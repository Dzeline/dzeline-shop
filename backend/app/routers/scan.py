"""
Invoice scanning router — uses Claude Haiku vision to extract structured
line items from a supplier invoice or delivery note photo.

POST /scan/invoice  → { supplier, invoice_number, items: [{name, qty, unit_cost}] }
"""
import json
import logging
import os

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..deps import get_tenant
from ..limiter import limiter
from ..models import Tenant

router = APIRouter(prefix="/scan", tags=["scan"])
logger = logging.getLogger(__name__)

_PROMPT = """You are a POS inventory assistant. Extract all product line items from this supplier invoice, delivery note, or receipt image.

Return ONLY valid JSON — no explanation, no markdown, no extra text:
{
  "supplier": "supplier company name or null",
  "invoice_number": "invoice/delivery number or null",
  "items": [
    {"name": "product description", "qty": 1, "unit_cost": 0.00}
  ]
}

Rules:
- Include every product line you can read, even partially
- qty must be a number (default 1 if not shown)
- unit_cost is the price per unit; use null if not visible
- Normalise names to title case
- If the image is not a valid invoice/receipt, return {"supplier":null,"invoice_number":null,"items":[]}"""


class InvoiceScanRequest(BaseModel):
    image_base64: str   # full data URI (data:image/jpeg;base64,...) or raw base64
    media_type: str = "image/jpeg"


class ScannedItem(BaseModel):
    name: str
    qty: float
    unit_cost: float | None = None


class InvoiceScanResponse(BaseModel):
    supplier: str | None = None
    invoice_number: str | None = None
    items: list[ScannedItem] = []


@router.post("/invoice", response_model=InvoiceScanResponse)
@limiter.limit("6/minute")
def scan_invoice(
    request: Request,
    payload: InvoiceScanRequest,
    tenant: Tenant = Depends(get_tenant),
):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI scanning not configured — set ANTHROPIC_API_KEY")

    # Strip data URI prefix if present
    img_data = payload.image_base64
    if img_data.startswith("data:"):
        try:
            media_type_part, img_data = img_data.split(",", 1)
            media_type = media_type_part.split(":")[1].split(";")[0]
        except (IndexError, ValueError):
            media_type = payload.media_type
    else:
        media_type = payload.media_type

    if len(img_data) > 7_000_000:
        raise HTTPException(status_code=413, detail="Image too large — please use a compressed photo")

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": img_data,
                            },
                        },
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=503, detail="AI service: invalid API key")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="AI service rate limit — try again shortly")
    except anthropic.APIError as e:
        logger.error("anthropic error tenant=%s %s", tenant.id, e)
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    raw = message.content[0].text.strip()
    try:
        # Be tolerant of Claude wrapping JSON in backticks
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
    except (json.JSONDecodeError, IndexError):
        logger.warning("scan non-JSON response tenant=%s raw=%r", tenant.id, raw[:200])
        raise HTTPException(status_code=422, detail="Could not read invoice — try a clearer, well-lit photo")

    items: list[ScannedItem] = []
    for item in data.get("items", []):
        try:
            items.append(ScannedItem(
                name=str(item.get("name", "Unknown")).strip(),
                qty=max(0.01, float(item.get("qty") or 1)),
                unit_cost=float(item["unit_cost"]) if item.get("unit_cost") else None,
            ))
        except (TypeError, ValueError):
            continue

    logger.info("scan_invoice tenant=%s items=%d", tenant.id, len(items))
    return InvoiceScanResponse(
        supplier=data.get("supplier") or None,
        invoice_number=data.get("invoice_number") or None,
        items=items,
    )
