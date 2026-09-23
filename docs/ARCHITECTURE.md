# Architecture

How Dzeline Shop is put together, and why. For endpoints see [API.md](API.md); for
running and deploying it see [SETUP.md](SETUP.md).

## The shape of the system

An offline-first PWA that owns its data locally and reconciles with a shared backend
whenever there happens to be a connection. The till is the source of truth for a sale the
moment it is rung up; the cloud is how tills agree with each other afterwards.

```text
┌──────────────────────────────────────────────────────────────┐
│           DEVICE — phone, tablet, or desktop till             │
│                                                              │
│  React 19 + Vite 8 PWA                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │  Zustand    │  │   Dexie.js   │  │  Service Worker  │     │
│  │  cart,      │  │  IndexedDB   │  │  Workbox         │     │
│  │  staff,     │  │  v15 schema  │  │  offline cache   │     │
│  │  nav, prefs │  │  13 tables   │  └──────────────────┘     │
│  └─────────────┘  └──────────────┘                           │
│         ↑                ↑                                    │
│         └───── App.jsx ──┘                                    │
│                    ↓ (when online)                            │
│        sync.js · etims.js · thermalPrinter.js                 │
│        X-API-Key header (apiHeaders.js)                       │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  FastAPI backend (Render)                     │
│                                                              │
│  /products /sync /mpesa /etims /sms /admin /scan              │
│  /stock-receipts /staff /settings /suppliers /print-jobs      │
│        ↓                                                     │
│  SQLAlchemy 2 · pool_pre_ping · pool_recycle=1800             │
│  multi-tenant by X-API-Key                                    │
└──────────────────┬─────────────────┬─────────────────────────┘
                   │                 │
                   ▼                 ▼
         Safaricom Daraja         KRA eTIMS
         (M-Pesa STK Push)        (VSCU API)
```

PostgreSQL is hosted on Neon; Render runs the API process and mounts a disk for the
PaddleOCR models used by invoice scanning. There is no Redis and no message broker — the
sync model below does not need one.

## Why offline-first

Connectivity in the target market is intermittent, and a till that stops selling when the
line drops is worse than no till. Everything the cashier does writes to IndexedDB first
and returns immediately; nothing in the sell path awaits the network. The amber offline
banner tells the cashier what is happening, and sync catches up on its own.

The consequence to keep in mind when changing code: **any feature that only works online
is a feature that breaks at the worst moment.** Payment confirmation is the one unavoidable
exception, which is why M-Pesa has both an STK path and an SMS-reconciliation fallback.

## Sync model

Eventual consistency, last-write-wins per row, with no central coordinator. Each table
follows one of two idioms, both in `frontend/src/services/sync.js`:

**Outbox (push-only)** — transactions and print jobs. A row is created locally, pushed
once, and never mutated by another device. `synced` marks it done. `device_id` on
transactions tells "mine" from "foreign" so a pull never re-inserts or re-pushes another
till's sale.

**Two-way (push + pull)** — products, staff, settings, suppliers, stock receipts. Local
edits set `synced = false` and `updated_at = now`; the push sends them, the pull merges
what other devices changed. `cloud_id` links a local row to its backend id (null until the
first successful push). Deletes are tombstones (`deleted_at`), not row removals, so an
unsynced delete cannot be silently resurrected by a pull that lands first.

Sync runs on three triggers: the online/offline edge, a 45-second pull interval while the
app stays online, and explicit calls after actions worth propagating immediately.
`runFullSync()` and `runPullSync()` share one in-flight guard, so an interval tick landing
mid-cycle is a no-op rather than a racing second pull.

### Sale, end to end

```text
Cashier adds items          → cartStore (Zustand, persisted)
Checkout                    → dbHelpers.completeTransaction()
                              transactions + transaction_items, one atomic Dexie txn
                              synced = false, device_id = this device
Receipt                     → thermalPrinter.js (Web Bluetooth ESC/POS)
                              or enqueued to print_jobs for the hub device
On reconnect                → sync.pushUnsynced() → POST /sync/transactions
                              backend deduplicates by local_id
                              → synced = true
```

### Staged stock receiving

Deliberately splits the person who receives stock from the person who prices it:

```text
Attendant (any role with stock access)
  → StockReceiving.jsx: qty, unit cost, expiry, condition per line
  → "Submit for Pricing Review"  → draft in IndexedDB, stock NOT incremented

Manager (EDIT_PRODUCTS)
  → ManagerReceiving.jsx: reviews drafts, sets selling price per line
  → "Activate Stock" → dbHelpers.activateStockReceipt()
                       increments product.stock, writes prices
                       → receipt marked activated, syncs on reconnect
```

Stock moves only on activation. Since schema v13 drafts sync too, so a manager can price a
delivery from a different device than the one that recorded it.

### Purchase orders

Sending an order to a supplier used to be fire-and-forget — a WhatsApp or email
message with nothing kept — so the shop had no record of what was already
coming. That is what caused the same product to be ordered twice, and why a
low-stock alert could not say "already on order".

```text
Suppliers → Create Order    → purchaseOrders.create() BEFORE the message opens
                              status = sent, each line qty_outstanding = qty

Delivery activated          → purchaseOrders.applyDelivery(received)
                              oldest matching order first, qty_outstanding falls
                              → all lines at zero  → status = received
                              → some still open    → status = partially_received

Inventory alerts            → "Ordered · 40 due" from getOnOrderMap()
```

**"On order" is derived, never a flag.** A boolean somebody has to clear by hand
drifts out of step with reality within a week, which is the failure the table
exists to prevent. Orders older than 21 days stop counting as on-order — an
order nobody has closed in three weeks is usually forgotten, not in transit, and
it must not go on suppressing a genuine shortage.

### M-Pesa

```text
1. Cashier picks M-Pesa      → sync.initiateMpesaStk(txnId, phone, amount)
2. Backend                   → POST /mpesa/stk-push → Daraja
                               StkRequest(status=pending, checkout_request_id)
3. Customer enters PIN on their phone
4. Daraja                    → POST /mpesa/callback (IP-restricted to Safaricom)
                               StkRequest(status=confirmed, mpesa_code)
5. Frontend polls /mpesa/status/{id} until confirmed

Fallbacks:
  offline at step 1  → queued in pending_mpesa; sync.resumePendingStkChecks() retries
  callback never lands → shop's SMS gateway POSTs to /sms/webhook;
                         sync.reconcileSmsCodes() pulls /sms/verified-codes
```

## Client state

```text
staffStore   (persisted) → usePermissions() → can(feature) booleans
                            role → which nav tabs exist (App.jsx)
navStore     (in-memory) → panel, sub → which panel renders
cartStore    (persisted) → items[], totals → Cart, CartBar, scanner tally
settingsStore(persisted) → shopName, VAT, printer → header, receipt, checkout
```

`staffStore` persisting the session is what makes a reload not a logout. The cost is that
a role change does not take effect until the next explicit login — see Known Issues in
[../HANDOFF.md](../HANDOFF.md).

## Responsive shell

One codebase serves a phone in the hand and a desktop till. The split is at Tailwind's
`lg` (1024px):

| Concern | below `lg` | `lg` and up |
| --- | --- | --- |
| Navigation | bottom tab bar | `SideNav` rail |
| Cart | a panel you navigate to, with `CartBar` showing the running total | permanent rail beside the product grid |
| Barcode input | camera (`BarcodeScanner`) | camera **and** USB/Bluetooth wedge scanner (`useWedgeScanner`) |
| Overlays | bottom sheets | centred dialogs, Escape to close |

Almost all of this is CSS. `useMediaQuery` exists only for the cases where *behaviour*
differs rather than appearance — the cart tab must not exist at all on desktop, since the
cart is already on screen.

The product grid uses **container queries**, not viewport breakpoints: it shares its row
with the cart rail, so the column count has to follow the width the list actually got, not
the width of the monitor.

## Local database (Dexie, schema v14)

Migration chain v1 → v14. Every version is additive with an `upgrade()` where a backfill is
needed; none drop user data except `sync_queue`, which was replaced by per-row `synced`
flags in v5.

| Version | Change |
| --- | --- |
| v1 | Base: products, transactions, transaction_items, pending_mpesa, sync_queue, staff, settings |
| v2 | stock_receipts (flat) |
| v3 | reorder_level index on products |
| v4 | suppliers |
| v5 | Drop sync_queue; staff role index; backfill roles, hash plaintext PINs, `voided:false` |
| v6 | cost_price index on products |
| v7 | etims_item_cd + etims_status indexes; backfill `etims_status:'pending'` |
| v8 | checkout_request_id index on pending_mpesa |
| v9 | Split stock_receipts into receipts + items; status/synced indexes |
| v10 | Multi-device staff + products: cloud_id, updated_at, deleted_at, synced |
| v11 | Cross-device transactions: cloud_id, device_id |
| v12 | Suppliers sync: cloud_id, updated_at, deleted_at, synced |
| v13 | Stock receipt drafts sync: cloud_id, device_id |
| v14 | print_jobs outbox for the shared-printer queue |
| v15 | purchase_orders + purchase_order_items — what has been ordered and not yet arrived |

| Table | Key | Indexed | Notable unindexed |
| --- | --- | --- | --- |
| `products` | `++id` | `barcode, name, price, cost_price, stock, category, etims_item_cd, reorder_level, cloud_id, updated_at, synced, *tags` | `image_blob` (base64) |
| `transactions` | `++id` | `timestamp, total, payment_method, synced, staff_id, etims_status, cloud_id, device_id` | `subtotal, vat, change_given, voided` |
| `transaction_items` | `++id` | `transaction_id, product_id` | `quantity, price, subtotal` |
| `pending_mpesa` | `++id` | `transaction_id, code, checkout_request_id, timestamp, verified, amount` | — |
| `staff` | `++id` | `name, pin, role, active, created_at, cloud_id, updated_at, deleted_at, synced` | `permissions[]` (custom role) |
| `settings` | `key` | `value` | `shop_name, kra_pin, mpesa_till, pochi_number, vat_rate, vat_enabled, setup_complete, device_id` |
| `stock_receipts` | `++id` | `timestamp, supplier, supplier_id, staff_id, status, synced, cloud_id, device_id` | `invoice_number, photo_blob, activated_at` |
| `stock_receipt_items` | `++id` | `receipt_id, product_id` | `qty_added, qty_before, unit_cost, selling_price, expiry_date, condition` |
| `suppliers` | `++id` | `name, created_at, cloud_id, updated_at, deleted_at, synced` | `phone, email, notes` |
| `print_jobs` | `++id` | `device_id, created_at` | Pure outbox — deleted once pushed |
| `purchase_orders` | `++id` | `supplier_id, supplier, status, created_at, sent_at, synced, cloud_id, device_id` | `note, closed_at` |
| `purchase_order_items` | `++id` | `order_id, product_id, qty_outstanding` | `qty_ordered, qty_received, unit_cost` |

**All IndexedDB access goes through `dbHelpers` in `db.js`.** Components never import `db`
directly; that is what keeps migrations and invariants in one auditable place.

## Backend database (PostgreSQL)

| Table | Purpose |
| --- | --- |
| `tenants` | One row per shop — owns every other table via `tenant_id` |
| `transactions` / `transaction_items` | Synced sales |
| `products` | Cloud catalogue |
| `staff` | Cloud roster |
| `suppliers` | Cloud supplier directory |
| `shop_settings` | Cloud mirror of per-shop settings |
| `stock_receipts` / `stock_receipt_items` | Activated deliveries (items cascade-delete) |
| `stk_requests` | M-Pesa STK Push tracking |
| `sms_verified_codes` | M-Pesa codes from the SMS gateway |
| `etims_invoices` / `etims_counters` / `etims_configs` | KRA records, per-tenant sequential invoice numbers, credentials |
| `print_jobs` | Queue for the shared-printer hub |

Tenancy is enforced by `Depends(get_tenant)`, which hashes the `X-API-Key` header and
checks the tenant is active and inside its billing window.

## RBAC

Defined in `frontend/src/utils/permissions.js`, evaluated at runtime via `usePermissions()`.

| Role | POS | Stock | Reports | eTIMS | Settings | Edit products | Void sales |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sub_admin` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `stock_keeper` | ✅ | ✅ | ✅ | — | — | — | — |
| `sales_manager` | ✅ | — | ✅ | ✅ | — | — | — |
| `cashier` | ✅ | — | ✅ | — | — | — | — |

A sixth role, `custom`, is granted any combination of the columns above.

`EDIT_PRODUCTS` additionally gates the manager pricing panel. The accountant-ready sales
export is narrower still — `admin` and `sales_manager` only.

## VAT

Shelf prices **include** VAT (16% default, per-shop configurable). VAT is extracted for the
receipt and KRA, never added on top:

```text
grandTotal = Σ(price × qty)           ← what the customer pays
subtotal   = grandTotal / (1 + rate)  ← net, ex-VAT
vat        = grandTotal − subtotal    ← shown on the receipt
```

### Suggesting a price

Because the shelf price carries the VAT, a price suggested from cost has to go
outwards in this order (`utils/pricing.js`):

```text
shelf price = cost / (1 − target_margin)   ← rounded UP to the nearest 5
```

Margin is taken on the **cash outlay** — the unit cost exactly as it appears on
the supplier's invoice, VAT included — against the VAT-inclusive shelf price.
That is the shopkeeper's own model ("I paid 152, I want a quarter on it"), and
critically it is the same basis `getFinancialSummary` already reports on, so the
receiving screen and the Finance tab never quote different margins for the same
sale. `verify:pricing` asserts that equality directly.

VAT is still extracted for the receipt and KRA, and the VAT inside a price is
shown beside it — but it plays no part in the margin, so nobody has to answer
"does this cost include VAT?": whatever was paid is the cost.

The suggestion pre-fills the price field when a delivery is activated; it is
always editable, and whatever is typed is described back in margin and
profit-per-unit so the number can be judged rather than guessed.

## Security

What is actually true today, so nobody assumes more:

- **Tenant auth** is a hashed API key in `X-API-Key`. Not JWT, no user-level auth on the API
  — a device holding the key acts for the whole shop.
- **Staff PINs** are SHA-256 hashed (Web Crypto) before storage. PINs gate the UI, not the API.
- **Local data is not encrypted.** IndexedDB holds the catalogue, sales and hashed PINs in
  the clear; device-level security is the control. Do not store anything there you would
  not accept losing with the phone.
- **Admin routes** need a separate `X-Admin-Secret`; the SMS webhook needs the shop's API
  key as `?key=` plus `X-SMS-Secret` when configured; the Daraja callback is restricted to
  Safaricom's IP ranges.
- **An SMS confirmation is evidence, not proof.** The listener cannot verify a notification
  really came from Safaricom — any app that posts a notification titled "MPESA" is
  forwarded. Reconciliation therefore requires the code *and* the amount to agree, and
  anything else is flagged for a person rather than auto-cleared.
- **Secrets live in environment variables** only — never in the repo, never in the client
  bundle. Anything in `VITE_*` is public by definition.
- HTTPS everywhere in production; invoice scanning is rate-limited to 6 req/min per tenant.

## Code standards

### Frontend

- JavaScript, no TypeScript. React 19 function components and hooks only.
- Tailwind v4, CSS-first (`@theme` in `index.css`). There is **no `tailwind.config.js`** —
  it was a v3 leftover and is gone. Use `bg-linear-to-br`, not `bg-gradient-to-br`.
- Zustand for cross-component state; `useState` for local UI state.
- All IndexedDB access via `dbHelpers`. All API calls via `apiHeaders()` / `apiGetHeaders()`.
- `async/await` in components, not `.then()` chains. `try/catch` in the service layer.
- User-facing errors go through `showToast()`; `console.error` for diagnostics, no
  `console.log` outside `main.jsx`.
- Anything on the sell path must work offline.

### Backend

- Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy 2.
- `Depends(get_tenant)` on every protected route; `Depends(get_db)` for sessions, never
  held across an await.
- `pool_pre_ping=True` + `pool_recycle=1800` — without these, Postgres drops idle
  connections and requests fail with SSL errors.
- Sync endpoints are idempotent by `local_id`; a retried push must never double-insert.
