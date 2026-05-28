"""
SMS webhook router — receives M-Pesa SMS from android-sms-listener,
parses confirmation codes, and stores them per tenant so the frontend
can reconcile against pending_mpesa IndexedDB rows.

Endpoints:
  POST /sms/webhook          — receive SMS from Android notification listener
  GET  /sms/verified-codes   — frontend polls for newly verified codes
"""
import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import SmsVerifiedCode, Tenant

router = APIRouter(prefix="/sms", tags=["sms"])

_RECEIVED = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+You have received\s+KES\s+([\d,]+\.?\d*)"
    r"\s+from\s+(.+?)\s+(0\d{2}[\*\d]+\d{3}|\d{9,12})\s+on",
    re.IGNORECASE,
)

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
    x_sms_secret: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Receive SMS webhook from android-sms-listener.
    Authenticates via X-SMS-Secret (shop-level secret, not the API key).
    The tenant is identified by matching the secret against stored config.
    """
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

    # Webhook is single-tenant for now — stores without tenant_id (NULL).
    # Phase 2: include tenant_id in the webhook URL path.
    existing = db.query(SmsVerifiedCode).filter(
        SmsVerifiedCode.confirmation_code == parsed["confirmation_code"],
        SmsVerifiedCode.tenant_id == None,  # noqa: E711
    ).first()
    if not existing:
        db.add(SmsVerifiedCode(
            tenant_id         = None,
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
    Return codes verified via SMS since the given ms-epoch timestamp.
    The frontend calls this on reconnect passing its last-check timestamp.
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
