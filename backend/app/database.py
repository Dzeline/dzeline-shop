import logging
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("dzeline.db")

def _importable(module):
    try:
        __import__(module)
        return True
    except ImportError:
        return False


# The DBAPI each postgres dialect needs, so a URL naming one that is not
# installed can fall back to one that is instead of killing the process.
_PG_DRIVERS = {"psycopg2": "psycopg2", "psycopg": "psycopg", "pg8000": "pg8000"}


def normalise_db_url(raw, log=None):
    """
    The connection URL, with a driver that is actually installed.

    Two corrections, both of which have taken this service down:

    `postgres://` is the spelling some providers still hand out, and SQLAlchemy 2
    rejects it outright.

    A driver that is not installed. Neon's dashboard hands out
    `postgresql+psycopg://` for SQLAlchemy - psycopg v3 - and requirements.txt
    installs psycopg2. Pasting that connection string in is enough to crash the
    API on boot with ModuleNotFoundError before it serves a request, which is
    exactly what happened when the database was restored in September 2026. The
    URL is right about the database and wrong about one word.

    So: a named driver that imports is left alone, because it is a choice. A
    named sync driver that does not import is swapped for one that does, loudly.
    A driver outside that set - anything async, anything unrecognised - is left
    alone, because it means a different architecture rather than a typo, and
    SQLAlchemy's own complaint about it is clearer than a silent swap. And a URL
    naming no driver gets psycopg2 named explicitly, rather than depending on a
    default this code does not control.
    """
    url = raw or "sqlite:///./dzeline.db"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if not url.startswith("postgresql"):
        return url

    scheme = url.split("://", 1)[0]
    named = scheme.split("+", 1)[1] if "+" in scheme else None

    if named is None:
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)

    module = _PG_DRIVERS.get(named, named)
    if _importable(module):
        return url

    # Only substitute within the sync drivers above. An async driver, or one this
    # does not recognise, is a different architecture rather than a typo - the
    # app builds a sync engine, so swapping asyncpg for psycopg2 would paper over
    # a real misconfiguration and SQLAlchemy's own error about it is clearer.
    if named not in _PG_DRIVERS:
        message = (
            f"DATABASE_URL asks for the {named!r} driver, which is not installed, and it is "
            "not one this app can substitute for. Fix DATABASE_URL or install that driver."
        )
        if log:
            log.warning(message)
        else:
            print(f"WARNING: {message}")
        return url

    for candidate, candidate_module in _PG_DRIVERS.items():
        if candidate != named and _importable(candidate_module):
            message = (
                f"DATABASE_URL asks for the {named!r} driver, which is not installed. "
                f"Using {candidate!r} instead. Fix DATABASE_URL, or add {module!r} to "
                "requirements.txt if that driver is what you meant."
            )
            if log:
                log.warning(message)
            else:
                print(f"WARNING: {message}")
            return url.replace(f"postgresql+{named}://", f"postgresql+{candidate}://", 1)

    # Nothing usable is installed. Leave the URL alone so the failure names the
    # driver that is missing rather than one this function guessed at.
    return url


DATABASE_URL = normalise_db_url(os.getenv("DATABASE_URL"), log=logger)

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
