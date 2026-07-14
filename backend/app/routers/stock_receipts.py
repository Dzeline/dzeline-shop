import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import StockReceipt, StockReceiptItem, Tenant

router = APIRouter(prefix="/stock-receipts", tags=["stock-receipts"])
logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StockReceiptItemIn(BaseModel):
    product_id:    Optional[int]   = None
    product_name:  Optional[str]   = None
    qty_added:     int             = 0
    qty_before:    Optional[int]   = None
    unit_cost:     Optional[float] = None
    selling_price: Optional[float] = None
    expiry_date:   Optional[str]   = None
    condition:     Optional[str]   = "good"


class StockReceiptIn(BaseModel):
    local_id:       Optional[int]   = None
    device_id:      Optional[str]   = None
    status:         str             = "activated"
    supplier:       Optional[str]   = None
    supplier_id:    Optional[int]   = None
    invoice_number: Optional[str]   = None
    staff_id:       Optional[int]   = None
    created_at:     Optional[int]   = None
    activated_at:   Optional[int]   = None
    items:          list[StockReceiptItemIn] = []


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_receipt(
    payload: StockReceiptIn,
    db:      Session = Depends(get_db),
    tenant:  Tenant  = Depends(get_tenant),
):
    existing = (
        db.query(StockReceipt)
        .filter(
            StockReceipt.tenant_id == tenant.id,
            StockReceipt.device_id == payload.device_id,
            StockReceipt.local_id == payload.local_id,
        )
        .first()
    )
    if existing:
        logger.info("stock_receipt duplicate tenant=%s device=%s local_id=%s", tenant.id, payload.device_id, payload.local_id)
        return {"id": existing.id}

    receipt = StockReceipt(
        tenant_id      = tenant.id,
        device_id      = payload.device_id,
        local_id       = payload.local_id,
        status         = payload.status,
        supplier       = payload.supplier,
        supplier_id    = payload.supplier_id,
        invoice_number = payload.invoice_number,
        staff_id       = payload.staff_id,
        created_at     = payload.created_at or int(datetime.utcnow().timestamp() * 1000),
        activated_at   = payload.activated_at,
    )
    db.add(receipt)
    db.flush()   # get receipt.id before adding items

    for item in payload.items:
        db.add(StockReceiptItem(
            receipt_id    = receipt.id,
            product_id    = item.product_id,
            product_name  = item.product_name,
            qty_added     = item.qty_added,
            qty_before    = item.qty_before,
            unit_cost     = item.unit_cost,
            selling_price = item.selling_price,
            expiry_date   = item.expiry_date,
            condition     = item.condition or "good",
        ))

    db.commit()
    logger.info("stock_receipt tenant=%s local_id=%s items=%d", tenant.id, payload.local_id, len(payload.items))
    return {"id": receipt.id}


@router.get("")
def list_receipts(
    limit:  int     = 50,
    db:     Session = Depends(get_db),
    tenant: Tenant  = Depends(get_tenant),
):
    rows = (
        db.query(StockReceipt)
        .filter(StockReceipt.tenant_id == tenant.id)
        .order_by(StockReceipt.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":             r.id,
            "local_id":       r.local_id,
            "status":         r.status,
            "supplier":       r.supplier,
            "invoice_number": r.invoice_number,
            "created_at":     r.created_at,
            "activated_at":   r.activated_at,
            "item_count":     len(r.items),
        }
        for r in rows
    ]
