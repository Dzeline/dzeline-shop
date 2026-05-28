"""
eTIMS router — handles all KRA electronic invoice submissions.

Endpoints:
  GET  /etims/status               — check device/connection health
  POST /etims/items/register       — register product catalogue with KRA
  POST /etims/submit-batch         — submit one or more transactions to KRA
  POST /etims/device/init          — initialize the eTIMS device (first-time setup)
"""
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EtimsInvoice, EtimsCounter
from ..schemas import (
    EtimsBatchRequest,
    EtimsBatchResponse,
    EtimsInvoiceResult,
    EtimsItemsRegisterRequest,
    EtimsTransactionIn,
)
from .. import etims_client

router = APIRouter(prefix="/etims", tags=["etims"])

# ── Payment type code mapping ────────────────────────────────────────────────
PMT_TYPE = {
    "CASH":  "01",
    "MPESA": "05",
    "POCHI": "05",
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _next_invc_no(db: Session) -> int:
    """Atomically increment and return the next sequential eTIMS invoice number."""
    counter = db.query(EtimsCounter).filter(EtimsCounter.id == 1).with_for_update().first()
    if not counter:
        counter = EtimsCounter(id=1, last_invc_no=0)
        db.add(counter)
        db.flush()
    counter.last_invc_no += 1
    db.flush()
    return counter.last_invc_no


def _fmt_dt(ms: int) -> str:
    """Convert ms epoch to KRA datetime string YYYYMMDDHHMMSS."""
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y%m%d%H%M%S")


def _fmt_date(ms: int) -> str:
    """Convert ms epoch to KRA date string YYYYMMDD."""
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y%m%d")


def _now_dt() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%d%H%M%S")


def _auto_item_cd(product_id: int) -> str:
    """
    Generate a KRA-format item code for products not yet registered.
    Format: KE1NTXU{7-digit-product-id}
    Replace with real KRA-assigned codes after item registration.
    """
    return f"KE1NTXU{product_id:07d}"


def _build_kra_payload(txn: EtimsTransactionIn, invc_no: int, vat_rate: float, taxpayer_name: str) -> dict:
    """Build the full KRA saveTrns / saveTrns (refund) JSON payload."""
    tin = os.getenv("ETIMS_TIN", "")
    bhf_id = os.getenv("ETIMS_BHF_ID", "00")
    pmt_cd = PMT_TYPE.get(txn.payment_method.upper(), "01")
    rcpt_typ = txn.rcpt_typ or ("R" if txn.voided else "S")
    sales_dt = _fmt_date(txn.timestamp)
    cfg_dt = _fmt_dt(txn.timestamp)
    now = _now_dt()

    # Build item list + running tax totals
    item_list = []
    total_taxbl_a = 0.0   # 16% VAT taxable base
    total_tax_a   = 0.0
    total_taxbl_b = 0.0   # Zero-rated / exempt
    total_tax_b   = 0.0

    for seq, item in enumerate(txn.items, start=1):
        line_total = round(item.price * item.qty, 2)
        item_cd = item.etims_item_cd or _auto_item_cd(item.product_id)

        # VAT-inclusive pricing: taxable = total / (1 + rate), tax = total - taxable
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
            "itemSeq":      seq,
            "itemCd":       item_cd,
            "itemClsCd":    item.item_cls_cd or "10000000",
            "itemNm":       item.name,
            "bcd":          item.barcode or "",
            "pkgUnitCd":    item.pkg_unit_cd or "NT",
            "pkg":          1,
            "qtyUnitCd":    item.qty_unit_cd or "U",
            "qty":          item.qty,
            "prc":          item.price,
            "splyAmt":      line_total,
            "dcRt":         0,
            "dcAmt":        0,
            "isrccCd":      None,
            "isrccNm":      None,
            "isrcRt":       None,
            "isrcAmt":      None,
            "vatTyCd":      vat_ty_cd,
            "exciseTxTyCd": None,
            "taxblAmt":     taxbl_amt,
            "taxAmt":       tax_amt,
            "totAmt":       line_total,
        })

    tot_taxbl = round(total_taxbl_a + total_taxbl_b, 2)
    tot_tax   = round(total_tax_a   + total_tax_b,   2)

    return {
        "tin":          tin,
        "bhfId":        bhf_id,
        "invcNo":       invc_no,
        "orgInvcNo":    txn.org_invc_no or 0,
        "trdInvcNo":    f"TXN{txn.local_id:06d}",
        "rcptTyCd":     rcpt_typ,
        "pmtTyCd":      pmt_cd,
        "salesTyCd":    "N",
        "cfmDt":        cfg_dt,
        "salesDt":      sales_dt,
        "stockRlsDt":   None,
        "cnclReqDt":    None,
        "cnclDt":       None,
        "prchrAcptcYn": "N",
        "remark":       None,
        "regrId":       taxpayer_name,
        "regrNm":       taxpayer_name,
        "modrId":       taxpayer_name,
        "modrNm":       taxpayer_name,
        "rcptPbctDt":   now,
        "totItemCnt":   len(item_list),
        "taxblAmtA":    round(total_taxbl_a, 2),
        "taxblAmtB":    round(total_taxbl_b, 2),
        "taxblAmtC":    0.0,
        "taxblAmtD":    0.0,
        "taxblAmtE":    0.0,
        "taxRtA":       round(vat_rate * 100, 2) if vat_rate > 0 else 0,
        "taxRtB":       0.0,
        "taxRtC":       0.0,
        "taxRtD":       0.0,
        "taxRtE":       0.0,
        "taxAmtA":      round(total_tax_a, 2),
        "taxAmtB":      0.0,
        "taxAmtC":      0.0,
        "taxAmtD":      0.0,
        "taxAmtE":      0.0,
        "totTaxblAmt":  tot_taxbl,
        "totTaxAmt":    tot_tax,
        "totAmt":       round(txn.total, 2),
        "prchrPin":     None,
        "prchrNm":      None,
        "trdeNm":       None,
        "adrs":         None,
        "topMsg":       None,
        "btmMsg":       None,
        "itemList":     item_list,
    }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/status")
def etims_status():
    """Return current eTIMS configuration (no credentials, just env info)."""
    return {
        "env":    os.getenv("ETIMS_ENV", "sandbox"),
        "tin":    os.getenv("ETIMS_TIN", ""),
        "bhf_id": os.getenv("ETIMS_BHF_ID", "00"),
        "base_url": etims_client.ETIMS_BASE,
        "configured": bool(os.getenv("ETIMS_TIN")),
    }


@router.post("/device/init")
def init_device(dvc_srl_no: str):
    """
    Send device initialisation request to KRA.
    Call once when setting up eTIMS for the first time.
    """
    if not os.getenv("ETIMS_TIN"):
        raise HTTPException(status_code=503, detail="ETIMS_TIN not configured")
    result = etims_client.init_device(dvc_srl_no)
    if result.get("resultCd") not in ("000", None):
        raise HTTPException(status_code=502, detail=result.get("resultMsg", "KRA error"))
    return result


@router.post("/items/register")
def register_items(payload: EtimsItemsRegisterRequest):
    """
    Register or update product catalogue items with KRA.
    Should be called whenever new products are added or prices change.
    """
    if not os.getenv("ETIMS_TIN"):
        raise HTTPException(status_code=503, detail="ETIMS_TIN not configured")

    tin = os.getenv("ETIMS_TIN", "")
    bhf_id = os.getenv("ETIMS_BHF_ID", "00")
    now = _now_dt()

    item_list = []
    for seq, item in enumerate(payload.items, start=1):
        item_cd = item.etims_item_cd or _auto_item_cd(item.product_id)
        item_list.append({
            "itemSeq":     seq,
            "itemCd":      item_cd,
            "itemClsCd":   item.item_cls_cd or "10000000",
            "itemNm":      item.name,
            "itemStdNm":   None,
            "orgnNatCd":   "KE",
            "pkgUnitCd":   item.pkg_unit_cd or "NT",
            "qtyUnitCd":   item.qty_unit_cd or "U",
            "taxTyCd":     item.tax_typ_cd or "A",
            "btchNo":      None,
            "bcd":         item.barcode or "",
            "dftPrc":      item.price,
            "addInfo":     None,
            "sftyQty":     0,
            "isrcAplcbYn": "N",
            "useYn":       "Y",
            "regrId":      tin,
            "regrNm":      tin,
            "modrId":      tin,
            "modrNm":      tin,
        })

    result = etims_client.save_items(item_list)
    if result.get("resultCd") not in ("000", None):
        raise HTTPException(status_code=502, detail=result.get("resultMsg", "KRA error"))
    return {"registered": len(item_list), "kra_result": result}


@router.post("/submit-batch", response_model=EtimsBatchResponse)
def submit_batch(payload: EtimsBatchRequest, db: Session = Depends(get_db)):
    """
    Submit one or more transactions to KRA eTIMS.
    Frontend sends the full transaction data; we build the KRA payload here.
    Already-submitted invoices (found by local_id) are skipped.
    """
    if not os.getenv("ETIMS_TIN"):
        raise HTTPException(status_code=503, detail="ETIMS_TIN not configured")

    results: list[EtimsInvoiceResult] = []
    submitted = failed = skipped = 0
    vat_rate = payload.vat_rate or 0.16
    taxpayer_name = payload.taxpayer_name or "Admin"
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    for txn in payload.transactions:
        # Skip if already successfully submitted
        existing = (
            db.query(EtimsInvoice)
            .filter(
                EtimsInvoice.local_txn_id == txn.local_id,
                EtimsInvoice.status == "submitted",
            )
            .first()
        )
        if existing:
            results.append(EtimsInvoiceResult(
                local_id=txn.local_id,
                status="submitted",
                invc_no=existing.invc_no,
                cu_invc_no=existing.cu_invc_no,
                rcpt_sign=existing.rcpt_sign,
                sdc_id=existing.sdc_id,
                mrc_no=existing.mrc_no,
                vsdc_rcpt_pbct_date=existing.vsdc_rcpt_pbct_date,
            ))
            skipped += 1
            continue

        # Get next sequential invoice number (thread-safe increment)
        invc_no = _next_invc_no(db)

        # Build KRA payload
        kra_payload = _build_kra_payload(txn, invc_no, vat_rate, taxpayer_name)

        # Call KRA
        if txn.voided or txn.rcpt_typ == "R":
            kra_resp = etims_client.save_refund_transaction(kra_payload)
        else:
            kra_resp = etims_client.save_sales_transaction(kra_payload)

        result_cd = kra_resp.get("resultCd", "ERR")
        success = result_cd == "000"
        data = kra_resp.get("data", {}) or {}

        # Persist result to DB
        record = EtimsInvoice(
            local_txn_id=txn.local_id,
            invc_no=invc_no,
            rcpt_typ=txn.rcpt_typ or "S",
            status="submitted" if success else "failed",
            cu_invc_no=data.get("rcptNo"),
            rcpt_sign=data.get("rcptSign"),
            intr_data=data.get("intrlData"),
            sdc_id=data.get("sdcId"),
            mrc_no=data.get("mrcNo"),
            vsdc_rcpt_pbct_date=data.get("vsdcRcptPbctDate"),
            error_msg=None if success else kra_resp.get("resultMsg", "Unknown error"),
            attempts=1,
            submitted_at=now_ms if success else None,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        if success:
            submitted += 1
        else:
            failed += 1

        results.append(EtimsInvoiceResult(
            local_id=txn.local_id,
            status=record.status,
            invc_no=record.invc_no,
            cu_invc_no=record.cu_invc_no,
            rcpt_sign=record.rcpt_sign,
            sdc_id=record.sdc_id,
            mrc_no=record.mrc_no,
            vsdc_rcpt_pbct_date=record.vsdc_rcpt_pbct_date,
            error=record.error_msg,
        ))

    return EtimsBatchResponse(
        results=results,
        submitted=submitted,
        failed=failed,
        skipped=skipped,
    )
