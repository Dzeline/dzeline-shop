"""
Shop settings sync — the subset of Tenant fields the shop owner controls
from the app's Settings screen (shop name, VAT, KRA PIN, M-Pesa/Pochi
numbers). Kept separate from /admin/* (plan, billing, Daraja secrets),
which the shop owner never sees or edits.
"""
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_tenant
from ..models import Tenant
from ..schemas import ShopSettingsIn, ShopSettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=ShopSettingsOut)
def get_settings(tenant: Tenant = Depends(get_tenant)):
    return tenant


@router.put("", response_model=ShopSettingsOut)
def update_settings(
    payload: ShopSettingsIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, key, value)
    tenant.settings_updated_at = int(datetime.utcnow().timestamp() * 1000)
    db.commit()
    db.refresh(tenant)
    return tenant
