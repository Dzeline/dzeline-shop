# Dzeline Shop — Project Handoff

Offline-first PWA point-of-sale for small Kenyan supermarkets. All data is local (IndexedDB via Dexie v9). Syncs to a FastAPI backend when online.

---

## Status: Phase F Complete — Field-Ready

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Core POS (products, cart, IndexedDB) | ✅ |
| 2 | Payments + receipts (Cash, M-Pesa, Pochi) | ✅ |
| 3 | Staff / PIN login | ✅ |
| 4 | Backend, sync, transaction history | ✅ |
| 5 | Product editing, Pochi, analytics, scanner | ✅ |
| E | Navigation overhaul (bottom tab + inline panels) | ✅ |
| A | RBAC — granular role-based permissions | ✅ |
| C | Financial intelligence / P&L | ✅ |
| D | AI invoice scanning | ✅ |
| F | Offline reliability + thermal printing + staged stock receiving | ✅ |
| B | Real-time multi-device sync (WebSocket) | 📋 Planned |

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    DEVICE (Phone / Tablet)                   │
│                                                             │
│  React 19 + Vite 8 PWA                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Zustand    │  │   Dexie.js   │  │  Service Worker  │   │
│  │  (cart,     │  │  IndexedDB   │  │  (offline cache) │   │
│  │  staff,     │  │  v9 schema   │  │  Workbox         │   │
│  │  nav, prefs)│  │  10 tables   │  └──────────────────┘   │
│  └─────────────┘  └──────────────┘                          │
│         ↑                ↑                                   │
│         └────── App.jsx ─┘                                   │
│                    ↓  (when online)                          │
│        sync.js · etims.js · thermalPrinter.js                │
│        X-API-Key header (apiHeaders.js)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Backend (Render)                       │
│                                                             │
│  /products  /sync  /mpesa  /etims  /sms  /admin             │
│  /scan  /stock-receipts                                     │
│        ↓                                                    │
│  SQLAlchemy ORM · pool_pre_ping · pool_recycle=1800          │
│  11 tables, multi-tenant by X-API-Key                        │
└──────────────────┬──────────────────┬────────────────────────┘
                   │                  │
                   ▼                  ▼
         Safaricom Daraja          KRA eTIMS
         (M-Pesa STK Push)        (VSCU API)
```

---

## What Phase F Added

### Offline Indicator Banner

`App.jsx` renders an amber banner whenever `navigator.onLine` is false:

```jsx
{!isOnline && (
  <div className="shrink-0 bg-amber-500 text-amber-950 px-4 py-1.5 ...">
    Offline — sales save locally and sync automatically when reconnected
  </div>
)}
```

The `isOnline` useEffect also calls `syncService.pushUnsyncedReceipts()` on reconnect alongside the existing transaction push.

### Sync Loop Fix

`sync.js:pushUnsynced()` previously had a `break` in its catch block — one failed transaction permanently stalled the entire sync queue until app restart. Changed to `continue`.

### Thermal Printer Service (`thermalPrinter.js`)

Web Bluetooth ESC/POS service with automatic profile discovery across three known BLE printer GATT profiles (Rongta, Sewoo, Microchip). Falls back to `window.print()` via popup/iframe for USB and OS-paired Bluetooth.

Key behaviors:

- `connect()` — opens browser device picker, tries profiles in order, saves device name to localStorage
- `printBluetooth(sale, settings)` — builds full ESC/POS byte array, writes in 20-byte MTU-safe chunks
- `printBrowser(sale, settings)` — generates 58mm monospace HTML, opens popup, calls `window.print()`
- `Receipt.jsx` — BT Print button (shown only if Web Bluetooth available) + Print button (always shown)
- `SettingsScreen.jsx` — "Receipt Printer" card: shows paired printer name + Remove, or Connect button

### Staged Stock Receiving Workflow

Separates the attendant role (submit delivery) from the manager role (approve + price):

```text
Attendant (any role with stock access)
  → StockReceiving.jsx
  → fills qty, unit cost, expiry date, condition per item
  → clicks "Submit for Pricing Review"
  → saved as draft in IndexedDB (stock NOT incremented)

Manager (EDIT_PRODUCTS permission)
  → ManagerReceiving.jsx (shown above StockReceiving for eligible roles)
  → sees pending draft receipts with condition badges + expiry dates
  → enters selling price per item
  → clicks "Activate Stock"
  → dbHelpers.activateStockReceipt() increments product.stock, sets prices
  → receipt marked activated; synced to backend on next reconnect
```

The "Receiving" sub-tab label shows a badge count of pending drafts when any exist.

### Stock Receipts Sync

`sync.js:pushUnsyncedReceipts()` — on reconnect, fetches activated unsynced receipts from IndexedDB, POSTs to `/stock-receipts`, marks synced. Failures skip with `continue` (same pattern as transaction sync).

---

## Service Wiring

### Frontend → Backend

All API calls go through two utility functions in `frontend/src/utils/apiHeaders.js`:

```js
apiHeaders()     // { Content-Type, X-API-Key }  — POST/PUT
apiGetHeaders()  // { X-API-Key }                — GET
```

API base URL:

```bash
# frontend/.env.local (dev)  or  Vercel env var (prod)
VITE_API_URL=https://dzeline-api.onrender.com
```

**All fetch call sites:**

| File | Endpoint | Method | Trigger |
| --- | --- | --- | --- |
| `sync.js` | `/sync/transactions` | POST | Reconnect |
| `sync.js` | `/stock-receipts` | POST | Reconnect (activated receipts) |
| `sync.js` | `/mpesa/stk-push` | POST | M-Pesa checkout |
| `sync.js` | `/mpesa/stk-query/{id}` | GET | Deferred STK check |
| `sync.js` | `/mpesa/status/{id}` | GET | STK status polling |
| `sync.js` | `/sms/verified-codes?since=` | GET | SMS M-Pesa reconciliation |
| `etims.js` | `/etims/status` | GET | eTIMS panel load |
| `etims.js` | `/etims/config` | GET / POST | Load / save KRA credentials |
| `etims.js` | `/etims/branches` | POST | KRA branch list |
| `etims.js` | `/etims/device/init` | POST | Initialize VSCU device |
| `etims.js` | `/etims/items/register` | POST | Register product catalogue |
| `etims.js` | `/etims/submit-batch` | POST | Submit invoices to KRA |
| `StockReceiving.jsx` | `/scan/invoice` | POST | AI invoice scan |

### Frontend State → Components

```text
staffStore (persist)   → usePermissions() → can(feature) booleans
  currentStaff.role                       → tab visibility (App.jsx)
  currentStaff.permissions                → action guards

navStore (in-memory)   → panel, sub      → which panel/sub-tab renders
  navigate(panel, sub)                   → bottom tab bar
  navigateSub(sub)                       → sub-tab bars

cartStore (persist)    → items[], totals → Cart.jsx, checkout flow
settingsStore (persist)→ shopName, etc   → header, receipt, VAT calc
```

### Backend Auth Flow

```text
Request arrives
    ├─ /health            → public
    ├─ /admin/*           → X-Admin-Secret header
    ├─ /sms/webhook       → X-SMS-Secret header
    ├─ /mpesa/callback    → IP-restricted to Safaricom CIDRs
    └─ everything else    → Depends(get_tenant)
                               hash(X-API-Key) → Tenant lookup
                               check active + billing_cycle_end
```

### M-Pesa Payment Flow

```text
1. Cashier selects M-Pesa at checkout
2. CheckoutModal → sync.initiateMpesaStk(txnId, phone, amount)
3. Backend: POST /mpesa/stk-push → Daraja STK Push API
   → StkRequest(status=pending, checkout_request_id)
4. Customer enters PIN on phone
5. Daraja posts result to /mpesa/callback (IP-whitelisted)
   → StkRequest(status=confirmed, mpesa_code)
6. Frontend polls /mpesa/status/{id} every ~3s until confirmed
   OR: SMS gateway posts to /sms/webhook
   → /sms/verified-codes reconciles on reconnect

Offline fallback:
  - STK Push queued in pending_mpesa (IndexedDB)
  - On reconnect: sync.resumePendingStkChecks() retries
```

### Transaction Sync Flow

```text
Sale completed locally:
  transactions + transaction_items → IndexedDB (atomic)
  synced = false

On reconnect:
  sync.pushUnsynced()
    → db.transactions.filter(!synced)
    → POST /sync/transactions (backend deduplicates by local_id)
    → marks synced = true

  sync.pushUnsyncedReceipts()
    → dbHelpers.getUnsyncedReceipts() (status=activated, synced=false)
    → POST /stock-receipts
    → marks synced = true
```

---

## Backend API Reference

Base URL: `https://dzeline-api.onrender.com` (prod) | `http://localhost:8000` (dev)

All routes except `/health`, `/admin/*`, `/sms/webhook`, `/mpesa/callback` require:

```http
X-API-Key: <tenant api key>
```

### Products

| Method | Path | Description |
| --- | --- | --- |
| GET | `/products/` | List all products for tenant |
| POST | `/products/` | Create product |
| PUT | `/products/{id}` | Update product |
| DELETE | `/products/{id}` | Delete product |
| GET | `/products/low-stock` | Products at or below reorder_level |

### Sync

| Method | Path | Description |
| --- | --- | --- |
| POST | `/sync/transactions` | Upload completed transactions (idempotent by local_id) |
| GET | `/sync/transactions` | List synced transactions (skip/limit) |
| GET | `/sync/status` | `{ synced_transactions: int }` |

### Stock Receipts

| Method | Path | Description |
| --- | --- | --- |
| POST | `/stock-receipts` | Upload activated receipt + items (idempotent by local_id) |
| GET | `/stock-receipts` | List receipts for tenant (limit 50) |

### M-Pesa

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/mpesa/stk-push` | X-API-Key | Initiate STK Push |
| POST | `/mpesa/callback` | IP whitelist | Daraja result callback |
| GET | `/mpesa/status/{id}` | X-API-Key | Check StkRequest status |
| GET | `/mpesa/stk-query/{id}` | X-API-Key | Query Daraja directly |

### eTIMS / KRA

| Method | Path | Description |
| --- | --- | --- |
| GET | `/etims/status` | Device status + env |
| GET / POST | `/etims/config` | Read / write KRA credentials |
| POST | `/etims/branches` | Query KRA branch registry |
| POST | `/etims/device/init` | Initialize VSCU device with KRA |
| POST | `/etims/items/register` | Register product codes with KRA |
| POST | `/etims/submit-batch` | Submit sales invoices to KRA |

### SMS Verification

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/sms/webhook` | X-SMS-Secret | Receive M-Pesa SMS from shop device |
| GET | `/sms/verified-codes` | X-API-Key | Pull codes since timestamp |

### AI Invoice Scanning

Rate limited: 6 requests/minute per tenant. Requires `ANTHROPIC_API_KEY`.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/scan/invoice` | Base64 invoice photo → `{ supplier, invoice_number, items[] }` |

### Admin

All require `X-Admin-Secret` header.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/admin/tenants` | Create tenant (returns raw API key once) |
| GET | `/admin/tenants` | List tenants |
| GET | `/admin/tenants/{id}` | Get tenant |
| PATCH | `/admin/tenants/{id}` | Update plan / active |
| POST | `/admin/tenants/{id}/rotate-key` | Rotate API key |
| POST | `/admin/tenants/{id}/claim-legacy-data` | Migrate single-tenant data |

### Health

```http
GET /health  → { status: "ok" }  (public)
```

Interactive docs: `http://localhost:8000/docs`

---

## IndexedDB Schema (v9 via Dexie)

Migration chain: v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9

| Version | Change |
| --- | --- |
| v1 | Base: products, transactions, transaction_items, pending_mpesa, sync_queue, staff, settings |
| v2 | Add stock_receipts (old flat schema) |
| v3 | Add reorder_level index to products |
| v4 | Add suppliers table |
| v5 | Drop sync_queue; add role index to staff; backfill roles + hash PINs + voided:false |
| v6 | Add cost_price index to products |
| v7 | Add etims_item_cd + etims_status indexes; backfill etims_status:'pending' |
| v8 | Add checkout_request_id index to pending_mpesa |
| v9 | Replace flat stock_receipts with stock_receipts + stock_receipt_items; add status/synced indexes; backfill existing rows as activated+synced |

| Table | Key | Indexed fields | Notable fields |
| --- | --- | --- | --- |
| `products` | `++id` | `barcode, name, price, cost_price, stock, category, etims_item_cd, reorder_level, *tags` | `image_blob` (base64) |
| `transactions` | `++id` | `timestamp, total, payment_method, synced, staff_id, etims_status` | `subtotal, vat, change_given, voided` |
| `transaction_items` | `++id` | `transaction_id, product_id` | `quantity, price, subtotal` |
| `pending_mpesa` | `++id` | `transaction_id, code, checkout_request_id, timestamp, verified, amount` | — |
| `staff` | `++id` | `name, pin, role, active, created_at` | `permissions[]` (custom role) |
| `settings` | `key` | `value` | Keys: shop_name, kra_pin, mpesa_till, pochi_number, vat_rate, vat_enabled, setup_complete |
| `stock_receipts` | `++id` | `timestamp, supplier, supplier_id, staff_id, status, synced` | `invoice_number, photo_blob, activated_at` |
| `stock_receipt_items` | `++id` | `receipt_id, product_id` | `qty_added, qty_before, unit_cost, selling_price, expiry_date, condition` |
| `suppliers` | `++id` | `name, created_at` | `phone, email, notes` |

---

## Backend Database Schema (PostgreSQL)

| Table | Purpose |
| --- | --- |
| `tenants` | One row per shop — owns all other tables via tenant_id |
| `stk_requests` | M-Pesa STK Push tracking |
| `transactions` | Synced sales from frontend |
| `transaction_items` | Line items per sale |
| `products` | Cloud product catalogue |
| `etims_invoices` | KRA invoice records |
| `etims_counters` | Sequential invoice number per tenant (unique per tenant) |
| `etims_configs` | KRA credentials per tenant |
| `sms_verified_codes` | M-Pesa codes from SMS gateway |
| `stock_receipts` | Cloud mirror of activated deliveries |
| `stock_receipt_items` | Line items per delivery (cascade delete from receipt) |

---

## RBAC — Roles & Permissions

Defined in `frontend/src/utils/permissions.js`.

| Role | POS | Stock | Reports | eTIMS | Settings | Edit Products | Void Sales |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| sub_admin | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| stock_keeper | ✅ | ✅ | ✅ | — | — | — | — |
| sales_manager | ✅ | — | ✅ | ✅ | — | — | — |
| cashier | ✅ | — | ✅ | — | — | — | — |
| custom | pick any combination | | | | | | |

`EDIT_PRODUCTS` permission also gates the Manager Pricing review panel in the Stock tab.

Permissions evaluated at runtime via `usePermissions()` hook. Role changes take effect on next login.

---

## VAT Model

Shelf prices **include** VAT (16% default, configurable per shop).

```text
grandTotal = Σ(price × qty)          ← what customer pays
subtotal   = grandTotal / (1 + rate) ← net ex-VAT (for KRA)
vat        = grandTotal − subtotal   ← extracted VAT on receipt
```

---

## Code Standards

### Frontend

- **Language**: JavaScript (no TypeScript)
- **Framework**: React 19 functional components + hooks only
- **Styling**: Tailwind CSS v4 CSS-first (`@theme` variables). Use `bg-linear-to-br` not `bg-gradient-to-br`
- **State**: Zustand for cross-component; `useState` for component-local UI
- **Database**: All IndexedDB access goes through `dbHelpers` in `db.js` — never import `db` directly in components
- **API calls**: Always use `apiHeaders()` / `apiGetHeaders()` — never hardcode headers
- **Async**: `async/await` only — no `.then()` chains in components
- **Errors**: `try/catch` in service layer; `showToast()` for user-facing errors in components
- **Logging**: `console.error` only — no `console.log` outside `main.jsx`

### Backend

- **Language**: Python 3.11+ / FastAPI + Pydantic v2 + SQLAlchemy 2
- **Auth**: `Depends(get_tenant)` on every protected route
- **DB sessions**: `Depends(get_db)` — never hold a session across async calls
- **Connection pool**: `pool_pre_ping=True` + `pool_recycle=1800` (prevents SSL drop errors on Render free tier)
- **Secrets**: environment variables only

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Example | Required |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@host/db` | ✅ |
| `ADMIN_SECRET` | 64-char random hex | ✅ |
| `ALLOWED_ORIGINS` | `https://dzeline.online` | ✅ |
| `MPESA_ENV` | `sandbox` or `production` | ✅ |
| `MPESA_CONSUMER_KEY` | from Daraja portal | ✅ (M-Pesa) |
| `MPESA_CONSUMER_SECRET` | from Daraja portal | ✅ (M-Pesa) |
| `MPESA_SHORTCODE` | `174379` (sandbox) | ✅ (M-Pesa) |
| `MPESA_PASSKEY` | from Daraja portal | ✅ (M-Pesa) |
| `MPESA_SHORTCODE_TYPE` | `paybill` or `till` | ✅ (M-Pesa) |
| `MPESA_CALLBACK_URL` | `https://dzeline-api.onrender.com/mpesa/callback` | ✅ (M-Pesa) |
| `SMS_WEBHOOK_SECRET` | 32-char random hex | ✅ (SMS) |
| `ETIMS_ENV` | `sandbox` or `production` | ✅ (eTIMS) |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | ✅ (AI scan) |

Generate secrets: `python -c "import secrets; print(secrets.token_hex(32))"`

### Frontend (`frontend/.env.local`)

| Variable | Example |
| --- | --- |
| `VITE_API_URL` | `https://dzeline-api.onrender.com` |

---

## Deployment

| Layer | Platform | Config |
| --- | --- | --- |
| Frontend | Vercel | `.vercel/project.json` — auto-deploys on push to `master` |
| Backend | Render | `backend/render.yaml` — auto-deploys from `backend/` on push |
| Database | Render managed Postgres | `DATABASE_URL` env var |

**gitignore note**: The Android TWA build uses `/app/` (root-anchored) so the rule only matches `./app/` and never `backend/app/`. Previous bare `app/` rule caused Render to silently drop all new files under `backend/app/` from its deploy artifact.

---

## Android APK (TWA)

The PWA is packaged as an Android APK via Google's bubblewrap tool. No code duplication — the APK wraps `dzeline.online` in a Chrome TWA shell.

```bash
# From repo root
npm run build-apk
```

The wizard handles icons, keystore signing, `assetlinks.json`, and `bubblewrap build`. Distribute the signed APK directly (WhatsApp, download link) without Play Store.

---

## Known Issues

| Severity | File | Issue |
| --- | --- | --- |
| 🟡 UX | `PinLogin.jsx:88` | 4-digit PIN mismatch gives no feedback — by design (allows 6-digit continuation) |
| 🟡 Security | `staffStore.js` | Persisted session carries stale role until explicit logout; role demotions not immediate |
| 🔵 Design | `App.jsx` | Permission guards duplicated between tab array and render block — must be kept in sync manually |

---

## Production TODOs

- [ ] Replace `pochiNumber: "0700000000"` placeholder in `constants.js`
- [ ] Replace `kraPin: "P051234567X"` placeholder in `constants.js`
- [ ] Add real 512×512 PNG app icon in `frontend/public/`
- [ ] Add error tracking (Sentry) on frontend and backend
- [ ] Wire Daraja per-tenant credentials from Settings UI → backend tenant record
- [ ] Upgrade Render service from free tier (free tier spins down after ~15 min idle)

---

## Remaining Planned Work

| Feature | Notes |
| --- | --- |
| Real-time multi-device sync | WebSocket hub — Phase B |
| CSV / Excel product import | Bulk stock loading for new shops |
| Category icon set | Grains, Sugar, Dairy, Oils, Bakery, Beverages, Spices, Household, Produce + 5 nav tab icons |
| Selling price history | Track price changes per product over time |
| Expiry date alerts | Surface items nearing expiry from stock_receipt_items |

---

Built by Dzeline · Nairobi, Kenya · 2026
