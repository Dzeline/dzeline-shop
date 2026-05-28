import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from .database import Base, engine
from .routers import products, sync, mpesa, etims, sms, admin

load_dotenv()

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Dzeline Shop API",
    description="Backend for Dzeline POS — sync, M-Pesa STK Push, product management",
    version="2.0.0",
)

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
app.include_router(sms.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "dzeline-api", "version": "2.0.0"}


@app.get("/admin-ui", response_class=HTMLResponse, include_in_schema=False)
def admin_ui():
    """Serve the browser-based admin dashboard."""
    html = (Path(__file__).parent / "admin_ui.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html)
