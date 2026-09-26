"""
What the database actually has, compared with what the models declare.

    python scripts/check_schema_state.py

Read-only. Run it after a deploy to confirm the boot-time migrations did their
job, or before one to see what they will have to do. Exits non-zero if anything
is missing, so it can gate a deploy check.

This is the same detection the API runs on every boot (app/schema_sync.py) - it
just reports instead of writing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, inspect as sa_inspect  # noqa: E402

from app.database import Base, normalise_db_url  # noqa: E402
from app import models  # noqa: E402,F401
from app.schema_sync import missing_columns, add_column_sql  # noqa: E402

url = os.getenv("DATABASE_URL", "")
if not url:
    sys.exit("DATABASE_URL is not set.")
url = normalise_db_url(url)

engine = create_engine(url)

with engine.connect() as conn:
    insp = sa_inspect(conn)
    present = set(insp.get_table_names())

    model_tables = [t.name for t in Base.metadata.sorted_tables]
    absent_tables = [t for t in model_tables if t not in present]

    print(f"{len(model_tables)} tables on the models, {len(present)} in the database\n")

    if absent_tables:
        print("Tables the database has not got (create_all builds these on boot):")
        for t in absent_tables:
            print(f"  - {t}")
        print()

    gaps = missing_columns(conn)
    if not gaps:
        print("Every column the models declare is present.")
    else:
        print(f"{len(gaps)} missing column(s) - the API will 500 on any endpoint that reads them:")
        for table, col in gaps:
            sql, note = add_column_sql(table.name, col, conn.dialect)
            print(f"  - {table.name}.{col.name}")
            print(f"      {sql}")
            if note:
                print(f"      note: {note}")

    # Row counts for the tables this release touches, so it is obvious whether
    # anything has actually synced yet.
    print("\nRows in the tables this release touches:")
    from sqlalchemy import text
    for t in ["tenants", "suppliers", "stock_receipts", "supplier_payments", "transactions"]:
        if t not in present:
            print(f"  {t:20} (table absent)")
            continue
        try:
            n = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            print(f"  {t:20} {n}")
        except Exception as exc:
            print(f"  {t:20} error: {exc}")

sys.exit(1 if (gaps or absent_tables) else 0)
