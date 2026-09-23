# Handoff — current state

Offline-first PWA point-of-sale for small Kenyan supermarkets. All data is local
(IndexedDB via Dexie, schema v15) and syncs to a FastAPI backend when a connection exists.

This document is **what state the project is in**. The durable reference material lives
next to it, one fact in one place:

| For | Read |
| --- | --- |
| How it works and why | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Endpoints, auth, call sites | [docs/API.md](docs/API.md) |
| Running it, env vars, deploying | [docs/SETUP.md](docs/SETUP.md) |
| The cross-device UI work | [docs/UI_OVERHAUL_PLAN.md](docs/UI_OVERHAUL_PLAN.md) |

---

## Status: field-ready, with a caveat

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Core POS — products, cart, IndexedDB | done |
| 2 | Payments + receipts — Cash, M-Pesa, Pochi | done |
| 3 | Staff / PIN login | done |
| 4 | Backend, sync, transaction history | done |
| 5 | Product editing, analytics, scanner | done |
| E | Navigation — bottom tabs + inline panels | done |
| A | RBAC — granular role permissions | done |
| C | Financial intelligence / P&L | done |
| D | AI invoice scanning | done |
| F | Offline reliability, thermal printing, staged receiving | done |
| G | Multi-device sync — products, staff, settings, suppliers, receipts, transactions | done |
| H | Cross-device UI — desktop till + POS flow fixes | done, **needs a hardware pass** |
| B | Real-time sync (WebSocket) | not started |

**The caveat:** as of 2026-09-23 the Render service and the Neon database are suspended for
non-payment. This does not block development — the frontend is offline-first and runs
entirely standalone — but nothing syncs until they are restored, and no sync path has been
exercised end to end since.

---

## Most recent work — Phase H

A cross-device overhaul plus the three POS complaints raised in field testing. Full detail,
including what was deliberately not done, is in
[docs/UI_OVERHAUL_PLAN.md](docs/UI_OVERHAUL_PLAN.md).

**The shell was mobile-only by construction** — `App.jsx` had zero breakpoints, so a
desktop showed one phone-width column of logic stretched across the screen. Now: a
`SideNav` rail at `lg`, bottom tabs below it, content capped at 1400px.

**The cart is always visible.** A permanent rail beside the product grid on desktop; a
`CartBar` running total above the bottom nav on phones. The customer can see the total
climb without the cashier navigating away.

**Scanning persists until checkout** — opt-in continuous mode with a 1500ms duplicate
lockout, in-camera hit/miss feedback and a live tally. The four call sites that scan a
single code into a field keep one-shot behaviour.

**The app now has a keyboard layer**, where it previously had zero keydown handlers:
USB/Bluetooth wedge scanners (the cheapest and most reliable till hardware), Escape to
close overlays, PIN entry from the number row, focus-visible rings.

Two real bugs fixed along the way:

- `searchProducts` reached straight for `.includes`/`.some` on `barcode` and `tags`, which
  CSV import leaves null and absent. The TypeError rejected the whole Dexie query and was
  swallowed by a `catch`, so **any shop onboarded by CSV import had search silently return
  nothing** while showing stale results.
- Clearing the search box hit an early return that unmounted the search bar itself — the
  "page reloads and I have to click the box again" symptom from the field notes.

### Verification

```bash
cd frontend
npm run dev                  # in one terminal
npm run verify:responsive    # in another
```

40 Playwright checks across 390 / 768 / 1440 / 1920 px: shell swaps at the right
breakpoint, no horizontal overflow, search keeps focus, barcode search survives
null-barcode rows, the wedge scanner adds to the cart and stays out of the way while
someone types in a field, PIN accepts both taps and the number row.

It replaces 13 ad-hoc probe scripts, now parked in `frontend/scripts/legacy/`.

---

## Where things live

```text
frontend/src/
├── App.jsx                 # Shell: setup gate → PIN gate → header, rail/tabs, panels
├── components/
│   ├── SideNav · CartBar           # Desktop rail, phone running-total bar
│   ├── SetupWizard · PinLogin · PinRecovery · JoinShop
│   ├── ProductList · ProductAddModal · ProductEditModal · CsvImport
│   ├── BarcodeScanner              # zxing; one-shot or continuous
│   ├── Cart · CheckoutModal · Receipt
│   ├── InventoryScreen · StockReceiving · ManagerReceiving · SuppliersScreen
│   ├── DailySummary · TransactionHistory · FinanceDashboard · SalesExport
│   └── StaffManagement · SettingsScreen · EtimsModal
├── services/  db.js (Dexie + all dbHelpers) · sync.js · thermalPrinter.js · etims.js
├── store/     cartStore · staffStore · navStore · settingsStore  (Zustand)
├── hooks/     usePermissions · useWedgeScanner · useEscapeKey
└── utils/     apiHeaders · permissions · formatters · toast · useMediaQuery ·
               useDebounce · useOnline · csvExport · imageCompression · categories

backend/app/
├── routers/   products · staff · suppliers · settings · sync · stock_receipts ·
│              print_jobs · mpesa · sms · etims · scan · admin
├── models.py · schemas.py · database.py · deps.py · limiter.py · main.py
```

---

## Known issues

| Severity | Where | Issue |
| --- | --- | --- |
| Security | `staffStore.js` | The persisted session carries the staff role until an explicit logout, so a role demotion does not take effect on a till that stays logged in. |
| Design | `App.jsx` | Permission guards are duplicated between the tab array and the render block and must be kept in sync by hand. Adding a panel means editing both. |
| UX | `PinLogin.jsx` | A wrong 4-digit PIN gives no feedback — deliberate, since 4-digit entry has to stay open for a 6-digit PIN to be typed. |
| Cleanup | `utils/constants.js` | `DB_VERSION = 8` is stale and unused; the real schema version is the migration chain in `db.js`, now at v14. Delete the constant rather than updating it. |
| Security | `MpesaListenerService.kt` | The listener cannot tell a real Safaricom notification from one any installed app posts with the title "MPESA". Checking `sbn.packageName` against the device's SMS app would close most of this. Amount-matching in reconciliation limits the damage but does not remove it. |
| Reliability | `MpesaListenerService.kt` | A failed webhook POST is not retried, and the notification fires once. For Pochi and manual till payments the SMS is the *only* confirmation that exists, so a delivery failure loses it permanently. Wants a small on-device queue. |
| Privacy | `MpesaListenerService.kt` | Logs the first 50 characters of each M-Pesa message — code and amount — to logcat. |
| Security | `AndroidManifest.xml` | `allowBackup="true"` with the webhook secret and API key in plain `SharedPreferences`; both are extractable via `adb backup`. |
| Risk | `AndroidManifest.xml` | `default_filter_types="conversations,alerting"` (API 33+) may drop M-Pesa notifications if the SMS app posts them silently. Untested on Android 13+. |
| Build | `android-sms-listener` | No `gradlew.bat`, so the project cannot be built from Windows. Generate one with `gradle wrapper` on a machine running **JDK 17** — Gradle 8.2 rejects JDK 21+, and AGP 8.2 rejects anything below 11. |
| Sync gap | `settingsStore` | The default profit margin is stored locally only. Syncing it needs a new column on the `tenants` row, so a second till falls back to 25% until then. |
| Untested | `android-sms-listener` | Nothing in this module has ever been compiled — the wrapper jar was missing and `gradle.properties` did not exist, so both the APK workflow and any local build failed before reaching the Kotlin. CI is the first real build; expect it to surface more. |

---

## Production TODOs

- [ ] Replace the `pochiNumber: "0700000000"` placeholder in `utils/constants.js`
- [ ] Replace the `kraPin: "P051234567X"` placeholder in `utils/constants.js`
- [ ] Add error tracking (Sentry or similar) on frontend and backend
- [ ] Wire per-tenant Daraja credentials from the Settings UI through to the tenant record
- [ ] Restore the Render service and Neon database, then verify sync end to end
- [ ] Hardware pass on Phase H: scan a real basket on a phone, and test a real USB wedge
      scanner (`MAX_GAP_MS` / `MIN_LENGTH` in `hooks/useWedgeScanner.js` are the dials)

Done since the last handoff: 512×512 PWA icon shipped; Render moved off the free tier to
`plan: standard`; CSV/Excel product import built (`CsvImport.jsx`).

---

## Planned work

| Feature | Notes |
| --- | --- |
| Purchase order sync | The local half is built (Dexie v15, `services/purchaseOrders.js`). Orders do not yet reach the backend: `purchase_orders` / `purchase_order_items` need SQLAlchemy models, a router and push/pull in `sync.js`, following the stock-receipts pattern. Until then a second till cannot see what the first ordered. |
| Real-time multi-device sync | WebSocket hub — Phase B. Today's sync is a 45s pull plus reconnect-edge push, which is adequate but not live. |
| Category icon set | Categories render as a coloured block with an initial; real icons for Grains, Sugar, Dairy, Oils, Bakery, Beverages, Spices, Household, Produce. |
| Selling price history | Track price changes per product over time. |
| Expiry date alerts | `stock_receipt_items.expiry_date` is captured but never surfaced. |
| Theme consistency | The shell is `gray-900` dark while cards and modals are white. Legitimate as a style, but it is not a designed dark mode, and deciding it properly is its own piece of work. |

---

Built by Dzeline · Nairobi, Kenya
