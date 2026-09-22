# Cross-Device UI Overhaul & POS Usability — Phased Plan

Status: **all six phases implemented** 2026-09-22 on top of commit `febadc4`, and
left uncommitted in the working tree. Verified by `npm run verify:responsive`
(40 checks across 4 viewports, all passing) plus a clean `npm run build`.

Two things were **not** done as written, both noted in place below: the
`Sheet.jsx` modal extraction (unnecessary — the premise was wrong, see Phase 2)
and removing the nested `dzeline-shop/` directory (has an uncommitted edit in it;
see Phase 0).

Goal: one codebase that works as a phone-in-hand POS **and** a desktop till, plus the
three POS flow fixes from the field sketches (live search, persistent scanning, visible
cart). Render and Neon being suspended blocks none of this — the frontend is offline-first
on Dexie, so every phase below can be built and tested with the backend down. Only sync
verification needs the services back.

Phases are ordered so each one ships independently and nothing later depends on a phase
being perfect. Phases 0–1 are small and immediately felt; phase 2 is the structural one.

---

## Phase 0 — Clear the ground

No user-visible change. Removes things that will actively mislead edits during the later
phases.

| File | Change |
|---|---|
| `frontend/tailwind.config.js` | **Delete.** It is a Tailwind v3 config in a v4 project (`@tailwindcss/vite`); it is not read. The live theme is the `@theme` block in `src/index.css:3`, which duplicates the same four colours. |
| `frontend/src/index.css:96` | `.animate-pulse` is overridden with a light gradient (`#ececee`→`#dddde0`). Every skeleton renders as white blocks inside the `gray-900` shell. Change to dark stops (`#1f2937`→`#374151`) or scope the light version to the cards that are actually white. |
| `dzeline-shop/` (nested dir) | **Not done — needs your call.** It is not stray clutter but a *gitlink* (mode 160000) pointing at this same GitHub repo at its "Initial commit", with no `.gitmodules` and a one-line uncommitted edit to its README. Removing it discards that edit and rewrites the parent index — unrelated to UI work, so it was left alone. |
| `frontend/verify_*.mjs` (13 files), `frontend/*.png` (~56 files) | One-off Playwright probes and screenshots from June sitting in the frontend root. Move to `frontend/scripts/legacy/` or delete — phase 2 wants a clean root for real viewport tests. |

**Acceptance:** `npm run build` succeeds, app renders identically, skeletons no longer flash white.

---

## Phase 1 — Search correctness and the search flash

The highest felt-benefit-per-line work in the whole plan. Both bugs are in the Products
search path and are independent of everything else.

### 1a. Search crashes on products without a barcode

`frontend/src/services/db.js:218` — `searchProducts()` does `p.barcode.includes(query)` and
`p.tags.some(...)`. But:
- `frontend/src/components/CsvImport.jsx:91` writes `barcode: null` and **no `tags` field at all**
- `frontend/src/services/sync.js:500` writes `barcode: p.barcode ?? null`

So any catalogue onboarded by CSV import (the empty-state CTA) throws a `TypeError` inside
the Dexie filter. The rejection is swallowed by the `catch` at `ProductList.jsx:89`, so
search silently does nothing and the grid keeps showing stale results.

**Change** — `services/db.js:218`, make the predicate null-safe:
- guard `p.barcode` before `.includes`
- guard `p.tags` before `.some` (and each tag before `.includes`)
- keep the existing `p.active !== false` check

No data migration needed — null-safety covers existing rows. `ProductList.jsx` is the only
caller (`InventoryScreen` filters in memory; `StockReceiving` uses `getProductByBarcode`).

**Change** — `ProductList.jsx:89`, stop swallowing: keep the `console.error` but also
`showToast("Search failed")` so a future breakage is visible instead of silent.

### 1b. Clearing the search unmounts the search bar

`ProductList.jsx:117` early-returns the skeleton grid whenever `loading` is true — and that
early return contains the search input. `ProductList.jsx:96` calls `loadProducts()` (which
sets `loading = true`) every time the query empties. Result: input unmounts, focus is lost,
grid flashes — the reported "page reloads, you have to re-click the search bar".

**Change** — `ProductList.jsx`:
- split state: `initialLoading` (first mount only) vs. nothing for refetches
- `loadProducts()` takes a `{ silent }` flag; the effect at line 95 calls it silently
- delete the early return at 117; render the toolbar unconditionally and put the skeleton
  **inside** the grid region only
- keep the 300ms `useDebounce` — per-keystroke live search already works once the unmount
  is gone, so sketch item 1 needs no new mechanism

**Acceptance:** import a CSV with no barcode column, then type and clear a query — focus
stays in the box, toolbar never disappears, results are correct.

---

## Phase 2 — Responsive shell

The structural phase. Today `App.jsx:628` is `h-dvh flex flex-col` with a bottom nav and
**zero breakpoints**; the whole app has ~32 responsive tokens, mostly `max-w-sm` on modals.
This phase adds the wide-screen branch without rewriting screens — they are all
`flex flex-col h-full` children and keep working inside a new shell.

Breakpoint convention for the project (write it down once, use it everywhere):
`< md` phone · `md–lg` tablet · `≥ lg` desktop till.

### New files

| File | Purpose |
|---|---|
| `src/components/SideNav.jsx` | The `≥ lg` left rail: logo, shop name, the same tab list, staff pill at the bottom. Takes the existing `tabs` array as a prop. |
| `src/components/AppShell.jsx` | Optional if `App.jsx` gets crowded: the grid wrapper (sidebar / main / cart rail). Can also stay inline in `App.jsx`. |

### Changed files

| File | Change |
|---|---|
| `App.jsx:560–625` | Lift the `tabs` array out of the render body so both `SideNav` and the bottom nav consume it. No logic change — permissions filtering stays. |
| `App.jsx:628` | Root becomes a responsive grid: `lg:grid lg:grid-cols-[auto_1fr]` with `SideNav` in column 1. |
| `App.jsx:690` | Bottom `<nav>` gets `lg:hidden`. |
| `App.jsx:632–651` | Header: on `lg` the shop name moves into the sidebar; the header keeps panel title + online dot + staff pill. Avoid showing the shop name twice. |
| `App.jsx:667–687` | Wrap `<main>` content in `mx-auto w-full max-w-[1400px]` so 1920px screens get a readable measure instead of edge-to-edge rows. This is the direct fix for the "unutilized regions" note. |
| `src/utils/toast.js:12` | `fixed bottom-24` assumes the bottom nav. Make it `bottom-24 lg:bottom-6 lg:left-auto lg:right-6 lg:translate-x-0` so desktop toasts don't sit under the cart rail. |
| `src/index.css:166` | `.pb-safe` should only apply while the bottom nav is visible; scope it or drop it from the `lg` layout. |

### Modals — corrected, and much smaller than planned

**The premise of this section was wrong.** Reading every wrapper rather than counting
breakpoint tokens per file: `CheckoutModal`, `ProductAddModal`, `ProductEditModal`,
`CsvImport` and `PinRecovery` *already* carry `sm:items-center` + `sm:max-w-*` +
`sm:rounded-2xl`, alongside `SuppliersScreen` and `StockReceiving`. They centre correctly
on a desktop already.

Exactly one overlay was phone-only: the **scan-source chooser** at
`StockReceiving.jsx:435` (`items-end`, `rounded-t-3xl`, no `sm:` variants). Fixed.

The `Sheet.jsx` extraction was therefore **dropped**: rewriting the DOM of eleven working
modals to share a wrapper is churn and regression risk for no behavioural gain. What those
modals actually lacked was keyboard dismissal, which Phase 5 adds with a hook instead —
no structural change.

**Acceptance:** screenshots at 390 / 768 / 1440 / 1920 px. No horizontal scroll at 390px;
no single stretched column at 1920px; every modal centred above `sm`.

---

## Phase 3 — POS split view and the always-visible cart

Fixes sketch 3's third point ("the customer can't see the running total"). Depends on
phase 2's shell.

| File | Change |
|---|---|
| `src/components/Cart.jsx` | Split it. Extract the item list + totals (lines 82–166) into `CartPanel.jsx` so it can render in three places: the desktop rail, the mobile panel, and the expanded mobile sheet. `Cart.jsx` keeps the `cart / checkout / receipt` view switching and the sale-completion logic (32–61) — that stays in one place. |
| `src/components/CartPanel.jsx` (new) | Presentational: items, qty steppers, VAT breakdown, total, Checkout button. Props: none it can't read from `cartStore`. |
| `App.jsx` (main region) | On `lg`, Products renders as `grid-cols-[1fr_360px]` — product grid left, `CartPanel` right, permanently mounted. The cart nav tab hides on `lg` since the cart is always on screen. |
| `src/components/CartBar.jsx` (new) | Mobile (`< lg`) only: sticky bar above the bottom nav showing item count + running total, tap to expand into the cart sheet. This is what lets the customer see the total mid-scan on a phone. |
| `src/store/navStore.js` | `navigate("cart")` on `lg` should be a no-op / focus the rail rather than swapping the panel. Small guard, or handle it in `App.jsx`. |
| `src/components/ProductList.jsx:253` | Grid columns need a wider ramp for the rail layout: `grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6` currently tops out at `lg:grid-cols-5` across the full width. |

Card legibility on desktop is worth revisiting here too — `text-[9px]` category labels and
`text-xs` names (`ProductList.jsx:289,295`) are fine at phone distance, small on a 24"
monitor at arm's length. Bump one step at `lg`.

**Acceptance:** on desktop, add items without ever navigating away from Products; the total
updates in the rail. On mobile, the bar shows count + total on every Products screen.

---

## Phase 4 — Scanning that persists until checkout

Fixes sketch 3's second point. `ProductList.jsx:106` closes the scanner on every successful
scan and `BarcodeScanner.jsx:55` stops the camera stream, so multi-item scanning means
re-opening the camera per product.

`BarcodeScanner` has **five call sites** — `ProductList`, `InventoryScreen:462`,
`ProductAddModal:84`, `ProductEditModal:104`, `StockReceiving:902`. The last four scan a
single code to fill a field and **must keep one-shot behaviour**. So continuous mode is
opt-in via prop, not a behaviour change to the component's default.

| File | Change |
|---|---|
| `BarcodeScanner.jsx:19` | New prop `continuous = false`. When false, behaviour is exactly as today. |
| `BarcodeScanner.jsx:53–58` | In continuous mode: do **not** call `controls.stop()`; instead keep a `lastCode`/`lastAt` ref and ignore the same code within ~1200ms (zxing fires many times per second on a held barcode). Keep the `navigator.vibrate?.(40)` per accepted scan. |
| `BarcodeScanner.jsx` (overlay) | In continuous mode show a running tally — "3 items · KSh 450" — fed by a `summary` prop, plus a prominent **Done** button. Flash the frame green on an accepted read, red + a message on an unknown barcode, so the cashier gets feedback without leaving the camera. |
| `ProductList.jsx:105–115` | `handleScan` stops calling `setShowScanner(false)`. On hit: `addItem`. On miss: keep the scanner open and surface "not found" in the overlay rather than falling back to `setSearch(barcode)` (which is only useful once the camera closes). |
| `ProductList.jsx:378` | Pass `continuous` + `summary={{ count, total }}` from `cartStore`. |

**Acceptance:** scan five products in a row without touching the screen; the tally matches
the cart; **Done** returns to a cart that already has all five.

---

## Phase 5 — The keyboard layer (the missing desktop till feature)

Grep for `onKeyDown` / `keydown` / `keypress` across `frontend/src`: **zero hits**. On a
phone that is invisible; on a desktop till it is the difference between a usable and an
unusable POS.

| File | Change |
|---|---|
| `src/hooks/useWedgeScanner.js` (new) | Global `keydown` listener detecting a fast burst of digits terminated by `Enter` (USB/Bluetooth scanners are keyboard-wedge devices: they *type*). Heuristic: ≥8 chars, inter-key gap < 35ms, ends on Enter. Ignore while focus is in an `input`/`textarea` unless the burst is unambiguous. Calls back with the code. **This is the single highest-value functional win for a desktop till** — wedge scanners are cheaper and far more reliable than a webcam. |
| `App.jsx` | Mount `useWedgeScanner`, routing codes through the same `getProductByBarcode` → `addItem` path as `handleScan`, so camera and wedge share one code path. |
| `src/hooks/useEscapeKey.js` (new) | `Esc` closes the topmost modal. Apply across the modal files (or bake it into `Sheet.jsx` from phase 2 — better, one place). |
| `PinLogin.jsx:51` | Accept physical input: digits `0–9` → `handleKey`, `Backspace` → `⌫`, `Enter` → `✓`. The existing `handleKey` already does everything; this just adds a listener. |
| `src/index.css` | Add `:focus-visible` rings. Today only inputs have focus styling (`focus:ring-2`); every button is mouse/touch-only. Needed for keyboard-driven till use and for accessibility. |

**Acceptance:** with a USB scanner, scan into a cart without clicking anything; `Esc` closes
every modal; PIN can be entered entirely from the number row.

---

## Phase 6 — Login portal remake

Mostly cosmetic, deliberately last. Note that most of sketch 2's *behaviour* already exists:
clicking an account already swaps the tile grid for the keypad in place
(`PinLogin.jsx:115` remounts on `selected`), and recovery already exists as "Can't log in?"
(`PinLogin.jsx:247`).

| File | Change |
|---|---|
| `PinLogin.jsx:97` | `min-h-screen` → `min-h-dvh` (matches the rest of the app; fixes mobile browser chrome). |
| `PinLogin.jsx:116` | `max-w-sm` card on a 1920px screen is the "dead space" in sketch 1. On `lg`, widen the card and lay the staff grid out beside the branding rather than under it. |
| `PinLogin.jsx:126,132` | `grid-cols-2` is fixed; with 4+ staff on desktop it stays a narrow two-column stack. `grid-cols-2 lg:grid-cols-3` or auto-fit. |
| `PinLogin.jsx:107` | Shop name is `text-2xl`; sketch 2 wants it as the dominant element. Bump and tighten the "Point of Sale" subline under it. |
| `PinLogin.jsx:102` + `index.css` | Logo rotation animation — new `@keyframes` next to the existing `fade-logo` (index.css:116). Keep it subtle and one-shot on mount; a looping spin behind a PIN pad gets old by the tenth login of the day. |
| `PinLogin.jsx:249` | Recovery link is `text-white/35` — effectively invisible. Sketch 2 calls it out as "Recover Access". Raise contrast and label it plainly. |

---

## Sequencing and risk

```
Phase 0 ─┐
Phase 1 ─┴─► independent, ship first (small, high felt value)
Phase 2 ────► structural; everything below builds on the shell
Phase 3 ────► needs 2
Phase 4 ────► needs 3 for the tally to be meaningful (works without it)
Phase 5 ────► independent of 2–4, but best demoed on the desktop shell
Phase 6 ────► independent, cosmetic, last
```

Highest risk is phase 2: it touches the file every screen renders inside. Mitigations —
keep screen internals untouched, do the modal pass as one mechanical `Sheet.jsx` swap, and
land the viewport screenshot check before starting so regressions are visible.

Phases 1, 4 and 5 are the ones that change what a cashier actually feels at the counter.
If time is short, those three in that order deliver most of the usability win; phases 2, 3
and 6 are what make the desktop stop looking like a stretched phone.

## What shipped

New files:

| File | Role |
|---|---|
| `src/components/SideNav.jsx` | Desktop navigation rail (≥ lg) |
| `src/components/CartBar.jsx` | Phone running-total bar above the bottom nav |
| `src/utils/useMediaQuery.js` | `useSyncExternalStore` media-query hook + `DESKTOP_QUERY` |
| `src/hooks/useWedgeScanner.js` | USB/Bluetooth barcode scanner as keyboard input |
| `src/hooks/useEscapeKey.js` | Stacked Escape-to-close, topmost overlay wins |
| `scripts/verify-responsive.mjs` | The acceptance test — `npm run verify:responsive` |

Changes worth knowing about beyond the phase tables:

- **Container queries, not viewport breakpoints, for the product grid.** The grid shares
  its row with the cart rail, so column count follows the space the list actually got
  (`@2xl:grid-cols-4 @5xl:grid-cols-5 @6xl:grid-cols-6` on an `@container` root). A `lg:`
  breakpoint would have counted the monitor, not the column.
- **The camera scanner's effect is now mount-only.** It reads `onScan` through a ref, so a
  new callback identity from the parent can no longer tear down and restart the camera
  mid-scan — a latent wart that continuous mode would have made very visible.
- **Escape is gated on the M-Pesa tab** (`CheckoutModal`). An STK push may be in flight
  against the customer's phone; a stray keypress must not make the cashier lose sight of a
  payment that is still happening. Cash checkout closes on Escape freely.
- **PWA manifest orientation** changed from `portrait` to `any` (`vite.config.js`) — an
  installed desktop till window is landscape. The Android TWA manifest was left on
  `portrait` deliberately; that build is the phone distribution.
- **`animate-pulse` was silently wrong.** Its override painted a *light* shimmer gradient,
  so every `bg-gray-800` skeleton on the dark shell rendered as white blocks, and the two
  pulsing status dots had their colour painted over. Now dark by default, with
  `animate-pulse-light` for white cards and `animate-dot-pulse` for the dots.
- **The toast keyframe no longer sets `transform`.** It was hardcoding `translate(-50%, …)`,
  which would fight the corner positioning at lg.

## Still to verify on real hardware

The suite drives a real browser but cannot drive a camera or a USB scanner:

- **Continuous camera scanning** — the duplicate-code lockout (1500ms), the green/red
  in-camera feedback and the running tally are all unexercised by the test. Scan a basket
  on an actual phone before trusting it on the counter.
- **The wedge scanner is verified against *synthetic* keystrokes** at 6ms intervals, which
  is what the heuristic expects. A real scanner's timing and any prefix/suffix characters
  it sends should still be checked once; `MAX_GAP_MS` and `MIN_LENGTH` in
  `src/hooks/useWedgeScanner.js` are the two dials.

## Deliberately not in scope

- **Theme consistency.** The shell is `gray-900` dark while cards, modals and the login card
  are white. That's a legitimate style, but it is not a designed dark mode, and deciding it
  properly is its own piece of work — don't let it creep into phase 2.
- **Backend / sync changes.** Nothing here touches `services/sync.js` or the FastAPI app.
- **The suspended Render + Neon services.** Not a blocker for any phase above.
