from datetime import datetime
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, BigInteger
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
