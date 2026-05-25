import base64
import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import httpx
from ..database import get_db
from ..schemas import MpesaStkRequest, MpesaStkResponse

router = APIRouter(prefix="/mpesa", tags=["mpesa"])

MPESA_ENV = os.getenv("MPESA_ENV", "sandbox")
MPESA_BASE = (
    "https://sandbox.safaricom.co.ke"
    if MPESA_ENV == "sandbox"
    else "https://api.safaricom.co.ke"
)


def _get_access_token() -> str:
    key = os.getenv("MPESA_CONSUMER_KEY", "")
    secret = os.getenv("MPESA_CONSUMER_SECRET", "")
    if not key or not secret:
        raise HTTPException(status_code=503, detail="M-Pesa credentials not configured")
    creds = base64.b64encode(f"{key}:{secret}".encode()).decode()
    response = httpx.get(
        f"{MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials",
        headers={"Authorization": f"Basic {creds}"},
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["access_token"]


@router.post("/stk-push", response_model=MpesaStkResponse)
def stk_push(payload: MpesaStkRequest, db: Session = Depends(get_db)):
    shortcode = os.getenv("MPESA_SHORTCODE", "174379")
    passkey = os.getenv("MPESA_PASSKEY", "")
    callback_url = os.getenv("MPESA_CALLBACK_URL", "https://dzeline.online/api/mpesa/callback")

    if not passkey:
        raise HTTPException(status_code=503, detail="M-Pesa passkey not configured")

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()
    phone = payload.phone_number.replace("+", "").replace(" ", "")
    if phone.startswith("0"):
        phone = "254" + phone[1:]

    token = _get_access_token()
    response = httpx.post(
        f"{MPESA_BASE}/mpesa/stkpush/v1/processrequest",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "BusinessShortCode": shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerBuyGoodsOnline",
            "Amount": int(payload.amount),
            "PartyA": phone,
            "PartyB": shortcode,
            "PhoneNumber": phone,
            "CallBackURL": callback_url,
            "AccountReference": f"TXN{payload.transaction_id}",
            "TransactionDesc": "Dzeline Shop Payment",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return MpesaStkResponse(
        checkout_request_id=data.get("CheckoutRequestID", ""),
        response_code=data.get("ResponseCode", ""),
        response_description=data.get("ResponseDescription", ""),
        customer_message=data.get("CustomerMessage", ""),
    )


@router.post("/callback")
async def mpesa_callback(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    stk_callback = body.get("Body", {}).get("stkCallback", {})
    result_code = stk_callback.get("ResultCode")
    checkout_id = stk_callback.get("CheckoutRequestID")

    if result_code == 0:
        metadata = stk_callback.get("CallbackMetadata", {}).get("Item", [])
        mpesa_code = next((i["Value"] for i in metadata if i["Name"] == "MpesaReceiptNumber"), None)
        return {"status": "success", "code": mpesa_code, "checkout_id": checkout_id}

    return {"status": "failed", "result_code": result_code}
