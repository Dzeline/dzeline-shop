"""
KRA eTIMS HTTP client.
All calls accept an explicit `config` dict so sandbox/production switching is
driven by the DB-stored config, not module-level env vars.

config dict keys:
  tin        — KRA PIN (string)
  bhf_id     — Branch ID, default "00"
  dvc_srl_no — Device serial number
  env        — "sandbox" | "production"

Sandbox base URL:    https://etims-api-sbx.kra.go.ke/etims-api
Production base URL: https://etims-api.kra.go.ke/etims-api

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
        "https://etims-api-sbx.kra.go.ke/etims-api"
        if env == "sandbox"
        else "https://etims-api.kra.go.ke/etims-api"
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
    POST /selectInitOsdcInfo
    Called once per device to activate it with KRA. The response's
    data.info.cmcKey is the Communication Key every other endpoint requires —
    callers must persist it and pass it back in as config["cmc_key"].
    """
    return _post(
        "/selectInitOsdcInfo",
        {
            "tin": config.get("tin", ""),
            "bhfId": config.get("bhf_id", "00"),
            "dvcSrlNo": config.get("dvc_srl_no", ""),
        },
        config,
    )


def get_branches(config: dict) -> dict:
    """
    POST /selectBhfList
    Retrieve the list of branches registered under the TIN.
    """
    return _post(
        "/selectBhfList",
        {
            "tin": config.get("tin", ""),
            "bhfId": "00",
            "cmcKey": config.get("cmc_key", ""),
            "lastReqDt": "20190101000000",
        },
        config,
    )


def save_item(item: dict, config: dict) -> dict:
    """
    POST /saveItem
    Register or update a single stock item in KRA's system — the OSCU spec
    takes one item per call, not a batch list. item must have itemCd,
    itemClsCd, itemNm, taxTyCd etc.
    """
    return _post(
        "/saveItem",
        {
            "tin": config.get("tin", ""),
            "bhfId": config.get("bhf_id", "00"),
            "cmcKey": config.get("cmc_key", ""),
            **item,
        },
        config,
    )


def save_sales_transaction(payload: dict, config: dict) -> dict:
    """
    POST /saveTrnsSalesOsdc
    Submit a completed sale transaction — also used for refunds/credit notes,
    distinguished only by payload["rcptTyCd"] ("S" vs "R"); there is no
    separate refund endpoint in the OSCU spec.
    payload must already be a fully-formed KRA transaction body.
    """
    return _post("/saveTrnsSalesOsdc", payload, config)
