import base64
import logging
import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import httpx
from ..database import get_db
from ..deps import get_tenant
from ..limiter import limiter
from ..models import StkRequest, Tenant
from ..schemas import MpesaStkRequest, MpesaStkResponse, StkStatusResponse

logger = logging.getLogger(__name__)

MPESA_ENV = os.getenv("MPESA_ENV", "sandbox")
MPESA_BASE = (
    "https://sandbox.safaricom.co.ke"
    if MPESA_ENV == "sandbox"
    else "https://api.safaricom.co.ke"
)
_IS_SANDBOX = MPESA_ENV == "sandbox"

router = APIRouter(prefix="/mpesa", tags=["mpesa"])

# Safaricom's published callback source IPs (production + sandbox).
_SAFARICOM_IPS = {
    "196.201.214.200", "196.201.214.206", "196.201.213.114",
    "196.201.214.207", "196.201.214.208", "196.201.213.44",
    "196.201.212.127", "196.201.212.138", "196.201.212.129",
    "196.201.212.136", "196.201.212.74",  "196.201.212.69",
}


def _require_safaricom_ip(request: Request) -> None:
    if os.getenv("MPESA_ENV", "sandbox") == "sandbox":
        return
    forwarded = request.headers.get("X-Forwarded-For")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host or "")
    if client_ip not in _SAFARICOM_IPS:
        raise HTTPException(status_code=403, detail="Forbidden: untrusted callback source")


def _daraja_credentials(tenant: Tenant) -> tuple[str, str]:
    """Return (consumer_key, consumer_secret) — tenant overrides fall back to env vars."""
    key    = tenant.daraja_consumer_key    or os.getenv("MPESA_CONSUMER_KEY", "")
    secret = tenant.daraja_consumer_secret or os.getenv("MPESA_CONSUMER_SECRET", "")
    return key, secret


def _get_access_token(tenant: Tenant) -> str:
    key, secret = _daraja_credentials(tenant)
    if not key or not secret:
        raise HTTPException(status_code=503, detail="M-Pesa credentials not configured")
    creds = base64.b64encode(f"{key}:{secret}".encode()).decode()
    try:
        response = httpx.get(
            f"{MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials",
            headers={"Authorization": f"Basic {creds}"},
            timeout=15,
        )
        response.raise_for_status()
        return response.json()["access_token"]
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Daraja auth failed: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Daraja unreachable: {e}")


@router.get("/mode")
def mpesa_mode():
    """Returns whether the backend is running in Daraja sandbox mode."""
    return {"sandbox": _IS_SANDBOX}


@router.post("/stk-push", response_model=MpesaStkResponse)
@limiter.limit("10/minute")
def stk_push(
    request: Request,
    payload: MpesaStkRequest,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    shortcode      = tenant.daraja_shortcode      or os.getenv("MPESA_SHORTCODE", "174379")
    passkey        = os.getenv("MPESA_PASSKEY", "")
    callback_url   = tenant.daraja_callback_url   or os.getenv("MPESA_CALLBACK_URL", "")
    shortcode_type = (tenant.daraja_shortcode_type or os.getenv("MPESA_SHORTCODE_TYPE", "paybill")).lower()
    transaction_type = "CustomerBuyGoodsOnline" if shortcode_type == "till" else "CustomerPayBillOnline"

    if not passkey:
        raise HTTPException(status_code=503, detail="M-Pesa passkey not configured")

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password  = base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()
    phone = payload.phone_number.replace("+", "").replace(" ", "")
    if phone.startswith("0"):
        phone = "254" + phone[1:]

    token = _get_access_token(tenant)
    ref   = f"TXN{payload.transaction_id}" if payload.transaction_id else f"DZL{timestamp}"

    try:
        response = httpx.post(
            f"{MPESA_BASE}/mpesa/stkpush/v1/processrequest",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "BusinessShortCode": shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "TransactionType": transaction_type,
                "Amount": int(payload.amount),
                "PartyA": phone,
                "PartyB": shortcode,
                "PhoneNumber": phone,
                "CallBackURL": callback_url,
                "AccountReference": ref,
                "TransactionDesc": "Dzeline Shop Payment",
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"STK Push failed: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Daraja unreachable: {e}")

    checkout_request_id = data.get("CheckoutRequestID", "")
    if checkout_request_id:
        db.add(StkRequest(
            tenant_id=tenant.id,
            checkout_request_id=checkout_request_id,
            status="pending",
            phone_number=payload.phone_number,
            amount=payload.amount,
        ))
        db.commit()
        logger.info("stk_push initiated tenant=%s amount=%s checkout=%s", tenant.id, payload.amount, checkout_request_id)

    return MpesaStkResponse(
        checkout_request_id=checkout_request_id,
        response_code=data.get("ResponseCode", ""),
        response_description=data.get("ResponseDescription", ""),
        customer_message=data.get("CustomerMessage", ""),
        sandbox=_IS_SANDBOX,
    )


@router.post("/callback")
async def mpesa_callback(request: Request, db: Session = Depends(get_db)):
    _require_safaricom_ip(request)

    body         = await request.json()
    stk_callback = body.get("Body", {}).get("stkCallback", {})
    result_code  = stk_callback.get("ResultCode")
    checkout_id  = stk_callback.get("CheckoutRequestID")

    row = db.query(StkRequest).filter(
        StkRequest.checkout_request_id == checkout_id
    ).first()

    if result_code == 0:
        metadata   = stk_callback.get("CallbackMetadata", {}).get("Item", [])
        mpesa_code = next((i["Value"] for i in metadata if i["Name"] == "MpesaReceiptNumber"), None)
        if row:
            row.status     = "confirmed"
            row.mpesa_code = mpesa_code
            db.commit()
        logger.info("mpesa_callback confirmed checkout=%s code=%s", checkout_id, mpesa_code)
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    if row:
        row.status = "failed"
        db.commit()
    logger.warning("mpesa_callback failed checkout=%s result_code=%s", checkout_id, result_code)
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.get("/status/{checkout_request_id}", response_model=StkStatusResponse)
def stk_status(
    checkout_request_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    row = db.query(StkRequest).filter(
        StkRequest.checkout_request_id == checkout_request_id,
        StkRequest.tenant_id == tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return StkStatusResponse(
        checkout_request_id=row.checkout_request_id,
        status=row.status,
        mpesa_code=row.mpesa_code,
    )


_STK_RESULT_CODES = {
    0:    "confirmed",
    1:    "failed",
    1032: "failed",
    1037: "failed",
    2001: "failed",
}


@router.get("/stk-query/{checkout_request_id}")
def stk_query(
    checkout_request_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    shortcode = tenant.daraja_shortcode or os.getenv("MPESA_SHORTCODE", "174379")
    passkey   = os.getenv("MPESA_PASSKEY", "")
    if not passkey:
        raise HTTPException(status_code=503, detail="M-Pesa passkey not configured")

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password  = base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()
    token     = _get_access_token(tenant)

    try:
        response = httpx.post(
            f"{MPESA_BASE}/mpesa/stkpushquery/v1/query",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "BusinessShortCode": shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "CheckoutRequestID": checkout_request_id,
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"STK query failed: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Daraja unreachable: {e}")

    try:
        result_code = int(data.get("ResultCode", -1))
    except (TypeError, ValueError):
        result_code = -1

    status = _STK_RESULT_CODES.get(result_code, "pending")

    row = db.query(StkRequest).filter(
        StkRequest.checkout_request_id == checkout_request_id,
        StkRequest.tenant_id == tenant.id,
    ).first()
    if row and status in ("confirmed", "failed") and row.status == "pending":
        row.status = status
        db.commit()

    return StkStatusResponse(
        checkout_request_id=checkout_request_id,
        status=status,
        mpesa_code=row.mpesa_code if row else None,
    )
