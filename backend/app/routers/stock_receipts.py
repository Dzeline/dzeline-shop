import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_tenant
from ..models import StockReceipt, StockReceiptItem, Tenant

router = APIRouter(prefix="/stock-receipts", tags=["stock-receipts"])
logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StockReceiptItemIn(BaseModel):
    product_id:       Optional[int]   = None
    cloud_product_id: Optional[int]   = None  # tenant-wide id — see StockReceiptItem model
    product_name:     Optional[str]   = None
    qty_added:        int             = 0
    qty_before:       Optional[int]   = None
    unit_cost:        Optional[float] = None
    selling_price:    Optional[float] = None
    expiry_date:       Optional[str]   = None
    condition:        Optional[str]   = "good"


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
    photo_blob:     Optional[str]   = None  # set once at create — never resent on activation
    items:          list[StockReceiptItemIn] = []


class StockReceiptItemUpdate(BaseModel):
    # Identifies which existing item this update applies to — cloud_product_id
    # preferred (tenant-wide, works cross-device), product_id as a fallback
    # (only meaningful when the update comes from the originating device).
    product_id:       Optional[int]   = None
    cloud_product_id: Optional[int]   = None
    selling_price:    Optional[float] = None
    unit_cost:        Optional[float] = None


class StockReceiptUpdate(BaseModel):
    status:       Optional[str] = None
    activated_at: Optional[int] = None
    items:        Optional[list[StockReceiptItemUpdate]] = None


class StockReceiptItemOut(BaseModel):
    product_id:       Optional[int]   = None
    cloud_product_id: Optional[int]   = None
    product_name:     Optional[str]   = None
    qty_added:        int
    qty_before:       Optional[int]   = None
    unit_cost:        Optional[float] = None
    selling_price:    Optional[float] = None
    expiry_date:      Optional[str]   = None
    condition:        Optional[str]   = None

    class Config:
        from_attributes = True


class StockReceiptOut(BaseModel):
    id:             int
    local_id:       Optional[int] = None
    device_id:      Optional[str] = None
    status:         str
    supplier:       Optional[str] = None
    supplier_id:    Optional[int] = None
    invoice_number: Optional[str] = None
    staff_id:       Optional[int] = None
    created_at:     Optional[int] = None
    activated_at:   Optional[int] = None
    photo_blob:     Optional[str] = None
    updated_at:     Optional[int] = None
    items:          list[StockReceiptItemOut] = []

    class Config:
        from_attributes = True


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

    now_ms = int(datetime.utcnow().timestamp() * 1000)
    receipt = StockReceipt(
        tenant_id      = tenant.id,
        device_id      = payload.device_id,
        local_id       = payload.local_id,
        status         = payload.status,
        supplier       = payload.supplier,
        supplier_id    = payload.supplier_id,
        invoice_number = payload.invoice_number,
        staff_id       = payload.staff_id,
        created_at     = payload.created_at or now_ms,
        activated_at   = payload.activated_at,
        photo_blob     = payload.photo_blob,
        updated_at     = payload.created_at or now_ms,
    )
    db.add(receipt)
    db.flush()

    for item in payload.items:
        db.add(StockReceiptItem(
            receipt_id       = receipt.id,
            product_id       = item.product_id,
            cloud_product_id = item.cloud_product_id,
            product_name     = item.product_name,
            qty_added        = item.qty_added,
            qty_before       = item.qty_before,
            unit_cost        = item.unit_cost,
            selling_price    = item.selling_price,
            expiry_date      = item.expiry_date,
            condition        = item.condition or "good",
        ))

    db.commit()
    logger.info("stock_receipt tenant=%s local_id=%s items=%d", tenant.id, payload.local_id, len(payload.items))
    return {"id": receipt.id}


@router.put("/{receipt_id}", response_model=StockReceiptOut)
def update_receipt(
    receipt_id: int,
    payload:    StockReceiptUpdate,
    db:         Session = Depends(get_db),
    tenant:     Tenant  = Depends(get_tenant),
):
    """
    Update a receipt by its real backend id — unlike POST, this is NOT
    device-scoped. This is what makes cross-device activation possible: the
    manager's device didn't create this draft, so it has no device-scoped
    identity to push under, but it can legitimately update the real record.
    """
    receipt = (
        db.query(StockReceipt)
        .filter(StockReceipt.id == receipt_id, StockReceipt.tenant_id == tenant.id)
        .first()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Stock receipt not found")

    if payload.status is not None:
        receipt.status = payload.status
    if payload.activated_at is not None:
        receipt.activated_at = payload.activated_at
    receipt.updated_at = int(datetime.utcnow().timestamp() * 1000)

    unmatched = []
    if payload.items:
        existing_items = db.query(StockReceiptItem).filter(StockReceiptItem.receipt_id == receipt.id).all()
        by_cloud_product = {i.cloud_product_id: i for i in existing_items if i.cloud_product_id is not None}
        by_product = {i.product_id: i for i in existing_items if i.product_id is not None}

        for update in payload.items:
            target = None
            if update.cloud_product_id is not None:
                target = by_cloud_product.get(update.cloud_product_id)
            if target is None and update.product_id is not None:
                target = by_product.get(update.product_id)
            if target is None:
                unmatched.append(update.cloud_product_id or update.product_id)
                continue
            if update.selling_price is not None:
                target.selling_price = update.selling_price
            if update.unit_cost is not None:
                target.unit_cost = update.unit_cost

    db.commit()
    db.refresh(receipt)
    if unmatched:
        logger.warning("stock_receipt update tenant=%s receipt=%s unmatched_items=%s", tenant.id, receipt_id, unmatched)
    return receipt


@router.get("", response_model=list[StockReceiptOut])
def list_receipts(
    since:  int     = 0,
    limit:  int     = 50,
    db:     Session = Depends(get_db),
    tenant: Tenant  = Depends(get_tenant),
):
    # since-filtered like /sync/transactions — this endpoint is polled every
    # 45s per device, and every receipt includes its (compressed but still
    # substantial) photo_blob. Re-sending every receipt's photo on every poll
    # forever, with no since-filtering, is what actually burned through the
    # Neon data-transfer quota. joinedload still avoids one lazy-load SELECT
    # per receipt for .items.
    return (
        db.query(StockReceipt)
        .filter(StockReceipt.tenant_id == tenant.id, StockReceipt.updated_at > since)
        .order_by(StockReceipt.updated_at.asc())
        .limit(limit)
        .options(joinedload(StockReceipt.items))
        .all()
    )
