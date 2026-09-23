/**
 * Purchase order tracking.
 *
 *   npm run dev                          # one terminal
 *   npm run verify:purchase-orders       # another
 *
 * The matching logic runs against a real IndexedDB, so it is exercised in the
 * page rather than stubbed: Vite serves the source modules in dev, so the test
 * imports the actual service the app uses.
 *
 * What matters here is that "on order" is DERIVED. A flag somebody has to clear
 * by hand would drift out of step with reality within a week, which is the
 * failure this table exists to prevent.
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

await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1500);

// Seed a shop so the app is past its setup gate and the schema is open.
await page.evaluate(async () => {
  const r2p = (r) =>
    new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const db = await r2p(indexedDB.open("DzelineShop"));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234"));
  const pin = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tx = db.transaction(["settings", "staff", "products"], "readwrite");
  const put = (s, v) => r2p(tx.objectStore(s).put(v));
  await put("settings", { key: "setup_complete", value: "true" });
  await put("settings", { key: "shop_name", value: "Demo Shop" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now() });
  for (const p of [
    { id: 1, name: "Maize Flour 2kg", stock: 4 },
    { id: 2, name: "Cooking Oil 1L", stock: 2 },
  ]) {
    await put("products", {
      id: p.id, barcode: String(6000000000000 + p.id), name: p.name, price: 100,
      cost_price: 75, stock: p.stock, category: "Grains", reorder_level: 10,
      active: true, updated_at: Date.now(),
    });
  }
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
});
await page.reload({ waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1500);

const results = await page.evaluate(async () => {
  const { purchaseOrders, PO_STATUS } = await import("/src/services/purchaseOrders.js");
  const out = {};

  // An order for 50 flour and 12 oil
  const orderId = await purchaseOrders.create({
    supplier: "Mwangi Wholesalers",
    supplier_id: null,
    staff_id: 1,
    items: [
      { product_id: 1, name: "Maize Flour 2kg", qty: 50 },
      { product_id: 2, name: "Cooking Oil 1L", qty: 12 },
    ],
  });
  out.orderId = orderId;

  let map = await purchaseOrders.getOnOrderMap();
  out.onOrderFlour = map.get(1)?.qty ?? 0;
  out.onOrderOil = map.get(2)?.qty ?? 0;
  out.supplierNamed = map.get(1)?.orders?.[0]?.supplier ?? null;

  // A partial delivery: 20 of the 50 flour
  await purchaseOrders.applyDelivery([{ product_id: 1, qty: 20 }]);
  map = await purchaseOrders.getOnOrderMap();
  out.afterPartialFlour = map.get(1)?.qty ?? 0;
  let open = await purchaseOrders.getOpen();
  out.statusAfterPartial = open[0]?.status ?? null;

  // The rest of the flour, and all the oil — this completes the order
  await purchaseOrders.applyDelivery([
    { product_id: 1, qty: 30 },
    { product_id: 2, qty: 12 },
  ]);
  map = await purchaseOrders.getOnOrderMap();
  out.afterFullFlour = map.get(1)?.qty ?? 0;
  out.afterFullOil = map.get(2)?.qty ?? 0;
  open = await purchaseOrders.getOpen();
  out.openCountAfterFull = open.length;
  const history = await purchaseOrders.getHistory(5);
  out.statusAfterFull = history.find((o) => o.id === orderId)?.status ?? null;

  // Over-delivery must not produce a negative outstanding
  const second = await purchaseOrders.create({
    supplier: "Second Supplier", supplier_id: null, staff_id: 1,
    items: [{ product_id: 2, name: "Cooking Oil 1L", qty: 5 }],
  });
  await purchaseOrders.applyDelivery([{ product_id: 2, qty: 40 }]);
  const afterOver = await purchaseOrders.getHistory(5);
  const overOrder = afterOver.find((o) => o.id === second);
  out.overOutstanding = overOrder?.items?.[0]?.qty_outstanding ?? null;
  out.overStatus = overOrder?.status ?? null;

  // Oldest order settles first when two are open for the same product
  const a = await purchaseOrders.create({
    supplier: "Older", supplier_id: null, staff_id: 1,
    items: [{ product_id: 1, name: "Maize Flour 2kg", qty: 10 }],
  });
  await new Promise((r) => setTimeout(r, 25));
  const b = await purchaseOrders.create({
    supplier: "Newer", supplier_id: null, staff_id: 1,
    items: [{ product_id: 1, name: "Maize Flour 2kg", qty: 10 }],
  });
  await purchaseOrders.applyDelivery([{ product_id: 1, qty: 10 }]);
  const both = await purchaseOrders.getHistory(10);
  out.olderStatus = both.find((o) => o.id === a)?.status ?? null;
  out.newerOutstanding = both.find((o) => o.id === b)?.items?.[0]?.qty_outstanding ?? null;

  // Cancelling stops it counting as on order
  await purchaseOrders.close(b, { cancelled: true });
  map = await purchaseOrders.getOnOrderMap();
  out.onOrderAfterCancel = map.get(1)?.qty ?? 0;
  out.PO_RECEIVED = PO_STATUS.RECEIVED;

  return out;
});

console.log("\n── recording and deriving ──");
check("creating an order puts stock on order", results.onOrderFlour === 50, `${results.onOrderFlour}`);
check("every line is counted", results.onOrderOil === 12, `${results.onOrderOil}`);
check("the supplier is named for the alert badge", results.supplierNamed === "Mwangi Wholesalers", results.supplierNamed);

console.log("\n── deliveries close lines automatically ──");
check("a partial delivery reduces what is outstanding", results.afterPartialFlour === 30, `${results.afterPartialFlour}`);
check("the order is marked part-received", results.statusAfterPartial === "partially_received", results.statusAfterPartial);
check("completing every line clears on-order", results.afterFullFlour === 0 && results.afterFullOil === 0,
  `flour ${results.afterFullFlour}, oil ${results.afterFullOil}`);
check("a fully delivered order leaves the open list", results.openCountAfterFull === 0, `${results.openCountAfterFull} open`);
check("and is marked received", results.statusAfterFull === results.PO_RECEIVED, results.statusAfterFull);

console.log("\n── edges ──");
check("over-delivery never goes negative", results.overOutstanding === 0, `${results.overOutstanding}`);
check("over-delivered order still closes", results.overStatus === results.PO_RECEIVED, results.overStatus);
check("the oldest order settles first", results.olderStatus === results.PO_RECEIVED, results.olderStatus);
check("the newer order keeps waiting", results.newerOutstanding === 10, `${results.newerOutstanding}`);
check("a cancelled order stops counting as on order", results.onOrderAfterCancel === 0, `${results.onOrderAfterCancel}`);

// ── the badge the shopkeeper actually sees ────────────────────────────────
console.log("\n── in the app ──");
await page.click("text=Admin");
await page.waitForTimeout(400);
for (const d of "1234") { await page.keyboard.press(d); await page.waitForTimeout(90); }
await page.waitForTimeout(1000);

await page.evaluate(async () => {
  const { purchaseOrders } = await import("/src/services/purchaseOrders.js");
  await purchaseOrders.create({
    supplier: "Mwangi Wholesalers", supplier_id: null, staff_id: 1,
    items: [{ product_id: 1, name: "Maize Flour 2kg", qty: 40 }],
  });
});

await page.click("nav >> text=Stock");
await page.waitForTimeout(700);
await page.getByRole("button", { name: "Inventory", exact: true }).click();
await page.waitForTimeout(900);

const inventoryText = await page.evaluate(() => document.body.innerText);
check("low stock shows it is already ordered", /Ordered\s*·\s*40 due/.test(inventoryText));

const stockTabs = await page.evaluate(() => document.body.innerText);
check("the Orders tab carries a count", /Orders \(\d+\)/.test(stockTabs));

await page.getByRole("button", { name: /^Orders/ }).first().click();
await page.waitForTimeout(800);
const ordersText = await page.evaluate(() => document.body.innerText);
check("the open order is listed", /Mwangi Wholesalers/.test(ordersText));
check("it states what is still due", /still due/.test(ordersText));

await page.screenshot({ path: "scripts/screenshots/purchase-orders.png" });

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All purchase order checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
