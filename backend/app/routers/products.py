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
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    return (
        db.query(Product)
        .filter(Product.tenant_id == tenant.id, Product.active == True)
        .order_by(Product.name)
        .all()
    )


@router.post("/", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
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
