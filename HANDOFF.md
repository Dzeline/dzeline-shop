# Dzeline Shop — Project Handoff

Offline-first PWA point-of-sale for small Kenyan supermarkets. All data is local (IndexedDB). Syncs to a FastAPI backend when online.

---

## Status: Phase E + A Complete

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Core POS (products, cart, IndexedDB) | ✅ |
| 2 | Payments + receipts | ✅ |
| 3 | Staff / PIN login | ✅ |
| 4 | Backend, sync, transaction history | ✅ |
| 5 | Product editing, Pochi, analytics, scanner | ✅ |
| E | Navigation overhaul (bottom tab bar + inline panels) | ✅ |
| A | RBAC — granular role-based permissions | ✅ |

---

## Phase E — Navigation Overhaul (Complete)

Replaced 8 `show*` boolean flags in App.jsx with a persistent bottom tab bar and panel-based rendering. All full-screen modal overlays converted to inline panels.

| Change | Detail |
| --- | --- |
| `navStore.js` | New Zustand store — `panel`, `sub`, `navigate()`, `navigateSub()` |
| Bottom tab bar | 5 tabs: Products, Cart, Stock, Reports, Settings — permission-gated |
| Sub-tab bars | Stock: Inventory / Receiving / Suppliers; Reports: Summary / History; Settings: Shop / Staff / eTIMS |
| Screen components | Removed `fixed inset-0 z-50` from 8 screens; changed to `flex flex-col h-full` |
| Header | Shows current panel/sub title below shop name; gradient changes per staff member |

---

## Phase A — RBAC (Complete)

Replaced binary admin/cashier with 6 granular roles. Permissions gate both navigation tabs and UI actions.

| File | Change |
| --- | --- |
| `src/utils/permissions.js` | Defines `FEATURES`, `ROLE_PERMISSIONS`, labels, colors, `ASSIGNABLE_ROLES` |
| `src/hooks/usePermissions.js` | `usePermissions()` → `{ role, can(feature), permissions }` |
| `App.jsx` | `usePermissions()` called unconditionally at top; tabs filtered by `can()` |
| `StaffManagement.jsx` | `RoleChip`, `RoleSelector` components; inline role-change form per staff row |
| `ProductList.jsx` | Edit/Add buttons gated by `can(FEATURES.EDIT_PRODUCTS)` |
| `TransactionHistory.jsx` | Void button gated by `canVoid` prop (from `can(FEATURES.VOID_SALES)`) |
| `PinLogin.jsx` | Shows role label for all roles; PIN lookup now passes `selected.id` so staff with identical PINs don't block each other |
| `db.js` | `addStaff()` accepts `permissions[]`; `updateStaffRole()`; `getStaffByPin(pin, staffId?)` |

**Roles and default permissions:**

| Role | Permissions |
| --- | --- |
| admin | all |
| sub_admin | pos, stock, reports, etims, edit_products, void_sales |
| stock_keeper | pos, stock, reports |
| sales_manager | pos, reports, etims |
| cashier | pos, reports |
| custom | manual selection |

**PIN login fix:** `getStaffByPin` now accepts an optional `staffId` argument. When provided, the filter matches both PIN hash AND staff ID, so two staff sharing the same PIN no longer block each other's login.

---

## Phase 4 — Sync & Backend (Complete)

| Feature | File(s) |
| --- | --- |
| FastAPI backend (SQLite/PostgreSQL) | `backend/` |
| Cloud sync on reconnect | `frontend/src/services/sync.js` |
| Transaction history (last 50 sales) | `TransactionHistory.jsx` |
| New product creation (admin) | `ProductAddModal.jsx` |
| Stock receiving with photo | `StockReceiving.jsx` |
| Setup wizard (first launch) | `SetupWizard.jsx` |

Backend endpoints: `GET /health`, `POST /sync/transactions`, `GET /products/`, `POST/PUT/DELETE /products/{id}`, `POST /mpesa/stk-push`, `POST /mpesa/callback`.

Run locally: `cd backend && python run.py`. Copy `.env.example` → `.env` for Daraja credentials.

---

## Phase 5 — Advanced Features (Complete)

| Feature | File(s) | Notes |
| --- | --- | --- |
| Product images | `ProductList.jsx`, `ProductEditModal.jsx` | Camera capture → base64 blob in IndexedDB |
| Product editing (admin) | `ProductEditModal.jsx` | Edit name, price, reorder level, photo |
| Pochi la Biashara | `CheckoutModal.jsx`, `Receipt.jsx` | Third payment tab; stored to `pending_mpesa` like M-Pesa |
| Low stock alerts | `DailySummary.jsx`, `InventoryScreen.jsx` | Per-product `reorder_level`; warning in summary + inventory |
| Inventory screen (admin) | `InventoryScreen.jsx` | Grouped by category, collapsible, stock value totals |
| Barcode scanner | `ProductList.jsx` | Native `BarcodeDetector` API; scans → adds to cart |
| Date-range analytics | `DailySummary.jsx` | Today / This Week / This Month tabs |
| Cashier shift reports | `DailySummary.jsx` | Per-cashier sale count + revenue |
| VAT fix (inclusive) | `Cart.jsx` | Shelf prices include VAT; extracted for receipt, not added on top |
| Settings screen | `SettingsScreen.jsx` | Admin edits shop name, KRA PIN, M-Pesa till, Pochi number, VAT rate |

### VAT Model

Shelf prices **include** VAT. At checkout:

- `grandTotal = sum(price × qty)` — what customer pays (unchanged from shelf price)
- `subtotal = grandTotal / (1 + vatRate)` — net ex-VAT component (for KRA)
- `vat = grandTotal − subtotal` — extracted VAT shown on receipt

---

## Database Schema (IndexedDB v8 via Dexie)

| Table | Indexed fields | Notable unindexed fields |
| --- | --- | --- |
| `products` | `++id, barcode, name, price, stock, category, reorder_level, *tags` | `image_blob` |
| `transactions` | `++id, timestamp, total, payment_method, synced, staff_id` | `subtotal, vat, payment_amount, change_given, voided` |
| `transaction_items` | `++id, transaction_id, product_id, quantity, price, subtotal` | |
| `pending_mpesa` | `++id, transaction_id, code, timestamp, verified, amount` | stores codes for both M-Pesa and Pochi |
| `staff` | `++id, name, pin, role, active, created_at` | `pin` is SHA-256 hex (64 chars); `permissions[]` for custom role |
| `settings` | `key, value` | shop_name, kra_pin, mpesa_till, pochi_number, vat_rate, vat_enabled |
| `stock_receipts` | `++id, timestamp, supplier, supplier_id, staff_id` | `items[]` (JSON), `photo_blob`, `invoice_number` |
| `suppliers` | `++id, name, created_at` | `phone, email, notes` |

`sync_queue` was dropped in v5. `mpesa_code` was removed from `transactions` — codes live exclusively in `pending_mpesa` and are joined in `getTransactionHistory`.

---

## Tech Stack

- **React 19** + **Vite 8** + **Tailwind CSS 4** (CSS-first `@theme`)
- **Dexie.js 4** — IndexedDB wrapper
- **Zustand 5** — cart + staff session (persisted to localStorage)
- **vite-plugin-pwa** — service worker + offline caching
- **FastAPI** + **SQLAlchemy** — SQLite (dev) / PostgreSQL (prod)

---

## Development

```bash
cd frontend && npm install && npm run dev
# → http://localhost:5173  |  Admin PIN: 1234
```

First run seeds 10 products + 1 admin. Test offline: DevTools → Network → Offline → refresh.

```bash
# Backend
cd backend && pip install -r requirements.txt
cp .env.example .env   # fill Daraja creds
python run.py          # → http://localhost:8000
```

---

## Deployment

- **Frontend**: Vercel. `VITE_API_URL=https://dzeline-shop.onrender.com` already set.
- **Backend**: Render (`backend/render.yaml` present). Add env vars from `.env.example` in Render dashboard.

---

## Production TODOs

- [ ] Change admin PIN from `1234` (set in `db.js` seed — only affects fresh installs)
- [ ] Fill real Daraja API credentials in `backend/.env` and Render env vars
- [ ] Replace `pochiNumber: "0700000000"` in `constants.js`
- [ ] Replace KRA PIN `P051234567X` in `constants.js`
- [ ] Add real 512×512 PNG app icon in `frontend/public/`

---

## Remaining Planned Work

| Feature | Phase | Notes |
| --- | --- | --- |
| Real-time multi-device sync | B | WebSocket hub — backend + client code planned |
| Financial intelligence / balance sheet | C | Cost vs revenue, profit margin dashboard |
| AI invoice / receipt scanning | D | Camera → OCR → auto-fill stock receive form |
| M-Pesa STK Push (live) | — | Backend code exists; needs real Daraja creds + HTTPS callback URL |
| KRA eTIMS VSCU signing | — | Requires KRA Virtual Sales Control Unit API access |
| Bluetooth thermal printer | — | Web Bluetooth + ESC/POS protocol — not started |

---

Built by Dzeline · Nairobi, Kenya · 2026
