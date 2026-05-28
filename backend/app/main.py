import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from .database import Base, engine
from .routers import products, sync, mpesa, etims, sms

load_dotenv()

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Dzeline Shop API",
    description="Backend for Dzeline POS — sync, M-Pesa STK Push, product management",
    version="1.0.0",
)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,https://dzeline.online")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API key guard ─────────────────────────────────────────────────────────────
# All routes require X-API-Key except:
#   GET  /health         — uptime probes
#   POST /mpesa/callback — Safaricom calls this; it is IP-restricted instead
_API_KEY_EXEMPT = {("/health", "GET"), ("/mpesa/callback", "POST")}


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    if (request.url.path, request.method) not in _API_KEY_EXEMPT:
        api_key = os.getenv("API_KEY", "")
        if not api_key:
            return JSONResponse(
                {"detail": "Server misconfigured: API_KEY env var not set"},
                status_code=503,
            )
        if request.headers.get("X-API-Key") != api_key:
            return JSONResponse({"detail": "Invalid or missing API key"}, status_code=401)
    return await call_next(request)


app.include_router(products.router)
app.include_router(sync.router)
app.include_router(mpesa.router)
app.include_router(etims.router)
app.include_router(sms.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "dzeline-api"}
