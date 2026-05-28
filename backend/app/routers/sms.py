"""
SMS webhook router.

Receives incoming SMS from android-sms-gateway running on the shop device,
parses M-Pesa confirmation messages, and stores the extracted codes so the
frontend can reconcile them against pending_mpesa IndexedDB rows.

Setup on android-sms-gateway app:
  Webhook URL : https://your-backend.com/sms/webhook
  Header      : X-SMS-Secret: <value of SMS_WEBHOOK_SECRET env var>

Endpoints:
  POST /sms/webhook          — receive SMS from android-sms-gateway
  GET  /sms/verified-codes   — frontend polls for newly verified codes
"""
import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SmsVerifiedCode

router = APIRouter(prefix="/sms", tags=["sms"])

# ── M-Pesa SMS patterns ───────────────────────────────────────────────────────

# "You have received" — Pochi la Biashara / C2B (money arrives on shop SIM)
_RECEIVED = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+You have received\s+KES\s+([\d,]+\.?\d*)"
    r"\s+from\s+(.+?)\s+(0\d{2}[\*\d]+\d{3}|\d{9,12})\s+on",
    re.IGNORECASE,
)

# "Ksh X paid to" — Till / Paybill payment confirmation (arrives on owner SIM)
_PAID_TO = re.compile(
    r"^([A-Z0-9]{10})\s+confirmed\.\s+Ksh([\d,]+\.?\d*)\s+paid to\s+(.+?)\s+on",
    re.IGNORECASE,
)


def _parse_mpesa_sms(body: str) -> dict | None:
    """Extract structured fields from an M-Pesa SMS body. Returns None if not M-Pesa."""
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def sms_webhook(
    request: Request,
    x_sms_secret: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Receive an SMS webhook from android-sms-gateway.
    Accepts two body shapes:
      1. { "address": "MPESA", "body": "...", "date": <ms> }
      2. { "message": { "address": "MPESA", "body": "...", "date": <ms> } }
    """
    secret = os.getenv("SMS_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured on server")
    if x_sms_secret != secret:
        raise HTTPException(status_code=401, detail="Invalid SMS webhook secret")

    payload = await request.json()

    # Unwrap either shape
    msg = payload.get("message") or payload
    address = str(msg.get("address", "")).upper()
    body    = str(msg.get("body", ""))
    date_ms = msg.get("date") or int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    # Only process messages from the MPESA sender ID
    if address != "MPESA":
        return {"accepted": False, "reason": "not_mpesa"}

    parsed = _parse_mpesa_sms(body)
    if not parsed:
        return {"accepted": False, "reason": "unrecognised_format"}

    # Upsert — ignore duplicates (idempotent)
    existing = db.query(SmsVerifiedCode).filter(
        SmsVerifiedCode.confirmation_code == parsed["confirmation_code"]
    ).first()
    if not existing:
        db.add(SmsVerifiedCode(
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
def verified_codes(since: int = 0, db: Session = Depends(get_db)):
    """
    Return M-Pesa codes verified via SMS since the given ms-epoch timestamp.
    The frontend calls this on reconnect, passing its last-check timestamp.
    """
    rows = (
        db.query(SmsVerifiedCode)
        .filter(SmsVerifiedCode.created_at > since)
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
