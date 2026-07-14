"""
Staff roster sync — transport only, never an auth server.

PIN verification always happens locally on each device via a Dexie lookup
against pin_hash. This router just carries staff records between a tenant's
devices so a newly-joined phone can pull the real roster instead of only
ever seeing whoever was created locally on it.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_tenant
from ..models import Staff, Tenant
from ..schemas import StaffIn, StaffOut, StaffUpdate

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("", response_model=list[StaffOut])
def list_staff(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    # Includes soft-deleted rows — pulling devices need the tombstones to
    # know a staff member was removed, not just filter them out server-side.
    return (
        db.query(Staff)
        .filter(Staff.tenant_id == tenant.id)
        .order_by(Staff.updated_at)
        .all()
    )


@router.post("", response_model=StaffOut, status_code=201)
def create_staff(
    payload: StaffIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    if payload.device_id and payload.local_id is not None:
        existing = (
            db.query(Staff)
            .filter(
                Staff.tenant_id == tenant.id,
                Staff.device_id == payload.device_id,
                Staff.local_id == payload.local_id,
            )
            .first()
        )
        if existing:
            return existing

    staff = Staff(
        **payload.model_dump(),
        tenant_id=tenant.id,
        updated_at=int(datetime.utcnow().timestamp() * 1000),
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)
    return staff


@router.put("/{staff_id}", response_model=StaffOut)
def update_staff(
    staff_id: int,
    payload: StaffUpdate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    staff = (
        db.query(Staff)
        .filter(Staff.id == staff_id, Staff.tenant_id == tenant.id)
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(staff, key, value)
    staff.updated_at = int(datetime.utcnow().timestamp() * 1000)
    db.commit()
    db.refresh(staff)
    return staff


@router.delete("/{staff_id}", status_code=204)
def delete_staff(
    staff_id: int,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    staff = (
        db.query(Staff)
        .filter(Staff.id == staff_id, Staff.tenant_id == tenant.id)
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    staff.active = False
    staff.deleted_at = int(datetime.utcnow().timestamp() * 1000)
    staff.updated_at = staff.deleted_at
    db.commit()
