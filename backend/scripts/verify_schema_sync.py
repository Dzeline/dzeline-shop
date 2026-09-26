"""
Does the schema reconciler find what the hand-written list misses?

    cd backend && python scripts/verify_schema_sync.py

Run against SQLite, because the decisions being checked are dialect-independent:
which columns are missing, what type they get, and whether NOT NULL is safe to
assert on a table that already has rows. The one Postgres-only part is
`ADD COLUMN IF NOT EXISTS`, so the SQL is asserted as text rather than executed
against SQLite, and the detection is run against a real database file.

This exists because the reconciler runs on every API boot. A bug in it does not
break a feature, it breaks starting up.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from app.database import Base  # noqa: E402
from app import models  # noqa: E402,F401
from app.schema_sync import add_column_sql, missing_columns  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"{'  ok  ' if ok else '  FAIL'}  {label}{f' - {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


def col(table_name, col_name):
    return Base.metadata.tables[table_name].columns[col_name]


# -- the DDL it builds ------------------------------------------------------─
from sqlalchemy.dialects import postgresql  # noqa: E402

pg = postgresql.dialect()

print("\n-- the ALTER it writes --")

sql, note = add_column_sql("suppliers", col("suppliers", "pay_method"), pg)
check("a nullable string is added plainly",
      sql == "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pay_method VARCHAR(30)" and note is None,
      sql)

sql, note = add_column_sql("stock_receipts", col("stock_receipts", "invoice_amount"), pg)
check("a NOT NULL number brings its default, so existing rows read as zero",
      "DEFAULT 0" in sql and "NOT NULL" in sql and note is None, sql)

sql, note = add_column_sql("stock_receipts", col("stock_receipts", "payment_status"), pg)
check("a NOT NULL string default is quoted",
      "DEFAULT 'unpaid'" in sql and "NOT NULL" in sql, sql)

# The dangerous case: NOT NULL with no usable default. Adding that to a table
# with rows in it cannot work, so it must be relaxed and said out loud.
sql, note = add_column_sql("supplier_payments", col("supplier_payments", "amount"), pg)
check("a NOT NULL column with no default is relaxed, not crashed on",
      "NOT NULL" not in sql and note is not None, note or sql)

# A lambda default (most created_at columns) is not a SQL default.
sql, note = add_column_sql("suppliers", col("suppliers", "created_at"), pg)
check("a callable default is not mistaken for a SQL one",
      "DEFAULT" not in sql, sql)

# -- the gaps it finds ------------------------------------------------------─
print("\n-- the gaps it finds --")

fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)
try:
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        check("a database built from the models has no gaps",
              missing_columns(conn) == [], str(len(missing_columns(conn))) + " found")

    # Now make it look like production did: a suppliers table from before the
    # payment-details columns existed, with a row already in it.
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE suppliers"))
        conn.execute(text(
            "CREATE TABLE suppliers ("
            " id INTEGER PRIMARY KEY, tenant_id INTEGER, device_id VARCHAR(64),"
            " local_id INTEGER, name VARCHAR(200) NOT NULL, phone VARCHAR(30),"
            " email VARCHAR(200), notes TEXT, deleted_at BIGINT,"
            " created_at BIGINT, updated_at BIGINT)"
        ))
        conn.execute(text("INSERT INTO suppliers (id, name) VALUES (1, 'Mwangi Wholesalers')"))
        conn.commit()

    with engine.connect() as conn:
        gaps = missing_columns(conn)
        names = [f"{t.name}.{c.name}" for t, c in gaps]
        check("it finds the three payment-detail columns",
              sorted(names) == ["suppliers.pay_account", "suppliers.pay_method", "suppliers.pay_name"],
              ", ".join(sorted(names)) or "none")

        # And the ALTERs it would run must actually work on a table with rows -
        # the SQLite spelling, since that is what can be executed here.
        for table, column in gaps:
            sql, _ = add_column_sql(table.name, column, engine.dialect)
            conn.execute(text(sql.replace(" IF NOT EXISTS", "")))
        conn.commit()

    with engine.connect() as conn:
        check("after running them there are no gaps left", missing_columns(conn) == [])
        kept = conn.execute(text("SELECT name FROM suppliers WHERE id = 1")).scalar()
        check("and the row that was already there is untouched", kept == "Mwangi Wholesalers", kept)

    # A table absent entirely is create_all's business, not this.
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE supplier_payments"))
        conn.commit()
    with engine.connect() as conn:
        names = [t.name for t, _ in missing_columns(conn)]
        check("a missing table is left to create_all, not ALTERed column by column",
              "supplier_payments" not in names, ", ".join(sorted(set(names))) or "none")
finally:
    try:
        os.unlink(path)
    except OSError:
        pass

# -- the columns this release needs ------------------------------------------
print("\n-- the columns this release needs --")
for table_name, col_name in [
    ("suppliers", "pay_method"), ("suppliers", "pay_account"), ("suppliers", "pay_name"),
    ("stock_receipts", "order_id"), ("stock_receipts", "invoice_amount"),
    ("stock_receipts", "amount_paid"), ("stock_receipts", "payment_status"),
]:
    check(f"{table_name}.{col_name} is on the model", col_name in Base.metadata.tables[table_name].columns)

print()
if failures:
    print(f"{len(failures)} failed:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("All schema-sync checks passed.")
