from typing import Optional
from pydantic import BaseModel


# ── Tenant schemas ─────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str
    plan: str = "trial"


class TenantOut(BaseModel):
    id: int
    name: str
    plan: str
    active: bool
    billing_cycle_end: Optional[int] = None
    created_at: int

    class Config:
        from_attributes = True


class TenantCreated(TenantOut):
    api_key: str   # raw key — shown once, never stored


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    active: Optional[bool] = None
    billing_cycle_end: Optional[int] = None


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
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    etims_status: Optional[str] = None
    items: list[TransactionItemIn] = []


class TransactionOut(BaseModel):
    id: int
    local_id: Optional[int]
    timestamp: int
    total: float
    payment_method: str
    mpesa_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    etims_status: Optional[str] = None
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
    transaction_id: Optional[int] = None
    phone_number: str
    amount: float


class MpesaStkResponse(BaseModel):
    checkout_request_id: str
    response_code: str
    response_description: str
    customer_message: str
    sandbox: bool = False


class StkStatusResponse(BaseModel):
    checkout_request_id: str
    status: str  # pending | confirmed | failed
    mpesa_code: Optional[str] = None


# ── eTIMS schemas ─────────────────────────────────────────────────────────────

class EtimsItemIn(BaseModel):
    """One line item inside a transaction submitted for eTIMS."""
    product_id: int
    name: str
    barcode: Optional[str] = None
    qty: float
    price: float                       # unit price (VAT-inclusive)
    etims_item_cd: Optional[str] = None   # KRA item code (auto-generated if absent)
    item_cls_cd: Optional[str] = "10000000"  # UNSPSC 8-digit classification
    pkg_unit_cd: Optional[str] = "NT"      # packaging unit (NT=Not applicable)
    qty_unit_cd: Optional[str] = "U"       # quantity unit (U=Unit)


class EtimsTransactionIn(BaseModel):
    """Full transaction payload sent from the frontend for eTIMS submission."""
    local_id: int
    timestamp: int                     # ms epoch
    items: list[EtimsItemIn]
    subtotal: float
    vat: float
    total: float
    payment_method: str                # CASH | MPESA | POCHI
    voided: bool = False
    rcpt_typ: Optional[str] = "S"      # S=Sale R=Refund
    org_invc_no: Optional[int] = None  # original invoice no for refunds


class EtimsBatchRequest(BaseModel):
    transactions: list[EtimsTransactionIn]
    vat_rate: Optional[float] = 0.16
    taxpayer_name: Optional[str] = "Admin"


class EtimsItemRegisterIn(BaseModel):
    """Minimal product fields needed for KRA item registration."""
    product_id: int
    name: str
    barcode: Optional[str] = None
    price: float
    etims_item_cd: Optional[str] = None
    item_cls_cd: Optional[str] = "10000000"
    pkg_unit_cd: Optional[str] = "NT"
    qty_unit_cd: Optional[str] = "U"
    tax_typ_cd: Optional[str] = "A"   # A=16% VAT, B=0% zero-rated


class EtimsItemsRegisterRequest(BaseModel):
    items: list[EtimsItemRegisterIn]


class EtimsInvoiceResult(BaseModel):
    local_id: int
    status: str
    invc_no: Optional[int] = None
    cu_invc_no: Optional[int] = None
    rcpt_sign: Optional[str] = None
    sdc_id: Optional[str] = None
    mrc_no: Optional[str] = None
    vsdc_rcpt_pbct_date: Optional[str] = None
    error: Optional[str] = None


class EtimsBatchResponse(BaseModel):
    results: list[EtimsInvoiceResult]
    submitted: int
    failed: int
    skipped: int


# ── eTIMS config schemas ───────────────────────────────────────────────────────

class EtimsConfigIn(BaseModel):
    tin: str
    bhf_id: str = "00"
    dvc_srl_no: str
    env: Optional[str] = None   # only set by developer via env vars or direct API call


class EtimsConfigOut(BaseModel):
    tin: Optional[str]
    bhf_id: str
    dvc_srl_no: Optional[str]
    env: str
    initialized: bool
    initialized_at: Optional[int]

    class Config:
        from_attributes = True


class EtimsBranch(BaseModel):
    bhfId: str
    bhfNm: Optional[str] = None
    bhfSttsCd: Optional[str] = None


class EtimsBranchesResponse(BaseModel):
    branches: list[EtimsBranch]
