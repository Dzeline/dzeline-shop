"""
Admin router — platform operator endpoints for managing tenant shops.

All routes require X-Admin-Secret header matching the ADMIN_SECRET env var.
These endpoints are never called by the shop PWA — only by you (the operator)
via curl, Postman, or an internal dashboard.

Endpoints:
  POST   /admin/tenants              — register a new client shop, returns api_key once
  GET    /admin/tenants              — list all tenants
  GET    /admin/tenants/{id}         — get one tenant
  PATCH  /admin/tenants/{id}         — update plan / active / billing_cycle_end
  POST   /admin/tenants/{id}/rotate-key  — generate a new API key (old key immediately invalid)
  POST   /admin/tenants/{id}/claim-legacy-data — assign NULL-tenant rows to this tenant
"""
import hashlib
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import (
    Tenant, Transaction, TransactionItem, Product,
    StkRequest, SmsVerifiedCode, EtimsInvoice, EtimsCounter, EtimsConfig,
)
from ..schemas import TenantCreate, TenantCreated, TenantOut, TenantUpdate

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


def _generate_key() -> tuple[str, str]:
    """Return (raw_key, hash). raw_key is shown once; only hash is stored."""
    raw = "dzl_" + secrets.token_hex(28)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


@router.post("/tenants", response_model=TenantCreated, status_code=201)
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)):
    raw_key, key_hash = _generate_key()
    tenant = Tenant(
        name=payload.name,
        api_key_hash=key_hash,
        plan=payload.plan,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return TenantCreated(
        id=tenant.id,
        name=tenant.name,
        plan=tenant.plan,
        active=tenant.active,
        billing_cycle_end=tenant.billing_cycle_end,
        created_at=tenant.created_at,
        api_key=raw_key,
    )


@router.get("/tenants", response_model=list[TenantOut])
def list_tenants(db: Session = Depends(get_db)):
    return db.query(Tenant).order_by(Tenant.created_at.desc()).all()


@router.get("/tenants/{tenant_id}", response_model=TenantOut)
def get_tenant(tenant_id: int, db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
def update_tenant(tenant_id: int, payload: TenantUpdate, db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    db.commit()
    db.refresh(tenant)
    return tenant


@router.post("/tenants/{tenant_id}/rotate-key", response_model=TenantCreated)
def rotate_api_key(tenant_id: int, db: Session = Depends(get_db)):
    """Generate a new API key. The old key stops working immediately."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    raw_key, key_hash = _generate_key()
    tenant.api_key_hash = key_hash
    db.commit()
    db.refresh(tenant)
    return TenantCreated(
        id=tenant.id,
        name=tenant.name,
        plan=tenant.plan,
        active=tenant.active,
        billing_cycle_end=tenant.billing_cycle_end,
        created_at=tenant.created_at,
        api_key=raw_key,
    )


@router.post("/tenants/{tenant_id}/claim-legacy-data")
def claim_legacy_data(tenant_id: int, db: Session = Depends(get_db)):
    """
    Assign all NULL-tenant rows to this tenant.
    Run once after enabling multi-tenancy on an existing single-tenant deployment
    so the original shop's data is not orphaned.
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    counts = {}
    for Model, label in [
        (Transaction,     "transactions"),
        (Product,         "products"),
        (StkRequest,      "stk_requests"),
        (SmsVerifiedCode, "sms_verified_codes"),
        (EtimsInvoice,    "etims_invoices"),
        (EtimsCounter,    "etims_counter"),
        (EtimsConfig,     "etims_config"),
    ]:
        updated = (
            db.query(Model)
            .filter(Model.tenant_id == None)  # noqa: E711
            .update({"tenant_id": tenant_id}, synchronize_session=False)
        )
        counts[label] = updated

    db.commit()
    return {"claimed": counts, "tenant_id": tenant_id}
