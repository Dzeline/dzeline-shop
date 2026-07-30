import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_tenant
from ..models import PrintJob, Tenant

router = APIRouter(prefix="/print-jobs", tags=["print-jobs"])
logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PrintJobIn(BaseModel):
    local_id:   Optional[int] = None
    device_id:  Optional[str] = None
    sale_json:  str
    created_at: Optional[int] = None


class PrintJobUpdate(BaseModel):
    status: str


class PrintJobOut(BaseModel):
    id:         int
    local_id:   Optional[int] = None
    device_id:  Optional[str] = None
    sale_json:  str
    status:     str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None

    class Config:
        from_attributes = True


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_print_job(
    payload: PrintJobIn,
    db:      Session = Depends(get_db),
    tenant:  Tenant  = Depends(get_tenant),
):
    existing = (
        db.query(PrintJob)
        .filter(
            PrintJob.tenant_id == tenant.id,
            PrintJob.device_id == payload.device_id,
            PrintJob.local_id == payload.local_id,
        )
        .first()
    )
    if existing:
        logger.info("print_job duplicate tenant=%s device=%s local_id=%s", tenant.id, payload.device_id, payload.local_id)
        return {"id": existing.id}

    now_ms = int(datetime.utcnow().timestamp() * 1000)
    job = PrintJob(
        tenant_id  = tenant.id,
        device_id  = payload.device_id,
        local_id   = payload.local_id,
        sale_json  = payload.sale_json,
        status     = "pending",
        created_at = payload.created_at or now_ms,
        updated_at = now_ms,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    logger.info("print_job created tenant=%s local_id=%s", tenant.id, payload.local_id)
    return {"id": job.id}


@router.put("/{job_id}", response_model=PrintJobOut)
def update_print_job(
    job_id:  int,
    payload: PrintJobUpdate,
    db:      Session = Depends(get_db),
    tenant:  Tenant  = Depends(get_tenant),
):
    """
    Ack a job by its real backend id — not device-scoped. This is what lets
    the hub device (which didn't create the job) mark someone else's sale as
    printed, the same cross-device write pattern as receipt activation.
    """
    job = (
        db.query(PrintJob)
        .filter(PrintJob.id == job_id, PrintJob.tenant_id == tenant.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    job.status = payload.status
    job.updated_at = int(datetime.utcnow().timestamp() * 1000)
    db.commit()
    db.refresh(job)
    return job


@router.get("", response_model=list[PrintJobOut])
def list_print_jobs(
    status: Optional[str] = None,
    limit:  int           = 50,
    db:     Session        = Depends(get_db),
    tenant: Tenant         = Depends(get_tenant),
):
    q = db.query(PrintJob).filter(PrintJob.tenant_id == tenant.id)
    if status:
        q = q.filter(PrintJob.status == status)
    return q.order_by(PrintJob.created_at.asc()).limit(limit).all()
