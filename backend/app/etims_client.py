"""
KRA eTIMS HTTP client.
All calls accept an explicit `config` dict so sandbox/production switching is
driven by the DB-stored config, not module-level env vars.

config dict keys:
  tin        — KRA PIN (string)
  bhf_id     — Branch ID, default "00"
  dvc_srl_no — Device serial number
  env        — "sandbox" | "production"

Sandbox base URL:    https://etims-sbx.kra.go.ke/etims-api
Production base URL: https://etims.kra.go.ke/etims-api

KRA eTIMS result codes:
  000 = Success
  001 = System error
  101 = Duplicate invoice number
  801+ = Validation errors
"""
import httpx

ETIMS_TIMEOUT = 30


def _post(path: str, body: dict, config: dict) -> dict:
    """Make a POST call to KRA eTIMS and return the parsed JSON response."""
    env = config.get("env", "sandbox")
    base = (
        "https://etims-sbx.kra.go.ke/etims-api"
        if env == "sandbox"
        else "https://etims.kra.go.ke/etims-api"
    )
    url = f"{base}{path}"
    headers = {
        "Content-Type": "application/json",
        "tin": config.get("tin", ""),
        "bhfId": config.get("bhf_id", "00"),
    }
    try:
        resp = httpx.post(url, json=body, headers=headers, timeout=ETIMS_TIMEOUT)
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


def init_device(config: dict) -> dict:
    """
    POST /initializer/selectInitInfo
    Called once per device to activate it with KRA.
    """
    return _post(
        "/initializer/selectInitInfo",
        {
            "tin": config.get("tin", ""),
            "bhfId": config.get("bhf_id", "00"),
            "dvcSrlNo": config.get("dvc_srl_no", ""),
        },
        config,
    )


def get_branches(config: dict) -> dict:
    """
    POST /branches/selectBhfList
    Retrieve the list of branches registered under the TIN.
    """
    return _post(
        "/branches/selectBhfList",
        {
            "tin": config.get("tin", ""),
            "bhfId": "00",
            "lastReqDt": "20190101000000",
        },
        config,
    )


def save_items(item_list: list, config: dict) -> dict:
    """
    POST /items/saveItems
    Register or update stock items in KRA's system.
    Each item must have itemCd, itemClsCd, itemNm, taxTyCd etc.
    """
    return _post(
        "/items/saveItems",
        {
            "tin": config.get("tin", ""),
            "bhfId": config.get("bhf_id", "00"),
            "itemList": item_list,
        },
        config,
    )


def save_sales_transaction(payload: dict, config: dict) -> dict:
    """
    POST /trnsSales/saveTrns
    Submit a completed sale transaction.
    payload must already be a fully-formed KRA transaction body.
    """
    return _post("/trnsSales/saveTrns", payload, config)


def save_refund_transaction(payload: dict, config: dict) -> dict:
    """
    POST /trnsRefunds/saveTrns
    Submit a refund/void transaction (credit note).
    """
    return _post("/trnsRefunds/saveTrns", payload, config)
