# Dzeline Shop — Frontend

React 19 + Vite 8 PWA frontend for the Dzeline Shop POS system.

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:5173
npm run build      # production build → dist/
npm run lint       # ESLint check
npm run preview    # preview production build
```

First run auto-seeds IndexedDB. Log in as **Admin** with PIN `1234`.

## Project Structure

```text
src/
├── components/
│   ├── App.jsx               # Root — PIN gate, header, bottom nav
│   ├── PinLogin.jsx          # Staff PIN entry screen
│   ├── ProductList.jsx       # Product grid with debounced search
│   ├── Cart.jsx              # Cart → Checkout → Receipt flow
│   ├── CheckoutModal.jsx     # Cash / M-Pesa payment tabs
│   ├── Receipt.jsx           # Post-sale KRA-style receipt
│   └── StaffManagement.jsx   # Admin CRUD for staff
├── services/
│   └── db.js                 # Dexie.js schema + all dbHelpers
├── store/
│   ├── cartStore.js          # Zustand cart (persisted)
│   └── staffStore.js         # Zustand staff session (persisted)
└── utils/
    ├── constants.js          # VAT_RATE, SHOP_INFO, PAYMENT_METHODS
    ├── formatters.js         # formatPrice, formatDate, calculateVAT
    ├── toast.js              # DOM-injected toast notifications
    ├── useDebounce.js        # Debounce hook for search
    └── useOnline.js          # Browser online/offline event hook
```

## Key Flows

**Login**: App checks `staffStore` on mount. If no session → shows `PinLogin`. Staff taps name → enters 4-digit PIN → validated against IndexedDB.

**Sale**: Products tab → Add to Cart → Proceed to Checkout → Cash or M-Pesa → Receipt → New Sale.

**M-Pesa**: Manual code entry (customer shows SMS code). Recorded to `pending_mpesa` table for server verification in a future phase.

**Staff Management**: Admin only (staff ID 1). Access via header avatar dropdown. Add/remove cashiers, change PINs, activate/deactivate.

## IndexedDB Tables

| Table | Key fields |
| --- | --- |
| `products` | `++id, barcode, name, price, stock, category` |
| `transactions` | `++id, timestamp, total, payment_method, staff_id` |
| `transaction_items` | `++id, transaction_id, product_id, quantity, price` |
| `pending_mpesa` | `++id, transaction_id, code, verified` |
| `sync_queue` | `++id, type, status` |
| `staff` | `++id, name, pin, active` |
| `settings` | `key, value` |

## Tech

| Package | Version | Purpose |
| --- | --- | --- |
| React | 19 | UI |
| Vite | 8 | Build tool |
| Tailwind CSS | 4 | Styling (CSS-first, `@theme`) |
| Dexie.js | 4 | IndexedDB wrapper |
| Zustand | 5 | State management |
| vite-plugin-pwa | latest | Service worker + manifest |

## Test Offline

1. `npm run dev`
2. DevTools → Network → Offline
3. Refresh — app still works

## Test on Phone

```bash
npm run dev -- --host
# open http://YOUR_LOCAL_IP:5173 on phone (same WiFi)
```
