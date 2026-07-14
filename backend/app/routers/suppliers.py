"""
Supplier directory sync — a tenant's suppliers, shared across devices instead
of each till building its own independent, uncorrelated list.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_tenant
from ..models import Supplier, Tenant
from ..schemas import SupplierIn, SupplierOut, SupplierUpdate

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    # Includes soft-deleted rows — pulling devices need the tombstones.
    return (
        db.query(Supplier)
        .filter(Supplier.tenant_id == tenant.id)
        .order_by(Supplier.updated_at)
        .all()
    )


@router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(
    payload: SupplierIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    if payload.device_id and payload.local_id is not None:
        existing = (
            db.query(Supplier)
            .filter(
                Supplier.tenant_id == tenant.id,
                Supplier.device_id == payload.device_id,
                Supplier.local_id == payload.local_id,
            )
            .first()
        )
        if existing:
            return existing

    supplier = Supplier(
        **payload.model_dump(),
        tenant_id=tenant.id,
        updated_at=int(datetime.utcnow().timestamp() * 1000),
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    supplier = (
        db.query(Supplier)
        .filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(supplier, key, value)
    supplier.updated_at = int(datetime.utcnow().timestamp() * 1000)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}", status_code=204)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    supplier = (
        db.query(Supplier)
        .filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    now = int(datetime.utcnow().timestamp() * 1000)
    supplier.deleted_at = now
    supplier.updated_at = now
    db.commit()
