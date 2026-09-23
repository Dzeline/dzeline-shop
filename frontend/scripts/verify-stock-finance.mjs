/**
 * Checks the reorder-decision work: the price suggestion on stock activation,
 * and the rebuilt Finance panels.
 *
 *   npm run dev                          # one terminal
 *   npm run verify:stock-finance         # another
 *
 * Seeds a catalogue, a fortnight of sales and one pending delivery, then drives
 * the real screens. Screenshots land in scripts/screenshots/.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = "scripts/screenshots";
mkdirSync(OUT, { recursive: true });

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Offline: the backend is suspended, and its retries would compete with the
// IndexedDB reads this suite measures.
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const r2p = (r) =>
    new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const db = await r2p(indexedDB.open("DzelineShop"));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234"));
  const pin = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const DAY = 86400000;
  const now = Date.now();

  const tx = db.transaction(
    [
      "settings", "staff", "products", "transactions", "transaction_items",
      "stock_receipts", "stock_receipt_items",
    ],
    "readwrite",
  );
  const put = (store, v) => r2p(tx.objectStore(store).put(v));

  await put("settings", { key: "setup_complete", value: "true" });
  await put("settings", { key: "shop_name", value: "Demo Shop" });
  await put("settings", { key: "vat_enabled", value: "true" });
  await put("settings", { key: "vat_rate", value: "0.16" });
  await put("settings", { key: "default_margin", value: "0.25" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: now });

  // Chosen so the panels have something to say: fast movers on thin cover,
  // slow movers sitting on months of stock, and a fat-margin low-volume line.
  const catalogue = [
    { id: 1, name: "Maize Flour 2kg", cost: 150, price: 195, stock: 8,   perDay: 14 },
    { id: 2, name: "Cooking Oil 1L",  cost: 280, price: 380, stock: 6,   perDay: 9 },
    { id: 3, name: "Sugar 1kg",       cost: 140, price: 175, stock: 60,  perDay: 7 },
    { id: 4, name: "Bread",           cost: 55,  price: 70,  stock: 4,   perDay: 20 },
    { id: 5, name: "Rice 5kg",        cost: 700, price: 950, stock: 40,  perDay: 2 },
    { id: 6, name: "Tea Leaves 250g", cost: 120, price: 220, stock: 150, perDay: 1 },
    { id: 7, name: "Salt 1kg",        cost: 25,  price: 35,  stock: 200, perDay: 3 },
  ];
  for (const p of catalogue) {
    await put("products", {
      id: p.id,
      barcode: String(6000000000000 + p.id),
      name: p.name,
      price: p.price,
      cost_price: p.cost,
      stock: p.stock,
      category: "Grains",
      reorder_level: 10,
      active: true,
      updated_at: now,
    });
  }

  // A fortnight of sales
  let txnId = 1;
  let itemId = 1;
  for (let d = 13; d >= 0; d--) {
    const ts = now - d * DAY + 36000000;
    for (const p of catalogue) {
      const qty = p.perDay;
      const total = qty * p.price;
      await put("transactions", {
        id: txnId,
        timestamp: ts,
        total,
        subtotal: total / 1.16,
        vat: total - total / 1.16,
        payment_method: "CASH",
        synced: true,
        staff_id: 1,
        voided: false,
        etims_status: "pending",
        cloud_id: null,
        device_id: "seed",
      });
      await put("transaction_items", {
        id: itemId++,
        transaction_id: txnId,
        product_id: p.id,
        name: p.name,
        quantity: qty,
        price: p.price,
        subtotal: total,
        cost_price: p.cost,
      });
      txnId++;
    }
  }

  // One delivery waiting to be priced
  await put("stock_receipts", {
    id: 1,
    timestamp: now - 3600000,
    supplier: "Mwangi Wholesalers",
    supplier_id: null,
    invoice_number: "INV-4471",
    photo_blob: null,
    staff_id: 1,
    status: "draft",
    synced: false,
    device_id: "seed",
    cloud_id: null,
  });
  const delivery = [
    { product_id: 1, qty: 50, unit_cost: 152 },
    { product_id: 2, qty: 24, unit_cost: 291 },
    { product_id: 4, qty: 60, unit_cost: 57 },
  ];
  let riId = 1;
  for (const d of delivery) {
    const prod = catalogue.find((c) => c.id === d.product_id);
    await put("stock_receipt_items", {
      id: riId++,
      receipt_id: 1,
      product_id: d.product_id,
      product_name: prod.name,
      qty_added: d.qty,
      qty_before: prod.stock,
      unit_cost: d.unit_cost,
      selling_price: null,
      expiry_date: null,
      condition: "good",
    });
  }

  await new Promise((res) => {
    tx.oncomplete = res;
  });
  db.close();
});

await page.reload({ waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1200);
await page.click("text=Admin");
await page.waitForTimeout(400);
for (const d of "1234") {
  await page.keyboard.press(d);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(1000);

// ── Finance ────────────────────────────────────────────────────────────────
console.log("\n── Finance ──");
await page.click("nav >> text=Reports");
await page.waitForTimeout(500);
await page.click("text=Finance");
await page.waitForTimeout(900);
await page.click("text=This Week");
await page.waitForTimeout(1400);

check("restock panel is present", await page.isVisible("text=Restock first"));
check("profit concentration is present", await page.isVisible("text=Profit concentration"));
check("movers table is present", await page.isVisible("text=Movers"));

const body = await page.evaluate(() => document.body.innerText);
check("cover is expressed in days", /\d+\s*days|today|1 day/.test(body));
check("concentration states a share of gross profit", /% of gross profit/.test(body));

// Bread sells fastest against the least stock, so it should lead the list
const firstRestock = await page.evaluate(() => {
  const h = [...document.querySelectorAll("p")].find(
    (p) => p.textContent.trim() === "Restock first",
  );
  return h?.closest("div.bg-white")?.querySelectorAll("p.font-semibold")[0]?.textContent ?? null;
});
check("most urgent product leads the restock list", firstRestock === "Bread", `got "${firstRestock}"`);

await page.screenshot({ path: `${OUT}/finance-desktop.png`, fullPage: true });

// The new panels sit below the existing P&L cards — capture them on their own
// so the layout can be reviewed without scrolling a full-page image.
await page.evaluate(() => {
  const h = [...document.querySelectorAll("p")].find(
    (x) => x.textContent.trim() === "Restock first",
  );
  h?.closest("div.bg-white")?.scrollIntoView({ block: "start" });
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/finance-panels.png` });

const beforeSort = await page.evaluate(() => document.querySelector("table tbody tr td")?.textContent);
await page.click("th >> text=Margin");
await page.waitForTimeout(500);
const afterSort = await page.evaluate(() => document.querySelector("table tbody tr td")?.textContent);
check("sorting the movers table reorders it", beforeSort !== afterSort, `${beforeSort} → ${afterSort}`);

// The movers table has six columns. It may scroll sideways inside its own
// container, but it must never make the page itself scroll horizontally.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no page-level horizontal overflow at 390px", overflow <= 1, `${overflow}px`);
const tableScrolls = await page.evaluate(() => {
  const t = document.querySelector("table");
  const box = t?.parentElement;
  return box ? box.scrollWidth > box.clientWidth + 1 : false;
});
check("the table itself is the thing that scrolls", tableScrolls);
await page.screenshot({ path: `${OUT}/finance-phone.png` });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(500);

// ── Pricing suggestion ─────────────────────────────────────────────────────
console.log("\n── Stock activation pricing ──");
await page.click("nav >> text=Stock");
await page.waitForTimeout(600);
await page.click("text=Receiving");
await page.waitForTimeout(900);
await page.click("text=Mwangi Wholesalers");
await page.waitForTimeout(800);

const priceInputs = page.locator("input[type='number']");
const fieldCount = await priceInputs.count();
check("delivery lines render price fields", fieldCount >= 3, `${fieldCount} fields`);

// cost 152 @ 25% margin → 202.67 net → ×1.16 = 235.10 → rounds up to 240
const firstValue = await priceInputs.first().inputValue();
check("price field opens pre-filled, not blank", firstValue !== "", `"${firstValue}"`);
check("suggestion matches cost + margin + VAT", firstValue === "240", `expected 240, got "${firstValue}"`);

const panel = await page.evaluate(() => document.body.innerText);
check("margin of the suggested price is shown", /% margin/.test(panel));
check("profit per unit is shown", /profit each/.test(panel));
check("VAT-inclusive cost toggle is offered", /already include VAT/.test(panel));

await page.screenshot({ path: `${OUT}/receiving-pricing.png`, fullPage: true });

await browser.close();
console.log(
  "\n" +
    (failures.length === 0
      ? "All stock/finance checks passed."
      : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`),
);
process.exit(failures.length === 0 ? 0 : 1);
