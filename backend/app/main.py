import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from .database import Base, engine
from .limiter import limiter
from .routers import products, sync, mpesa, etims, admin, scan, stock_receipts, sms, staff, settings, suppliers, print_jobs

load_dotenv()


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        })


_handler = logging.StreamHandler()
_handler.setFormatter(_JsonFormatter())
logging.basicConfig(handlers=[_handler], level=logging.INFO, force=True)

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)
logger.info("Database tables verified")


def _apply_migrations():
    """Idempotent ALTER TABLE migrations — safe to run on every startup.
    Needed because SQLAlchemy's create_all only creates missing tables,
    not missing columns on existing tables. Skipped for SQLite (local dev).
    """
    import os
    from sqlalchemy import text

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url or db_url.startswith("sqlite"):
        return

    pending = [
        # tenants — owner contact + notes (Phase 3)
        ("tenants", "owner_name",    "VARCHAR(200)"),
        ("tenants", "owner_phone",   "VARCHAR(30)"),
        ("tenants", "owner_email",   "VARCHAR(200)"),
        ("tenants", "notes",         "TEXT"),
        # tenants — M-Pesa Buy Goods till
        ("tenants", "till_number",   "VARCHAR(20)"),
        # transactions — customer identity + eTIMS status
        ("transactions", "customer_name",  "VARCHAR(200)"),
        ("transactions", "customer_phone", "VARCHAR(30)"),
        ("transactions", "etims_status",   "VARCHAR(20)"),
        # stk_requests — link to completed transaction
        ("stk_requests", "transaction_id", "INTEGER REFERENCES transactions(id)"),
        # device-scoped identity — prevents cross-device local_id collisions
        # once a tenant has more than one till (multi-device sync)
        ("transactions",   "device_id", "VARCHAR(64)"),
        ("stock_receipts", "device_id", "VARCHAR(64)"),
        ("products",       "device_id", "VARCHAR(64)"),
        # tenants — shop-owner-editable settings, synced to every device via /settings
        ("tenants", "shop_name",           "VARCHAR(200)"),
        ("tenants", "town",                "VARCHAR(100)"),
        ("tenants", "phone",               "VARCHAR(30)"),
        ("tenants", "kra_pin",             "VARCHAR(20)"),
        ("tenants", "vat_enabled",         "BOOLEAN DEFAULT TRUE"),
        ("tenants", "vat_rate",            "FLOAT DEFAULT 0.16"),
        ("tenants", "pochi_number",        "VARCHAR(20)"),
        ("tenants", "mpesa_till_type",     "VARCHAR(20)"),
        ("tenants", "currency",            "VARCHAR(10) DEFAULT 'KES'"),
        ("tenants", "settings_updated_at", "BIGINT"),
        # transactions — cross-device Reports pull (void state, cashier name,
        # incremental-pull watermark)
        ("transactions", "voided",     "BOOLEAN DEFAULT FALSE"),
        ("transactions", "staff_name", "VARCHAR(200)"),
        ("transactions", "updated_at", "BIGINT"),
        # transaction_items — cross-device COGS + product id remapping
        ("transaction_items", "cost_price",       "FLOAT"),
        ("transaction_items", "cloud_product_id", "INTEGER"),
        # products — cross-device COGS/margin math
        ("products", "cost_price", "FLOAT"),
        # etims_invoices — real transaction id as the dedup key, replacing the
        # per-device-ambiguous local_txn_id, so any device can safely submit
        # any of the tenant's pending transactions to KRA
        ("etims_invoices", "transaction_id", "INTEGER REFERENCES transactions(id)"),
        # stock_receipt_items — cross-device product id remapping. Was added
        # to the model but missed here — GET /stock-receipts 500s the moment
        # any tenant has a receipt with items, since the ORM SELECTs this
        # column unconditionally regardless of which rows match.
        ("stock_receipt_items", "cloud_product_id", "INTEGER"),
        # stock_receipts — compressed photo of the delivery, so the business
        # owner can review it during approval regardless of which device
        # they're on. Create-only (never resent on activation).
        ("stock_receipts", "photo_blob", "TEXT"),
        # stock_receipts — bumped on create + activation. Without this,
        # /stock-receipts had no way to be pulled incrementally: every
        # device re-fetched every receipt (photo included) on every 45s
        # poll forever, which is what actually burned through the Neon
        # data-transfer quota.
        ("stock_receipts", "updated_at", "BIGINT"),
    ]
    with engine.connect() as conn:
        for table, col, typ in pending:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typ}"))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                logger.warning("Migration skipped %s.%s: %s", table, col, exc)

        # Existing rows get NULL updated_at from a bare ADD COLUMN (no
        # DEFAULT) — and NULL > since is never true, so every transaction
        # this tenant already has would silently vanish from the new
        # since-based pull forever unless backfilled. Idempotent — no-op
        # once every row has a value.
        try:
            conn.execute(text(
                "UPDATE transactions SET updated_at = COALESCE(synced_at, timestamp) "
                "WHERE updated_at IS NULL"
            ))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.warning("updated_at backfill skipped: %s", exc)

        try:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_transactions_tenant_updated "
                "ON transactions (tenant_id, updated_at)"
            ))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.warning("Index creation skipped: %s", exc)

        # Same backfill reasoning as transactions.updated_at above — existing
        # receipts get NULL from the bare ADD COLUMN and would otherwise
        # vanish from the new since-based pull forever.
        try:
            conn.execute(text(
                "UPDATE stock_receipts SET updated_at = COALESCE(activated_at, created_at) "
                "WHERE updated_at IS NULL"
            ))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.warning("stock_receipts updated_at backfill skipped: %s", exc)

        try:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_stock_receipts_tenant_updated "
                "ON stock_receipts (tenant_id, updated_at)"
            ))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.warning("Index creation skipped: %s", exc)
    logger.info("Schema migrations complete")


_apply_migrations()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # OCR is intentionally NOT pre-warmed here anymore — it used to load
    # ~1GB of PaddleOCR models into memory on every startup regardless of
    # whether Scan was ever used, which was the likely cause of recurring
    # SIGTERM/OOM crashes that took down the whole API, not just scanning.
    # scan.py's _get_ocr() now loads lazily, in a background thread, only
    # on the first actual scan attempt. See scan.py for the full reasoning.
    yield


app = FastAPI(
    title="Dzeline Shop API",
    description="Backend for Dzeline POS — sync, M-Pesa STK Push, product management",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,https://dzeline.online").split(",")
    if origin.strip()
]
logger.info("CORS allowed_origins=%s", allowed_origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _log_rejected_preflight(request, call_next):
    origin = request.headers.get("origin")
    response = await call_next(request)
    if request.method == "OPTIONS" and response.status_code == 400 and origin:
        logger.warning("CORS preflight rejected origin=%s path=%s", origin, request.url.path)
    return response


# All routes. Auth is enforced per-route via Depends(get_tenant) or Depends(require_admin).
# /mpesa/callback is exempt from API-key auth — it is IP-restricted in the mpesa router.
# /sms/webhook has its own auth (?key= or X-SMS-Secret) — the SMS gateway device has no tenant API key.
# /health is public for uptime probes.
app.include_router(products.router)
app.include_router(sync.router)
app.include_router(mpesa.router)
app.include_router(etims.router)
app.include_router(admin.router)
app.include_router(scan.router)
app.include_router(stock_receipts.router)
app.include_router(sms.router)
app.include_router(staff.router)
app.include_router(settings.router)
app.include_router(suppliers.router)
app.include_router(print_jobs.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "dzeline-api", "version": "2.0.0"}


@app.get("/admin-ui", response_class=HTMLResponse, include_in_schema=False)
def admin_ui():
    """Serve the browser-based admin dashboard."""
    html = (Path(__file__).parent / "admin_ui.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html)
