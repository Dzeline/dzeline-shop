import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..deps import get_tenant
from ..limiter import limiter
from ..models import Transaction, TransactionItem, Tenant, Product
from ..schemas import TransactionIn, TransactionOut

router = APIRouter(prefix="/sync", tags=["sync"])
logger = logging.getLogger(__name__)


@router.post("/transactions", response_model=TransactionOut, status_code=201)
@limiter.limit("120/minute")
def sync_transaction(
    request: Request,
    payload: TransactionIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    existing = (
        db.query(Transaction)
        .filter(
            Transaction.tenant_id == tenant.id,
            Transaction.device_id == payload.device_id,
            Transaction.local_id == payload.id,
        )
        .first()
    )
    now = int(datetime.utcnow().timestamp() * 1000)

    if existing:
        # A re-push (e.g. after voidTransaction() resets synced:false) must
        # actually update the stored row, not just no-op — otherwise voided
        # status, eTIMS status, etc. never reach the backend past the first sync.
        existing.voided = payload.voided or False
        existing.mpesa_code = payload.mpesa_code
        existing.staff_name = payload.staff_name
        existing.customer_name = payload.customer_name
        existing.customer_phone = payload.customer_phone
        existing.etims_status = payload.etims_status
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        logger.info("sync_transaction updated tenant=%s device=%s local_id=%s", tenant.id, payload.device_id, payload.id)
        return existing

    txn = Transaction(
        tenant_id=tenant.id,
        device_id=payload.device_id,
        local_id=payload.id,
        timestamp=payload.timestamp,
        subtotal=payload.subtotal,
        vat=payload.vat,
        total=payload.total,
        payment_method=payload.payment_method,
        payment_amount=payload.payment_amount,
        change_given=payload.change_given or 0,
        mpesa_code=payload.mpesa_code,
        staff_id=payload.staff_id,
        staff_name=payload.staff_name,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        etims_status=payload.etims_status,
        voided=payload.voided or False,
        synced_at=now,
        updated_at=now,
    )
    db.add(txn)
    db.flush()

    for item in payload.items:
        db.add(TransactionItem(
            transaction_id=txn.id,
            product_id=item.product_id,
            quantity=item.quantity,
            price=item.price,
            subtotal=item.subtotal,
            product_name=item.name,
            cost_price=item.cost_price,
            cloud_product_id=item.cloud_product_id,
        ))
        if item.cloud_product_id:
            product = (
                db.query(Product)
                .filter(Product.id == item.cloud_product_id, Product.tenant_id == tenant.id)
                .first()
            )
            if product:
                product.stock = max(0, product.stock - item.quantity)

    db.commit()
    db.refresh(txn)
    logger.info("sync_transaction saved tenant=%s local_id=%s total=%s", tenant.id, payload.id, payload.total)
    return txn


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    since: int = 0,
    limit: int = 300,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    # Filtered/ordered by updated_at, not timestamp — a void that happens
    # days after the sale must still be picked up by a since-bounded pull
    # even though the sale's own timestamp is old. Callers page forward by
    # advancing since to the max updated_at they've seen.
    return (
        db.query(Transaction)
        .filter(Transaction.tenant_id == tenant.id, Transaction.updated_at > since)
        .order_by(Transaction.updated_at.asc())
        .limit(min(limit, 500))
        .options(joinedload(Transaction.items))
        .all()
    )


@router.get("/status")
def sync_status(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    count = db.query(Transaction).filter(Transaction.tenant_id == tenant.id).count()
    return {"synced_transactions": count}
