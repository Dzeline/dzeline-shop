import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

def normalise_db_url(raw):
    """
    The connection URL, with the driver named explicitly.

    Two corrections, both of which have bitten this service:

    `postgres://` is the spelling some providers still hand out and SQLAlchemy 2
    rejects outright.

    `postgresql://` with no driver means "whatever SQLAlchemy defaults to", and
    that default moved. This code was written against 2.0, where it is psycopg2 -
    the driver in requirements.txt. A newer SQLAlchemy defaults to psycopg (v3),
    which is not installed, so the first rebuild after the September 2026 billing
    suspension crashed on boot with ModuleNotFoundError: No module named 'psycopg'
    before a single request was served. Naming the driver costs nothing and does
    not depend on which version pip resolved this morning.
    """
    url = raw or "sqlite:///./dzeline.db"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Only when no driver is given - an explicit +psycopg or +asyncpg is a choice.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


DATABASE_URL = normalise_db_url(os.getenv("DATABASE_URL"))

_is_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
    **({} if _is_sqlite else {"pool_recycle": 1800}),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
