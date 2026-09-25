# Frontend

React 19 + Vite 8 PWA for Dzeline Shop. Runs fully offline on IndexedDB; the backend is
only needed for sync, payments and eTIMS.

System design, schemas, RBAC and code standards live in
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — this file is just how to work in here.

## Scripts

```bash
npm install
npm run dev                 # → http://localhost:5173
```

| Script | Does |
| --- | --- |
| `dev` | Vite dev server with HMR |
| `build` | Production build → `dist/` |
| `preview` | Serve the built bundle |
| `lint` | ESLint over `src/` |
| `verify:responsive` | Playwright layout + POS-flow checks at 4 viewports (needs `dev` running) |
| `verify:stock-finance` | Playwright checks for the pricing suggestion and Finance panels (needs `dev` running) |
| `verify:pricing` | Selling-price suggestion maths (no browser needed) |
| `verify:purchase-orders` | Order recording and delivery matching (needs `dev` running) |
| `verify:supplier-ledger` | Invoices, part payments and what is owed (needs `dev` running) |
| `verify:scanner` | Camera decode cost and the fast/thorough split (needs `dev` running) |
| `verify:sms-match` | M-Pesa code/amount reconciliation rules (no browser needed) |
| `generate-icons` | Regenerate PWA icons from the source SVG |

First run opens the setup wizard. In development the admin PIN is `1234`.

## Layout

```text
src/
├── App.jsx              Shell: setup gate → PIN gate → header, nav, panels, cart rail
├── components/
│   ├── SideNav          Desktop navigation rail (lg and up)
│   ├── CartBar          Phone running-total bar above the bottom nav
│   ├── SetupWizard      First-launch shop configuration
│   ├── PinLogin         Staff picker + PIN pad (also accepts a physical keyboard)
│   ├── PinRecovery      Recovery flow when nobody can log in
│   ├── JoinShop         Join an existing shop from an invite link
│   ├── ProductList      Grid, live search, scanner entry point, edit mode
│   ├── ProductAddModal · ProductEditModal · CsvImport
│   ├── BarcodeScanner   zxing decoder; one-shot, or continuous for a whole basket
│   ├── Cart · CheckoutModal · Receipt
│   ├── InventoryScreen · StockReceiving · ManagerReceiving · SuppliersScreen
│   ├── PurchaseOrdersScreen  Open supplier orders, what is owed, and paying it
│   ├── SupplierDetail · RecordPaymentModal  One supplier's orders, invoices and payments
│   ├── DailySummary · TransactionHistory · FinanceDashboard · SalesExport
│   └── StaffManagement · SettingsScreen · EtimsModal
├── services/
│   ├── db.js            Dexie schema (v16) + every dbHelpers accessor
│   ├── sync.js          Push/pull for all synced tables
│   ├── purchaseOrders.js  What is on order, and matching deliveries to it
│   ├── supplierLedger.js  Invoices, payments, and what the shop owes
│   ├── thermalPrinter.js  Web Bluetooth ESC/POS + browser print fallback
│   └── etims.js         KRA VSCU client
├── store/               cartStore · staffStore · navStore · settingsStore (Zustand)
├── hooks/               usePermissions · useWedgeScanner · useEscapeKey
├── utils/               apiHeaders · permissions · pricing · formatters · toast · useMediaQuery ·
│                        useDebounce · useOnline · csvExport · imageCompression · categories
└── index.css            Tailwind v4 @theme tokens + all keyframes
```

## Conventions that matter here

- **Never import `db` directly in a component.** Everything goes through `dbHelpers` so
  migrations and invariants stay in one place.
- **Never hand-build API headers.** Use `apiHeaders()` / `apiGetHeaders()`.
- **There is no `tailwind.config.js`.** This is Tailwind v4: theme tokens are the `@theme`
  block at the top of `index.css`. Use `bg-linear-to-br`, not `bg-gradient-to-br`.
- **Anything on the sell path must work offline.** If a feature needs the network to
  complete a sale, it is the wrong design.
- **Breakpoints**: `lg` (1024px) is the phone/desktop divide. Prefer Tailwind prefixes;
  `useMediaQuery` is only for when behaviour differs, not appearance. The product grid uses
  **container** queries because it shares its row with the cart rail.

## Testing

```bash
npm run dev                 # terminal 1
npm run verify:responsive   # terminal 2
```

Seeds a shop into IndexedDB, logs in, and runs 40 checks at 390 / 768 / 1440 / 1920 px —
shell swap, overflow, search focus, null-barcode search, wedge scanner, PIN input.
Screenshots land in `scripts/screenshots/` (gitignored).

Not covered, and needing a real device: camera scanning, and a physical USB wedge scanner.

### Offline check

DevTools → Network → Offline → reload. The app still works and the amber banner appears.

### On a phone

```bash
npm run dev -- --host
# http://YOUR_LOCAL_IP:5173 on the same Wi-Fi
```

Camera scanning needs a secure context — fine on `localhost`, but over a LAN IP you will
need a tunnel (ngrok, Cloudflare Tunnel) for the camera to start.

`scripts/legacy/` holds one-off verification scripts from earlier phases, kept for
reference. They are not maintained.
