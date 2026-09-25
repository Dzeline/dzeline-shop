/**
 * Voiding a sale puts the goods back on the shelf.
 *
 *   npm run dev              # one terminal
 *   npm run verify:refunds   # another
 *
 * This is the bug the Aronium comparison surfaced: the old void flipped a flag
 * and nothing else, so the stock count drifted further from reality with every
 * void — and the cover/velocity figures in Finance are computed from that
 * count. The checks below are the ones that would have caught it.
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
  await put("products", {
    id: 1, barcode: "6000000000001", name: "Maize Flour 2kg", price: 195, cost_price: 150,
    stock: 20, category: "Grains", reorder_level: 10, active: true, updated_at: Date.now(),
  });
  await put("products", {
    id: 2, barcode: "6000000000002", name: "Sugar 1kg", price: 175, cost_price: 140,
    stock: 30, category: "Sugar", reorder_level: 10, active: true, updated_at: Date.now(),
  });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const { dbHelpers, db } = await import("/src/services/db.js");
  const r = {};

  const sell = async () =>
    dbHelpers.completeTransaction(
      [
        { id: 1, name: "Maize Flour 2kg", price: 195, quantity: 3, stock: 20 },
        { id: 2, name: "Sugar 1kg", price: 175, quantity: 2, stock: 30 },
      ],
      { method: "CASH", amount: 935, change: 0, subtotal: 806, vat: 129, total: 935 },
      1,
    );

  // ── a sale reduces stock, and voiding puts it back ──────────────────────
  const sale = await sell();
  r.stockAfterSale = (await db.products.get(1)).stock;         // 20 - 3 = 17
  r.sugarAfterSale = (await db.products.get(2)).stock;         // 30 - 2 = 28

  const voided = await dbHelpers.voidTransaction(sale.id, {
    reason: "Customer changed their mind", staffId: 1, restock: true,
  });
  r.restoredLines = voided.restored;
  r.missingLines = voided.missing;
  r.stockAfterVoid = (await db.products.get(1)).stock;         // back to 20
  r.sugarAfterVoid = (await db.products.get(2)).stock;         // back to 30

  const row = await db.transactions.get(sale.id);
  r.marked = row.voided === true;
  r.reasonKept = row.void_reason;
  r.authorKept = row.voided_by;
  r.timeKept = typeof row.voided_at === "number";
  r.flaggedRestored = row.stock_restored === true;
  r.pushesAgain = row.synced === false;
  r.productMarkedUnsynced = (await db.products.get(1)).synced === false;

  // ── voiding twice must not restock twice ────────────────────────────────
  const second = await dbHelpers.voidTransaction(sale.id, { reason: "again", staffId: 1, restock: true });
  r.secondVoidNoop = second.alreadyVoided === true;
  r.stockAfterDoubleVoid = (await db.products.get(1)).stock;   // still 20

  // ── goods that are not coming back ──────────────────────────────────────
  const damaged = await sell();
  const before = (await db.products.get(1)).stock;
  await dbHelpers.voidTransaction(damaged.id, { reason: "Damaged goods", staffId: 1, restock: false });
  r.noRestockLeavesStock = (await db.products.get(1)).stock === before;
  const damagedRow = await db.transactions.get(damaged.id);
  r.noRestockRecorded = damagedRow.stock_restored === false;
  r.noRestockStillVoided = damagedRow.voided === true;

  // ── a line whose product is gone ────────────────────────────────────────
  const orphan = await sell();
  await db.products.delete(2);
  const orphanResult = await dbHelpers.voidTransaction(orphan.id, { reason: "Wrong item", staffId: 1, restock: true });
  r.orphanRestored = orphanResult.restored;   // flour only
  r.orphanMissing = orphanResult.missing;     // sugar is gone
  const orphanRow = await db.transactions.get(orphan.id);
  // It must NOT claim a clean restock when a line could not be put back
  r.orphanHonest = orphanRow.stock_restored === false;
  r.orphanStillVoided = orphanRow.voided === true;

  // ── reasons ─────────────────────────────────────────────────────────────
  const reasons = await dbHelpers.getVoidReasons();
  r.seededReasons = reasons.length;
  await dbHelpers.addVoidReason("Till error");
  await dbHelpers.addVoidReason("till error");   // same thing, different case
  r.afterAdding = (await dbHelpers.getVoidReasons()).length;

  return r;
});

console.log("\n── a void puts the goods back ──");
check("selling reduces stock", out.stockAfterSale === 17 && out.sugarAfterSale === 28,
  `flour ${out.stockAfterSale}, sugar ${out.sugarAfterSale}`);
check("voiding restores every line", out.stockAfterVoid === 20 && out.sugarAfterVoid === 30,
  `flour ${out.stockAfterVoid}, sugar ${out.sugarAfterVoid}`);
check("it reports what it restored", out.restoredLines === 2 && out.missingLines === 0,
  `${out.restoredLines} restored, ${out.missingLines} missing`);
check("the sale is marked voided", out.marked);
check("restored products re-sync", out.productMarkedUnsynced);
check("the void itself re-syncs", out.pushesAgain);

console.log("\n── the audit trail ──");
check("the reason is kept", out.reasonKept === "Customer changed their mind", out.reasonKept);
check("who voided it is kept", out.authorKept === 1, String(out.authorKept));
check("when is kept", out.timeKept);
check("and that the stock came back", out.flaggedRestored);

console.log("\n── things that would corrupt the count ──");
check("voiding twice is a no-op", out.secondVoidNoop);
check("and cannot restock twice", out.stockAfterDoubleVoid === 20, `${out.stockAfterDoubleVoid}`);
check("goods not coming back leave stock alone", out.noRestockLeavesStock);
check("and that is recorded, not assumed", out.noRestockRecorded);
check("the sale is still voided either way", out.noRestockStillVoided);

console.log("\n── a product that no longer exists ──");
check("the lines that can be restored are", out.orphanRestored === 1, `${out.orphanRestored}`);
check("the one that cannot is counted", out.orphanMissing === 1, `${out.orphanMissing}`);
check("and it does NOT claim a clean restock", out.orphanHonest);
check("the void still completes", out.orphanStillVoided);

console.log("\n── reasons ──");
check("a starting list is seeded", out.seededReasons >= 5, `${out.seededReasons}`);
check("a new reason is learned once, not twice", out.afterAdding === out.seededReasons + 1,
  `${out.seededReasons} → ${out.afterAdding}`);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All refund checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
