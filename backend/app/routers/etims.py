"""
eTIMS router — handles all KRA electronic invoice submissions.

Endpoints:
  GET  /etims/status               — check device/connection health
  GET  /etims/config               — load current eTIMS config
  POST /etims/config               — save eTIMS config to DB
  POST /etims/branches             — proxy selectBhfList to KRA
  POST /etims/items/register       — register product catalogue with KRA
  POST /etims/device/init          — initialize the eTIMS device with KRA
  POST /etims/submit-batch         — submit one or more transactions to KRA
"""
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import EtimsInvoice, EtimsCounter, EtimsConfig, Tenant, Transaction
from ..schemas import (
    EtimsBatchRequest,
    EtimsBatchResponse,
    EtimsConfigIn,
    EtimsConfigOut,
    EtimsBranch,
    EtimsBranchesResponse,
    EtimsInvoiceResult,
    EtimsItemsRegisterRequest,
    EtimsTransactionIn,
)
from .. import etims_client

router = APIRouter(prefix="/etims", tags=["etims"])

PMT_TYPE = {"CASH": "01", "MPESA": "05", "POCHI": "05"}


def _load_config(db: Session, tenant_id: int) -> dict:
    """Load eTIMS config for a tenant, falling back to environment variables."""
    cfg = db.query(EtimsConfig).filter(EtimsConfig.tenant_id == tenant_id).first()
    return {
        "tin":         (cfg.tin        if cfg and cfg.tin        else os.getenv("ETIMS_TIN", "")),
        "bhf_id":      (cfg.bhf_id     if cfg                    else os.getenv("ETIMS_BHF_ID", "00")),
        "dvc_srl_no":  (cfg.dvc_srl_no if cfg and cfg.dvc_srl_no else os.getenv("ETIMS_DEVICE_SERIAL", "")),
        "env":         (cfg.env        if cfg                    else os.getenv("ETIMS_ENV", "sandbox")),
        "initialized": (cfg.initialized if cfg                   else False),
    }


def _next_invc_no(db: Session, tenant_id: int) -> int:
    """Atomically increment and return the next sequential invoice number for this tenant."""
    counter = (
        db.query(EtimsCounter)
        .filter(EtimsCounter.tenant_id == tenant_id)
        .with_for_update()
        .first()
    )
    if not counter:
        counter = EtimsCounter(tenant_id=tenant_id, last_invc_no=0)
        db.add(counter)
        db.flush()
    counter.last_invc_no += 1
    db.flush()
    return counter.last_invc_no


def _fmt_dt(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y%m%d%H%M%S")


def _fmt_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y%m%d")


def _now_dt() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%d%H%M%S")


def _auto_item_cd(product_id: int) -> str:
    # Callers should pass a tenant-wide id (cloud_product_id) where available,
    # not a device-local one — see call sites for why.
    return f"KE1NTXU{product_id:07d}"


def _build_kra_payload(txn: EtimsTransactionIn, invc_no: int, vat_rate: float, taxpayer_name: str, config: dict) -> dict:
    tin    = config.get("tin", "")
    bhf_id = config.get("bhf_id", "00")
    pmt_cd = PMT_TYPE.get(txn.payment_method.upper(), "01")
    rcpt_typ = txn.rcpt_typ or ("R" if txn.voided else "S")

    item_list = []
    total_taxbl_a = total_tax_a = total_taxbl_b = total_tax_b = 0.0

    for seq, item in enumerate(txn.items, start=1):
        line_total = round(item.price * item.qty, 2)
        # cloud_product_id is tenant-wide (assigned once by product sync);
        # product_id is a per-device Dexie autoincrement id. Deriving the
        # item code from the latter meant the same physical product sold
        # from two different tills was reported to KRA under two different
        # item codes. Falls back to product_id only when the product hasn't
        # synced yet (rare, self-heals once it does).
        item_cd = item.etims_item_cd or _auto_item_cd(item.cloud_product_id or item.product_id or 0)

        if vat_rate > 0:
            taxbl_amt = round(line_total / (1 + vat_rate), 2)
            tax_amt   = round(line_total - taxbl_amt, 2)
            vat_ty_cd = "A"
            total_taxbl_a += taxbl_amt
            total_tax_a   += tax_amt
        else:
            taxbl_amt = line_total
            tax_amt   = 0.0
            vat_ty_cd = "B"
            total_taxbl_b += taxbl_amt

        item_list.append({
            "itemSeq": seq, "itemCd": item_cd, "itemClsCd": item.item_cls_cd or "10000000",
            "itemNm": item.name, "bcd": item.barcode or "",
            "pkgUnitCd": item.pkg_unit_cd or "NT", "pkg": 1,
            "qtyUnitCd": item.qty_unit_cd or "U", "qty": item.qty,
            "prc": item.price, "splyAmt": line_total,
            "dcRt": 0, "dcAmt": 0,
            "isrccCd": None, "isrccNm": None, "isrcRt": None, "isrcAmt": None,
            "vatTyCd": vat_ty_cd, "exciseTxTyCd": None,
            "taxblAmt": taxbl_amt, "taxAmt": tax_amt, "totAmt": line_total,
        })

    tot_taxbl = round(total_taxbl_a + total_taxbl_b, 2)
    tot_tax   = round(total_tax_a   + total_tax_b,   2)
    now       = _now_dt()

    return {
        "tin": tin, "bhfId": bhf_id, "invcNo": invc_no,
        "orgInvcNo": txn.org_invc_no or 0,
        "trdInvcNo": f"TXN{txn.local_id:06d}",
        "rcptTyCd": rcpt_typ, "pmtTyCd": pmt_cd,
        "salesTyCd": "N", "cfmDt": _fmt_dt(txn.timestamp),
        "salesDt": _fmt_date(txn.timestamp),
        "stockRlsDt": None, "cnclReqDt": None, "cnclDt": None,
        "prchrAcptcYn": "N", "remark": None,
        "regrId": taxpayer_name, "regrNm": taxpayer_name,
        "modrId": taxpayer_name, "modrNm": taxpayer_name,
        "rcptPbctDt": now, "totItemCnt": len(item_list),
        "taxblAmtA": round(total_taxbl_a, 2), "taxblAmtB": round(total_taxbl_b, 2),
        "taxblAmtC": 0.0, "taxblAmtD": 0.0, "taxblAmtE": 0.0,
        "taxRtA": round(vat_rate * 100, 2) if vat_rate > 0 else 0,
        "taxRtB": 0.0, "taxRtC": 0.0, "taxRtD": 0.0, "taxRtE": 0.0,
        "taxAmtA": round(total_tax_a, 2),
        "taxAmtB": 0.0, "taxAmtC": 0.0, "taxAmtD": 0.0, "taxAmtE": 0.0,
        "totTaxblAmt": tot_taxbl, "totTaxAmt": tot_tax,
        "totAmt": round(txn.total, 2),
        "prchrPin": None, "prchrNm": None, "trdeNm": None,
        "adrs": None, "topMsg": None, "btmMsg": None,
        "itemList": item_list,
    }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/status")
def etims_status(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    config = _load_config(db, tenant.id)
    env  = config.get("env", "sandbox")
    base = (
        "https://etims-sbx.kra.go.ke/etims-api"
        if env == "sandbox"
        else "https://etims.kra.go.ke/etims-api"
    )
    return {
        "env":         env,
        "tin":         config.get("tin", ""),
        "bhf_id":      config.get("bhf_id", "00"),
        "base_url":    base,
        "configured":  bool(config.get("tin")),
        "initialized": config.get("initialized", False),
    }


@router.get("/config", response_model=EtimsConfigOut)
def get_config(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    cfg = db.query(EtimsConfig).filter(EtimsConfig.tenant_id == tenant.id).first()
    if not cfg:
        return EtimsConfigOut(
            tin=os.getenv("ETIMS_TIN") or None,
            bhf_id=os.getenv("ETIMS_BHF_ID", "00"),
            dvc_srl_no=None,
            env=os.getenv("ETIMS_ENV", "sandbox"),
            initialized=False,
            initialized_at=None,
        )
    return cfg


@router.post("/config", response_model=EtimsConfigOut)
def save_config(
    payload: EtimsConfigIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    cfg = db.query(EtimsConfig).filter(EtimsConfig.tenant_id == tenant.id).first()
    if cfg:
        cfg.tin        = payload.tin.strip()
        cfg.bhf_id     = payload.bhf_id.strip() or "00"
        cfg.dvc_srl_no = payload.dvc_srl_no.strip()
        if payload.env is not None:
            cfg.env = payload.env
        cfg.initialized    = False
        cfg.activation_key = None
        cfg.initialized_at = None
        cfg.updated_at     = now_ms
    else:
        cfg = EtimsConfig(
            tenant_id  = tenant.id,
            tin        = payload.tin.strip(),
            bhf_id     = payload.bhf_id.strip() or "00",
            dvc_srl_no = payload.dvc_srl_no.strip(),
            env        = payload.env or os.getenv("ETIMS_ENV", "sandbox"),
            initialized    = False,
            activation_key = None,
            initialized_at = None,
            updated_at     = now_ms,
        )
        db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.post("/branches", response_model=EtimsBranchesResponse)
def query_branches(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    config = _load_config(db, tenant.id)
    if payload.get("tin"):
        config["tin"] = payload["tin"]
    if payload.get("bhf_id"):
        config["bhf_id"] = payload["bhf_id"]

    if not config.get("tin"):
        raise HTTPException(status_code=422, detail="TIN is required to query branches")

    result      = etims_client.get_branches(config)
    if result.get("resultCd") not in ("000", None):
        raise HTTPException(status_code=502, detail=result.get("resultMsg", "KRA error"))

    raw_branches = (result.get("data") or {}).get("bhfList") or []
    return EtimsBranchesResponse(branches=[
        EtimsBranch(bhfId=b.get("bhfId",""), bhfNm=b.get("bhfNm"), bhfSttsCd=b.get("bhfSttsCd"))
        for b in raw_branches
    ])


@router.post("/device/init")
def init_device(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    config = _load_config(db, tenant.id)
    if not config.get("tin"):
        raise HTTPException(status_code=503, detail="eTIMS TIN not configured. Save config first.")
    if not config.get("dvc_srl_no"):
        raise HTTPException(status_code=503, detail="Device serial not configured. Save config first.")

    result    = etims_client.init_device(config)
    result_cd = result.get("resultCd")

    if result_cd == "000":
        now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        data   = result.get("data") or {}
        activation_key = data.get("activationKey") or data.get("ackYn") or ""

        cfg = db.query(EtimsConfig).filter(EtimsConfig.tenant_id == tenant.id).first()
        if cfg:
            cfg.initialized    = True
            cfg.activation_key = str(activation_key)
            cfg.initialized_at = now_ms
            cfg.updated_at     = now_ms
            db.commit()

        return {"initialized": True, "resultCd": result_cd,
                "resultMsg": result.get("resultMsg", "Device initialized"), "data": data}

    raise HTTPException(
        status_code=502,
        detail=result.get("resultMsg") or f"KRA returned code {result_cd}",
    )


@router.post("/items/register")
def register_items(
    payload: EtimsItemsRegisterRequest,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    config = _load_config(db, tenant.id)
    if not config.get("tin"):
        raise HTTPException(status_code=503, detail="ETIMS_TIN not configured")

    tin  = config["tin"]
    now  = _now_dt()
    item_list = []
    for seq, item in enumerate(payload.items, start=1):
        item_cd = item.etims_item_cd or _auto_item_cd(item.cloud_product_id or item.product_id)
        item_list.append({
            "itemSeq": seq, "itemCd": item_cd,
            "itemClsCd": item.item_cls_cd or "10000000",
            "itemNm": item.name, "itemStdNm": None, "orgnNatCd": "KE",
            "pkgUnitCd": item.pkg_unit_cd or "NT", "qtyUnitCd": item.qty_unit_cd or "U",
            "taxTyCd": item.tax_typ_cd or "A", "btchNo": None,
            "bcd": item.barcode or "", "dftPrc": item.price, "addInfo": None,
            "sftyQty": 0, "isrcAplcbYn": "N", "useYn": "Y",
            "regrId": tin, "regrNm": tin, "modrId": tin, "modrNm": tin,
        })

    result = etims_client.save_items(item_list, config)
    if result.get("resultCd") not in ("000", None):
        raise HTTPException(status_code=502, detail=result.get("resultMsg", "KRA error"))
    return {"registered": len(item_list), "kra_result": result}


@router.post("/submit-batch", response_model=EtimsBatchResponse)
def submit_batch(
    payload: EtimsBatchRequest,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    config = _load_config(db, tenant.id)
    if not config.get("tin"):
        raise HTTPException(status_code=503, detail="ETIMS_TIN not configured")

    results: list[EtimsInvoiceResult] = []
    submitted = failed = skipped = 0
    vat_rate      = payload.vat_rate or 0.16
    taxpayer_name = payload.taxpayer_name or "Admin"
    now_ms        = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    for txn in payload.transactions:
        # transaction_id is the real, tenant-wide Transaction.id (what the
        # frontend calls cloud_id) — local_id alone is a per-device Dexie
        # autoincrement id and is ambiguous once transactions sync across
        # devices, so it can no longer be trusted as the dedup key.
        if txn.transaction_id is None:
            results.append(EtimsInvoiceResult(local_id=txn.local_id, status="skipped"))
            skipped += 1
            continue

        existing = (
            db.query(EtimsInvoice)
            .filter(
                EtimsInvoice.tenant_id      == tenant.id,
                EtimsInvoice.transaction_id == txn.transaction_id,
                EtimsInvoice.status         == "submitted",
            )
            .first()
        )
        if existing:
            results.append(EtimsInvoiceResult(
                local_id=txn.local_id, status="submitted",
                invc_no=existing.invc_no, cu_invc_no=existing.cu_invc_no,
                rcpt_sign=existing.rcpt_sign, sdc_id=existing.sdc_id,
                mrc_no=existing.mrc_no, vsdc_rcpt_pbct_date=existing.vsdc_rcpt_pbct_date,
            ))
            skipped += 1
            continue

        invc_no     = _next_invc_no(db, tenant.id)
        kra_payload = _build_kra_payload(txn, invc_no, vat_rate, taxpayer_name, config)

        if txn.voided or txn.rcpt_typ == "R":
            kra_resp = etims_client.save_refund_transaction(kra_payload, config)
        else:
            kra_resp = etims_client.save_sales_transaction(kra_payload, config)

        result_cd = kra_resp.get("resultCd", "ERR")
        success   = result_cd == "000"
        data      = kra_resp.get("data", {}) or {}

        record = EtimsInvoice(
            tenant_id      = tenant.id,
            local_txn_id   = txn.local_id,
            transaction_id = txn.transaction_id,
            invc_no      = invc_no,
            rcpt_typ     = txn.rcpt_typ or "S",
            status       = "submitted" if success else "failed",
            cu_invc_no   = data.get("rcptNo"),
            rcpt_sign    = data.get("rcptSign"),
            intr_data    = data.get("intrlData"),
            sdc_id       = data.get("sdcId"),
            mrc_no       = data.get("mrcNo"),
            vsdc_rcpt_pbct_date = data.get("vsdcRcptPbctDate"),
            error_msg    = None if success else kra_resp.get("resultMsg", "Unknown error"),
            attempts     = 1,
            submitted_at = now_ms if success else None,
        )
        db.add(record)

        # Write the outcome back onto the actual transaction row so it's
        # visible cross-device — etims_status already rides pullTransactions()/
        # push unchanged, this is what makes that propagation carry a real value.
        txn_row = (
            db.query(Transaction)
            .filter(Transaction.id == txn.transaction_id, Transaction.tenant_id == tenant.id)
            .first()
        )
        if txn_row:
            txn_row.etims_status = "submitted" if success else "failed"
            txn_row.updated_at = now_ms

        db.commit()
        db.refresh(record)

        submitted += 1 if success else 0
        failed    += 0 if success else 1

        results.append(EtimsInvoiceResult(
            local_id=txn.local_id, status=record.status,
            invc_no=record.invc_no, cu_invc_no=record.cu_invc_no,
            rcpt_sign=record.rcpt_sign, sdc_id=record.sdc_id,
            mrc_no=record.mrc_no, vsdc_rcpt_pbct_date=record.vsdc_rcpt_pbct_date,
            error=record.error_msg,
        ))

    return EtimsBatchResponse(results=results, submitted=submitted, failed=failed, skipped=skipped)
