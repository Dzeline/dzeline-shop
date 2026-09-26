"""
Repair supplier_payments rows that carry local ids instead of cloud ids.

    # look, change nothing (the default)
    DATABASE_URL=postgresql://... python scripts/repair_payment_ids.py

    # then, if the report reads right
    DATABASE_URL=postgresql://... python scripts/repair_payment_ids.py --apply

Why these rows are wrong
------------------------
Until 2026-09-26 the frontend pushed a payment with `receipt_id` and
`supplier_id` set to its own *local* Dexie ids, as if they were cloud ids. So a
payment on the server points at whatever StockReceipt happens to hold that
number for some other device, or at nothing. Pulled onto a second device it
credits the wrong invoice or none, and the till goes on showing money as owed
that has been paid.

Why they are recoverable
------------------------
Every synced row carries (tenant_id, device_id, local_id), which is exactly the
key the device used. So the broken `receipt_id` is a local_id, and the receipt it
meant is the one with that local_id for that tenant and device. The repair is a
lookup, not a guess.

What it deliberately will not touch
-----------------------------------
A row whose `receipt_id` already resolves to a StockReceipt of the same tenant
is left alone. It may be a correct post-fix row, or a pre-fix row that collided
with a real cloud id, and nothing in the data distinguishes them — so the safe
reading is "already right". Ambiguous rows are reported, never guessed at.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from app.database import normalise_db_url  # noqa: E402

FIXABLE = text("""
    SELECT p.id, p.tenant_id, p.device_id, p.receipt_id, p.supplier_id, p.amount, p.supplier
      FROM supplier_payments p
     ORDER BY p.id
""")

RECEIPT_BY_LOCAL = text("""
    SELECT id FROM stock_receipts
     WHERE tenant_id = :tenant_id AND device_id = :device_id AND local_id = :local_id
""")

SUPPLIER_BY_LOCAL = text("""
    SELECT id FROM suppliers
     WHERE tenant_id = :tenant_id AND device_id = :device_id AND local_id = :local_id
""")

RECEIPT_EXISTS = text("SELECT 1 FROM stock_receipts WHERE id = :id AND tenant_id = :tenant_id")
SUPPLIER_EXISTS = text("SELECT 1 FROM suppliers WHERE id = :id AND tenant_id = :tenant_id")


def resolve(conn, by_local, exists, tenant_id, device_id, current):
    """
    What this id should be: (new_id, why).

    new_id is None when nothing should change.
    """
    if current is None:
        return None, "empty"
    if conn.execute(exists, {"id": current, "tenant_id": tenant_id}).first():
        return None, "already resolves - left alone"
    if not device_id:
        return None, "no device_id, cannot look up what it meant"
    rows = conn.execute(by_local, {
        "tenant_id": tenant_id, "device_id": device_id, "local_id": current,
    }).fetchall()
    if len(rows) == 1:
        return rows[0][0], f"local {current} on {device_id} -> cloud {rows[0][0]}"
    if not rows:
        return None, f"no row with local_id {current} for this device"
    return None, f"AMBIGUOUS: {len(rows)} rows with local_id {current}"


def recompute_invoice_totals(conn):
    """
    Bring every invoice's paid figure back in line with its payment rows.

    Recomputed, not adjusted: the rows are the record and amount_paid is only a
    cached total of them, so summing is the one operation that cannot drift.
    Written as a correlated subquery rather than Postgres UPDATE..FROM so the
    same statement can be run against a test database.
    """
    conn.execute(text("""
        UPDATE stock_receipts
           SET amount_paid = (
                   SELECT COALESCE(SUM(amount), 0) FROM supplier_payments
                    WHERE receipt_id = stock_receipts.id
               ),
               payment_status = CASE
                   WHEN invoice_amount > 0 AND (
                       SELECT COALESCE(SUM(amount), 0) FROM supplier_payments
                        WHERE receipt_id = stock_receipts.id
                   ) >= invoice_amount - 0.01 THEN 'paid'
                   WHEN (
                       SELECT COALESCE(SUM(amount), 0) FROM supplier_payments
                        WHERE receipt_id = stock_receipts.id
                   ) > 0.01 THEN 'partial'
                   ELSE 'unpaid'
               END
         WHERE id IN (SELECT receipt_id FROM supplier_payments WHERE receipt_id IS NOT NULL)
    """))
    conn.commit()


def run(conn, apply=False):
    """Report what is wrong, and optionally fix it. Returns the repairs made."""
    payments = conn.execute(FIXABLE).fetchall()
    print(f"{len(payments)} supplier payment rows on the server\n")

    repairs = []
    untouched = 0
    problems = []

    for pid, tenant_id, device_id, receipt_id, supplier_id, amount, supplier in payments:
        new_receipt, why_r = resolve(conn, RECEIPT_BY_LOCAL, RECEIPT_EXISTS, tenant_id, device_id, receipt_id)
        new_supplier, why_s = resolve(conn, SUPPLIER_BY_LOCAL, SUPPLIER_EXISTS, tenant_id, device_id, supplier_id)

        if new_receipt is None and new_supplier is None:
            untouched += 1
            if "AMBIGUOUS" in why_r or "AMBIGUOUS" in why_s:
                problems.append(f"  payment {pid} (KES {amount}, {supplier}): {why_r} / {why_s}")
            elif why_r.startswith("no row") or why_s.startswith("no row"):
                problems.append(f"  payment {pid} (KES {amount}, {supplier}): {why_r} / {why_s}")
            continue

        repairs.append((pid, new_receipt, new_supplier))
        print(f"  payment {pid} (KES {amount}, {supplier})")
        if new_receipt is not None:
            print(f"      receipt_id  {receipt_id} -> {new_receipt}   [{why_r}]")
        if new_supplier is not None:
            print(f"      supplier_id {supplier_id} -> {new_supplier}   [{why_s}]")

    print(f"\n{len(repairs)} to repair, {untouched} left alone")
    if problems:
        print("\nNeeding a human - not touched:")
        for line in problems:
            print(line)

    # Returns rather than exits: the verification script calls this, and a
    # library function that kills the process cannot be tested.
    if not repairs:
        print("\nNothing to do.")
        return []

    if not apply:
        print("\nDry run. Re-run with --apply to write these changes.")
        return []

    for pid, new_receipt, new_supplier in repairs:
        sets, params = [], {"id": pid}
        if new_receipt is not None:
            sets.append("receipt_id = :receipt_id")
            params["receipt_id"] = new_receipt
        if new_supplier is not None:
            sets.append("supplier_id = :supplier_id")
            params["supplier_id"] = new_supplier
        conn.execute(text(f"UPDATE supplier_payments SET {', '.join(sets)} WHERE id = :id"), params)
    conn.commit()
    print(f"\nRepaired {len(repairs)} rows.")

    recompute_invoice_totals(conn)
    print("Invoice totals recomputed from the payment rows.")
    return repairs


if __name__ == "__main__":
    url = os.getenv("DATABASE_URL", "")
    if not url:
        sys.exit("DATABASE_URL is not set. Run this with the shop database's URL in the environment.")
    # Shared with the app so the driver is chosen in exactly one place.
    url = normalise_db_url(url)

    engine = create_engine(url)
    with engine.connect() as conn:
        run(conn, apply="--apply" in sys.argv)
