from typing import Optional
from pydantic import BaseModel


class TransactionItemIn(BaseModel):
    product_id: int
    quantity: int
    price: float
    subtotal: float
    name: Optional[str] = None


class TransactionIn(BaseModel):
    id: Optional[int] = None
    timestamp: int
    subtotal: float
    vat: float
    total: float
    payment_method: str
    payment_amount: Optional[float] = None
    change_given: Optional[float] = 0
    mpesa_code: Optional[str] = None
    staff_id: Optional[int] = None
    items: list[TransactionItemIn] = []


class TransactionOut(BaseModel):
    id: int
    local_id: Optional[int]
    timestamp: int
    total: float
    payment_method: str
    synced_at: int

    class Config:
        from_attributes = True


class ProductIn(BaseModel):
    local_id: Optional[int] = None
    barcode: Optional[str] = None
    name: str
    price: float
    stock: int = 0
    category: Optional[str] = None
    reorder_level: int = 10


class ProductOut(ProductIn):
    id: int
    active: bool
    updated_at: int

    class Config:
        from_attributes = True


class MpesaStkRequest(BaseModel):
    transaction_id: int
    phone_number: str
    amount: float


class MpesaStkResponse(BaseModel):
    checkout_request_id: str
    response_code: str
    response_description: str
    customer_message: str
