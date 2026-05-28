"""
KRA eTIMS HTTP client.
All calls go through this module so sandbox/production switching is centralised.

Sandbox base URL: https://etims-sbx.kra.go.ke/etims-api
Production base URL: https://etims.kra.go.ke/etims-api

KRA eTIMS result codes:
  000 = Success
  001 = System error
  101 = Duplicate invoice number
  801+ = Validation errors
"""
import os
import httpx

ETIMS_ENV = os.getenv("ETIMS_ENV", "sandbox")
ETIMS_BASE = (
    "https://etims-sbx.kra.go.ke/etims-api"
    if ETIMS_ENV == "sandbox"
    else "https://etims.kra.go.ke/etims-api"
)
ETIMS_TIMEOUT = 30


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "tin": os.getenv("ETIMS_TIN", ""),
        "bhfId": os.getenv("ETIMS_BHF_ID", "00"),
    }


def _post(path: str, body: dict) -> dict:
    """Make a POST call to KRA eTIMS and return the parsed JSON response."""
    url = f"{ETIMS_BASE}{path}"
    try:
        resp = httpx.post(url, json=body, headers=_headers(), timeout=ETIMS_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        return {
            "resultCd": "HTTP_ERR",
            "resultMsg": f"HTTP {exc.response.status_code}: {exc.response.text[:300]}",
        }
    except httpx.RequestError as exc:
        return {
            "resultCd": "NET_ERR",
            "resultMsg": f"Network error: {exc}",
        }


def init_device(dvc_srl_no: str) -> dict:
    """
    POST /initializer/selectInitInfo
    Called once per device to activate it with KRA.
    """
    return _post(
        "/initializer/selectInitInfo",
        {
            "tin": os.getenv("ETIMS_TIN", ""),
            "bhfId": os.getenv("ETIMS_BHF_ID", "00"),
            "dvcSrlNo": dvc_srl_no,
        },
    )


def save_items(item_list: list[dict]) -> dict:
    """
    POST /items/saveItems
    Register or update stock items in KRA's system.
    Each item must have itemCd, itemClsCd, itemNm, taxTyCd etc.
    """
    return _post(
        "/items/saveItems",
        {
            "tin": os.getenv("ETIMS_TIN", ""),
            "bhfId": os.getenv("ETIMS_BHF_ID", "00"),
            "itemList": item_list,
        },
    )


def save_sales_transaction(payload: dict) -> dict:
    """
    POST /trnsSales/saveTrns
    Submit a completed sale transaction.
    payload must already be a fully-formed KRA transaction body.
    """
    return _post("/trnsSales/saveTrns", payload)


def save_refund_transaction(payload: dict) -> dict:
    """
    POST /trnsRefunds/saveTrns
    Submit a refund/void transaction (credit note).
    """
    return _post("/trnsRefunds/saveTrns", payload)
