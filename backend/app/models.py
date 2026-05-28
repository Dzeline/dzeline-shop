from datetime import datetime
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, BigInteger, Text
from sqlalchemy.orm import relationship
from .database import Base


class StkRequest(Base):
    __tablename__ = "stk_requests"

    id = Column(Integer, primary_key=True, index=True)
    checkout_request_id = Column(String(100), unique=True, index=True, nullable=False)
    status = Column(String(20), default="pending", nullable=False)  # pending | confirmed | failed
    mpesa_code = Column(String(30), nullable=True)
    phone_number = Column(String(20), nullable=True)
    amount = Column(Float, nullable=True)
    created_at = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    local_id = Column(Integer, index=True)
    timestamp = Column(BigInteger, index=True)
    subtotal = Column(Float, nullable=False)
    vat = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    payment_method = Column(String(10), nullable=False)
    payment_amount = Column(Float)
    change_given = Column(Float, default=0)
    mpesa_code = Column(String(20), nullable=True)
    staff_id = Column(Integer, nullable=True)
    synced_at = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))

    items = relationship("TransactionItem", back_populates="transaction")


class TransactionItem(Base):
    __tablename__ = "transaction_items"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), index=True)
    product_id = Column(Integer, nullable=False)
    quantity = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)
    product_name = Column(String(200), nullable=True)

    transaction = relationship("Transaction", back_populates="items")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    local_id = Column(Integer, unique=True, nullable=True)
    barcode = Column(String(50), nullable=True)
    name = Column(String(200), nullable=False, index=True)
    price = Column(Float, nullable=False)
    stock = Column(Integer, default=0)
    category = Column(String(100), nullable=True)
    reorder_level = Column(Integer, default=10)
    active = Column(Boolean, default=True)
    updated_at = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class EtimsInvoice(Base):
    """Tracks every eTIMS submission attempt and its KRA response."""
    __tablename__ = "etims_invoices"

    id = Column(Integer, primary_key=True, index=True)
    local_txn_id = Column(Integer, index=True, nullable=False)  # IndexedDB transaction id
    invc_no = Column(Integer, nullable=False)                   # sequential eTIMS invoice number
    rcpt_typ = Column(String(1), default="S")                   # S=Sale R=Refund C=Copy

    status = Column(String(20), default="pending", nullable=False)
    # pending | submitted | failed | skipped

    # KRA response fields (populated on success)
    cu_invc_no = Column(Integer, nullable=True)
    rcpt_sign = Column(String(500), nullable=True)
    intr_data = Column(String(500), nullable=True)
    sdc_id = Column(String(50), nullable=True)
    mrc_no = Column(String(50), nullable=True)
    vsdc_rcpt_pbct_date = Column(String(20), nullable=True)

    error_msg = Column(String(500), nullable=True)
    attempts = Column(Integer, default=0)
    submitted_at = Column(BigInteger, nullable=True)
    created_at = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))


class EtimsCounter(Base):
    """Single-row table that tracks the last used sequential eTIMS invoice number."""
    __tablename__ = "etims_counter"

    id = Column(Integer, primary_key=True, default=1)
    last_invc_no = Column(Integer, default=0, nullable=False)


class SmsVerifiedCode(Base):
    """
    M-Pesa confirmation codes extracted from SMS received by android-sms-gateway
    on the shop device.  The frontend reconciles these against pending_mpesa rows.
    """
    __tablename__ = "sms_verified_codes"

    id                = Column(Integer, primary_key=True, index=True)
    confirmation_code = Column(String(20), unique=True, index=True, nullable=False)
    amount            = Column(Float, nullable=True)
    sender_name       = Column(String(200), nullable=True)
    sender_phone      = Column(String(30), nullable=True)   # may be masked since 2024
    received_at       = Column(BigInteger, nullable=False)   # ms epoch from SMS timestamp
    created_at        = Column(BigInteger, default=lambda: int(datetime.utcnow().timestamp() * 1000))
    raw_sms           = Column(Text, nullable=True)


class EtimsConfig(Base):
    """Single-row table storing eTIMS credentials configured from the UI."""
    __tablename__ = "etims_config"

    id             = Column(Integer, primary_key=True, default=1)
    tin            = Column(String(20),  nullable=True)        # KRA PIN
    bhf_id         = Column(String(5),   default="00")         # Branch ID
    dvc_srl_no     = Column(String(50),  nullable=True)        # Device serial
    env            = Column(String(20),  default="sandbox")    # sandbox | production
    initialized    = Column(Boolean,     default=False)
    activation_key = Column(String(500), nullable=True)        # from selectInitInfo response
    initialized_at = Column(BigInteger,  nullable=True)
    updated_at     = Column(BigInteger,  nullable=True)
