"""
Does the connection URL end up naming a driver that is actually installed?

    cd backend && python scripts/verify_db_url.py

This is the first line of app/main.py's import chain. Getting it wrong does not
break a feature, it stops the process before a single request is served - which
is exactly what happened twice in September 2026: once from a URL naming psycopg
v3 when psycopg2 is what requirements installs, and once from my own first fix,
which left that URL untouched because I had misdiagnosed the cause as a changed
SQLAlchemy default.

So which drivers are "installed" is stubbed here rather than inherited from
whatever this machine happens to have. A test that only passes on a developer's
laptop is how the original bug reached production.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import database  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"{'  ok  ' if ok else '  FAIL'}  {label}{f' - {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


class Installed:
    """Pretend exactly these driver modules are importable."""

    def __init__(self, *modules):
        self.modules = set(modules)

    def __enter__(self):
        self._real = database._importable
        database._importable = lambda m: m in self.modules
        return self

    def __exit__(self, *_):
        database._importable = self._real


n = database.normalise_db_url

print("\n-- the spelling providers hand out --")
with Installed("psycopg2"):
    check("postgres:// is rewritten (SQLAlchemy 2 rejects it)",
          n("postgres://u:p@h/db") == "postgresql+psycopg2://u:p@h/db",
          n("postgres://u:p@h/db"))
    check("a driverless URL names psycopg2 rather than trusting the default",
          n("postgresql://u:p@h/db") == "postgresql+psycopg2://u:p@h/db",
          n("postgresql://u:p@h/db"))
    check("the query string survives",
          n("postgresql://u:p@h/db?sslmode=require&x=1").endswith("/db?sslmode=require&x=1"),
          n("postgresql://u:p@h/db?sslmode=require&x=1"))

print("\n-- the Neon connection string that crashed the boot --")
with Installed("psycopg2"):
    got = n("postgresql+psycopg://u:p@h/db?sslmode=require")
    check("psycopg v3 falls back to the psycopg2 that is installed",
          got == "postgresql+psycopg2://u:p@h/db?sslmode=require", got)

print("\n-- a driver that works is a choice, not a mistake --")
with Installed("psycopg2", "psycopg"):
    check("psycopg v3 is left alone when it IS installed",
          n("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db",
          n("postgresql+psycopg://u:p@h/db"))
with Installed("psycopg2"):
    check("psycopg2 is left alone", n("postgresql+psycopg2://u:p@h/db") == "postgresql+psycopg2://u:p@h/db")
with Installed("psycopg"):
    got = n("postgresql+psycopg2://u:p@h/db")
    check("and it works the other way round too - psycopg2 missing, psycopg present",
          got == "postgresql+psycopg://u:p@h/db", got)

print("\n-- when nothing is installed --")
with Installed():
    got = n("postgresql+psycopg://u:p@h/db")
    check("the URL is left alone so the error names the real missing driver",
          got == "postgresql+psycopg://u:p@h/db", got)

print("\n-- everything else is passed through --")
with Installed("psycopg2"):
    check("sqlite is untouched", n("sqlite:///./x.db") == "sqlite:///./x.db")
    check("no URL at all falls back to the local sqlite file",
          n(None) == "sqlite:///./dzeline.db" and n("") == "sqlite:///./dzeline.db")
    # An async driver is a deliberate, different architecture - not something to
    # silently swap for a sync one, which would fail in a far more confusing way.
    check("an unknown driver that is not installed is not swapped for a sync one",
          n("postgresql+asyncpg://u:p@h/db") == "postgresql+asyncpg://u:p@h/db",
          n("postgresql+asyncpg://u:p@h/db"))

print("\n-- it warns when it overrides --")
with Installed("psycopg2"):
    class Log:
        def __init__(self):
            self.messages = []

        def warning(self, m):
            self.messages.append(m)

    log = Log()
    n("postgresql+psycopg://u:p@h/db", log=log)
    check("the override is logged, naming both drivers",
          len(log.messages) == 1 and "psycopg" in log.messages[0] and "psycopg2" in log.messages[0],
          log.messages[0][:120] if log.messages else "nothing logged")

    log2 = Log()
    n("postgresql://u:p@h/db", log=log2)
    check("a URL that needed no override logs nothing", log2.messages == [],
          str(log2.messages)[:80])

print("\n-- the URL SQLAlchemy will actually build --")
from sqlalchemy.engine.url import make_url  # noqa: E402

with Installed("psycopg2"):
    for raw in ["postgres://u:p@h/db", "postgresql://u:p@h/db", "postgresql+psycopg://u:p@h/db"]:
        url = make_url(n(raw))
        check(f"{raw} resolves to a psycopg2 dialect", url.get_dialect().driver == "psycopg2",
              url.get_dialect().driver)

print()
if failures:
    print(f"{len(failures)} failed:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("All database-URL checks passed.")
