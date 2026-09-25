/**
 * Paying suppliers: invoices, part payments, and what is owed.
 *
 *   npm run dev                          # one terminal
 *   npm run verify:supplier-ledger       # another
 *
 * Runs the real service against a real IndexedDB. This is money leaving the
 * shop, so the arithmetic gets the same treatment as the sales side: a balance
 * that is quietly wrong is worse than no balance at all.
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
  await put("settings", { key: "shop_name", value: "Demo Shop" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now() });
  await put("products", {
    id: 1, barcode: "6000000000001", name: "Maize Flour 2kg", price: 195, cost_price: 150,
    stock: 20, category: "Grains", reorder_level: 10, active: true, updated_at: Date.now(),
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
  const { supplierLedger, PAYMENT_STATUS } = await import("/src/services/supplierLedger.js");
  const { dbHelpers, db } = await import("/src/services/db.js");
  const { purchaseOrders } = await import("/src/services/purchaseOrders.js");
  const r = {};

  // An order, then a delivery against it
  const orderId = await purchaseOrders.create({
    supplier: "Mwangi Wholesalers", supplier_id: 1, staff_id: 1,
    items: [{ product_id: 1, name: "Maize Flour 2kg", qty: 50 }],
  });

  const receiptId = await dbHelpers.addStockReceipt({
    supplier: "Mwangi Wholesalers",
    supplier_id: 1,
    invoice_number: "INV-4471",
    photo_blob: "data:image/png;base64,iVBORw0KGgo=",
    staff_id: 1,
    items: [{ product_id: 1, qty_added: 50, unit_cost: 152, condition: "good" }],
  });
  await dbHelpers.activateStockReceipt(receiptId, {});
  await purchaseOrders.applyDelivery([{ product_id: 1, qty: 50 }]);
  await supplierLedger.linkReceiptToOrder(receiptId, orderId);
  await supplierLedger.setInvoiceAmount(receiptId, 7600); // 50 x 152

  let hist = await supplierLedger.getSupplierHistory(1);
  r.billed = hist.balance.billed;
  r.owedBeforePaying = hist.balance.outstanding;
  r.statusUnpaid = hist.invoices[0].payment_status;
  r.photoKept = Boolean(hist.invoices[0].photo_blob);
  r.invoiceNumberKept = hist.invoices[0].invoice_number;
  r.linkedToOrder = hist.orders[0].invoices.length === 1;

  // Part payment
  await supplierLedger.recordPayment({ receipt_id: receiptId, amount: 3000, method: "mpesa_paybill", reference: "QA1", staff_id: 1 });
  hist = await supplierLedger.getSupplierHistory(1);
  r.afterPartPaid = hist.balance.paid;
  r.afterPartOwed = hist.balance.outstanding;
  r.statusPartial = hist.invoices[0].payment_status;

  // Settle the rest, in two goes — payments are rows, so both must be kept
  await supplierLedger.recordPayment({ receipt_id: receiptId, amount: 4000, method: "cash", staff_id: 1 });
  await supplierLedger.recordPayment({ receipt_id: receiptId, amount: 600, method: "cash", staff_id: 1 });
  hist = await supplierLedger.getSupplierHistory(1);
  r.finalPaid = hist.balance.paid;
  r.finalOwed = hist.balance.outstanding;
  r.statusPaid = hist.invoices[0].payment_status;
  r.paymentRows = hist.invoices[0].payments.length;
  r.referenceKept = hist.invoices[0].payments.some((p) => p.reference === "QA1");

  // Paid invoices drop out of payables
  let payables = await supplierLedger.getPayables();
  r.payablesWhenSettled = payables.total;

  // A second, unpaid invoice
  const r2 = await dbHelpers.addStockReceipt({
    supplier: "Mwangi Wholesalers", supplier_id: 1, invoice_number: "INV-4480",
    photo_blob: null, staff_id: 1,
    items: [{ product_id: 1, qty_added: 10, unit_cost: 150, condition: "good" }],
  });
  await dbHelpers.activateStockReceipt(r2, {});
  await supplierLedger.setInvoiceAmount(r2, 1500);
  payables = await supplierLedger.getPayables();
  r.payablesWithUnpaid = payables.total;
  r.payableSupplierNamed = payables.suppliers[0]?.supplier ?? null;

  // A draft delivery is not yet a bill
  const draft = await dbHelpers.addStockReceipt({
    supplier: "Mwangi Wholesalers", supplier_id: 1, invoice_number: "DRAFT-1",
    photo_blob: null, staff_id: 1,
    items: [{ product_id: 1, qty_added: 5, unit_cost: 150, condition: "good" }],
  });
  await supplierLedger.setInvoiceAmount(draft, 750);
  const afterDraft = await supplierLedger.getPayables();
  r.draftNotOwed = afterDraft.total;

  // Rounding: a payment a fraction short still closes the invoice
  const r3 = await dbHelpers.addStockReceipt({
    supplier: "Mwangi Wholesalers", supplier_id: 1, invoice_number: "INV-ROUND",
    photo_blob: null, staff_id: 1,
    items: [{ product_id: 1, qty_added: 1, unit_cost: 100, condition: "good" }],
  });
  await dbHelpers.activateStockReceipt(r3, {});
  await supplierLedger.setInvoiceAmount(r3, 100);
  await supplierLedger.recordPayment({ receipt_id: r3, amount: 99.995, method: "cash", staff_id: 1 });
  const rounded = await db.stock_receipts.get(r3);
  r.roundingClosesInvoice = rounded.payment_status === PAYMENT_STATUS.PAID;

  // Rejections
  try {
    await supplierLedger.recordPayment({ receipt_id: receiptId, amount: 0, method: "cash" });
    r.rejectsZero = false;
  } catch { r.rejectsZero = true; }
  try {
    await supplierLedger.recordPayment({ receipt_id: receiptId, amount: -50, method: "cash" });
    r.rejectsNegative = false;
  } catch { r.rejectsNegative = true; }

  // The order carries its invoices for the Orders screen
  const byOrder = await supplierLedger.getInvoicesByOrder([orderId]);
  r.orderHasInvoice = (byOrder.get(orderId) ?? []).length === 1;
  r.orderInvoicePaid = (byOrder.get(orderId) ?? [])[0]?.payment_status;

  return r;
});

console.log("\n── an invoice arrives ──");
check("the delivery is billed at its invoice amount", out.billed === 7600, `${out.billed}`);
check("and is owed in full", out.owedBeforePaying === 7600, `${out.owedBeforePaying}`);
check("it starts unpaid", out.statusUnpaid === "unpaid", out.statusUnpaid);
check("the invoice photo is kept", out.photoKept);
check("the invoice number is kept", out.invoiceNumberKept === "INV-4471", out.invoiceNumberKept);
check("it is filed against the order it fulfilled", out.linkedToOrder);

console.log("\n── paying it ──");
check("a part payment reduces what is owed", out.afterPartOwed === 4600, `${out.afterPartOwed}`);
check("and marks it part paid", out.statusPartial === "partial", out.statusPartial);
check("instalments add up", out.finalPaid === 7600, `${out.finalPaid}`);
check("nothing is left owing", out.finalOwed === 0, `${out.finalOwed}`);
check("the invoice is marked paid", out.statusPaid === "paid", out.statusPaid);
check("every payment is kept as its own row", out.paymentRows === 3, `${out.paymentRows}`);
check("the M-Pesa reference is kept", out.referenceKept);
check("a payment a fraction short still closes it", out.roundingClosesInvoice);

console.log("\n── what the shop owes ──");
check("settled invoices drop out of payables", out.payablesWhenSettled === 0, `${out.payablesWhenSettled}`);
check("an unpaid invoice appears", out.payablesWithUnpaid === 1500, `${out.payablesWithUnpaid}`);
check("the supplier is named", out.payableSupplierNamed === "Mwangi Wholesalers", out.payableSupplierNamed);
check("a delivery not yet activated is not yet a bill", out.draftNotOwed === 1500, `${out.draftNotOwed}`);

console.log("\n── rejections ──");
check("a zero payment is refused", out.rejectsZero);
check("a negative payment is refused", out.rejectsNegative);

console.log("\n── the Orders screen's view ──");
check("the order carries its invoice", out.orderHasInvoice);
check("and its payment state", out.orderInvoicePaid === "paid", out.orderInvoicePaid);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All supplier ledger checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
