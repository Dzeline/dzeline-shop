"""
Does sync actually work against the live API and the real database?

Run it from the API's own shell, where ADMIN_SECRET and DATABASE_URL already
exist, so no credential has to travel anywhere:

    python scripts/verify_live_sync.py

Or against a different host:

    API_BASE=https://dzeline-api.onrender.com python scripts/verify_live_sync.py

It creates a throwaway tenant, pushes a supplier, a delivery and a payment
through the real HTTP endpoints, reads them back, and deletes the tenant and
everything it made. No existing shop's data is touched, and nothing is left
behind.

What it is really checking
--------------------------
Three things that only a live round trip can show:

1. The columns added in this release exist in Postgres. A missing one does not
   degrade an endpoint, it 500s it, so a payment detail or invoice amount that
   survives a write and a read is proof the boot-time migration ran.

2. /supplier-payments exists at all. The build that came back from the billing
   suspension predated that router entirely, so every payment push 404d.

3. A payment stays attached to its invoice. The device now sends the *cloud*
   receipt id; if the server stores or returns something else, the owner's
   payment lands on nothing and the till goes on showing the money as owed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"{'  ok  ' if ok else '  FAIL'}  {label}{f' - {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


BASE = os.getenv("API_BASE") or f"http://localhost:{os.getenv('PORT', '8000')}"
ADMIN = os.getenv("ADMIN_SECRET", "")
if not ADMIN:
    sys.exit("ADMIN_SECRET is not set. Run this from the API's own environment.")

BASE = BASE.rstrip("/")
DEVICE = "verify-live-sync"
client = httpx.Client(timeout=60.0, follow_redirects=True)
admin_headers = {"X-Admin-Secret": ADMIN}

print(f"Against {BASE}\n")

r = client.get(f"{BASE}/health")
if r.status_code != 200:
    sys.exit(f"API is not answering at {BASE} ({r.status_code}). Set API_BASE if it is elsewhere.")

# ── a throwaway shop ────────────────────────────────────────────────────────
r = client.post(f"{BASE}/admin/tenants", headers=admin_headers, json={
    "name": "ZZ verify-live-sync (delete me)", "plan": "trial",
})
if r.status_code != 201:
    sys.exit(f"Could not create a test tenant: {r.status_code} {r.text[:300]}")
tenant = r.json()
tenant_id = tenant["id"]
key = tenant["api_key"]
hdr = {"X-API-Key": key}
print(f"Test tenant {tenant_id} created\n")

try:
    # ── the router that was missing entirely ────────────────────────────────
    print("-- the endpoints exist --")
    r = client.get(f"{BASE}/supplier-payments?since=0", headers=hdr)
    check("GET /supplier-payments answers (it 404d on the pre-suspension build)",
          r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    r = client.get(f"{BASE}/suppliers", headers=hdr)
    check("GET /suppliers answers", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    r = client.get(f"{BASE}/stock-receipts?since=0", headers=hdr)
    check("GET /stock-receipts answers", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    # ── the columns this release added ──────────────────────────────────────
    print("\n-- the payment details survive a write and a read --")
    r = client.post(f"{BASE}/suppliers", headers=hdr, json={
        "device_id": DEVICE, "local_id": 1, "name": "Mwangi Wholesalers",
        "phone": "0722000000",
        "pay_method": "mpesa_paybill", "pay_account": "400200", "pay_name": "Mwangi Ltd",
    })
    check("a supplier with payment details is accepted",
          r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    supplier_cloud_id = r.json().get("id") if r.status_code in (200, 201) else None

    r = client.get(f"{BASE}/suppliers", headers=hdr)
    mine = [s for s in r.json() if s.get("device_id") == DEVICE] if r.status_code == 200 else []
    check("and they come back intact",
          bool(mine) and mine[0].get("pay_method") == "mpesa_paybill"
          and mine[0].get("pay_account") == "400200",
          str(mine[0]) [:160] if mine else "no supplier returned")

    print("\n-- the delivery carries its invoice --")
    r = client.post(f"{BASE}/stock-receipts", headers=hdr, json={
        "device_id": DEVICE, "local_id": 1, "status": "activated",
        "supplier": "Mwangi Wholesalers", "supplier_id": supplier_cloud_id,
        "invoice_number": "INV-VERIFY-1", "staff_id": None,
        "created_at": 1700000000000, "activated_at": 1700000000000,
        "invoice_amount": 4000, "amount_paid": 0, "payment_status": "unpaid",
        "items": [{"cloud_product_id": None, "product_name": "Maize Flour 2kg",
                   "qty_added": 20, "unit_cost": 152, "selling_price": 195, "condition": "good"}],
    })
    check("a delivery with an invoice amount is accepted",
          r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    receipt_cloud_id = (r.json() or {}).get("id") if r.status_code in (200, 201) else None
    check("it comes back with a cloud id to reference", receipt_cloud_id is not None,
          str(receipt_cloud_id))

    r = client.get(f"{BASE}/stock-receipts?since=0", headers=hdr)
    got = [x for x in r.json() if x.get("id") == receipt_cloud_id] if r.status_code == 200 else []
    check("the invoice amount round-trips",
          bool(got) and got[0].get("invoice_amount") == 4000,
          f"{got[0].get('invoice_amount')}" if got else "receipt not returned")

    # ── the link that was broken in both directions ─────────────────────────
    print("\n-- a payment stays attached to its invoice --")
    r = client.post(f"{BASE}/supplier-payments", headers=hdr, json={
        "device_id": "owner-phone", "local_id": 11,
        "receipt_id": receipt_cloud_id,          # the CLOUD id, as the fixed push sends
        "supplier_id": supplier_cloud_id,
        "supplier": "Mwangi Wholesalers", "amount": 1500, "method": "mpesa",
        "reference": "QGR1ABCD", "staff_id": None, "paid_at": 1700000100000,
    })
    check("the payment is accepted", r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    payment_cloud_id = (r.json() or {}).get("id") if r.status_code in (200, 201) else None

    r = client.get(f"{BASE}/supplier-payments?since=0", headers=hdr)
    pays = [p for p in r.json() if p.get("id") == payment_cloud_id] if r.status_code == 200 else []
    check("it comes back pointing at the delivery it settles",
          bool(pays) and pays[0].get("receipt_id") == receipt_cloud_id,
          f"receipt_id={pays[0].get('receipt_id')}, expected {receipt_cloud_id}" if pays else "not returned")
    check("and at the right supplier",
          bool(pays) and pays[0].get("supplier_id") == supplier_cloud_id,
          f"supplier_id={pays[0].get('supplier_id')}" if pays else "not returned")

    # The push is deduped on (device_id, local_id) so a retry on a bad
    # connection cannot charge the shop twice.
    r = client.post(f"{BASE}/supplier-payments", headers=hdr, json={
        "device_id": "owner-phone", "local_id": 11,
        "receipt_id": receipt_cloud_id, "supplier_id": supplier_cloud_id,
        "supplier": "Mwangi Wholesalers", "amount": 1500, "method": "mpesa",
        "reference": "QGR1ABCD", "staff_id": None, "paid_at": 1700000100000,
    })
    r2 = client.get(f"{BASE}/supplier-payments?since=0", headers=hdr)
    same = [p for p in r2.json() if p.get("device_id") == "owner-phone"] if r2.status_code == 200 else []
    check("re-pushing the same payment does not double-count the money",
          len(same) == 1, f"{len(same)} rows for one payment")

    # ── the pull a recovering device makes ──────────────────────────────────
    print("\n-- the recovery pull --")
    r = client.get(f"{BASE}/sync/transactions?since=0&limit=300", headers=hdr)
    check("GET /sync/transactions accepts since=0 (recovery pulls from the beginning)",
          r.status_code == 200 and isinstance(r.json(), list),
          f"{r.status_code}, {len(r.json()) if r.status_code == 200 else '-'} rows")
    r = client.get(f"{BASE}/settings", headers=hdr)
    check("GET /settings answers", r.status_code == 200, f"{r.status_code}")
    r = client.get(f"{BASE}/staff", headers=hdr)
    check("GET /staff answers", r.status_code == 200, f"{r.status_code}")
    r = client.get(f"{BASE}/products/?since=0", headers=hdr)
    check("GET /products answers", r.status_code == 200, f"{r.status_code}")

finally:
    # ── take the throwaway shop back out ────────────────────────────────────
    # There is no DELETE /admin/tenants, and leaving a test tenant in a live
    # database is how test data ends up in somebody's report.
    print("\n-- cleaning up --")
    removed = {}
    try:
        from sqlalchemy import create_engine, text
        from app.database import normalise_db_url
        raw = os.getenv("DATABASE_URL", "")
        url = normalise_db_url(raw) if raw else ""
        if not url:
            print("  DATABASE_URL not set - could not remove test tenant "
                  f"{tenant_id}. Delete it by hand.")
        else:
            engine = create_engine(url)
            with engine.connect() as conn:
                for table in [
                    "supplier_payments", "stock_receipt_items", "stock_receipts",
                    "suppliers", "transaction_items", "transactions", "products",
                    "staff", "print_jobs", "sms_verified_codes", "stk_requests",
                    "etims_invoices", "etims_counter", "etims_config",
                ]:
                    try:
                        if table == "stock_receipt_items":
                            res = conn.execute(text(
                                "DELETE FROM stock_receipt_items WHERE receipt_id IN "
                                "(SELECT id FROM stock_receipts WHERE tenant_id = :t)"
                            ), {"t": tenant_id})
                        elif table == "transaction_items":
                            res = conn.execute(text(
                                "DELETE FROM transaction_items WHERE transaction_id IN "
                                "(SELECT id FROM transactions WHERE tenant_id = :t)"
                            ), {"t": tenant_id})
                        else:
                            res = conn.execute(text(
                                f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": tenant_id})
                        if res.rowcount:
                            removed[table] = res.rowcount
                        conn.commit()
                    except Exception:
                        conn.rollback()
                res = conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
                conn.commit()
                print(f"  removed test tenant {tenant_id}"
                      + (f" and {removed}" if removed else " (no rows)"))
                check("the test tenant is gone", res.rowcount == 1, f"{res.rowcount} deleted")
    except Exception as exc:
        print(f"  cleanup FAILED for tenant {tenant_id}: {exc}")
        print("  Delete it by hand: DELETE FROM tenants WHERE id = "
              f"{tenant_id};  (and its rows in the tables above)")
        failures.append("cleanup")
    client.close()

print()
if failures:
    print(f"{len(failures)} failed:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("Live sync verified end to end.")
