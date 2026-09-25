# Aronium POS — case study and what to take from it

A feature comparison against a mature commercial POS, run with the client's
permission on their licensed copy, to decide what Dzeline should build next.

Written 2026-09-25 against Aronium Pro (build dated 2025-09-07).

## Method, and its limits

Read: the SQL migrations, the English language file (1,870 lines, which names
every screen, button and permission in the product), the 26 workflow
definitions, the module list, the 67 report templates, and the app config.

Not read: the compiled assemblies. Nothing here is derived from decompiling
their code — this is a comparison of *what the product does*, drawn from its own
data and resource files, which is what a feature decision needs. Where something
is inferred rather than confirmed it says so.

So this describes their feature surface accurately and their implementation only
where the schema reveals it.

## What Aronium is

A Windows desktop POS: .NET WPF, SQL Server (it ships SQL Express in
`SetupFiles/`), single-site with networked terminals. Roughly 190 assemblies,
611MB installed.

Structurally it is the opposite of Dzeline on two axes that matter:

| | Aronium | Dzeline |
|---|---|---|
| Deployment | installed on Windows, SQL Server per site | PWA, installs anywhere, IndexedDB per device |
| Offline | the server *is* local; "offline" is not a concept | offline-first, sync when reachable |
| Reach | one site, its own machines | phone, tablet, desktop, any browser |
| Compliance | fiscal printers (EU) | KRA eTIMS |

**Neither is better in the abstract.** Their model assumes a fixed shop with a
server. Ours assumes a phone that may be in a market with no signal. Most of
what follows is about *retail workflow*, where they are ten years ahead of us —
not about architecture, where our choice is the right one for this market.

## Where they are genuinely ahead

Ordered by what I judge to matter for a Kenyan supermarket. This is a
recommendation, not an inventory.

### 1. Cash reconciliation — the largest single gap

Aronium has a whole layer Dzeline has nothing of: **starting cash**, **cash in /
cash out**, **user cash out**, **business day open/close**, and **X/Z reports**
(both `XZReport` and `XZReportA4` templates, plus `StartingCash` and
`UserCashOut`).

The workflow is: the till is opened with a counted float, cash movements in and
out during the day are recorded with a reason, and at close the cashier counts
the drawer and the system reports **expected vs counted vs difference** per user.

Dzeline has `DailySummary`, which reports what was *sold*. That is not the same
thing and does not answer the question an owner actually asks: **did the money in
the drawer match the sales?** Without it there is no mechanism to notice a
cashier pocketing cash, which in this market is the single most common loss.

This is the thing I would build first.

### 2. Customer accounts and credit

`Customer`, `CustomerDiscount`, customer balance, "Credit payments", "Collected
credit payments", and a `CollectedCreditPayments` report.

Selling on credit — *kuchukua kwa deni* — is normal in Kenyan dukas and
completely absent from Dzeline. Today the only way to record it is a cash sale
that never happened, which corrupts both the day's takings and the P&L.

### 3. Discounts

Aronium has per-item and per-cart discounts, as a percentage or fixed amount,
applied **before or after tax**, with a permission gating who may apply one, and
a `DiscountApplyRule` on the schema. Reports break out `SalesItemDiscounts`.

Dzeline has **no discount mechanism at all**. In a market where the price of a
bulk purchase is negotiated at the counter, the cashier's only options today are
to refuse, or to edit the product price — which silently changes it for every
future customer.

### 4. Refunds that put stock back

Their permission text is explicit: a refund "will create new Refund document and
will put quantities back to stock automatically."

**Ours does not.** `dbHelpers.voidTransaction` flips a `voided` flag and nothing
else — the UI even warns "Stock will NOT be automatically restored." So every
void leaves the stock count permanently wrong, and the more voids a shop does the
further inventory drifts from reality. That is a correctness bug, not a missing
feature, and it undermines the reorder work just shipped: `coverDays` is computed
from a stock figure that voids quietly corrupt.

### 5. Void reasons, captured and audited

A `PosVoid` table with `Reason`, `VoidedBy`, `VoidedByName`, `IsConfirmed`,
`DateVoided`, plus a `VoidReason` lookup of predefined reasons and a
`VoidedItems` report. Their own hint text: "Add void reasons in Management
section to improve and speed up the void process."

Dzeline voids with no reason and no separate record. A void is exactly where
theft hides, so it is the one action that most deserves an audit trail.

### 6. Price lists

`PriceList` / `PriceListItem`, attachable to a **cash register** *or* a
**customer**. That is wholesale-vs-retail pricing, and per-customer negotiated
pricing, in one mechanism.

Dzeline has a single price per product.

### 7. Granular, per-action permissions

Ours is six fixed roles mapping to seven coarse features. Theirs is per-action
with an access level, and the actions are the right ones: void order, void item,
lock sale, split order, apply discount, delete document, end of day, refund,
**change price**, view all open orders, view sales history, reprint receipt.

"Change price" and "reprint receipt" in particular are actions Dzeline currently
allows anyone who can reach the screen.

### 8. Stock control fields we half-have

`StockControl` carries `ReorderPoint`, **`PreferredQuantity`**,
`IsLowStockWarningEnabled`, `LowStockWarningQuantity` — per product, and
optionally per customer.

We have `reorder_level`. `PreferredQuantity` is the missing half: it is what the
order builder should propose ordering *up to*, instead of our current guess of
`reorder_level - stock + 5`.

### 9. Expiry dates, surfaced

A whole module (`Aronium.Pos.ExpirationDate`), a
`DocumentItemExpirationDate` table and a `ProductsExpirationDate` report.

We already *capture* expiry on receiving and have never shown it anywhere — it is
in our Known Issues. They prove the shape of the answer: a report, and warnings.

### 10. Reports as templates, not code

67 FastReport `.frx` templates, editable without recompiling. Ours are React
components — every new report is a code change and a deploy.

The breadth is also instructive. Beyond what we have: `SalesHourly` (when is the
shop busy — staffing), `SalesUsers` (per-cashier performance), `ProfitMargin`,
`LowStockWarning`, `ReorderProductList`, `ProductsPriceTags` (printable shelf
labels), `StockMovement`, `SalesUnpaid`.

### Also worth noting

- **Moving average price** as a costing method (`Aronium.Pos.MovingAveragePrice`).
  We overwrite `cost_price` with the latest purchase cost, which makes COGS jump
  whenever a supplier's price moves. Moving average is the standard fix.
- **Sentry** is shipped in their binaries — the same error tracking sitting in
  our production TODO list. Reasonable validation that it is worth doing.
- **Rounding rules per payment type** (`RoundingIncrement`, `RoundingRule`,
  `RoundingAdjustment` on `Payment`). Relevant wherever coins below a
  denomination are not in circulation.
- **Multiple taxes** per product, where we assume one VAT rate.

## What is theirs and should stay theirs

Not everything they have is worth wanting:

- **Floor plans, tables, open orders, takeaway, courses, kitchen printers** — a
  restaurant product. A supermarket does not seat customers. Skip all of it.
  (The one idea worth stealing from that cluster is **parking a sale**: the
  customer goes back for milk, you hold the basket and serve the next person.)
- **Fiscal printers** — an EU compliance model. We have eTIMS, which is the
  correct Kenyan equivalent and which they do not have.
- **The workflow engine** (26 `.wf` files defining flows as data with task graphs
  and transitions). Genuinely interesting, and the wrong trade for us: it buys
  runtime-configurable flows at the cost of a large amount of machinery. Our
  flows are not configured per customer.
- **SQL Server + installer + 611MB**. Our PWA installs in seconds and runs on a
  phone. This is our advantage, not a gap.

## Where we are ahead

Worth stating so the plan does not become "copy Aronium":

- **Offline-first.** Theirs needs its server; ours keeps selling with no network
  at all. In this market that is the difference between trading and not.
- **Any device.** Phone, tablet, desktop, one codebase. They are Windows only.
- **M-Pesa, Pochi, and SMS reconciliation.** They have nothing equivalent — it is
  not their market.
- **KRA eTIMS.**
- **Multi-device sync as a normal condition**, not a networked-terminal special case.
- **Cost of ownership.** No SQL Server licence, no installer, no per-terminal setup.

---

## Phased plan

Ordered by value to the shop per unit of work, not by how interesting it is.

### Phase 1 — Correctness — **done 2026-09-26**

| Item | Work |
|---|---|
| Refunds restore stock | Turn void into a proper refund: put quantities back, record it as its own record rather than a flag, and leave an audit trail. Fixes drifting stock counts and the reorder figures computed from them. |
| Void reasons | A reason on every void, with a short editable list of predefined reasons. One new table or a column plus a lookup. |

Do this first because every day it is not done, inventory drifts further and the
new cover/velocity numbers are computed from a wrong stock figure.

### Phase 2 — Cash reconciliation — **done 2026-09-26**

| Item | Work |
|---|---|
| Shift open with counted float | Starting cash per user per day |
| Cash in / cash out | With reason, during the shift |
| Cash out / close | Counted vs expected vs difference, per cashier |
| X / Z report | The end-of-day print an owner actually reads |

New tables, a new screen, and a report. This is the feature that lets an owner
trust the till, and it is the clearest thing Aronium has that we do not.

### Phase 3 — Selling flexibility

| Item | Work |
|---|---|
| Discounts | Per line and per cart, percent or amount, permission-gated, recorded separately so margin reporting stays honest |
| Park / resume a sale | Hold a basket, serve the next customer, come back |
| Price lists | Wholesale vs retail as a second price, selectable at the till |

Discounts first — a cashier editing the product price to do a deal is a live
problem today.

### Phase 4 — Customer accounts — **dropped**

Decided 2026-09-26: the shops are against selling on credit. Their reasoning is
that letting goods leave without confirming payment is neither financially
sound nor practical for them, so the whole feature — customer balances, credit
as a payment type, collections — is off the roadmap rather than deferred.

Worth revisiting only if a client asks for it directly. Nothing else in the plan
depended on it.

### Phase 4b — Paying suppliers — **done 2026-09-26**

Not from Aronium; raised directly. The order lifecycle now runs all the way to
settlement: raise an order, see it due, receive it, activate it into stock, and
then see what was billed and pay it. See "Supplier payments" in
[ARCHITECTURE.md](ARCHITECTURE.md).

### Phase 5 — Stock depth

| Item | Work |
|---|---|
| Preferred quantity | Order *up to* a level rather than guessing |
| Expiry surfaced | The data is already captured — a report and a warning |
| Moving average cost | Stop COGS jumping when a supplier's price moves |
| Shelf label / price tag printing | They have a template; we print receipts already |

### Phase 6 — Reporting breadth

| Item | Work |
|---|---|
| Sales by hour | Staffing decisions |
| Sales by cashier | Performance, and a second check on cash differences |
| A report template mechanism | So a new report stops being a code change and a deploy |

The template mechanism is the strategic item here; the individual reports are
cheap once it exists.

### Deliberately unscheduled

Restaurant features, fiscal printers, the workflow engine, and anything that
would compromise offline-first.

## Two things to verify before building

- **The shift model is decided: per user, per day.** One person legitimately
  moves between devices during a day — a phone while handling suppliers in the
  morning, a desktop at the counter during the rush — so a shift that belonged
  to a device would split one person's takings across two records and reconcile
  neither. Per user per day follows the money and the accountability, which is
  the point of the exercise. (Decided 2026-09-26.)
- ~~Credit sales and eTIMS~~ — moot, now that credit is dropped.
