import asyncio
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
from .routers import products, sync, mpesa, etims, admin, scan, stock_receipts

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
    ]
    with engine.connect() as conn:
        for table, col, typ in pending:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typ}"))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                logger.warning("Migration skipped %s.%s: %s", table, col, exc)
    logger.info("Schema migrations complete")


_apply_migrations()


async def _prewarm_ocr():
    try:
        await asyncio.to_thread(scan._get_ocr)
        logger.info("PaddleOCR pre-warm complete")
    except Exception as e:
        logger.warning("PaddleOCR pre-warm skipped: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Fire pre-warm in background — don't block startup waiting for OCR.
    # Render needs the port open within ~3 min; PaddleOCR can take 10+ min
    # on a cold download. The scan route initialises lazily if the task is
    # still running when the first request arrives.
    asyncio.create_task(_prewarm_ocr())
    yield


app = FastAPI(
    title="Dzeline Shop API",
    description="Backend for Dzeline POS — sync, M-Pesa STK Push, product management",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,https://dzeline.online")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All routes. Auth is enforced per-route via Depends(get_tenant) or Depends(require_admin).
# /mpesa/callback is exempt from API-key auth — it is IP-restricted in the mpesa router.
# /health is public for uptime probes.
app.include_router(products.router)
app.include_router(sync.router)
app.include_router(mpesa.router)
app.include_router(etims.router)
app.include_router(admin.router)
app.include_router(scan.router)
app.include_router(stock_receipts.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "dzeline-api", "version": "2.0.0"}


@app.get("/admin-ui", response_class=HTMLResponse, include_in_schema=False)
def admin_ui():
    """Serve the browser-based admin dashboard."""
    html = (Path(__file__).parent / "admin_ui.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html)
