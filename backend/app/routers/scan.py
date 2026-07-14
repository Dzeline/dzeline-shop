"""
Invoice scanning router — uses self-hosted PaddleOCR to extract structured
line items from a supplier invoice, delivery note, or receipt photo.

POST /scan/invoice  → { supplier, invoice_number, items: [{name, qty, unit_cost}] }

PaddleOCR models (~300 MB) download on first call to _get_ocr() and are
cached at $PADDLE_HOME (set to /opt/paddle_models in render.yaml so they
survive redeploys on Render's persistent disk).
"""
import base64
import io
import logging
import re
from threading import Lock

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image, ImageEnhance, ImageFilter
from pydantic import BaseModel

from ..deps import get_tenant
from ..limiter import limiter
from ..models import Tenant

router = APIRouter(prefix="/scan", tags=["scan"])
logger = logging.getLogger(__name__)

# ── OCR singleton ─────────────────────────────────────────────────────────────
# Double-checked lock so only one thread initialises PaddleOCR even under
# concurrent requests.  Models download on first call (~300 MB, ~30 s).

_ocr_instance = None
_ocr_lock = Lock()


def _init_ocr():
    global _ocr_instance
    from paddleocr import PaddleOCR
    logger.info("Initialising PaddleOCR (models may download now)")
    _ocr_instance = PaddleOCR(
        use_angle_cls=True,
        lang="en",
        enable_mkldnn=False,   # MKL-DNN off → more stable on cloud
    )
    logger.info("PaddleOCR ready")


def _get_ocr(wait: bool = True):
    """
    wait=True  — background pre-warm at startup: block until ready.
    wait=False — request path: if warm-up is already running elsewhere
    (pre-warm, or another request), return None immediately instead of
    blocking this request for minutes. Callers must turn None into a
    retryable error, not hang.
    """
    global _ocr_instance
    if _ocr_instance is not None:
        return _ocr_instance
    if not wait:
        if not _ocr_lock.acquire(blocking=False):
            return None
        try:
            if _ocr_instance is None:
                _init_ocr()
            return _ocr_instance
        finally:
            _ocr_lock.release()
    with _ocr_lock:
        if _ocr_instance is None:
            _init_ocr()
    return _ocr_instance


# ── Image helpers ─────────────────────────────────────────────────────────────

_MAX_SIDE    = 3000        # px — downsample very large photos before OCR
_MAX_DECODED = 7_000_000   # 7 MB of actual decoded image bytes


def _decode_image(image_base64: str) -> np.ndarray:
    """Decode data URI or raw base64 string → RGB numpy array."""
    data = image_base64
    if data.startswith("data:"):
        data = data.split(",", 1)[1]

    img_bytes = base64.b64decode(data)
    if len(img_bytes) > _MAX_DECODED:
        raise HTTPException(status_code=413, detail="Image too large — use a compressed photo (max 7 MB)")
    pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

    # Downsample if either dimension is very large (speeds up OCR ~4×)
    w, h = pil_img.size
    if max(w, h) > _MAX_SIDE:
        scale = _MAX_SIDE / max(w, h)
        pil_img = pil_img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    # Enhance for thermal receipts: boost contrast and sharpness so faded
    # dot-matrix / thermal print is more legible to PaddleOCR.
    pil_img = ImageEnhance.Contrast(pil_img).enhance(1.8)
    pil_img = ImageEnhance.Sharpness(pil_img).enhance(2.0)

    return np.array(pil_img)


# ── Invoice parser ────────────────────────────────────────────────────────────

# Words that should never be treated as the supplier name
_SKIP_SUPPLIER = re.compile(
    r"^(invoice|receipt|delivery|note|order|statement|tax|vat|till|nairobi|"
    r"kenya|tel|phone|email|www\.|page|date|time|cash|mpesa|m-pesa|total|"
    r"subtotal|balance|payment|thank|you|original|copy)$",
    re.I,
)

# Words that mark a table header row — skip when looking for line items
_HEADER_ROW = re.compile(
    r"\b(description|product|item(s)?|unit|qty|quantity|price|amount|"
    r"total|subtotal|discount|vat|tax|date|delivery|invoice|receipt|"
    r"supplier|customer|balance|kra|pin|no\.?)\b",
    re.I,
)

# Invoice / receipt number patterns
_INV_PATS = [
    re.compile(r"inv(?:oice)?[.\s#:/-]*([A-Z0-9/-]{3,})", re.I),
    re.compile(r"receipt[.\s#:/-]*([A-Z0-9/-]{3,})", re.I),
    re.compile(r"del(?:ivery)?[.\s#:/-]*(?:note)?[.\s#:/-]*([A-Z0-9/-]{3,})", re.I),
    re.compile(r"(?:no|num|number|ref)[.\s#:/-]+([A-Z0-9/-]{3,})", re.I),
    re.compile(r"#\s*([A-Z0-9/-]{3,})"),
]

# A run of digits with optional thousands-comma and decimal point
_NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b")


def _parse_invoice(ocr_result) -> dict:
    """
    Convert raw PaddleOCR output into structured invoice data.

    Strategy:
      1. Sort detected text blocks top-to-bottom.
      2. Cluster into visual rows by y-coordinate proximity.
      3. First substantive multi-word line → supplier name.
      4. Regex scan for invoice/receipt number.
      5. Rows that contain text AND at least one number → candidate line items.
         Numbers heuristic: small whole number = qty, larger = unit_cost.
    """
    if not ocr_result or not ocr_result[0]:
        return {"supplier": None, "invoice_number": None, "items": []}

    # 1. Collect blocks, discard low-confidence detections
    blocks = []
    for det in ocr_result[0]:
        bbox, (text, conf) = det
        if conf < 0.40 or not text.strip():
            continue
        ys = [pt[1] for pt in bbox]
        xs = [pt[0] for pt in bbox]
        blocks.append({
            "text": text.strip(),
            "y": sum(ys) / 4,
            "x": sum(xs) / 4,
        })

    if not blocks:
        return {"supplier": None, "invoice_number": None, "items": []}

    blocks.sort(key=lambda b: b["y"])

    # 2. Cluster into rows (~28px vertical tolerance — wider for thermal receipts
    #    where line-height is compressed and OCR boxes can overlap slightly)
    rows = [[blocks[0]]]
    for b in blocks[1:]:
        if abs(b["y"] - rows[-1][-1]["y"]) < 28:
            rows[-1].append(b)
        else:
            rows.append([b])

    # Sort each row left-to-right and join into a single string
    row_texts = [" ".join(b["text"] for b in sorted(r, key=lambda b: b["x"])) for r in rows]

    # 3. Supplier name — first multi-word line that isn't a boilerplate word
    supplier = None
    for text in row_texts[:10]:
        words = [w for w in text.split() if len(w) > 1]
        if len(words) >= 2 and not _SKIP_SUPPLIER.match(text.strip()):
            supplier = text.strip()
            break

    # 4. Invoice / receipt number
    invoice_number = None
    for text in row_texts:
        for pat in _INV_PATS:
            m = pat.search(text)
            if m:
                invoice_number = m.group(1).strip()
                break
        if invoice_number:
            break

    # 5. Line items
    items = []
    for text in row_texts:
        if _HEADER_ROW.search(text):
            continue

        number_strs = _NUMBER_RE.findall(text)
        if not number_strs:
            continue

        # Parse numbers (strip thousand commas)
        nums = []
        for n in number_strs:
            try:
                nums.append(float(n.replace(",", "")))
            except ValueError:
                pass

        if not nums:
            continue

        # Product name = everything that isn't a digit run or currency symbol
        name = _NUMBER_RE.sub("", text)
        name = re.sub(r"[Kk][Ss][Hh]?\.?|[Kk][Ee][Ss]?\.?|sh\.?", "", name)
        name = re.sub(r"[×xX*/]", " ", name)
        name = re.sub(r"[^\w\s'-]", " ", name)
        name = re.sub(r"\s+", " ", name).strip()

        if len(name) < 2:
            continue

        # Qty / unit_cost heuristic
        qty = 1.0
        unit_cost = None

        if len(nums) == 1:
            # Ambiguous — treat as unit cost (qty defaults to 1)
            unit_cost = nums[0]
        else:
            # Small whole number first → likely qty; second → unit cost
            if nums[0] <= 500 and nums[0] == int(nums[0]) and nums[1] >= nums[0]:
                qty = nums[0]
                unit_cost = nums[1]
            else:
                unit_cost = nums[0]

        items.append({"name": name, "qty": qty, "unit_cost": unit_cost})

    return {"supplier": supplier, "invoice_number": invoice_number, "items": items}


# ── Pydantic models ───────────────────────────────────────────────────────────

class InvoiceScanRequest(BaseModel):
    image_base64: str   # full data URI or raw base64
    media_type: str = "image/jpeg"  # ignored (kept for API compat)


class ScannedItem(BaseModel):
    name: str
    qty: float
    unit_cost: float | None = None


class InvoiceScanResponse(BaseModel):
    supplier: str | None = None
    invoice_number: str | None = None
    items: list[ScannedItem] = []


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/invoice", response_model=InvoiceScanResponse)
@limiter.limit("6/minute")
def scan_invoice(
    request: Request,
    payload: InvoiceScanRequest,
    tenant: Tenant = Depends(get_tenant),
):
    try:
        img_array = _decode_image(payload.image_base64)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("scan decode error tenant=%s %s", tenant.id, e)
        raise HTTPException(status_code=400, detail="Could not decode image")

    ocr = _get_ocr(wait=False)
    if ocr is None:
        raise HTTPException(
            status_code=503,
            detail="Scanner is still starting up — try again in about a minute",
        )

    try:
        result = ocr.ocr(img_array, cls=True)
    except Exception as e:
        logger.error("paddleocr error tenant=%s %s", tenant.id, e)
        raise HTTPException(status_code=502, detail="OCR engine error — please try again")

    parsed = _parse_invoice(result)

    items = []
    for item in parsed["items"]:
        try:
            items.append(ScannedItem(
                name=str(item["name"]).strip(),
                qty=max(0.01, float(item.get("qty") or 1)),
                unit_cost=float(item["unit_cost"]) if item.get("unit_cost") else None,
            ))
        except (TypeError, ValueError):
            continue

    logger.info("scan_invoice tenant=%s items=%d", tenant.id, len(items))
    return InvoiceScanResponse(
        supplier=parsed.get("supplier") or None,
        invoice_number=parsed.get("invoice_number") or None,
        items=items,
    )
