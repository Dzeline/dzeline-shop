# Dzeline Shop — Frontend

React 19 + Vite 8 PWA for the Dzeline Shop POS. Runs fully offline via IndexedDB.

## Quick Start

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build → dist/
npm run lint
```

First run auto-seeds IndexedDB. Log in as **Admin** with PIN `1234`.

## Project Structure

```text
src/
├── components/
│   ├── App.jsx                # Root — setup gate, PIN gate, header, bottom nav
│   ├── SetupWizard.jsx        # First-launch shop configuration
│   ├── PinLogin.jsx           # Staff selection + PIN numpad
│   ├── ProductList.jsx        # Product grid, search, barcode scanner, admin edit/add
│   ├── Cart.jsx               # Cart → Checkout → Receipt flow
│   ├── CheckoutModal.jsx      # Cash / M-Pesa / Pochi payment tabs
│   ├── Receipt.jsx            # KRA-style receipt (VAT-inclusive breakdown)
│   ├── StaffManagement.jsx    # Admin CRUD for cashiers
│   ├── StockReceiving.jsx     # Record supplier deliveries with photo
│   ├── InventoryScreen.jsx    # Stock view grouped by category (admin)
│   ├── SettingsScreen.jsx     # Shop name, KRA PIN, M-Pesa/Pochi numbers, VAT
│   ├── DailySummary.jsx       # Today/Week/Month analytics + cashier breakdown
│   ├── TransactionHistory.jsx # Last 50 sales with expandable line items
│   ├── ProductAddModal.jsx    # Add new product (admin)
│   └── ProductEditModal.jsx   # Edit price, photo, reorder level (admin)
├── services/
│   ├── db.js                  # Dexie schema (v3) + all dbHelpers
│   └── sync.js                # Push unsynced transactions to backend on reconnect
├── store/
│   ├── cartStore.js           # Zustand cart (persisted)
│   ├── staffStore.js          # Zustand staff session (persisted)
│   └── settingsStore.js       # Zustand shop settings (loaded from IndexedDB)
└── utils/
    ├── constants.js           # DB_VERSION, PAYMENT_METHODS, SHOP_INFO defaults
    ├── formatters.js          # formatPrice, formatDate
    ├── toast.js               # DOM-injected toast notifications
    ├── useDebounce.js         # Debounce hook
    └── useOnline.js           # Browser online/offline event hook
```

## Key Flows

**Sale**: Products → Add to Cart → Proceed to Checkout → Cash / M-Pesa / Pochi → Receipt → New Sale.

**VAT**: Prices are VAT-inclusive. At checkout, VAT is *extracted* from the total (not added on top). `vat = total − total/(1+rate)`.

**M-Pesa / Pochi**: Cashier enters the customer's SMS confirmation code. Stored to `pending_mpesa` for later verification. M-Pesa STK Push (server-triggered) requires Daraja credentials in `backend/.env`.

**Barcode scanner**: Tap the barcode icon in the search bar. Uses native `BarcodeDetector` API (Chrome/Edge on Android). On scan, adds the product to cart or pre-fills search if not found.

**Stock receiving**: Admin logs deliveries (supplier name, optional invoice + photo), selects products + quantities. Stock is incremented atomically.

**Sync**: On every online reconnect, `syncService.pushUnsynced()` POSTs unsynced transactions to `VITE_API_URL/sync/transactions`.

## IndexedDB Schema (v3)

| Table | Key fields |
| --- | --- |
| `products` | `++id, barcode, name, price, stock, category, reorder_level` |
| `transactions` | `++id, timestamp, total, payment_method, staff_id, synced` |
| `transaction_items` | `++id, transaction_id, product_id, quantity, price` |
| `pending_mpesa` | `++id, transaction_id, code, verified` |
| `stock_receipts` | `++id, timestamp, supplier, staff_id` |
| `staff` | `++id, name, pin, active` |
| `settings` | `key, value` |

## Staff Roles

| Role | Criteria | Access |
| --- | --- | --- |
| Admin | `staff.id === 1` | All features including Staff Mgmt, Settings, Inventory, product add/edit |
| Cashier | All others | POS only (Products, Cart, Daily Summary, Transaction History) |

## Tech

| Package | Purpose |
| --- | --- |
| React 19 + Vite 8 | UI + build |
| Tailwind CSS 4 | Styling (CSS-first `@theme`) |
| Dexie.js 4 | IndexedDB wrapper |
| Zustand 5 | State (cart, staff, settings) |
| vite-plugin-pwa | Service worker + offline caching |

## Test Offline

1. `npm run dev`
2. DevTools → Network → Offline
3. Refresh — app still works

## Test on Phone

```bash
npm run dev -- --host
# open http://YOUR_LOCAL_IP:5173 on phone (same WiFi)
```
