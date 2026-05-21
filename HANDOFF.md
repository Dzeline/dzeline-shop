# Dzeline Shop - Project Handoff Document

## Project Overview

Dzeline Shop is an offline-first POS (Point of Sale) system built for small-to-medium supermarkets in Kenya. It runs entirely in the browser as a Progressive Web App, storing all data locally in IndexedDB via Dexie.js.

---

## Phase 1 — Core Shop (Complete)

### Phase 1 Features

| Feature             | File(s)                                   | Notes                                        |
| ------------------- | ----------------------------------------- | -------------------------------------------- |
| Product Catalog     | `frontend/src/components/ProductList.jsx` | Grid layout, debounced search, stock badges  |
| Shopping Cart       | `frontend/src/components/Cart.jsx`        | Add/remove/quantity, VAT totals              |
| State Management    | `frontend/src/store/cartStore.js`         | Zustand + localStorage persist               |
| IndexedDB Schema    | `frontend/src/services/db.js`             | Dexie.js, auto-seeded on first run           |
| Online Indicator    | `frontend/src/utils/useOnline.js`         | Listens to browser online/offline events     |
| Toast Notifications | `frontend/src/utils/toast.js`             | DOM-injected, auto-dismiss                   |
| PWA Setup           | `frontend/vite.config.js`                 | vite-plugin-pwa, service worker, manifest    |

---

## Phase 2 — Payments (Complete)

### New in Phase 2

| Feature | File(s) | Notes |
| --- | --- | --- |
| Checkout Modal | `frontend/src/components/CheckoutModal.jsx` | Cash input, denomination quick-select, live change display |
| Receipt Display | `frontend/src/components/Receipt.jsx` | KRA-style receipt, items, VAT breakdown, "New Sale" button |
| Atomic Transactions | `frontend/src/services/db.js` | `completeTransaction()` — Dexie `db.transaction("rw", ...)` across 3 tables |
| Transaction History | `frontend/src/services/db.js` | `getTransactionHistory()` — joined transactions + line items |
| Stock Decrement | Part of `completeTransaction()` | Decrements `products.stock` per item sold, clamped to 0 |
| Checkout Flow | `frontend/src/components/Cart.jsx` | Internal `view` state: `'cart' \| 'checkout' \| 'receipt'` |
| New Sale Navigation | `frontend/src/App.jsx` | `onNewSale` callback navigates back to Products tab |

### Cash Payment Flow

1. Cashier taps **Proceed to Checkout** on the cart
2. `CheckoutModal` opens — shows order summary, cash input, denomination quick-select
3. Change is calculated live; **Complete Sale** stays disabled until cash ≥ total
4. Cashier taps **Complete Sale** → `completeTransaction()` runs atomically in IndexedDB
5. Cart is cleared, `Receipt` view renders with full breakdown
6. Cashier taps **New Sale** → app navigates back to Products tab

---

## Database Schema (IndexedDB via Dexie)

- **products** — `++id, barcode, name, price, stock, category, *tags`
- **transactions** — `++id, timestamp, total, payment_method, synced, staff_id`
  - Unindexed fields also stored: `subtotal`, `vat`, `payment_amount`, `change_given`
- **transaction_items** — `++id, transaction_id, product_id, quantity, price, subtotal`
- **pending_mpesa** — `++id, transaction_id, code, timestamp, verified, amount`
- **sync_queue** — `++id, type, data, attempts, last_attempt, status`
- **staff** — `++id, name, pin, active, created_at`
- **settings** — `key, value`

### Seed Data

On first load, the `db.on("populate")` hook seeds:

- 10 products (Unga, Sugar, Milk, Cooking Oil, Rice, Bread, Eggs, Tea Leaves, Salt, Soap)
- 1 admin staff record (PIN: `1234` — **change in production**)
- Default settings: shop name, KRA PIN, M-Pesa till, VAT rate (16%), currency (KES)

---

## Tech Stack

- **React 19** + **Vite 8** + **@vitejs/plugin-react**
- **Tailwind CSS 4** with `@tailwindcss/vite` plugin (CSS-first, `@theme` for custom colors)
- **Dexie.js 4** (IndexedDB wrapper)
- **Zustand 5** with `persist` middleware
- **vite-plugin-pwa** for service worker + manifest

---

## Development Setup

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Test Offline

1. Open DevTools → Network → set to "Offline"
2. Refresh — app continues working

### Test on Phone (same WiFi)

```bash
npm run dev -- --host
# then open http://YOUR_LOCAL_IP:5173 on your phone
```

---

## Phase 3 — Sync & Backend (Planned)

- FastAPI backend (Python)
- PostgreSQL 15 database
- Cloud sync when online — uses `sync_queue` table already in schema
- M-Pesa STK Push integration with offline fallback queue (`pending_mpesa` table ready)
- KRA eTIMS receipt signing
- Multi-device support

## Phase 4 — Advanced Features (Planned)

- Analytics dashboard (sales, stock, revenue)
- Staff management & shift reports
- Barcode scanner integration (camera + USB)
- Bluetooth thermal printer support
- Inventory management & reorder alerts

---

## Production TODOs (before real launch)

- [ ] Replace KRA PIN placeholder (`P051234567X`) in `constants.js` and `db.js`
- [ ] Replace M-Pesa till placeholder (`1234567`) with real till number
- [ ] Change default admin PIN from `1234` (set in `db.js` seed)
- [ ] Add proper 512×512 PNG app icon for PWA installability
- [ ] Enable HTTPS — required for service workers in production

---

Built by Noxus Player (Anubis101) · Nairobi, Kenya · 2026
