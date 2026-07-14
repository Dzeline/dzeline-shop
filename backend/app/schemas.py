from typing import Optional
from pydantic import BaseModel


# ── Tenant schemas ─────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str
    plan: str = "trial"
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    notes: Optional[str] = None


class TenantOut(BaseModel):
    id: int
    name: str
    plan: str
    active: bool
    billing_cycle_end: Optional[int] = None
    created_at: int
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    notes: Optional[str] = None

    # Non-secret Daraja config — safe to read back and prefill in a form.
    # daraja_consumer_secret and daraja_passkey are write-only (never echoed).
    daraja_consumer_key:   Optional[str] = None
    daraja_shortcode:      Optional[str] = None
    daraja_shortcode_type: Optional[str] = None
    daraja_callback_url:   Optional[str] = None
    till_number:           Optional[str] = None

    class Config:
        from_attributes = True


class TenantWithMetrics(TenantOut):
    txn_count: int = 0
    total_revenue: float = 0.0
    last_sync_at: Optional[int] = None


class TenantCreated(TenantOut):
    api_key: str   # raw key — shown once, never stored


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    active: Optional[bool] = None
    billing_cycle_end: Optional[int] = None
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    notes: Optional[str] = None

    # Per-tenant Daraja overrides — falls back to the shared env vars when unset.
    # Omit daraja_consumer_secret / daraja_passkey from the request entirely to
    # leave a previously-saved secret untouched (they're never sent back by
    # TenantOut, so the admin UI can't round-trip them).
    daraja_consumer_key:    Optional[str] = None
    daraja_consumer_secret: Optional[str] = None
    daraja_shortcode:       Optional[str] = None
    daraja_passkey:         Optional[str] = None
    daraja_callback_url:    Optional[str] = None
    daraja_shortcode_type:  Optional[str] = None
    till_number:            Optional[str] = None


# ── Shop settings schemas ────────────────────────────────────────────────────
# Shop-owner-editable subset of Tenant — never touches plan/billing/Daraja
# secrets, which stay under /admin/* only.

class ShopSettingsIn(BaseModel):
    shop_name:       Optional[str]   = None
    town:            Optional[str]   = None
    phone:           Optional[str]   = None
    kra_pin:         Optional[str]   = None
    vat_enabled:     Optional[bool]  = None
    vat_rate:        Optional[float] = None
    till_number:     Optional[str]   = None
    pochi_number:    Optional[str]   = None
    mpesa_till_type: Optional[str]   = None
    currency:        Optional[str]   = None


class ShopSettingsOut(BaseModel):
    shop_name:           Optional[str]   = None
    town:                Optional[str]   = None
    phone:               Optional[str]   = None
    kra_pin:             Optional[str]   = None
    vat_enabled:         Optional[bool]  = None
    vat_rate:            Optional[float] = None
    till_number:         Optional[str]   = None
    pochi_number:        Optional[str]   = None
    mpesa_till_type:     Optional[str]   = None
    currency:            Optional[str]   = None
    settings_updated_at: Optional[int]   = None

    class Config:
        from_attributes = True


class TransactionItemIn(BaseModel):
    product_id: int
    quantity: int
    price: float
    subtotal: float
    name: Optional[str] = None
    cloud_product_id: Optional[int] = None   # if set, backend decrements Product.stock
    cost_price: Optional[float] = None       # snapshot at sale time — cross-device COGS


class TransactionItemOut(BaseModel):
    product_id: int
    quantity: int
    price: float
    subtotal: float
    product_name: Optional[str] = None
    cost_price: Optional[float] = None
    cloud_product_id: Optional[int] = None

    class Config:
        from_attributes = True


class TransactionIn(BaseModel):
    id: Optional[int] = None
    device_id: Optional[str] = None
    timestamp: int
    subtotal: float
    vat: float
    total: float
    payment_method: str
    payment_amount: Optional[float] = None
    change_given: Optional[float] = 0
    mpesa_code: Optional[str] = None
    staff_id: Optional[int] = None
    staff_name: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    etims_status: Optional[str] = None
    voided: Optional[bool] = False
    items: list[TransactionItemIn] = []


class TransactionOut(BaseModel):
    id: int
    local_id: Optional[int]
    device_id: Optional[str] = None
    timestamp: int
    subtotal: float
    vat: float
    total: float
    payment_method: str
    payment_amount: Optional[float] = None
    change_given: Optional[float] = None
    mpesa_code: Optional[str] = None
    staff_id: Optional[int] = None
    staff_name: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    etims_status: Optional[str] = None
    voided: bool = False
    synced_at: int
    updated_at: Optional[int] = None
    items: list[TransactionItemOut] = []

    class Config:
        from_attributes = True


class ProductIn(BaseModel):
    device_id: Optional[str] = None
    local_id: Optional[int] = None
    barcode: Optional[str] = None
    name: str
    price: float
    cost_price: Optional[float] = None
    stock: int = 0
    category: Optional[str] = None
    reorder_level: int = 10


class ProductOut(ProductIn):
    id: int
    active: bool
    updated_at: int


# ── Staff schemas ──────────────────────────────────────────────────────────────
# Transport only — the backend never verifies a PIN. pin_hash travels as-is so
# a receiving device can do its own local lookup, exactly like the creating one.

class StaffIn(BaseModel):
    device_id:   Optional[str] = None
    local_id:    Optional[int] = None
    name:        str
    pin_hash:    str
    role:        str = "cashier"
    permissions: Optional[str] = None   # JSON-encoded array, role="custom" only
    active:      bool = True


class StaffUpdate(BaseModel):
    name:        Optional[str]  = None
    pin_hash:    Optional[str]  = None
    role:        Optional[str]  = None
    permissions: Optional[str]  = None
    active:      Optional[bool] = None


class StaffOut(BaseModel):
    id:          int
    device_id:   Optional[str] = None
    local_id:    Optional[int] = None
    name:        str
    pin_hash:    str
    role:        str
    permissions: Optional[str] = None
    active:      bool
    deleted_at:  Optional[int] = None
    updated_at:  int

    class Config:
        from_attributes = True

    class Config:
        from_attributes = True


# ── Supplier schemas ─────────────────────────────────────────────────────────

class SupplierIn(BaseModel):
    device_id: Optional[str] = None
    local_id:  Optional[int] = None
    name:      str
    phone:     Optional[str] = None
    email:     Optional[str] = None
    notes:     Optional[str] = None


class SupplierUpdate(BaseModel):
    name:  Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class SupplierOut(BaseModel):
    id:         int
    device_id:  Optional[str] = None
    local_id:   Optional[int] = None
    name:       str
    phone:      Optional[str] = None
    email:      Optional[str] = None
    notes:      Optional[str] = None
    deleted_at: Optional[int] = None
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
    product_id: Optional[int] = None   # may be unresolved for a foreign (pulled) item
    cloud_product_id: Optional[int] = None   # tenant-wide id — see _auto_item_cd
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
    transaction_id: Optional[int] = None   # real backend Transaction.id — the dedup key
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
    cloud_product_id: Optional[int] = None   # tenant-wide id — see _auto_item_cd
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
