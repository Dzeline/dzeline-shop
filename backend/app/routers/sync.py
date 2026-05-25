from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Transaction, TransactionItem
from ..schemas import TransactionIn, TransactionOut

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def sync_transaction(payload: TransactionIn, db: Session = Depends(get_db)):
    existing = db.query(Transaction).filter(Transaction.local_id == payload.id).first()
    if existing:
        return existing

    txn = Transaction(
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
        synced_at=int(datetime.utcnow().timestamp() * 1000),
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
        ))

    db.commit()
    db.refresh(txn)
    return txn


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return (
        db.query(Transaction)
        .order_by(Transaction.timestamp.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/status")
def sync_status(db: Session = Depends(get_db)):
    count = db.query(Transaction).count()
    return {"synced_transactions": count}
