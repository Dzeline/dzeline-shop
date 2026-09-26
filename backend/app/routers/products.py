import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_tenant
from ..models import Product, Tenant
from ..schemas import ProductIn, ProductOut

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/", response_model=list[ProductOut])
def list_products(
    since: int = 0,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    # Includes soft-deleted (active=False) rows — pulling devices need to see
    # a deletion, not just have it filtered out server-side, or it never
    # reaches other devices. Same pattern as list_staff.
    #
    # since-filtered like /stock-receipts — this endpoint is polled every 45s
    # per device, and now carries a (compressed but still real) image_blob.
    # Re-sending every product's photo on every poll forever, with no
    # since-filtering, is exactly what burned through the Neon data-transfer
    # quota with stock receipt photos earlier. since=0 (the default) still
    # returns everything — used by SetupWizard/JoinShop for a fresh catalog.
    return (
        db.query(Product)
        .filter(Product.tenant_id == tenant.id, Product.updated_at > since)
        .order_by(Product.updated_at.asc())
        .all()
    )


def _normalise_name(name):
    return " ".join(str(name or "").lower().split())


def _is_fabricated_barcode(barcode):
    """
    A barcode the old client invented rather than read off a package.

    Until September 2026 the add form fell back to String(Date.now()) when nobody
    typed one - 13 digits, the same length as an EAN-13 - so those values have to
    be treated as absent or two tills can never match the same product. The range
    is a millisecond timestamp from 2017 to 2033.
    """
    text = str(barcode or "").strip()
    return bool(re.fullmatch(r"1[5-9]\d{11}", text))


def _find_twin(db: Session, tenant_id: int, payload: ProductIn):
    """The product this tenant already has that `payload` is another copy of."""
    barcode = (payload.barcode or "").strip()
    if barcode and not _is_fabricated_barcode(barcode):
        return (
            db.query(Product)
            .filter(Product.tenant_id == tenant_id, Product.barcode == barcode)
            .first()
        )

    name = _normalise_name(payload.name)
    if not name:
        return None
    # Compared in Python rather than SQL: the stored names carry the casing and
    # spacing whoever typed them used, and matching has to ignore both.
    for candidate in (
        db.query(Product).filter(Product.tenant_id == tenant_id).all()
    ):
        candidate_barcode = (candidate.barcode or "").strip()
        # A product that has a real barcode is not the same as one without: the
        # barcode is the stronger statement, and merging across it would fold two
        # genuinely different items together.
        if candidate_barcode and not _is_fabricated_barcode(candidate_barcode):
            continue
        if _normalise_name(candidate.name) == name:
            return candidate
    return None


@router.post("/", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    if payload.device_id and payload.local_id is not None:
        existing = (
            db.query(Product)
            .filter(
                Product.tenant_id == tenant.id,
                Product.device_id == payload.device_id,
                Product.local_id == payload.local_id,
            )
            .first()
        )
        if existing:
            return existing

    # The same product pushed by a different device.
    #
    # The check above only catches one device re-pushing its own row. Two staff
    # each adding the same item on their own till produced two cloud products,
    # and then every device pulled both - so one tin of Blue Band became four
    # rows with its stock split between them, and no single row was ever low
    # enough to trigger a reorder.
    #
    # Returning the row that already exists makes both devices point at one
    # product, which is what the shop means. Barcode is definitive; a name match
    # is used only when neither side has one, which for these shops is most of
    # the catalogue.
    twin = _find_twin(db, tenant.id, payload)
    if twin is not None:
        return twin

    product = Product(
        **payload.model_dump(),
        tenant_id=tenant.id,
        updated_at=int(datetime.utcnow().timestamp() * 1000),
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.tenant_id == tenant.id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, key, value)
    product.updated_at = int(datetime.utcnow().timestamp() * 1000)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.tenant_id == tenant.id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.active = False
    db.commit()


@router.get("/low-stock", response_model=list[ProductOut])
def low_stock(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    products = (
        db.query(Product)
        .filter(Product.tenant_id == tenant.id, Product.active == True)
        .all()
    )
    return [p for p in products if p.stock <= p.reorder_level]
