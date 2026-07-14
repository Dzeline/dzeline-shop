"""
SMS webhook router — receives M-Pesa SMS from android-sms-gateway,
parses confirmation codes, and stores them per tenant so the frontend
can reconcile manually-entered codes against them once back online.

Endpoints:
  POST /sms/webhook          — receive SMS from Android notification listener
  GET  /sms/verified-codes   — frontend polls to reconcile pending codes

Configure the Android app (android-sms-gateway or SMS Forwarder) with:
  URL:    https://<render-host>/sms/webhook?key=<your-api-key>
  Header: X-SMS-Secret: <value of SMS_WEBHOOK_SECRET env var>

The ?key= param scopes codes to that tenant. Without it the endpoint
falls back to the shared SMS_WEBHOOK_SECRET and stores with tenant_id=NULL
(single-shop backwards-compat — visible to all tenants via verified-codes).
"""
import hashlib
import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import SmsVerifiedCode, Tenant

router = APIRouter(prefix="/sms", tags=["sms"])

# M-Pesa "you received" SMS (till / paybill / pochi incoming)
_RECEIVED = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+You have received\s+KES\s+([\d,]+\.?\d*)"
    r"\s+from\s+(.+?)\s+(0\d{2}[\*\d]+\d{3}|\d{9,12})\s+on",
    re.IGNORECASE,
)

# M-Pesa "paid to" SMS (customer's own outgoing confirmation)
_PAID_TO = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+Ksh([\d,]+\.?\d*)\s+paid to\s+(.+?)\s+on",
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

    Authentication — one of:
      • ?key=<tenant-api-key>  in the URL  (preferred: scopes codes to that tenant)
      • X-SMS-Secret header matching SMS_WEBHOOK_SECRET env var  (legacy single-shop)
    """
    tenant_id = None

    if key:
        # Preferred: tenant identified by their API key — properly scoped
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        tenant = db.query(Tenant).filter(
            Tenant.api_key_hash == key_hash,
            Tenant.active == True,  # noqa: E712
        ).first()
        if not tenant:
            raise HTTPException(status_code=401, detail="Invalid API key in webhook URL")
        tenant_id = tenant.id
    else:
        # Legacy: shared secret, stores with tenant_id=NULL
        secret = os.getenv("SMS_WEBHOOK_SECRET", "")
        if not secret:
            raise HTTPException(status_code=503, detail="Webhook secret not configured on server")
        if x_sms_secret != secret:
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
    Return codes received via SMS since the given ms-epoch timestamp.
    Includes both tenant-scoped codes (webhook with ?key=) and unscoped
    codes stored before multi-tenant support was added (tenant_id = NULL).
    """
    rows = (
        db.query(SmsVerifiedCode)
        .filter(
            or_(
                SmsVerifiedCode.tenant_id == tenant.id,
                SmsVerifiedCode.tenant_id.is_(None),
            ),
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
