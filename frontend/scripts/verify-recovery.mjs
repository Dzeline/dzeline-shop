/**
 * Recovering a shop onto an empty device.
 *
 *   npm run dev               # one terminal
 *   npm run verify:recovery   # another
 *
 * The backend is intercepted rather than mocked out: every request sync.js makes
 * is answered here with payloads shaped like the real FastAPI response models
 * (TransactionOut, StockReceiptOut, SupplierPaymentOut and friends), honouring
 * the same `since` and `limit` semantics. So the code under test is the real
 * pull path, headers and paging included.
 *
 * The fixture is built to catch the two failures the plan names: a history that
 * reaches back past the old 35-day floor, and more sales than fit in one page.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const API_HOST = "dzeline-api.onrender.com";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// ── the shop on the server ──────────────────────────────────────────────────
const products = [
  { id: 901, local_id: 1, device_id: "old-till", barcode: "6001", name: "Maize Flour 2kg", price: 195, cost_price: 150, stock: 40, category: "Grains", reorder_level: 10, active: true, image_blob: null, updated_at: NOW - 40 * DAY },
  { id: 902, local_id: 2, device_id: "old-till", barcode: "6002", name: "Sugar 1kg", price: 175, cost_price: 140, stock: 25, category: "Sugar", reorder_level: 10, active: true, image_blob: null, updated_at: NOW - 40 * DAY },
  { id: 903, local_id: 3, device_id: "old-till", barcode: "6003", name: "Cooking Oil 1L", price: 320, cost_price: 260, stock: 12, category: "Oils", reorder_level: 6, active: true, image_blob: null, updated_at: NOW - 2 * DAY },
];

const staff = [
  { id: 801, device_id: "old-till", local_id: 1, name: "Grace", pin_hash: "a".repeat(64), role: "admin", permissions: null, active: true, deleted_at: null, updated_at: NOW - 60 * DAY },
  { id: 802, device_id: "old-till", local_id: 2, name: "Otieno", pin_hash: "b".repeat(64), role: "cashier", permissions: null, active: true, deleted_at: null, updated_at: NOW - 60 * DAY },
];

const settings = {
  shop_name: "Mama Njeri Stores", town: "Nakuru", phone: "0722000000",
  kra_pin: "P051234567X", vat_enabled: true, vat_rate: 16, till_number: "123456",
  pochi_number: null, mpesa_till_type: "paybill", currency: "KES",
  settings_updated_at: NOW - 10 * DAY,
};

const suppliers = [
  { id: 701, device_id: "old-till", local_id: 1, name: "Mwangi Wholesalers", phone: "0733000000", email: null, notes: null, pay_method: "mpesa_paybill", pay_account: "400200", pay_name: "Mwangi Ltd", deleted_at: null, updated_at: NOW - 50 * DAY },
  { id: 702, device_id: "old-till", local_id: 2, name: "Rift Valley Grains", phone: "0744000000", email: null, notes: null, pay_method: "bank", pay_account: "0123456789", pay_name: "RVG Ltd", deleted_at: null, updated_at: NOW - 20 * DAY },
];

const receipts = [
  {
    id: 601, local_id: 1, device_id: "old-till", status: "activated",
    supplier: "Mwangi Wholesalers", supplier_id: 701, invoice_number: "INV-7001",
    staff_id: 801, created_at: NOW - 45 * DAY, activated_at: NOW - 45 * DAY,
    photo_blob: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    updated_at: NOW - 45 * DAY, order_id: null,
    invoice_amount: 4000, amount_paid: 0, payment_status: "unpaid",
    items: [{ product_id: null, cloud_product_id: 901, product_name: "Maize Flour 2kg", qty_added: 20, qty_before: 20, unit_cost: 152, selling_price: 195, expiry_date: null, condition: "good" }],
  },
  {
    id: 602, local_id: 2, device_id: "old-till", status: "activated",
    supplier: "Rift Valley Grains", supplier_id: 702, invoice_number: "INV-7002",
    staff_id: 801, created_at: NOW - 3 * DAY, activated_at: NOW - 3 * DAY,
    photo_blob: null, updated_at: NOW - 3 * DAY, order_id: null,
    invoice_amount: 2500, amount_paid: 0, payment_status: "unpaid",
    items: [{ product_id: null, cloud_product_id: 902, product_name: "Sugar 1kg", qty_added: 10, qty_before: 15, unit_cost: 140, selling_price: 175, expiry_date: null, condition: "good" }],
  },
];

// Paid by the owner from their own phone — the case that made payments sync.
const payments = [
  { id: 501, device_id: "owner-phone", local_id: 11, receipt_id: 601, supplier_id: 701, supplier: "Mwangi Wholesalers", amount: 1500, method: "mpesa", reference: "QGR1ABCD", note: null, staff_id: 801, paid_at: NOW - 40 * DAY, updated_at: NOW - 40 * DAY },
  { id: 502, device_id: "owner-phone", local_id: 12, receipt_id: 601, supplier_id: 701, supplier: "Mwangi Wholesalers", amount: 1000, method: "cash", reference: null, note: "part payment", staff_id: 801, paid_at: NOW - 30 * DAY, updated_at: NOW - 30 * DAY },
];

// 420 sales spread over 400 days. Two things follow: more than one 300-row page,
// and most of it older than the 35-day floor the old code stopped at.
const SALES = 420;
const transactions = Array.from({ length: SALES }, (_, i) => {
  const ts = NOW - (400 - i * (399 / (SALES - 1))) * DAY;
  const qty = (i % 3) + 1;
  const price = 195;
  const total = qty * price;
  return {
    id: 1000 + i,
    local_id: i + 1,
    device_id: "old-till",            // foreign to the recovering device
    timestamp: Math.round(ts),
    subtotal: Math.round(total / 1.16 * 100) / 100,
    vat: Math.round((total - total / 1.16) * 100) / 100,
    total,
    payment_method: i % 4 === 0 ? "MPESA" : "CASH",
    payment_amount: total, change_given: 0,
    mpesa_code: i % 4 === 0 ? `Q${i}XYZ` : null,
    staff_id: null, staff_name: i % 2 ? "Grace" : "Otieno",
    customer_name: null, customer_phone: null,
    etims_status: null, voided: false,
    synced_at: Math.round(ts), updated_at: Math.round(ts),
    items: [{ product_id: 901, cloud_product_id: 901, product_name: "Maize Flour 2kg", quantity: qty, price, subtotal: total, cost_price: 150 }],
  };
});
const oldestSaleAt = Math.min(...transactions.map((t) => t.timestamp));
const salesTotal = transactions.reduce((s, t) => s + t.total, 0);
const salesOlderThan35Days = transactions.filter((t) => t.timestamp < NOW - 35 * DAY).length;

// ── the fake backend ────────────────────────────────────────────────────────
//
// `serving` is closed while the device is being emptied. The app runs its own
// sync every 45 seconds, and the first attempt at this test had a background
// tick inserting rows into a half-cleared database — which is also a fair
// description of a real phone with no signal, so the pulls have to cope with
// being refused. `phase` tags each page so the paging assertions can look at
// the recovery run alone.
let requests = 0;
let serving = false;
let phase = "boot";
const pages = [];
const posted = [];   // every POST body the app sent, to check what it claims

function since(url) { return Number(new URL(url).searchParams.get("since") ?? 0); }
function limit(url) { return Number(new URL(url).searchParams.get("limit") ?? 1000); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

await ctx.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();
  if (!url.includes(API_HOST)) return route.abort();

  if (!serving) return route.abort();

  requests++;
  const path = new URL(url).pathname;
  const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  if (path.startsWith("/sync/transactions")) {
    // POST here is a push, not a page — counting it would make the paging
    // assertions meaningless.
    if (route.request().method() !== "GET") return json({ ok: true, id: 1 });
    const s = since(url);
    const lim = limit(url);
    // Exactly what the backend does: strictly newer than `since`, oldest first,
    // capped at `limit`.
    const rows = transactions.filter((t) => t.updated_at > s).sort((a, b) => a.updated_at - b.updated_at).slice(0, lim);
    pages.push({ phase, since: s, returned: rows.length });
    return json(rows);
  }
  if (path.startsWith("/products")) return json(products.filter((p) => p.updated_at > since(url)));
  if (path.startsWith("/staff")) return json(staff);
  if (path.startsWith("/settings")) return json(settings);
  if (path.startsWith("/suppliers")) return json(suppliers);
  if (path.startsWith("/stock-receipts")) return json(receipts.filter((r) => r.updated_at > since(url)));
  if (path.startsWith("/supplier-payments")) {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      posted.push({ path, body });
      return json({ id: 5900 + posted.length, ...body });
    }
    return json(payments.filter((p) => p.updated_at > since(url)));
  }
  if (path.startsWith("/print-jobs")) return json([]);
  if (path.startsWith("/mpesa/mode")) return json({ mode: "manual" });
  return json([]);
});

const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

// Empty the device with the network closed, so nothing arrives mid-wipe.
const emptied = await page.evaluate(async () => {
  const { backup } = await import("/src/services/backup.js");
  const { db, dbHelpers } = await import("/src/services/db.js");
  await backup.wipeShopData();
  // The key is saved *after* the wipe, exactly as joining does: wipeShopData
  // clears settings, so saving it first would delete it again.
  await dbHelpers.saveApiKey("test-key");
  return {
    sales: await db.transactions.count(),
    products: await db.products.count(),
    device: await dbHelpers.getDeviceId(),
  };
});

serving = true;
phase = "recover";

const out = await page.evaluate(async ({ apiHost, myDevice }) => {
  const { syncService } = await import("/src/services/sync.js");
  const { db, dbHelpers } = await import("/src/services/db.js");
  const r = {};

  r.apiHost = apiHost;

  const t0 = performance.now();
  const { recovered, failed } = await syncService.recoverEverything();
  r.seconds = (performance.now() - t0) / 1000;
  r.recovered = recovered;
  r.failed = failed;

  const txns = await db.transactions.toArray();
  r.sales = txns.length;
  r.salesTotal = txns.reduce((s, t) => s + (t.total ?? 0), 0);
  r.oldestSaleAt = txns.length ? Math.min(...txns.map((t) => t.timestamp)) : null;
  r.distinctCloudIds = new Set(txns.map((t) => t.cloud_id)).size;
  r.allMarkedSynced = txns.every((t) => t.synced === true);
  r.noneClaimedAsMine = txns.every((t) => t.device_id !== myDevice);

  r.products = await db.products.count();
  r.staff = await db.staff.count();
  r.suppliers = await db.suppliers.count();
  r.receipts = await db.stock_receipts.count();
  r.payments = await db.supplier_payments.count();
  r.shopName = (await dbHelpers.getShopSettings())?.shop_name ?? null;

  // Ordering: a sale's line items can only resolve their product if products
  // arrived first. This is the assertion that would fail on a parallel pull.
  const items = await db.transaction_items.toArray();
  r.items = items.length;
  r.itemsResolvedProduct = items.filter((i) => i.product_id != null).length;

  // ...and a delivery can only resolve its supplier if suppliers came first.
  const rec = await db.stock_receipts.where("cloud_id").equals(601).first();
  r.receiptKeptPhoto = Boolean(rec?.photo_blob);

  // The owner's two payments must land against that delivery and add up.
  const { supplierLedger } = await import("/src/services/supplierLedger.js");
  const localSupplier = await db.suppliers.where("cloud_id").equals(701).first();
  // Not merely "has a supplier id" — it must be the LOCAL one. The cloud id is
  // also non-null, and storing that was the bug.
  r.receiptFoundSupplier = rec?.supplier_id === localSupplier?.id;
  r.receiptSupplierId = rec?.supplier_id ?? null;
  r.localSupplierId = localSupplier?.id ?? null;

  // Same for the payment rows themselves.
  const pay = await db.supplier_payments.filter((x) => x.cloud_id === 501).first();
  r.paymentLinkedLocally = pay?.receipt_id === rec?.id && pay?.supplier_id === localSupplier?.id;
  const hist = localSupplier ? await supplierLedger.getSupplierHistory(localSupplier.id) : null;
  r.supplierPaid = hist?.balance?.paid ?? null;
  r.supplierOutstanding = hist?.balance?.outstanding ?? null;

  return r;
}, { apiHost: API_HOST, myDevice: emptied.device });

// Running it twice must not duplicate anything — a shop on a bad connection
// will tap it again. It re-pulls from the beginning, so this is a full second
// pass over every row, not a cheap no-op.
phase = "second";
const again = await page.evaluate(async () => {
  const { syncService } = await import("/src/services/sync.js");
  const { db } = await import("/src/services/db.js");
  const second = await syncService.recoverEverything();
  return {
    added: Object.values(second.recovered).reduce((a, b) => a + b, 0),
    sales: await db.transactions.count(),
    items: await db.transaction_items.count(),
  };
});

console.log(`\n(${requests} API calls, recovery took ${out.seconds.toFixed(1)}s)`);

console.log("\n── it starts from nothing ──");
check("the device was empty before recovery",
  emptied.sales === 0 && emptied.products === 0,
  `${emptied.sales} sales, ${emptied.products} products`);

console.log("\n── everything arrives, not just the catalogue ──");
check("products", out.products === products.length, `${out.products}`);
check("staff", out.staff === staff.length, `${out.staff}`);
check("shop settings", out.shopName === "Mama Njeri Stores", out.shopName ?? "none");
check("suppliers", out.suppliers === suppliers.length, `${out.suppliers}`);
check("deliveries", out.receipts === receipts.length, `${out.receipts}`);
check("supplier payments", out.payments === payments.length, `${out.payments}`);
check("sales", out.sales === SALES, `${out.sales} of ${SALES}`);
check("nothing failed", out.failed.length === 0, out.failed.join(", ") || "none");

console.log("\n── the 35-day gap is closed ──");
check(`sales older than 35 days arrive (${salesOlderThan35Days} of them)`,
  out.sales === SALES);
check("the oldest sale is the one on the server, not 35 days ago",
  Math.abs(out.oldestSaleAt - oldestSaleAt) < 1000,
  `${Math.round((NOW - out.oldestSaleAt) / DAY)} days back`);
check("the full sales total is recovered to the shilling",
  Math.abs(out.salesTotal - salesTotal) < 0.01,
  `KES ${out.salesTotal.toLocaleString()} of ${salesTotal.toLocaleString()}`);

console.log("\n── it pages, and pages exactly once per page ──");
const recoveryPages = pages.filter((p) => p.phase === "recover");
check("more than one page was needed", recoveryPages.length > 1, `${recoveryPages.length} pages`);
check("it asked for exactly the pages the data needs",
  recoveryPages.length === Math.ceil(SALES / 300), `${recoveryPages.length}`);
check("each page moved the cursor forward",
  recoveryPages.every((p, i) => i === 0 || p.since > recoveryPages[i - 1].since),
  recoveryPages.map((p) => p.returned).join(" + "));
check("the last page was short (it stopped rather than looping)",
  recoveryPages[recoveryPages.length - 1].returned < 300,
  `${recoveryPages[recoveryPages.length - 1].returned} rows`);
check("no sale was inserted twice", out.distinctCloudIds === out.sales,
  `${out.distinctCloudIds} distinct of ${out.sales}`);

console.log("\n── pulled rows know they are pulled ──");
check("every sale is marked synced", out.allMarkedSynced);
check("no foreign sale is claimed as this device's", out.noneClaimedAsMine);

console.log("\n── the order of the pulls matters ──");
check("line items resolved their product",
  out.items > 0 && out.itemsResolvedProduct === out.items,
  `${out.itemsResolvedProduct} of ${out.items}`);
check("the delivery resolved its supplier to the local row", out.receiptFoundSupplier,
  `receipt.supplier_id=${out.receiptSupplierId}, local supplier=${out.localSupplierId}`);
check("the payment points at the local delivery and supplier", out.paymentLinkedLocally);
check("the invoice photo came with it", out.receiptKeptPhoto);
check("the owner's payments landed on the delivery", out.supplierPaid === 2500,
  `KES ${out.supplierPaid}`);
check("and the balance is what is still owed", out.supplierOutstanding === 1500,
  `KES ${out.supplierOutstanding}`);

console.log("\n── the report is honest ──");
check("it reports the sales it actually wrote", out.recovered.transactions === SALES,
  `${out.recovered.transactions}`);
check("and the suppliers", out.recovered.suppliers === suppliers.length);

console.log("\n── running it again is safe ──");
check("a second recovery adds nothing", again.added === 0, `${again.added} rows`);
check("the sale count is unchanged", again.sales === SALES, `${again.sales}`);
check("and no line item was duplicated either", again.items === out.items, `${again.items}`);
check("the second run really did re-read every page",
  pages.filter((p) => p.phase === "second").length >= 2,
  `${pages.filter((p) => p.phase === "second").length} pages`);

// ── pushing back out ───────────────────────────────────────────────────────
// The other half of the same bug: a payment recorded here has a local receipt
// id, and the server only knows cloud ids.
phase = "push";
const push = await page.evaluate(async () => {
  const { syncService } = await import("/src/services/sync.js");
  const { supplierLedger } = await import("/src/services/supplierLedger.js");
  const { db } = await import("/src/services/db.js");

  const pulled = await db.stock_receipts.where("cloud_id").equals(601).first();
  await supplierLedger.recordPayment({
    receipt_id: pulled.id, amount: 500, method: "cash", staff_id: 1,
  });

  // A delivery that has never reached the server: its payment has nothing to
  // point at yet and must wait rather than be orphaned.
  const localOnlyId = await db.stock_receipts.add({
    timestamp: Date.now(), supplier: "Cash & Carry", supplier_id: null,
    invoice_number: "LOCAL-1", status: "activated", invoice_amount: 800,
    amount_paid: 0, payment_status: "unpaid", synced: false, cloud_id: null,
  });
  await supplierLedger.recordPayment({
    receipt_id: localOnlyId, amount: 800, method: "cash", staff_id: 1,
  });

  const result = await syncService.pushUnsyncedPayments();
  const held = await db.supplier_payments.filter((x) => x.receipt_id === localOnlyId).first();
  return {
    pushed: result.pushed,
    waiting: result.waiting,
    heldBack: held?.synced !== true,
    localReceiptId: pulled.id,
  };
});

console.log("");
console.log("── and pushing one back out ──");
const paymentPosts = posted.filter((x) => x.path.startsWith("/supplier-payments"));
check("exactly one payment was pushed", push.pushed === 1, `${push.pushed}`);
check("the other was held back, not orphaned", push.waiting === 1 && push.heldBack,
  `${push.waiting} waiting`);
check("it sent the delivery's CLOUD id, not the local one",
  paymentPosts.length === 1 && paymentPosts[0].body.receipt_id === 601,
  `sent ${paymentPosts[0]?.body?.receipt_id} (local id was ${push.localReceiptId})`);
check("and the supplier's cloud id",
  paymentPosts[0]?.body?.supplier_id === 701, `sent ${paymentPosts[0]?.body?.supplier_id}`);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All recovery checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
