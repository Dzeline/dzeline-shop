/**
 * Cash reconciliation — does the drawer match the sales?
 *
 *   npm run dev             # one terminal
 *   npm run verify:shifts   # another
 *
 * This is the figure an owner acts on, including by accusing someone of taking
 * money. It gets the same treatment as the rest of the money code: the
 * arithmetic is checked, and so is the thing that makes it trustworthy — that
 * expected cash is derived from the sales rather than accumulated as a running
 * total that can drift away from them.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const r2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await r2p(indexedDB.open("DzelineShop"));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234"));
  const pin = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tx = db.transaction(["settings", "staff", "products"], "readwrite");
  const put = (s, v) => r2p(tx.objectStore(s).put(v));
  await put("settings", { key: "setup_complete", value: "true" });
  await put("settings", { key: "shop_name", value: "Demo Shop" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now() });
  await put("staff", { id: 2, name: "Grace", pin, role: "cashier", active: 1, created_at: Date.now() });
  await put("products", {
    id: 1, barcode: "6000000000001", name: "Maize Flour 2kg", price: 100, cost_price: 75,
    stock: 500, category: "Grains", reorder_level: 10, active: true, updated_at: Date.now(),
  });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const { shifts, MOVEMENT } = await import("/src/services/shifts.js");
  const { dbHelpers, db } = await import("/src/services/db.js");
  const r = {};

  const sell = (method, qty, staffId) =>
    dbHelpers.completeTransaction(
      [{ id: 1, name: "Maize Flour 2kg", price: 100, quantity: qty, stock: 500 }],
      { method, amount: qty * 100, change: 0, subtotal: qty * 86.2, vat: qty * 13.8, total: qty * 100 },
      staffId,
    );

  // ── open with a float ───────────────────────────────────────────────────
  const shift = await shifts.open({ staff_id: 2, staff_name: "Grace", opening_float: 2000 });
  r.opened = shift.status === "open";
  r.floatKept = shift.opening_float;

  // opening again must not create a second shift for the same person and day
  const again = await shifts.open({ staff_id: 2, staff_name: "Grace", opening_float: 9999 });
  r.reopenSameShift = again.id === shift.id;
  r.floatNotOverwritten = again.opening_float === 2000;

  // ── only cash goes into the drawer ──────────────────────────────────────
  await sell("CASH", 3, 2);     // 300
  await sell("CASH", 2, 2);     // 200
  await sell("MPESA", 5, 2);    // 500 — not in the drawer
  await sell("POCHI", 1, 2);    // 100 — not in the drawer
  await sell("CASH", 4, 1);     // 400 — a DIFFERENT cashier

  let sum = await shifts.summarise(shift);
  r.cashSales = sum.salesByMethod.CASH;          // 500, not 900
  r.mpesaSeparate = sum.salesByMethod.MPESA;     // 500
  r.expectedAfterSales = sum.expectedCash;       // 2000 + 500
  r.countsOwnSalesOnly = sum.transactionCount;   // 4 (Grace's), not 5

  // ── cash in and out ─────────────────────────────────────────────────────
  await shifts.recordMovement({ shift_id: shift.id, type: MOVEMENT.OUT, amount: 150, reason: "paid for milk", staff_id: 2 });
  await shifts.recordMovement({ shift_id: shift.id, type: MOVEMENT.IN, amount: 50, reason: "float top-up", staff_id: 2 });
  sum = await shifts.summarise(shift);
  r.afterMovements = sum.expectedCash;           // 2500 - 150 + 50 = 2400

  try {
    await shifts.recordMovement({ shift_id: shift.id, type: MOVEMENT.OUT, amount: 100, reason: "  ", staff_id: 2 });
    r.rejectsBlankReason = false;
  } catch { r.rejectsBlankReason = true; }
  try {
    await shifts.recordMovement({ shift_id: shift.id, type: MOVEMENT.OUT, amount: -5, reason: "x", staff_id: 2 });
    r.rejectsNegative = false;
  } catch { r.rejectsNegative = true; }

  // ── a voided sale takes its money back out of expected ──────────────────
  const voidable = await sell("CASH", 6, 2);     // +600 -> 3000
  sum = await shifts.summarise(shift);
  r.beforeVoid = sum.expectedCash;
  await dbHelpers.voidTransaction(voidable.id, { reason: "Wrong item rung up", staffId: 2, restock: true });
  sum = await shifts.summarise(shift);
  r.afterVoid = sum.expectedCash;                // back to 2400
  r.voidCounted = sum.voidedCount;

  // ── a sale that syncs in late still counts ──────────────────────────────
  // Derived, not accumulated: a sale rung up on Grace's other device and pulled
  // afterwards must move the expected figure without anyone re-opening the shift.
  const now = Date.now();
  await db.transactions.add({
    timestamp: now, total: 700, subtotal: 603, vat: 97, payment_method: "CASH",
    synced: true, staff_id: 2, voided: false, etims_status: "pending",
    cloud_id: 9999, device_id: "the-other-device",
  });
  sum = await shifts.summarise(shift);
  r.afterForeignSale = sum.expectedCash;         // 2400 + 700 = 3100

  // ── close against a count ───────────────────────────────────────────────
  const closed = await shifts.close({ shift_id: shift.id, counted_cash: 3050, note: "50 missing" });
  r.closedStatus = closed.status;
  r.frozenExpected = closed.expected_cash;       // 3100
  r.difference = closed.difference;              // -50
  r.noteKept = closed.note;

  // frozen: a later sale must not rewrite a closed shift's figures
  await sell("CASH", 9, 2);
  const after = await db.shifts.get(shift.id);
  r.stillFrozen = after.expected_cash === 3100 && after.difference === -50;

  // closing twice must not change anything
  const twice = await shifts.close({ shift_id: shift.id, counted_cash: 1 });
  r.closeTwiceNoop = twice.expected_cash === 3100;

  // ── history and stale shifts ────────────────────────────────────────────
  const hist = await shifts.getHistory(10);
  const mine = hist.find((h) => h.id === shift.id);
  r.historyShowsShort = mine.balanced === false;

  // Admin sold 400 in cash earlier, so a balanced drawer is 1000 + 400 — not
  // the float. (The first draft of this test counted 1000 and the code
  // correctly called it 400 short.)
  const other = await shifts.open({ staff_id: 1, staff_name: "Admin", opening_float: 1000 });
  const otherSummary = await shifts.summarise(other);
  r.otherExpected = otherSummary.expectedCash;
  await shifts.close({ shift_id: other.id, counted_cash: otherSummary.expectedCash });
  const hist2 = await shifts.getHistory(10);
  r.balancedFlagged = hist2.find((h) => h.id === other.id).balanced === true;

  // a shift left open from an earlier day
  await db.shifts.add({
    staff_id: 2, staff_name: "Grace", business_date: "2020-01-01", opening_float: 100,
    opened_at: Date.now() - 86400000, closed_at: null, counted_cash: null,
    expected_cash: null, difference: null, note: null, status: "open",
    synced: false, cloud_id: null, device_id: "old",
  });
  r.staleFound = (await shifts.getStaleOpenShifts()).length;

  return r;
});

console.log("\n── opening ──");
check("a shift opens", out.opened);
check("the float is kept", out.floatKept === 2000, `${out.floatKept}`);
check("opening again returns the same shift", out.reopenSameShift);
check("and does not overwrite the float", out.floatNotOverwritten, `${out.floatNotOverwritten}`);

console.log("\n── only cash is in the drawer ──");
check("cash sales counted", out.cashSales === 500, `${out.cashSales}`);
check("M-Pesa reported separately, not in the drawer", out.mpesaSeparate === 500, `${out.mpesaSeparate}`);
check("expected = float + cash sales", out.expectedAfterSales === 2500, `${out.expectedAfterSales}`);
check("another cashier's sales are not counted", out.countsOwnSalesOnly === 4, `${out.countsOwnSalesOnly} sales`);

console.log("\n── cash in and out ──");
check("movements move the expected figure", out.afterMovements === 2400, `${out.afterMovements}`);
check("a movement without a reason is refused", out.rejectsBlankReason);
check("a negative movement is refused", out.rejectsNegative);

console.log("\n── voids ──");
check("a sale raises expected cash", out.beforeVoid === 3000, `${out.beforeVoid}`);
check("voiding it takes the money back out", out.afterVoid === 2400, `${out.afterVoid}`);
check("and the void is reported", out.voidCounted === 1, `${out.voidCounted}`);

console.log("\n── derived, not accumulated ──");
check("a sale synced from another device still counts", out.afterForeignSale === 3100, `${out.afterForeignSale}`);

console.log("\n── closing ──");
check("the shift closes", out.closedStatus === "closed", out.closedStatus);
check("expected is frozen at close", out.frozenExpected === 3100, `${out.frozenExpected}`);
check("the difference is recorded", out.difference === -50, `${out.difference}`);
check("the explanation is kept", out.noteKept === "50 missing", out.noteKept);
check("a later sale cannot rewrite a closed shift", out.stillFrozen);
check("closing twice changes nothing", out.closeTwiceNoop);

console.log("\n── the owner's read ──");
check("a short shift is flagged short", out.historyShowsShort);
check("a cashier's earlier sales are in their expected figure", out.otherExpected === 1400, `${out.otherExpected}`);
check("a balanced shift is flagged balanced", out.balancedFlagged);
check("a shift left open from an earlier day is surfaced", out.staleFound === 1, `${out.staleFound}`);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All shift checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
