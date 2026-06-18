# Dzeline Shop — Project Handoff

Offline-first PWA point-of-sale for small Kenyan supermarkets. All data is local (IndexedDB via Dexie). Syncs to a FastAPI backend when online.

---

## Status: Phases C + D Complete — MVP + AI Scanning Ready

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Core POS (products, cart, IndexedDB) | ✅ |
| 2 | Payments + receipts (Cash, M-Pesa, Pochi) | ✅ |
| 3 | Staff / PIN login | ✅ |
| 4 | Backend, sync, transaction history | ✅ |
| 5 | Product editing, Pochi, analytics, scanner | ✅ |
| E | Navigation overhaul (bottom tab bar + inline panels) | ✅ |
| A | RBAC — granular role-based permissions | ✅ |
| B | Real-time multi-device sync (WebSocket) | 📋 Planned |
| C | Financial intelligence / balance sheet | ✅ |
| D | AI invoice / receipt scanning | ✅ |

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
│  │  staff,     │  │  v8 schema   │  │  Workbox         │   │
│  │  nav, prefs)│  │  8 tables    │  └──────────────────┘   │
│  └─────────────┘  └──────────────┘                          │
│         ↑                ↑                                   │
│         └────── App.jsx ─┘                                   │
│                    ↓  (when online)                          │
│              sync.js / etims.js                              │
│              X-API-Key header (apiHeaders.js)                │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Backend (Render / Railway)             │
│                                                             │
│  /products  /sync  /mpesa  /etims  /sms  /admin             │
│        ↓                                                    │
│  SQLAlchemy ORM (SQLite dev / PostgreSQL prod)               │
│  9 tables, multi-tenant by X-API-Key                         │
└──────────────────┬──────────────────┬────────────────────────┘
                   │                  │
                   ▼                  ▼
         Safaricom Daraja          KRA eTIMS
         (M-Pesa STK Push)        (VSCU API)
```

---

## Service Wiring

### Frontend → Backend

All API calls go through two utility functions in `frontend/src/utils/apiHeaders.js`:

```js
// Injected on app start from IndexedDB settings → setApiKey(key)
apiHeaders()     // { Content-Type, X-API-Key }  — used for POST/PUT
apiGetHeaders()  // { X-API-Key }                — used for GET
```

The API base URL is set via environment variable:

```bash
# frontend/.env.local (dev)  or  Vercel env var (prod)
VITE_API_URL=https://dzeline-api.onrender.com
```

**All fetch call sites:**

| File | Endpoint | Method | Trigger |
| --- | --- | --- | --- |
| `sync.js` | `/sync/transactions` | POST | App reconnects (online event) |
| `sync.js` | `/mpesa/stk-push` | POST | Customer pays via M-Pesa |
| `sync.js` | `/mpesa/stk-query/{id}` | GET | Polling deferred STK checks |
| `sync.js` | `/mpesa/status/{id}` | GET | STK status check |
| `sync.js` | `/sms/verified-codes?since=` | GET | Pull SMS-confirmed M-Pesa codes |
| `etims.js` | `/etims/status` | GET | eTIMS panel load |
| `etims.js` | `/etims/config` | GET / POST | Load / save KRA credentials |
| `etims.js` | `/etims/branches` | POST | Query KRA branch list |
| `etims.js` | `/etims/device/init` | POST | Initialize VSCU device |
| `etims.js` | `/etims/items/register` | POST | Register product catalogue with KRA |
| `etims.js` | `/etims/submit-batch` | POST | Submit invoices to KRA |
| `StockReceiving.jsx` | `/scan/invoice` | POST | AI invoice scan (Claude Haiku vision) |

### Frontend State → Components

```text
staffStore (persist)   → usePermissions() hook → can(feature) booleans
  currentStaff.role                              → tab visibility (App.jsx)
  currentStaff.permissions                       → action guards (ProductList, TransactionHistory)

navStore (in-memory)   → panel, sub            → which panel/sub-tab renders (App.jsx)
  navigate(panel, sub)                          → called from bottom tab bar
  navigateSub(sub)                              → called from sub-tab bars

cartStore (persist)    → items[], totals        → Cart.jsx, checkout flow
settingsStore (persist)→ shopName, vatRate, etc → header, receipt, VAT calc
```

### Backend Auth Flow

```text
Request arrives
    │
    ├─ /health            → public, no auth
    ├─ /admin/*           → require X-Admin-Secret header (ADMIN_SECRET env var)
    ├─ /sms/webhook       → require X-SMS-Secret header (SMS_WEBHOOK_SECRET env var)
    ├─ /mpesa/callback    → IP-restricted to Safaricom CIDRs (production)
    └─ everything else    → Depends(get_tenant)
                               hash(X-API-Key) → lookup Tenant in DB
                               check tenant.active + billing_cycle_end
                               inject tenant into route handler
```

### M-Pesa Payment Flow

```text
1. Customer selects M-Pesa at checkout
2. CheckoutModal → sync.initiateMpesaStk(txnId, phone, amount)
3. Backend: POST /mpesa/stk-push → Daraja STK Push API
   → stores StkRequest(status=pending, checkout_request_id)
   → responds immediately with checkoutRequestId
4. Daraja sends push notification to customer's phone
5. Customer enters PIN on phone
6. Daraja posts result to /mpesa/callback (IP-whitelisted)
   → updates StkRequest(status=confirmed, mpesa_code)
   → updates Transaction with M-Pesa code
7. Frontend polls /mpesa/status/{id} every ~3s until confirmed
   OR: SMS gateway posts to /sms/webhook with confirmation code
   → frontend polls /sms/verified-codes to reconcile

Offline fallback:
  - STK Push queued in pending_mpesa (IndexedDB)
  - On reconnect: sync.resumePendingStkChecks() retries
  - SMS reconciliation runs automatically on reconnect
```

### Transaction Sync Flow

```text
Sale completed locally:
  transactions + transaction_items written to IndexedDB atomically
  Transaction marked synced=false

On reconnect (useOnline hook triggers):
  sync.pushUnsynced()
    → db.transactions.filter(!synced).toArray()
    → POST /sync/transactions (batch)
    → backend deduplicates by local_id (idempotent)
    → marks transactions synced=true in IndexedDB
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

### Admin (Platform Ops)

All require `X-Admin-Secret` header.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/admin/tenants` | Create new shop tenant (returns raw API key once) |
| GET | `/admin/tenants` | List all tenants |
| GET | `/admin/tenants/{id}` | Get tenant details |
| PATCH | `/admin/tenants/{id}` | Update plan / active status |
| POST | `/admin/tenants/{id}/rotate-key` | Rotate API key (returns new raw key once) |
| POST | `/admin/tenants/{id}/claim-legacy-data` | Migrate single-tenant data to tenant_id |

### AI Invoice Scanning

Requires `ANTHROPIC_API_KEY` set in backend env. Rate limited: 6 requests/minute per tenant.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/scan/invoice` | Analyze base64 invoice photo → `{ supplier, invoice_number, items[] }` |

### Health

```http
GET /health  → { status: "ok", db: "ok" }  (public, no auth)
```

Interactive docs auto-generated by FastAPI: `http://localhost:8000/docs`

---

## IndexedDB Schema (v8 via Dexie)

Migration chain: v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8

| Version | Change |
| --- | --- |
| v1 | Base schema: products, transactions, transaction_items, pending_mpesa, sync_queue, staff, settings |
| v2 | Add stock_receipts |
| v3 | Add reorder_level index to products |
| v4 | Add suppliers table |
| v5 | Drop sync_queue; add role index to staff; backfill roles + hash PINs + voided:false |
| v6 | Add cost_price index to products |
| v7 | Add etims_item_cd + etims_status indexes; backfill etims_status:'pending' |
| v8 | Add checkout_request_id index to pending_mpesa |

| Table | Key | Indexed fields | Notable stored-only fields |
| --- | --- | --- | --- |
| `products` | `++id` | `barcode, name, price, cost_price, stock, category, etims_item_cd, reorder_level, *tags` | `image_blob` (base64) |
| `transactions` | `++id` | `timestamp, total, payment_method, synced, staff_id, etims_status` | `subtotal, vat, change_given, voided` |
| `transaction_items` | `++id` | `transaction_id, product_id, quantity, price, subtotal` | — |
| `pending_mpesa` | `++id` | `transaction_id, code, checkout_request_id, timestamp, verified, amount` | — |
| `staff` | `++id` | `name, pin, role, active, created_at` | `permissions[]` (custom role only) |
| `settings` | `key` | `value` | Keys: shop_name, kra_pin, mpesa_till, pochi_number, vat_rate, vat_enabled, setup_complete |
| `stock_receipts` | `++id` | `timestamp, supplier, supplier_id, staff_id` | `items[]` (JSON), `photo_blob`, `invoice_number` |
| `suppliers` | `++id` | `name, created_at` | `phone, email, notes` |

---

## Backend Database Schema (PostgreSQL)

| Table | Purpose | Key relationships |
| --- | --- | --- |
| `tenants` | One row per shop | owns all other tables via tenant_id |
| `stk_requests` | M-Pesa STK Push tracking | tenant_id FK |
| `transactions` | Synced sales from frontend | tenant_id FK → transaction_items |
| `transaction_items` | Line items per sale | transaction_id FK |
| `products` | Cloud product catalogue | tenant_id FK |
| `etims_invoices` | KRA invoice records | tenant_id FK |
| `etims_counters` | Sequential invoice number per tenant | tenant_id unique |
| `etims_configs` | KRA credentials per tenant | tenant_id FK |
| `sms_verified_codes` | M-Pesa codes from SMS gateway | tenant_id FK |

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

Permissions are evaluated at runtime via `usePermissions()` hook. The hook reads `currentStaff` from Zustand (persisted to localStorage). **Role changes take effect on next login** — persisted sessions carry the role they had at login time.

---

## VAT Model

Shelf prices **include** VAT (16% default, configurable per shop).

```text
grandTotal = Σ(price × qty)          ← what customer pays
subtotal   = grandTotal / (1 + rate) ← net ex-VAT (for KRA)
vat        = grandTotal − subtotal   ← extracted VAT shown on receipt
```

---

## Code Standards

### Frontend

- **Language**: JavaScript (no TypeScript). Pydantic covers types on the backend.
- **Framework**: React 19 functional components + hooks only. No class components.
- **Styling**: Tailwind CSS v4 CSS-first (`@theme` variables in CSS). Use `bg-linear-to-br` not `bg-gradient-to-br` (v4 class names).
- **State**: Zustand stores for cross-component state; local `useState` for component-local UI state.
- **Database access**: All IndexedDB reads/writes go through `dbHelpers` in `db.js`. Never import `db` directly in components.
- **API calls**: All fetch calls go through `apiHeaders()` / `apiGetHeaders()` from `apiHeaders.js`. Never hardcode headers.
- **Async**: All DB and API calls use `async/await`. No `.then()` chains in components.
- **Error handling**: `try/catch` in service layer (`sync.js`, `etims.js`). Components use `showToast()` for user-facing errors.
- **No `console.log`**: Dev startup logs in `main.jsx` only. All other logging is `console.error`.
- **ESLint**: `npm run lint` — configured with `eslint-plugin-react-hooks`. Two rules relaxed for legitimate IndexedDB async patterns.

### Backend

- **Language**: Python 3.11+. FastAPI + Pydantic v2 + SQLAlchemy 2.
- **Auth**: `Depends(get_tenant)` injected into every protected route — never trust request body for tenant identity.
- **Schemas**: Every route has explicit Pydantic request + response schemas in `schemas.py`.
- **DB sessions**: `Depends(get_db)` — never hold a session across async calls.
- **Environment**: All secrets via environment variables. Never hardcoded.

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
| `MPESA_CALLBACK_URL` | `https://dzeline.online/mpesa/callback` | ✅ (M-Pesa) |
| `SMS_WEBHOOK_SECRET` | 32-char random hex | ✅ (SMS) |
| `ETIMS_ENV` | `sandbox` or `production` | ✅ (eTIMS) |
| `ETIMS_TIN` | real KRA TIN | ✅ (eTIMS) |
| `ETIMS_BHF_ID` | `00` | ✅ (eTIMS) |
| `ETIMS_DEVICE_SERIAL` | VSCU serial number | ✅ (eTIMS) |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | ✅ (AI scan) |

Generate secrets: `python -c "import secrets; print(secrets.token_hex(32))"`

### Frontend (`frontend/.env.local`)

| Variable | Example |
| --- | --- |
| `VITE_API_URL` | `https://dzeline-api.onrender.com` |

---

## Android APK (TWA — Trusted Web Activity)

The PWA is packaged as a real Android APK using Google's [bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) tool. The APK wraps `dzeline.online` in a Chrome TWA shell — no code duplication. Distribute the signed APK directly (WhatsApp, email, download link) without Play Store.

**Prerequisites (install once):**

- [Java JDK 17+](https://adoptium.net) — provides `keytool` for signing
- Node.js 18+ — already required for the frontend

Everything else (bubblewrap, icons, keystore, assetlinks.json) is handled automatically by the wizard.

**Run the wizard:**

```bash
# From repo root
npm run build-apk
```

The wizard walks through five steps:

| Step | What it does | Manual work required |
| --- | --- | --- |
| 1 | Checks Java and bubblewrap (auto-installs bubblewrap if missing) | Install Java if prompted |
| 2 | Generates PNG icons from `favicon.svg` | None |
| 3 | Creates signing keystore, extracts SHA-256, patches `assetlinks.json` | Choose a password |
| 4 | Waits for you to push the frontend to Vercel, then verifies the live link | `git push` |
| 5 | Runs `bubblewrap build`, shows APK path and distribution instructions | None |

**Distribute the APK:**

- Host `app-release-signed.apk` on GitHub Releases or any static URL
- Share the download link — users tap it on Android, allow "Install unknown apps", done
- To update: bump `appVersionCode` (integer) and `appVersionName` in `twa-manifest.json`, re-run `npm run build-apk`

**How the TWA verification works:**

```text
Android opens https://dzeline.online
    ↓
Chrome fetches /.well-known/assetlinks.json
    ↓
Checks SHA256 fingerprint matches the installed APK's signing cert
    ↓ match
Runs in full-screen TWA mode (no browser chrome, looks fully native)
    ↓ no match
Falls back to Custom Tab (browser chrome visible — still works, just looks less native)
```

**iOS:**
Apple requires a $99/year Developer Account + Mac with Xcode. PWABuilder (pwabduilder.microsoft.com) can generate an Xcode project from the PWA, but signing and distribution still require the Apple account. The PWA installs natively on iOS via "Add to Home Screen" from Safari — that's the practical iOS path for now.

---

## Development Setup

```bash
# Frontend
cd frontend
npm install
npm run dev          # → http://localhost:5173
# First run: setup wizard creates admin + seeds 10 products
# Default admin PIN (dev only): 1234
```

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env    # fill in values
python run.py           # → http://localhost:8000
# API docs: http://localhost:8000/docs
# Admin UI: http://localhost:8000/admin-ui
```

```bash
# Run linter
cd frontend && npm run lint

# Create tenant (replace ADMIN_SECRET with value from .env)
curl -X POST http://localhost:8000/admin/tenants \
  -H "X-Admin-Secret: your_admin_secret" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Shop", "plan": "trial"}'
# → Returns raw API key (stored in shop settings on first launch)
```

**Test offline mode**: DevTools → Network tab → Offline → Refresh → all sales still work.

---

## Deployment

| Layer | Platform | Config file |
| --- | --- | --- |
| Frontend (static) | Vercel | `.vercel/project.json` |
| Backend (API) | Render | `backend/render.yaml` |
| Database | PostgreSQL (Render managed or Supabase) | `DATABASE_URL` env var |

Vercel auto-deploys on push to `master`. Set `VITE_API_URL` in Vercel dashboard.
Render auto-deploys from `backend/` on push.

---

## Known Issues (from code review)

| Severity | File | Issue |
| --- | --- | --- |
| ~~🔴 Crash~~ | `StockReceiving.jsx:410` | ✅ Fixed — `onClose={() => navigateSub("inventory")}` passed from StockPanel |
| 🟡 UX | `PinLogin.jsx:88` | 4-digit PIN mismatch gives zero feedback — by design (allows 6-digit continuation) |
| ~~🟡 State~~ | `navStore.js` | ✅ Fixed — logout() now resets panel to "products" |
| 🟡 Security | `staffStore.js` | Persisted session carries stale role until explicit logout; role demotions not immediate |
| 🔵 Design | `App.jsx:447` | Permission guards duplicated between tab array and render block — must be kept in sync manually |

---

## Production TODOs

- [x] Fix `StockReceiving.jsx:410` Done button crash
- [x] Reset navStore on logout
- [x] Fix `DB_VERSION` in `constants.js`
- [x] Add structured logging to backend
- [x] Add rate limiting to `/mpesa/stk-push` and `/sync/transactions`
- [ ] Replace `pochiNumber: "0700000000"` in `constants.js`
- [ ] Replace `kraPin: "P051234567X"` in `constants.js`
- [ ] Add real 512×512 PNG app icon in `frontend/public/`
- [ ] Add error tracking (Sentry or similar) on both frontend and backend
- [ ] Wire Daraja per-tenant credentials from Settings UI → backend tenant record

---

## Remaining Planned Work

| Feature | Phase | Notes |
| --- | --- | --- |
| Real-time multi-device sync | B | WebSocket hub — backend + client code planned |
| Financial intelligence / balance sheet | C | ✅ Live — Finance tab in Reports: P&L, margin, COGS, stock valuation, top products by profit |
| AI invoice / receipt scanning | D | ✅ Live — "Scan Invoice" button in Stock Receiving; Claude Haiku vision auto-fills supplier, invoice no., line items |
| M-Pesa STK Push (live) | — | Backend code exists; needs real Daraja creds + HTTPS callback URL |
| KRA eTIMS VSCU signing | — | Requires KRA VSCU API access |
| Bluetooth thermal printer | — | Web Bluetooth + ESC/POS protocol — not started |
| Rate limiting | — | ✅ Done — slowapi on /mpesa/stk-push, /sync/transactions, /scan/invoice |
| Observability | — | ✅ Done — structured JSON logging on backend; Sentry not yet added |
| E2E test suite | — | Playwright installed, no test files yet |

---

Built by Dzeline · Nairobi, Kenya · 2026
