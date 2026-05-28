from datetime import datetime
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, BigInteger, Text
from sqlalchemy.orm import relationship
from .database import Base


class Tenant(Base):
    """One row per paying client shop."""
    __tablename__ = "tenants"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String(200), nullable=False)
    api_key_hash    = Column(String(64), unique=True, index=True, nullable=False)
    plan            = Column(String(20), default="trial")   # trial | starter | pro
    active          = Column(Boolean, default=True)
    billing_cycle_end = Column(BigInteger, nullable=True)   # ms epoch; NULL = no expiry
    created_at      = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))

    # Per-tenant Daraja overrides (Phase 2 — use env vars for now)
    daraja_consumer_key    = Column(String(200), nullable=True)
    daraja_consumer_secret = Column(String(200), nullable=True)
    daraja_shortcode       = Column(String(20),  nullable=True)
    daraja_passkey         = Column(String(200), nullable=True)
    daraja_callback_url    = Column(String(500), nullable=True)
    daraja_shortcode_type  = Column(String(20),  default="paybill")


class StkRequest(Base):
    __tablename__ = "stk_requests"

    id                  = Column(Integer, primary_key=True, index=True)
    tenant_id           = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    checkout_request_id = Column(String(100), index=True, nullable=False)
    status              = Column(String(20), default="pending", nullable=False)
    mpesa_code          = Column(String(30), nullable=True)
    phone_number        = Column(String(20), nullable=True)
    amount              = Column(Float, nullable=True)
    created_at          = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class Transaction(Base):
    __tablename__ = "transactions"

    id             = Column(Integer, primary_key=True, index=True)
    tenant_id      = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    local_id       = Column(Integer, index=True)
    timestamp      = Column(BigInteger, index=True)
    subtotal       = Column(Float, nullable=False)
    vat            = Column(Float, nullable=False)
    total          = Column(Float, nullable=False)
    payment_method = Column(String(10), nullable=False)
    payment_amount = Column(Float)
    change_given   = Column(Float, default=0)
    mpesa_code     = Column(String(20), nullable=True)
    staff_id       = Column(Integer, nullable=True)
    synced_at      = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))

    items = relationship("TransactionItem", back_populates="transaction")


class TransactionItem(Base):
    __tablename__ = "transaction_items"

    id             = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), index=True)
    product_id     = Column(Integer, nullable=False)
    quantity       = Column(Integer, nullable=False)
    price          = Column(Float, nullable=False)
    subtotal       = Column(Float, nullable=False)
    product_name   = Column(String(200), nullable=True)

    transaction = relationship("Transaction", back_populates="items")


class Product(Base):
    __tablename__ = "products"

    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    local_id      = Column(Integer, nullable=True)
    barcode       = Column(String(50), nullable=True)
    name          = Column(String(200), nullable=False, index=True)
    price         = Column(Float, nullable=False)
    stock         = Column(Integer, default=0)
    category      = Column(String(100), nullable=True)
    reorder_level = Column(Integer, default=10)
    active        = Column(Boolean, default=True)
    updated_at    = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class EtimsInvoice(Base):
    __tablename__ = "etims_invoices"

    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    local_txn_id = Column(Integer, index=True, nullable=False)
    invc_no      = Column(Integer, nullable=False)
    rcpt_typ     = Column(String(1), default="S")

    status   = Column(String(20), default="pending", nullable=False)

    cu_invc_no           = Column(Integer, nullable=True)
    rcpt_sign            = Column(String(500), nullable=True)
    intr_data            = Column(String(500), nullable=True)
    sdc_id               = Column(String(50), nullable=True)
    mrc_no               = Column(String(50), nullable=True)
    vsdc_rcpt_pbct_date  = Column(String(20), nullable=True)

    error_msg    = Column(String(500), nullable=True)
    attempts     = Column(Integer, default=0)
    submitted_at = Column(BigInteger, nullable=True)
    created_at   = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class EtimsCounter(Base):
    """Per-tenant sequential eTIMS invoice counter."""
    __tablename__ = "etims_counter"

    id            = Column(Integer, primary_key=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"), nullable=True, unique=True, index=True)
    last_invc_no  = Column(Integer, default=0, nullable=False)


class SmsVerifiedCode(Base):
    __tablename__ = "sms_verified_codes"

    id                = Column(Integer, primary_key=True, index=True)
    tenant_id         = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    confirmation_code = Column(String(20), index=True, nullable=False)
    amount            = Column(Float, nullable=True)
    sender_name       = Column(String(200), nullable=True)
    sender_phone      = Column(String(30), nullable=True)
    received_at       = Column(BigInteger, nullable=False)
    created_at        = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))
    raw_sms           = Column(Text, nullable=True)


class EtimsConfig(Base):
    """Per-tenant eTIMS credentials. One row per tenant."""
    __tablename__ = "etims_config"

    id             = Column(Integer, primary_key=True)
    tenant_id      = Column(Integer, ForeignKey("tenants.id"), nullable=True, unique=True, index=True)
    tin            = Column(String(20),  nullable=True)
    bhf_id         = Column(String(5),   default="00")
    dvc_srl_no     = Column(String(50),  nullable=True)
    env            = Column(String(20),  default="sandbox")
    initialized    = Column(Boolean,     default=False)
    activation_key = Column(String(500), nullable=True)
    initialized_at = Column(BigInteger,  nullable=True)
    updated_at     = Column(BigInteger,  nullable=True)
