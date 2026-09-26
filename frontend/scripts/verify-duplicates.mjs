/**
 * Duplicate products: not created, and found when they already exist.
 *
 *   npm run dev                 # one terminal
 *   npm run verify:duplicates   # another
 *
 * A duplicated product splits its stock between two rows, so neither is ever low
 * enough to trigger a reorder and the shelf runs empty while the system reports
 * plenty. They arrived from three directions - importing twice, two staff each
 * adding the same item, and sync pulling each device's copy onto the other - so
 * all three are checked here, against the same shared definition of identity.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const API_HOST = "dzeline-api.onrender.com";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// What the server hands back when the devices pull. Set per case.
let cloudProducts = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();
  if (!url.includes(API_HOST)) return route.abort();
  const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const path = new URL(url).pathname;
  if (path.startsWith("/products")) {
    if (route.request().method() !== "GET") return json({ id: 1, ok: true });
    return json(cloudProducts);
  }
  return json([]);
});

const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);

// ── the definition ──────────────────────────────────────────────────────────
console.log("");
console.log("-- when two products are the same product --");
const identity = await page.evaluate(async () => {
  const m = await import("/src/utils/productIdentity.js");
  const p = (name, barcode, extra = {}) => ({ name, barcode, ...extra });
  return {
    sameBarcode: m.sameProduct(p("Blue Band 250g", "6001"), p("BLUEBAND 250G", "6001")),
    differentBarcode: m.sameProduct(p("Blue Band 250g", "6001"), p("Blue Band 250g", "6002")),
    sameNameNoBarcodes: m.sameProduct(p("Sugar 1kg", ""), p("  sugar   1KG "), {}),
    differentName: m.sameProduct(p("Sugar 1kg", ""), p("Sugar 2kg", "")),
    oneHasBarcode: m.sameProduct(p("Sugar 1kg", "6009"), p("sugar 1kg", "")),
    // The fabricated barcodes the old add form produced.
    fabricated: m.realBarcode(p("x", String(Date.now()))),
    realKenyan: m.realBarcode(p("x", "6161117772045")),
    twoFabricatedSameName: m.sameProduct(
      p("Blue Band 250g", "1790416489648"),
      p("blue band 250g", "1790416500000"),
    ),
    emptyNames: m.sameProduct(p("", ""), p("", "")),
    groups: m.findDuplicateGroups([
      { id: 1, name: "Sugar 1kg", stock: 5 },
      { id: 2, name: "SUGAR 1KG", stock: 7 },
      { id: 3, name: "Blue Band", barcode: "6001", stock: 2 },
      { id: 4, name: "Blue Band 500g", barcode: "6001", stock: 3 },
      { id: 5, name: "Salt", barcode: "6002", stock: 9 },
    ]).map((g) => ({ ids: g.products.map((x) => x.id), totalStock: g.totalStock })),
  };
});

check("the same barcode means the same product, whatever it is called",
  identity.sameBarcode === true);
check("different barcodes are never the same product, even with the same name",
  identity.differentBarcode === false);
check("with no barcodes, the name decides", identity.sameNameNoBarcodes === true);
check("a different name is a different product", identity.differentName === false);
check("a barcode on one side only still matches by name", identity.oneHasBarcode === true);
check("a barcode the old form invented is treated as absent",
  identity.fabricated === null, String(identity.fabricated));
check("a real Kenyan barcode is kept", identity.realKenyan === "6161117772045",
  String(identity.realKenyan));
check("two invented barcodes do not hide a duplicate", identity.twoFabricatedSameName === true);
check("two nameless, barcodeless rows are not declared identical",
  identity.emptyNames === false);
check("duplicate groups are found by name and by barcode",
  identity.groups.length === 2
  && identity.groups.some((g) => g.ids.join(",") === "1,2" && g.totalStock === 12)
  && identity.groups.some((g) => g.ids.join(",") === "3,4" && g.totalStock === 5),
  JSON.stringify(identity.groups));

// ── sync ────────────────────────────────────────────────────────────────────
console.log("");
console.log("-- sync adopts this device's copy instead of duplicating it --");

async function pullWith(cloud, seed) {
  cloudProducts = cloud;
  return page.evaluate(async ({ seed }) => {
    const { syncService } = await import("/src/services/sync.js");
    const { db, dbHelpers } = await import("/src/services/db.js");
    await db.products.clear();
    await dbHelpers.saveApiKey("test-key");
    await dbHelpers.updateSetting("last_product_pull_at", "0");
    for (const row of seed) await db.products.add(row);
    await syncService.pullProducts();
    const all = await db.products.toArray();
    return all.map((p) => ({
      id: p.id, name: p.name, barcode: p.barcode ?? null,
      cloud_id: p.cloud_id ?? null, stock: p.stock,
    }));
  }, { seed });
}

// The exact scenario: this till added Blue Band itself, the other till added it
// too, and the other one reached the server first.
const adopted = await pullWith(
  [{ id: 4001, barcode: null, name: "Blue Band 250g", price: 180, cost_price: null, stock: 12,
     category: "Spreads", reorder_level: 10, active: true, updated_at: Date.now() }],
  [{ name: "Blue Band 250g", barcode: null, price: 180, stock: 4, category: "Spreads",
     reorder_level: 10, cloud_id: null, synced: false, updated_at: Date.now() }],
);
check("one product, not two", adopted.length === 1, `${adopted.length}: ${adopted.map((p) => p.name).join(", ")}`);
check("and this device's row now carries the cloud id",
  adopted[0]?.cloud_id === 4001, String(adopted[0]?.cloud_id));

// Matching by barcode, where the local row has the fabricated kind.
const adoptedByName = await pullWith(
  [{ id: 4002, barcode: "6161117772045", name: "Sugar 1kg", price: 175, cost_price: null, stock: 20,
     category: "Sugar", reorder_level: 10, active: true, updated_at: Date.now() }],
  [{ name: "Sugar 1kg", barcode: String(Date.now()), price: 175, stock: 6, category: "Sugar",
     reorder_level: 10, cloud_id: null, synced: false, updated_at: Date.now() }],
);
check("a locally invented barcode does not stop the match",
  adoptedByName.length === 1 && adoptedByName[0].cloud_id === 4002,
  `${adoptedByName.length} rows, cloud_id=${adoptedByName[0]?.cloud_id}`);

// A product genuinely different should still arrive.
const distinct = await pullWith(
  [{ id: 4003, barcode: "6009", name: "Cooking Oil 1L", price: 320, cost_price: null, stock: 8,
     category: "Oils", reorder_level: 6, active: true, updated_at: Date.now() }],
  [{ name: "Blue Band 250g", barcode: null, price: 180, stock: 4, category: "Spreads",
     reorder_level: 10, cloud_id: null, synced: false, updated_at: Date.now() }],
);
check("a genuinely new product is still added", distinct.length === 2,
  distinct.map((p) => p.name).join(", "));

// Two cloud rows for one product - a duplicate that already exists on the
// server. The device must not turn two into three.
const serverDupes = await pullWith(
  [
    { id: 4004, barcode: null, name: "Omo 500g", price: 150, cost_price: null, stock: 5,
      category: "Cleaning", reorder_level: 10, active: true, updated_at: Date.now() },
    { id: 4005, barcode: null, name: "OMO 500G", price: 150, cost_price: null, stock: 7,
      category: "Cleaning", reorder_level: 10, active: true, updated_at: Date.now() },
  ],
  [],
);
check("two cloud rows for one product land as one local product",
  serverDupes.length === 1, `${serverDupes.length}: ${JSON.stringify(serverDupes)}`);

// Pulling the same thing twice must not add it again.
cloudProducts = [{ id: 4006, barcode: "6003", name: "Salt 500g", price: 40, cost_price: null,
  stock: 30, category: "Other", reorder_level: 10, active: true, updated_at: Date.now() }];
const repeated = await page.evaluate(async () => {
  const { syncService } = await import("/src/services/sync.js");
  const { db, dbHelpers } = await import("/src/services/db.js");
  await db.products.clear();
  await dbHelpers.updateSetting("last_product_pull_at", "0");
  await syncService.pullProducts();
  const first = await db.products.count();
  await dbHelpers.updateSetting("last_product_pull_at", "0");
  await syncService.pullProducts();
  return { first, second: await db.products.count() };
});
check("pulling the same product twice does not add it twice",
  repeated.first === 1 && repeated.second === 1,
  `${repeated.first} then ${repeated.second}`);

// ── the add form ────────────────────────────────────────────────────────────
console.log("");
console.log("-- the add form knows the product is already there --");
const form = await page.evaluate(async () => {
  const { db } = await import("/src/services/db.js");
  const { indexByIdentity, findMatch } = await import("/src/utils/productIdentity.js");
  await db.products.clear();
  await db.products.add({ name: "Blue Band 250g", barcode: "6161117772045", price: 180,
    stock: 4, category: "Spreads", reorder_level: 10 });
  await db.products.add({ name: "Sugar 1kg", barcode: null, price: 175,
    stock: 9, category: "Sugar", reorder_level: 10 });
  const index = indexByIdentity(await db.products.toArray());
  return {
    typedSameName: findMatch(index, { name: "blue band 250g", barcode: "" })?.name ?? null,
    scannedBarcode: findMatch(index, { name: "Anything", barcode: "6161117772045" })?.name ?? null,
    typedUnbarcoded: findMatch(index, { name: "SUGAR  1KG", barcode: "" })?.name ?? null,
    genuinelyNew: findMatch(index, { name: "Royco Cubes", barcode: "" }),
    // The shop has "Sugar 1kg" with no barcode; somebody now scans a real one and
    // types the same name. That is the existing product gaining a barcode, not a
    // new product, so flagging it is the useful answer - it sends them to the row
    // that is already there instead of creating its twin.
    sameNameNewBarcode: findMatch(index, { name: "Sugar 1kg", barcode: "6009999999999" })?.name ?? null,
    // Two products that both carry real, different barcodes are different items
    // however similar the names, and the form must not nag.
    twoRealBarcodes: findMatch(index, { name: "Blue Band 250g", barcode: "6009999999999" }),
  };
});
check("typing a name that exists is caught", form.typedSameName === "Blue Band 250g",
  String(form.typedSameName));
check("scanning a barcode that exists is caught, whatever the name says",
  form.scannedBarcode === "Blue Band 250g", String(form.scannedBarcode));
check("an unbarcoded product is caught by name, spacing and case ignored",
  form.typedUnbarcoded === "Sugar 1kg", String(form.typedUnbarcoded));
check("a genuinely new product raises nothing", form.genuinelyNew === null);
check("adding a barcode to a product that already exists is caught, not duplicated",
  form.sameNameNewBarcode === "Sugar 1kg", String(form.sameNameNewBarcode));
check("two different real barcodes are never flagged as the same product",
  form.twoRealBarcodes === null, JSON.stringify(form.twoRealBarcodes));

// ── the add form no longer invents barcodes ─────────────────────────────────
const invented = await page.evaluate(async () => {
  const res = await fetch("/src/components/ProductAddModal.jsx");
  const source = await res.text();
  return {
    // The code, not the word: the comment explaining the old behaviour mentions
    // it by name, and a substring search would find that instead.
    inventsBarcode: /barcode:\s*barcode\.trim\(\)\s*\|\|\s*String\(Date\.now\(\)\)/.test(source),
    nullsIt: /barcode:\s*barcode\.trim\(\)\s*\|\|\s*null/.test(source),
  };
});
console.log("");
console.log("-- and no longer invents a barcode --");
check("the timestamp fallback is gone", invented.inventsBarcode === false);
check("an empty barcode is stored as nothing", invented.nullsIt === true);

// -- merging the ones that already exist --------------------------------------
console.log("");
console.log("-- merging duplicates that already exist --");
const merge = await page.evaluate(async () => {
  const { db } = await import("/src/services/db.js");
  const { findDuplicates, suggestSurvivor, previewMerge, mergeProducts } =
    await import("/src/services/mergeProducts.js");

  await db.products.clear();
  await db.transaction_items.clear();
  await db.stock_receipt_items.clear();

  // One tin of Blue Band, entered three times on three different days. The stock
  // the shop actually has is 4 + 3 + 5 = 12, but no single row is low enough to
  // trigger its reorder level of 6.
  const a = await db.products.add({ name: "Blue Band 250g", barcode: null, price: 180,
    cost_price: null, stock: 4, category: "Other", reorder_level: 6, cloud_id: 7001 });
  const b = await db.products.add({ name: "BLUE BAND 250G", barcode: "6161117772045", price: 0,
    cost_price: 150, stock: 3, category: "Spreads", reorder_level: 6, cloud_id: null });
  const c = await db.products.add({ name: "blue band  250g", barcode: null, price: 185,
    cost_price: null, stock: 5, category: "Other", reorder_level: 10, cloud_id: 7002 });
  // And something that is genuinely its own product.
  const other = await db.products.add({ name: "Salt 500g", barcode: "6003", price: 40,
    stock: 20, category: "Other", reorder_level: 10 });

  // History against two of the three.
  const txn = await db.transactions.add({ timestamp: Date.now(), total: 180, subtotal: 155,
    vat: 25, payment_method: "CASH", synced: false });
  await db.transaction_items.add({ transaction_id: txn, product_id: a, name: "Blue Band 250g",
    quantity: 1, price: 180, subtotal: 180 });
  await db.transaction_items.add({ transaction_id: txn, product_id: c, name: "blue band  250g",
    quantity: 2, price: 185, subtotal: 370 });
  await db.stock_receipt_items.add({ receipt_id: 1, product_id: b, qty_added: 3, unit_cost: 150 });

  const groups = await findDuplicates();
  const group = groups[0];
  const suggested = suggestSurvivor(group.products);
  const preview = previewMerge(
    group.products.find((p) => p.id === suggested.id),
    group.products.filter((p) => p.id !== suggested.id),
  );

  const outcome = await mergeProducts(suggested.id, group.products.map((p) => p.id));
  const kept = await db.products.get(suggested.id);
  const remaining = await db.products.filter((p) => p.active !== false).toArray();
  const linesOnKept = await db.transaction_items.where("product_id").equals(suggested.id).toArray();
  const receiptLines = await db.stock_receipt_items.where("product_id").equals(suggested.id).toArray();
  const deadRows = await Promise.all([a, b, c].filter((id) => id !== suggested.id).map((id) => db.products.get(id)));

  await db.products.clear();
  await db.transaction_items.clear();
  await db.stock_receipt_items.clear();
  await db.transactions.clear();

  return {
    groupCount: groups.length,
    groupSize: group.products.length,
    totalStock: group.totalStock,
    suggestedIsB: suggested.id === b,
    preview,
    outcome,
    kept: { name: kept.name, stock: kept.stock, price: kept.price, barcode: kept.barcode,
            category: kept.category, reorder_level: kept.reorder_level, cost_price: kept.cost_price,
            synced: kept.synced },
    remainingNames: remaining.map((p) => p.name).sort(),
    keptLines: linesOnKept.length,
    keptReceiptLines: receiptLines.length,
    deadRows: deadRows.map((p) => ({ active: p.active, stock: p.stock, deleted: p.deleted_at != null })),
    otherUntouched: (await db.products.get(other)) === undefined,
  };
});

check("the three entries are found as one group",
  merge.groupCount === 1 && merge.groupSize === 3, `${merge.groupCount} groups of ${merge.groupSize}`);
check("the group reports the stock the shop really has",
  merge.totalStock === 12, `${merge.totalStock}`);
check("the row with a real barcode is suggested as the one to keep", merge.suggestedIsB === true);
check("stock is added together, because the stock is on the shelf",
  merge.kept.stock === 12, `${merge.kept.stock}`);
check("the survivor keeps its barcode", merge.kept.barcode === "6161117772045", merge.kept.barcode);
check("a survivor with no price takes one that exists",
  merge.kept.price === 180 || merge.kept.price === 185, String(merge.kept.price));
check("its own cost price is not overwritten", merge.kept.cost_price === 150,
  String(merge.kept.cost_price));
check("a real category beats 'Other'", merge.kept.category === "Spreads", merge.kept.category);
check("the reorder level is the highest of the group", merge.kept.reorder_level === 10,
  String(merge.kept.reorder_level));
check("only one Blue Band is left", merge.remainingNames.filter((n) => /blue band/i.test(n)).length === 1,
  merge.remainingNames.join(", "));
check("the unrelated product is untouched", merge.remainingNames.includes("Salt 500g"));
check("past sale lines now point at the surviving product", merge.keptLines === 2,
  `${merge.keptLines}`);
check("so does the delivery line", merge.keptReceiptLines === 1, `${merge.keptReceiptLines}`);
check("the merged rows are tombstoned, not deleted outright",
  merge.deadRows.every((r) => r.active === false && r.deleted === true),
  JSON.stringify(merge.deadRows));
check("and their stock is zeroed so it cannot be counted twice",
  merge.deadRows.every((r) => r.stock === 0), JSON.stringify(merge.deadRows.map((r) => r.stock)));
check("the survivor is marked unsynced so other devices learn about it",
  merge.kept.synced === false, String(merge.kept.synced));
// Two lines move, not three: the delivery line was already against the row that
// survived, so it needed nothing done to it.
check("the outcome reports what it did",
  merge.outcome.mergedCount === 2 && merge.outcome.stock === 12 && merge.outcome.movedLines === 2,
  JSON.stringify(merge.outcome));

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All duplicate checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
