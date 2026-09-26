"""
Does the payment repair fix the right rows and leave the rest alone?

    cd backend && python scripts/verify_payment_repair.py

The repair writes to a live shop's money records, so "dry run by default" is not
enough assurance on its own. This builds a database with the exact corruption
seen in production - payments carrying local Dexie ids where cloud ids belong -
alongside rows that are already correct and rows that cannot be resolved, then
checks that each is treated the way it should be.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text  # noqa: E402

from app.database import Base  # noqa: E402
from app import models  # noqa: E402,F401
from repair_payment_ids import run, resolve, RECEIPT_BY_LOCAL, RECEIPT_EXISTS  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"{'  ok  ' if ok else '  FAIL'}  {label}{f' - {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)

try:
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, api_key_hash) VALUES (1, 'Mama Njeri', 'h1')"))
        conn.execute(text("INSERT INTO tenants (id, name, api_key_hash) VALUES (2, 'Other Shop', 'h2')"))

        # Two tills in one shop. The staff phone received the deliveries; the
        # owner's phone paid for them.
        for cloud_id, device, local, invoice in [
            (5001, "staff-till", 1, 4000),
            (5002, "staff-till", 2, 2500),
            (5003, "owner-phone", 1, 900),
        ]:
            conn.execute(text(
                "INSERT INTO stock_receipts (id, tenant_id, device_id, local_id, status, supplier,"
                " supplier_id, invoice_amount, amount_paid, payment_status)"
                " VALUES (:id, 1, :dev, :local, 'activated', 'Mwangi Wholesalers', :sup, :inv, 0, 'unpaid')"
            ), {"id": cloud_id, "dev": device, "local": local, "sup": 7001, "inv": invoice})

        # A receipt belonging to a DIFFERENT shop that happens to hold cloud id 1 -
        # the number a broken row would point at. Touching it would be the worst
        # possible outcome: one shop's payment against another shop's invoice.
        conn.execute(text(
            "INSERT INTO stock_receipts (id, tenant_id, device_id, local_id, status, supplier,"
            " supplier_id, invoice_amount, amount_paid, payment_status)"
            " VALUES (1, 2, 'far-away-till', 99, 'activated', 'Someone Else', 9999, 5000, 0, 'unpaid')"
        ))

        conn.execute(text(
            "INSERT INTO suppliers (id, tenant_id, device_id, local_id, name)"
            " VALUES (7001, 1, 'staff-till', 3, 'Mwangi Wholesalers')"
        ))

        # Broken: the owner's phone pushed its own local receipt id (1 and 2,
        # meaning the staff till's deliveries) and local supplier id 3.
        conn.execute(text(
            "INSERT INTO supplier_payments (id, tenant_id, device_id, local_id, receipt_id,"
            " supplier_id, supplier, amount, method, paid_at)"
            " VALUES (9001, 1, 'staff-till', 11, 1, 3, 'Mwangi Wholesalers', 1500, 'mpesa', 100)"
        ))
        conn.execute(text(
            "INSERT INTO supplier_payments (id, tenant_id, device_id, local_id, receipt_id,"
            " supplier_id, supplier, amount, method, paid_at)"
            " VALUES (9002, 1, 'staff-till', 12, 1, 3, 'Mwangi Wholesalers', 1000, 'cash', 200)"
        ))
        conn.execute(text(
            "INSERT INTO supplier_payments (id, tenant_id, device_id, local_id, receipt_id,"
            " supplier_id, supplier, amount, method, paid_at)"
            " VALUES (9003, 1, 'staff-till', 13, 2, 3, 'Mwangi Wholesalers', 2500, 'mpesa', 300)"
        ))
        # Already correct: pushed after the fix, carrying a real cloud id.
        conn.execute(text(
            "INSERT INTO supplier_payments (id, tenant_id, device_id, local_id, receipt_id,"
            " supplier_id, supplier, amount, method, paid_at)"
            " VALUES (9004, 1, 'owner-phone', 21, 5003, 7001, 'Mwangi Wholesalers', 900, 'cash', 400)"
        ))
        # Unresolvable: names a local id that does not exist for this device.
        conn.execute(text(
            "INSERT INTO supplier_payments (id, tenant_id, device_id, local_id, receipt_id,"
            " supplier_id, supplier, amount, method, paid_at)"
            " VALUES (9005, 1, 'staff-till', 22, 77, 3, 'Ghost Supplier', 400, 'cash', 500)"
        ))
        conn.commit()

    print("\n-- a dry run changes nothing --")
    with engine.connect() as conn:
        run(conn, apply=False)
    with engine.connect() as conn:
        still = conn.execute(text("SELECT receipt_id FROM supplier_payments WHERE id = 9001")).scalar()
        check("the broken row is still broken after a dry run", still == 1, f"receipt_id={still}")

    print("\n-- the repair --")
    with engine.connect() as conn:
        repairs = run(conn, apply=True)
        # Four, not three: the row whose receipt cannot be resolved still has a
        # resolvable supplier, and fixing the half that is knowable beats leaving
        # both wrong.
        check("it repaired every row it could", len(repairs) == 4, f"{len(repairs)}")

    with engine.connect() as conn:
        def pay(pid, field="receipt_id"):
            return conn.execute(
                text(f"SELECT {field} FROM supplier_payments WHERE id = :id"), {"id": pid}
            ).scalar()

        print("\n-- each payment points where it should --")
        check("the first two now point at the delivery they paid for",
              pay(9001) == 5001 and pay(9002) == 5001, f"{pay(9001)}, {pay(9002)}")
        check("the third at its own delivery", pay(9003) == 5002, f"{pay(9003)}")
        check("the supplier id was translated too",
              pay(9001, "supplier_id") == 7001, f"{pay(9001, 'supplier_id')}")
        check("a row that was already correct is untouched",
              pay(9004) == 5003 and pay(9004, "supplier_id") == 7001)
        check("an unresolvable receipt id is left as it was, not guessed at",
              pay(9005) == 77, f"{pay(9005)}")
        check("...while that row's resolvable supplier id is still fixed",
              pay(9005, "supplier_id") == 7001, f"{pay(9005, 'supplier_id')}")

        print("\n-- the other shop is not touched --")
        other = conn.execute(text(
            "SELECT amount_paid, payment_status FROM stock_receipts WHERE id = 1"
        )).first()
        check("the other shop's invoice is still unpaid at zero",
              other[0] == 0 and other[1] == "unpaid", f"{other[0]}, {other[1]}")

        print("\n-- and the invoices add up --")
        r1 = conn.execute(text(
            "SELECT invoice_amount, amount_paid, payment_status FROM stock_receipts WHERE id = 5001"
        )).first()
        check("the 4000 invoice shows 2500 paid, partial",
              r1[1] == 2500 and r1[2] == "partial", f"{r1[1]} of {r1[0]}, {r1[2]}")
        r2 = conn.execute(text(
            "SELECT invoice_amount, amount_paid, payment_status FROM stock_receipts WHERE id = 5002"
        )).first()
        check("the 2500 invoice is settled in full and marked paid",
              r2[1] == 2500 and r2[2] == "paid", f"{r2[1]} of {r2[0]}, {r2[2]}")

        print("\n-- running it twice is safe --")
        again = run(conn, apply=True)
        check("a second pass finds nothing to repair", len(again) == 0, f"{len(again)}")

        print("\n-- the guard against cross-shop damage --")
        # Directly: a payment of shop 1 naming id 1, which belongs to shop 2.
        new_id, why = resolve(conn, RECEIPT_BY_LOCAL, RECEIPT_EXISTS, 1, "unknown-device", 1)
        check("another tenant's row is never accepted as the answer", new_id != 1, why)
finally:
    try:
        os.unlink(path)
    except OSError:
        pass

print()
if failures:
    print(f"{len(failures)} failed:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("All payment-repair checks passed.")
