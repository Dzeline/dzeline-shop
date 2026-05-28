"""
FastAPI dependencies shared across routers.

get_tenant  — resolves the calling shop from X-API-Key header; used by all
              data-bearing routes to scope queries to a single tenant.

require_admin — checks X-Admin-Secret header; used only by /admin/* routes
                that you (the platform operator) call to manage tenants.
"""
import hashlib
import os
from datetime import datetime, timezone
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .database import get_db
from .models import Tenant


def get_tenant(
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Tenant:
    """Resolve tenant from X-API-Key. Raises 401 if missing or invalid."""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    tenant = (
        db.query(Tenant)
        .filter(Tenant.api_key_hash == key_hash, Tenant.active == True)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")

    # Billing expiry check — 402 if plan has lapsed
    if tenant.billing_cycle_end:
        now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        if now_ms > tenant.billing_cycle_end:
            raise HTTPException(
                status_code=402,
                detail="Subscription expired — please renew to continue using Dzeline",
            )
    return tenant


def require_admin(x_admin_secret: str | None = Header(default=None)) -> None:
    """Guard for /admin/* routes. Checks X-Admin-Secret against ADMIN_SECRET env var."""
    secret = os.getenv("ADMIN_SECRET", "")
    if not secret:
        raise HTTPException(status_code=503, detail="ADMIN_SECRET not configured on server")
    if x_admin_secret != secret:
        raise HTTPException(status_code=401, detail="Invalid admin secret")
