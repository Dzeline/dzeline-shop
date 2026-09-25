/**
 * Backup and restore — a full round trip.
 *
 *   npm run dev             # one terminal
 *   npm run verify:backup   # another
 *
 * The standing rule from the backup plan is that a backup nobody has restored
 * is not a backup. So this does not check that a file was produced: it wipes
 * the database, restores the file over the empty one, and checks the numbers a
 * shop would check — the sales total, the stock count, the supplier balance.
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
  const tx = db.transaction(["settings", "staff", "products", "suppliers"], "readwrite");
  const put = (s, v) => r2p(tx.objectStore(s).put(v));
  await put("settings", { key: "setup_complete", value: "true" });
  await put("settings", { key: "shop_name", value: "Mama Njeri Stores" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now() });
  await put("products", {
    id: 1, barcode: "6000000000001", name: "Maize Flour 2kg", price: 195, cost_price: 150,
    stock: 40, category: "Grains", reorder_level: 10, active: true, updated_at: Date.now(),
    image_blob: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  });
  await put("products", {
    id: 2, barcode: "6000000000002", name: "Sugar 1kg", price: 175, cost_price: 140,
    stock: 25, category: "Sugar", reorder_level: 10, active: true, updated_at: Date.now(),
  });
  await put("suppliers", {
    id: 1, name: "Mwangi Wholesalers", phone: "0722000000", created_at: Date.now(),
    pay_method: "mpesa_paybill", pay_account: "400200", pay_name: "Mwangi Ltd",
    cloud_id: null, updated_at: Date.now(), deleted_at: null, synced: false,
  });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const { backup } = await import("/src/services/backup.js");
  const { dbHelpers, db } = await import("/src/services/db.js");
  const { supplierLedger } = await import("/src/services/supplierLedger.js");
  const { shifts } = await import("/src/services/shifts.js");
  const r = {};

  // ── build a shop worth losing ───────────────────────────────────────────
  const shift = await shifts.open({ staff_id: 1, staff_name: "Admin", opening_float: 2000 });
  for (let i = 0; i < 4; i++) {
    await dbHelpers.completeTransaction(
      [{ id: 1, name: "Maize Flour 2kg", price: 195, quantity: 2, stock: 40 }],
      { method: "CASH", amount: 390, change: 0, subtotal: 336, vat: 54, total: 390 },
      1,
    );
  }
  const receiptId = await dbHelpers.addStockReceipt({
    supplier: "Mwangi Wholesalers", supplier_id: 1, invoice_number: "INV-9001",
    photo_blob: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    staff_id: 1, items: [{ product_id: 1, qty_added: 20, unit_cost: 152, condition: "good" }],
  });
  await dbHelpers.activateStockReceipt(receiptId, {});
  await supplierLedger.setInvoiceAmount(receiptId, 3040);
  await supplierLedger.recordPayment({ receipt_id: receiptId, amount: 1000, method: "cash", staff_id: 1 });

  // the numbers a shop would check after a restore
  const before = {
    sales: await db.transactions.count(),
    salesTotal: (await db.transactions.toArray()).reduce((s, t) => s + (t.total ?? 0), 0),
    flourStock: (await db.products.get(1)).stock,
    supplierOwed: (await supplierLedger.getSupplierHistory(1)).balance.outstanding,
    shiftExpected: (await shifts.summarise(shift)).expectedCash,
    photoKept: Boolean((await db.stock_receipts.get(receiptId)).photo_blob),
  };
  r.before = before;

  // ── export ──────────────────────────────────────────────────────────────
  const withPhotos = await backup.create({ includePhotos: true });
  r.metaShop = withPhotos.meta.shop_name;
  r.metaSchema = withPhotos.meta.schema_version;
  r.countedSales = withPhotos.meta.counts.transactions;
  r.hasPhotoInFile = Boolean(withPhotos.tables.stock_receipts[0].photo_blob);
  r.filename = backup.filename(withPhotos.meta);

  const noPhotos = await backup.create({ includePhotos: false });
  r.photoStripped = noPhotos.tables.stock_receipts[0].photo_blob === null;
  r.productImageStripped = noPhotos.tables.products.find((p) => p.id === 1).image_blob === null;
  // stripping must not lose the row itself
  r.noPhotoStillHasRows = noPhotos.tables.stock_receipts.length === withPhotos.tables.stock_receipts.length;
  r.smaller = JSON.stringify(noPhotos).length < JSON.stringify(withPhotos).length;

  // print_jobs is an outbox — restoring one would reprint old receipts
  r.excludesPrintJobs = withPhotos.tables.print_jobs === undefined;

  // ── inspect before trusting ─────────────────────────────────────────────
  const summary = backup.inspect(withPhotos);
  r.summaryShop = summary.shopName;
  r.summarySales = summary.sales;

  try { backup.inspect({ nonsense: true }); r.rejectsJunk = false; } catch { r.rejectsJunk = true; }
  try {
    backup.inspect({ meta: { format: 1, schema_version: 9999, counts: {} }, tables: {} });
    r.rejectsNewer = false;
  } catch { r.rejectsNewer = true; }

  r.backupDeviceId = withPhotos.meta.device_id;

  // ── the disaster: wipe everything ───────────────────────────────────────
  for (const t of backup.BACKUP_TABLES) {
    try { await db.table(t).clear(); } catch { /* table may not exist */ }
  }
  r.wipedSales = await db.transactions.count();
  r.wipedProducts = await db.products.count();

  // This is now a new phone as far as the app is concerned: it mints itself a
  // fresh identity on first use. Restoring the old phone's file must not make
  // it start claiming to BE the old phone — sync uses this id to tell its own
  // rows from another till's.
  const freshId = await dbHelpers.getDeviceId();
  r.freshIdDiffers = freshId !== r.backupDeviceId;

  // ── restore ─────────────────────────────────────────────────────────────
  const result = await backup.restore(withPhotos);
  r.restoredRows = Object.values(result.restored).reduce((a, b) => a + b, 0);

  const after = {
    sales: await db.transactions.count(),
    salesTotal: (await db.transactions.toArray()).reduce((s, t) => s + (t.total ?? 0), 0),
    flourStock: (await db.products.get(1)).stock,
    supplierOwed: (await supplierLedger.getSupplierHistory(1)).balance.outstanding,
    photoKept: Boolean((await db.stock_receipts.get(receiptId)).photo_blob),
  };
  r.after = after;

  const restoredShift = (await db.shifts.toArray())[0];
  r.shiftExpectedAfter = restoredShift ? (await shifts.summarise(restoredShift)).expectedCash : null;

  // the restored device keeps its OWN identity, not the backup's
  const afterId = await dbHelpers.getDeviceId();
  r.deviceIdKept = afterId === freshId;
  r.didNotAdoptBackupId = afterId !== r.backupDeviceId;
  // and forgets its pull watermarks so it re-syncs from scratch
  r.watermarkCleared = (await dbHelpers.getSetting("last_txn_pull_at")) == null;

  // a no-photo backup restores everything except the pictures
  await backup.restore(noPhotos);
  r.noPhotoRestoresRows = (await db.transactions.count()) === before.sales;
  r.noPhotoHasNoPicture = (await db.stock_receipts.get(receiptId)).photo_blob === null;

  return r;
});

console.log("\n── the file describes itself ──");
check("the shop is named", out.metaShop === "Mama Njeri Stores", out.metaShop);
check("the schema version travels with it", out.metaSchema >= 19, `v${out.metaSchema}`);
check("row counts are recorded", out.countedSales === out.before.sales, `${out.countedSales}`);
check("the filename is recognisable", /mama-njeri-stores-backup-\d{4}-\d{2}-\d{2}\.json/.test(out.filename), out.filename);
check("the transient print queue is excluded", out.excludesPrintJobs);

console.log("\n── photos are optional ──");
check("a full backup keeps the invoice photo", out.hasPhotoInFile);
check("'without photos' strips invoice photos", out.photoStripped);
check("...and product images", out.productImageStripped);
check("but keeps every row", out.noPhotoStillHasRows);
check("and is smaller", out.smaller);

console.log("\n── a file is inspected before it is trusted ──");
check("the summary names the shop", out.summaryShop === "Mama Njeri Stores", out.summaryShop);
check("and counts the sales", out.summarySales === out.before.sales, `${out.summarySales}`);
check("junk is refused", out.rejectsJunk);
check("a backup from a newer app version is refused", out.rejectsNewer);

console.log("\n── wipe, then restore ──");
check("the wipe really emptied it", out.wipedSales === 0 && out.wipedProducts === 0,
  `${out.wipedSales} sales, ${out.wipedProducts} products`);
check("rows come back", out.restoredRows > 0, `${out.restoredRows} rows`);

console.log("\n── the numbers a shop would check ──");
check("sales count matches", out.after.sales === out.before.sales,
  `${out.before.sales} → ${out.after.sales}`);
check("sales total matches to the shilling", Math.abs(out.after.salesTotal - out.before.salesTotal) < 0.01,
  `${out.before.salesTotal} → ${out.after.salesTotal}`);
check("stock count matches", out.after.flourStock === out.before.flourStock,
  `${out.before.flourStock} → ${out.after.flourStock}`);
check("what the supplier is owed matches", Math.abs(out.after.supplierOwed - out.before.supplierOwed) < 0.01,
  `${out.before.supplierOwed} → ${out.after.supplierOwed}`);
check("the shift still reconciles to the same figure", out.shiftExpectedAfter === out.before.shiftExpected,
  `${out.before.shiftExpected} → ${out.shiftExpectedAfter}`);
check("the invoice photo survived", out.after.photoKept);

console.log("\n── the restored device is still itself ──");
check("the wiped device mints a new identity", out.freshIdDiffers);
check("it keeps that identity through the restore", out.deviceIdKept);
check("it does not adopt the dead phone's identity", out.didNotAdoptBackupId);
check("and re-syncs from scratch", out.watermarkCleared);

console.log("\n── restoring a no-photo backup ──");
check("everything else still comes back", out.noPhotoRestoresRows);
check("the picture is simply absent", out.noPhotoHasNoPicture);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All backup checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
