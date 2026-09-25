"""
Supplier payment ledger — money the shop has paid against supplier invoices.

Shared across devices for a specific reason: the owner settles the invoices,
the staff receive them, and usually on different devices. Keeping this local
meant the person paying could not see what had arrived, and the person
receiving could not see what had been paid.

Push-only from the device that recorded the payment, pull-everything on the
other side — the same outbox idiom as transactions. A payment is never edited
after the fact; a correction is another row.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import SupplierPayment, Tenant
from ..schemas import SupplierPaymentIn, SupplierPaymentOut

router = APIRouter(prefix="/supplier-payments", tags=["supplier-payments"])


@router.get("", response_model=list[SupplierPaymentOut])
def list_payments(
    since: int = 0,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Payments recorded since a timestamp, oldest first, so pulls are incremental."""
    return (
        db.query(SupplierPayment)
        .filter(
            SupplierPayment.tenant_id == tenant.id,
            SupplierPayment.updated_at > since,
        )
        .order_by(SupplierPayment.updated_at)
        .limit(500)
        .all()
    )


@router.post("", response_model=SupplierPaymentOut, status_code=201)
def create_payment(
    payload: SupplierPaymentIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """
    Record a payment.

    Idempotent by (device_id, local_id): a retried push after a dropped
    connection must not double-count money against an invoice.
    """
    if payload.device_id and payload.local_id is not None:
        existing = (
            db.query(SupplierPayment)
            .filter(
                SupplierPayment.tenant_id == tenant.id,
                SupplierPayment.device_id == payload.device_id,
                SupplierPayment.local_id == payload.local_id,
            )
            .first()
        )
        if existing:
            return existing

    now = int(datetime.utcnow().timestamp() * 1000)
    payment = SupplierPayment(
        **payload.model_dump(),
        tenant_id=tenant.id,
        created_at=now,
        updated_at=now,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment
