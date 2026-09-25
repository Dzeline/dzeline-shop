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
│  │  staff,     │  │  v19 schema  │  │  offline cache   │     │
│  │  nav, prefs │  │  17 tables   │  └──────────────────┘     │
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
│  /supplier-payments                                           │
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

**Ids are translated at the boundary, in both directions.** A row travels with
*cloud* ids; every local join uses *local* ones. A delivery names its supplier, a
payment names its delivery, a line item names its product — and storing an
arriving id as-is silently detaches the row from the thing it belongs to, which
no later pass goes back and repairs. Both the push and the pull map through
`cloud_id`, and a push whose parent has no `cloud_id` yet **waits a cycle** rather
than sending a row that can never be reattached.

That is also why the dependent pushes are sequential — suppliers, then
deliveries, then payments — while the independent ones stay parallel.

### Recovery

`recoverEverything()` is the pull a replacement device runs: products, staff,
settings, suppliers, deliveries, payments, then sales, **in that order**, from the
beginning of the shop's history. The routine cycle can pull in parallel because an
established device already has everything the rows reference; an empty one does
not, so order is the difference between a recovered shop and a heap of orphaned
rows. It takes the sync guard rather than skipping on it, and reports what it
wrote by counting rows before and after each step — the individual pulls swallow
their own errors, which is right for a background cycle and useless when somebody
is watching.

Neither the device nor the cloud is a backup: both converge on the *current*
state. `services/backup.js` is the copy that does not — see
[BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

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

### Voiding a sale

A void is a refund: the goods go back on the shelf.

```text
Void → dbHelpers.voidTransaction(id, { reason, staffId, restock })
       one atomic Dexie transaction:
         each line's quantity returns to product.stock
         the sale is marked voided with reason, author, time
         stock_restored records what ACTUALLY happened
```

Until v17 this flipped a flag and nothing else, so the count drifted further
from reality with every void — and `coverDays` in Finance is computed from that
count.

Three rules hold it together. It is **idempotent**: voiding twice cannot restock
twice. It is **atomic** with the stock movement, because a void that half
happened is worse than either outcome. And `stock_restored` is **recorded, not
assumed** — goods that are not coming back (damaged, or the customer kept them)
leave stock alone, and a line whose product no longer exists is counted as
missing rather than passing as a clean restock.

Reasons come from a short editable list. Typing a reason every time is what
makes people stop giving one, and a void is where theft hides.

### Cash reconciliation

The app could always say what was sold. It could not say whether the money was
there — which is the mechanism an owner uses to notice cash going missing.

```text
Start of day  → shift opened with a COUNTED float, per user per day
During        → cash in / cash out recorded with a reason
Close         → cashier counts the drawer; expected vs counted vs difference
```

**A shift is per user, per day — never per device.** One person moves between
devices in a day (a phone while handling suppliers, the desktop at the counter
during the rush), so a device-scoped shift would split their takings across two
records and reconcile neither. It follows the person, because that is who the
money is accountable to.

**Expected cash is derived, never accumulated:**

```text
expected = opening float
         + cash sales   (that staff member, that date, any device, not voided)
         + cash in
         - cash out
```

Deriving it from the transactions means a sale rung up on the other device
counts the moment it syncs, and a running total that has drifted from the sales
it claims to represent is impossible by construction. Only CASH enters the
drawer; M-Pesa and Pochi are reported beside it, not folded into it.

At close the figure is **frozen** onto the shift row: while open it must follow
late-syncing sales, but once counted it is a record of what was expected *then*
and must not silently change afterwards.

One deliberate UI rule: the expected figure stays hidden until a count has been
entered. Showing it first turns counting into confirming.

### Supplier payments

The order lifecycle runs to settlement, not just to stock:

```text
Suppliers → Create Order   → purchase_orders (sent)
Delivery recorded          → stock_receipt (draft) + invoice number + photo
Manager activates          → stock moves, order lines close,
                             receipt linked to the order it fulfilled,
                             invoice_amount set from the line total
Payment                    → supplier_payments row; the receipt's amount_paid
                             and payment_status are recomputed from those rows
```

**The invoice belongs to the delivery, not the order.** The delivery is what
carries the invoice number and the photo, and a supplier may part-deliver one
order against two invoices. An order's payment state is derived from the
invoices raised against it, never stored on it.

**Payments are rows, not a running total.** A shop settles a large invoice in
instalments, and each one needs its own reference and date to be worth anything
when a supplier disputes it. `amount_paid` is recomputed from the rows, so the
two can never disagree.

Only *activated* deliveries count as debts — a draft has not been accepted into
stock, so it is not yet a bill. Suppliers carry their own payment details
(paybill, till, phone, bank) so settling an invoice does not mean hunting for a
number on a delivery note.

**All of it syncs**, because the owner settles the invoices and the staff
receive them, usually on different devices. Payments follow the outbox idiom
(push-only, deduped on device+local id so a retry cannot double-count money);
the receipt's invoice fields ride its existing two-way sync. A pulled payment
recomputes the affected invoice from every payment that device now knows about,
so the balance is right whichever update lands first — and `amount_paid` is only
ever *derived* from the payment rows, never added to, because two devices both
incrementing it would double-count the same shilling.

A payment can arrive before the delivery it settles: the owner pays the moment
the staff photograph the invoice, and there is no guaranteed order between two
devices pushing. Such a payment keeps its cloud receipt id and is adopted when
the delivery turns up, rather than depending on a lucky sequence.

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
| v16 | Supplier payment details; invoice amount / paid / status and order link on stock_receipts; supplier_payments ledger |
| v17 | Voids become refunds — reason, author, time and whether stock was restored; void_reasons list |
| v18 | Supplier payments sync (owner pays, staff receive — on different devices) |
| v19 | shifts + cash_movements — cash reconciliation, per user per day |

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
| `supplier_payments` | `++id` | `receipt_id, supplier_id, paid_at, synced, cloud_id, device_id` | `amount, method, reference, note, staff_id` |
| `shifts` | `++id` | `staff_id, business_date, status, opened_at, synced, cloud_id, device_id, [staff_id+business_date]` | `opening_float, counted_cash, expected_cash, difference, note` |
| `cash_movements` | `++id` | `shift_id, created_at, synced, cloud_id, device_id` | `type, amount, reason, staff_id` |

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
