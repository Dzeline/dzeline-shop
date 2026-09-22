"""
SMS webhook router — receives M-Pesa SMS from android-sms-gateway,
parses confirmation codes, and stores them per tenant so the frontend
can reconcile manually-entered codes against them once back online.

Endpoints:
  POST /sms/webhook          — receive SMS from Android notification listener
  GET  /sms/verified-codes   — frontend polls to reconcile pending codes

Configure the Android listener with:
  URL:    https://<render-host>/sms/webhook?key=<your-api-key>
  Header: X-SMS-Secret: <value of SMS_WEBHOOK_SECRET env var>   (optional second factor)

The ?key= param is REQUIRED — it identifies the shop, and every stored code is
scoped to that tenant.

Previously a webhook could authenticate with the shared SMS_WEBHOOK_SECRET
alone and its codes were stored with tenant_id = NULL, which verified-codes
then handed to *every* tenant. That leaked confirmation codes, amounts and
customer names between shops, and let one shop's sale be reconciled against
another shop's payment. Unscoped writes are now rejected, and reads are scoped
strictly to the calling tenant.

Migrating an existing deployment: point the listener at a ?key= URL (the
Android app builds it from the API key field), then adopt any orphaned rows:

    UPDATE sms_verified_codes SET tenant_id = <id> WHERE tenant_id IS NULL;
"""
import hashlib
import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import SmsVerifiedCode, Tenant

router = APIRouter(prefix="/sms", tags=["sms"])

# Safaricom writes the amount as "Ksh1,000.00" or "KES 1,000.00" depending on
# the message and the era, with the space optional. The two patterns below used
# to disagree with each other about this — _RECEIVED demanded "KES" plus
# whitespace, which never matches the "Ksh250.00" form, so real traffic could
# be rejected as unrecognised_format while the app's own test message (written
# in the "KES " spelling) passed. Accept both, space optional.
_AMOUNT = r"(?:KES|Ksh)\s*([\d,]+\.?\d*)"

# M-Pesa "you received" SMS (till / paybill / pochi incoming)
_RECEIVED = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+You have received\s+" + _AMOUNT +
    r"\s+from\s+(.+?)\s+(0\d{2}[\*\d]+\d{3}|\d{9,12})\s+on",
    re.IGNORECASE,
)

# M-Pesa "paid to" SMS (customer's own outgoing confirmation)
_PAID_TO = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+" + _AMOUNT + r"\s+paid to\s+(.+?)\s+on",
    re.IGNORECASE,
)


def _parse_mpesa_sms(body: str) -> dict | None:
    body = body.strip()
    m = _RECEIVED.match(body)
    if m:
        return {
            "confirmation_code": m.group(1).upper(),
            "amount":            float(m.group(2).replace(",", "")),
            "sender_name":       m.group(3).strip(),
            "sender_phone":      m.group(4),
        }
    m = _PAID_TO.match(body)
    if m:
        return {
            "confirmation_code": m.group(1).upper(),
            "amount":            float(m.group(2).replace(",", "")),
            "sender_name":       m.group(3).strip(),
            "sender_phone":      None,
        }
    return None


@router.post("/webhook")
async def sms_webhook(
    request: Request,
    key: str | None = Query(default=None),
    x_sms_secret: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Receive SMS webhook from the Android device that holds the M-Pesa SIM.

    Authentication:
      • ?key=<tenant-api-key> in the URL — required; identifies the shop
      • X-SMS-Secret header — additionally required when the server has
        SMS_WEBHOOK_SECRET configured
    """
    if not key:
        # Refused rather than stored unscoped: a code with no tenant used to be
        # readable by every shop on the deployment.
        raise HTTPException(
            status_code=401,
            detail="Missing ?key= — the webhook URL must carry the shop's API key",
        )

    key_hash = hashlib.sha256(key.encode()).hexdigest()
    tenant = db.query(Tenant).filter(
        Tenant.api_key_hash == key_hash,
        Tenant.active == True,  # noqa: E712
    ).first()
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid API key in webhook URL")
    tenant_id = tenant.id

    # Second factor when configured — the key sits in a URL, which is the more
    # leakable half of the pair (logs, proxies, screenshots of the app).
    secret = os.getenv("SMS_WEBHOOK_SECRET", "")
    if secret and x_sms_secret != secret:
        raise HTTPException(status_code=401, detail="Invalid SMS webhook secret")

    payload = await request.json()
    msg     = payload.get("message") or payload
    address = str(msg.get("address", "")).upper()
    body    = str(msg.get("body", ""))
    date_ms = msg.get("date") or int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    if address != "MPESA":
        return {"accepted": False, "reason": "not_mpesa"}

    parsed = _parse_mpesa_sms(body)
    if not parsed:
        return {"accepted": False, "reason": "unrecognised_format"}

    existing = db.query(SmsVerifiedCode).filter(
        SmsVerifiedCode.confirmation_code == parsed["confirmation_code"],
        SmsVerifiedCode.tenant_id == tenant_id,
    ).first()
    if not existing:
        db.add(SmsVerifiedCode(
            tenant_id         = tenant_id,
            confirmation_code = parsed["confirmation_code"],
            amount            = parsed["amount"],
            sender_name       = parsed.get("sender_name"),
            sender_phone      = parsed.get("sender_phone"),
            received_at       = int(date_ms),
            raw_sms           = body,
        ))
        db.commit()

    return {"accepted": True, "confirmation_code": parsed["confirmation_code"]}


@router.get("/verified-codes")
def verified_codes(
    since: int = 0,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """
    Return this tenant's codes received via SMS since the given ms-epoch
    timestamp.

    Scoped strictly to the calling tenant. Rows with tenant_id = NULL — written
    by the old unscoped webhook path — are deliberately NOT returned: handing
    them to every tenant is what leaked payment data between shops. Adopt any
    such rows with the UPDATE in this module's docstring.
    """
    rows = (
        db.query(SmsVerifiedCode)
        .filter(
            SmsVerifiedCode.tenant_id == tenant.id,
            SmsVerifiedCode.created_at > since,
        )
        .order_by(SmsVerifiedCode.created_at.asc())
        .limit(200)
        .all()
    )
    return {
        "codes": [
            {
                "confirmation_code": r.confirmation_code,
                "amount":            r.amount,
                "sender_name":       r.sender_name,
                "received_at":       r.received_at,
            }
            for r in rows
        ]
    }
