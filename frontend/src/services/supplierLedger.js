/**
 * What the shop owes each supplier, and what it has paid them.
 *
 * The trail used to stop at "stock activated": an order could be raised,
 * received and turned into stock, and nothing recorded what the supplier
 * actually billed or whether it had been settled. Paying suppliers happened in
 * someone's head, and the invoice photo — already captured at receiving — was
 * stranded on a delivery record nobody could find again.
 *
 * The model:
 *
 *   purchase_order  what was asked for
 *   stock_receipt   what arrived, and the invoice that came with it
 *   supplier_payment  money going the other way
 *
 * An invoice belongs to a *delivery*, not to an order, because that is what
 * carries the invoice number and the photo — and a supplier may part-deliver
 * one order against two invoices. An order's payment state is therefore
 * derived from the invoices raised against it, never stored on it.
 */
import { db, dbHelpers } from "./db";

export const PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
};

/** How a supplier wants to be paid. Labels are shown as-is at payment time. */
export const PAY_METHODS = [
  { id: "mpesa_paybill", label: "M-Pesa Paybill", accountLabel: "Paybill number", needsRef: true },
  { id: "mpesa_till",    label: "M-Pesa Till",    accountLabel: "Till number",    needsRef: true },
  { id: "mpesa_send",    label: "M-Pesa (phone)", accountLabel: "Phone number",   needsRef: true },
  { id: "bank",          label: "Bank transfer",  accountLabel: "Account number", needsRef: true },
  { id: "cash",          label: "Cash",           accountLabel: null,             needsRef: false },
];

export function payMethodLabel(id) {
  return PAY_METHODS.find((m) => m.id === id)?.label ?? null;
}

// Money compared to the cent: a payment that lands a fraction short through
// floating point must still close the invoice.
const EPSILON = 0.01;

function statusFor(invoiceAmount, amountPaid) {
  if (!(invoiceAmount > 0)) return PAYMENT_STATUS.UNPAID;
  if (amountPaid >= invoiceAmount - EPSILON) return PAYMENT_STATUS.PAID;
  if (amountPaid > EPSILON) return PAYMENT_STATUS.PARTIAL;
  return PAYMENT_STATUS.UNPAID;
}

/** Line total of a delivery — the default bill when no invoice figure is given. */
function receiptTotal(items) {
  return items.reduce((sum, i) => sum + (i.qty_added ?? 0) * (i.unit_cost ?? 0), 0);
}

export const supplierLedger = {
  PAYMENT_STATUS,

  /**
   * Record money paid against one invoice.
   *
   * Payments are rows, not a running total on the invoice: a shop pays a big
   * invoice in instalments, and each one needs its own reference and date to be
   * worth anything when a supplier disputes it. The invoice's `amount_paid` and
   * `payment_status` are recomputed from those rows, so the two can never
   * disagree.
   */
  async recordPayment({ receipt_id, amount, method, reference, staff_id, note, paid_at }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Payment amount must be positive");

    const deviceId = await dbHelpers.getDeviceId();

    return db.transaction("rw", [db.stock_receipts, db.supplier_payments], async () => {
      const receipt = await db.stock_receipts.get(receipt_id);
      if (!receipt) throw new Error("Invoice not found");

      await db.supplier_payments.add({
        receipt_id,
        supplier_id: receipt.supplier_id ?? null,
        supplier: receipt.supplier ?? null,
        amount: value,
        method: method ?? null,
        reference: reference?.trim() || null,
        note: note?.trim() || null,
        staff_id: staff_id ?? null,
        paid_at: paid_at ?? Date.now(),
        synced: false,
        cloud_id: null,
        device_id: deviceId,
      });

      const payments = await db.supplier_payments.where("receipt_id").equals(receipt_id).toArray();
      const amountPaid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);

      await db.stock_receipts.update(receipt_id, {
        amount_paid: amountPaid,
        payment_status: statusFor(receipt.invoice_amount ?? 0, amountPaid),
        synced: false,
      });

      return { amountPaid, status: statusFor(receipt.invoice_amount ?? 0, amountPaid) };
    });
  },

  /**
   * Set what the supplier actually billed.
   *
   * Defaults to the line total, but the two legitimately differ — delivery
   * charges, a negotiated discount, or a supplier who rounds. The invoice is
   * what has to be paid, so it is what the balance is built from.
   */
  async setInvoiceAmount(receiptId, amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw new Error("Invoice amount must be a number");
    const receipt = await db.stock_receipts.get(receiptId);
    if (!receipt) throw new Error("Invoice not found");
    await db.stock_receipts.update(receiptId, {
      invoice_amount: value,
      payment_status: statusFor(value, receipt.amount_paid ?? 0),
      synced: false,
    });
  },

  /** Attach a delivery to the order it fulfilled, so history reads as one story. */
  async linkReceiptToOrder(receiptId, orderId) {
    if (!orderId) return;
    await db.stock_receipts.update(receiptId, { order_id: orderId, synced: false });
  },

  /**
   * One supplier's whole story: orders raised, invoices received, money paid.
   *
   * Assembled here rather than in the component so the balance shown on the
   * supplier card and the balance inside their history can never disagree.
   */
  async getSupplierHistory(supplierId) {
    const [orders, receipts, payments] = await Promise.all([
      db.purchase_orders.where("supplier_id").equals(supplierId).toArray(),
      db.stock_receipts.where("supplier_id").equals(supplierId).toArray(),
      db.supplier_payments.where("supplier_id").equals(supplierId).toArray(),
    ]);

    const paymentsByReceipt = new Map();
    for (const p of payments) {
      const list = paymentsByReceipt.get(p.receipt_id) ?? [];
      list.push(p);
      paymentsByReceipt.set(p.receipt_id, list);
    }

    const invoices = await Promise.all(
      receipts.map(async (r) => {
        const items = await db.stock_receipt_items.where("receipt_id").equals(r.id).toArray();
        const invoiceAmount = r.invoice_amount ?? receiptTotal(items);
        const amountPaid = r.amount_paid ?? 0;
        return {
          ...r,
          items,
          invoice_amount: invoiceAmount,
          amount_paid: amountPaid,
          outstanding: Math.max(0, invoiceAmount - amountPaid),
          payment_status: r.payment_status ?? statusFor(invoiceAmount, amountPaid),
          payments: (paymentsByReceipt.get(r.id) ?? []).sort((a, b) => b.paid_at - a.paid_at),
        };
      }),
    );

    invoices.sort((a, b) => b.timestamp - a.timestamp);

    const ordersWithItems = await Promise.all(
      orders.map(async (o) => ({
        ...o,
        items: await db.purchase_order_items.where("order_id").equals(o.id).toArray(),
        // Only activated deliveries count as fulfilling an order; a draft is
        // not yet stock and not yet an invoice.
        invoices: invoices.filter((i) => i.order_id === o.id),
      })),
    );
    ordersWithItems.sort((a, b) => (b.sent_at ?? b.created_at) - (a.sent_at ?? a.created_at));

    const billed = invoices.reduce((s, i) => s + i.invoice_amount, 0);
    const paid = invoices.reduce((s, i) => s + i.amount_paid, 0);

    return {
      orders: ordersWithItems,
      invoices,
      payments: payments.sort((a, b) => b.paid_at - a.paid_at),
      balance: {
        billed,
        paid,
        outstanding: Math.max(0, billed - paid),
        unpaidCount: invoices.filter((i) => i.outstanding > EPSILON).length,
      },
      lastOrderAt: ordersWithItems[0]?.sent_at ?? ordersWithItems[0]?.created_at ?? null,
      lastDeliveryAt: invoices[0]?.timestamp ?? null,
    };
  },

  /**
   * Everything owed, by supplier — the view for settling several at once.
   *
   * Only activated deliveries count: a draft has not been accepted into stock,
   * so it is not yet a bill the shop owes.
   */
  async getPayables() {
    const receipts = await db.stock_receipts
      .filter((r) => r.status === "activated")
      .toArray();

    const bySupplier = new Map();
    for (const r of receipts) {
      const invoiceAmount = r.invoice_amount ?? 0;
      const outstanding = Math.max(0, invoiceAmount - (r.amount_paid ?? 0));
      if (outstanding <= EPSILON) continue;

      const key = r.supplier_id ?? `name:${r.supplier ?? "Unknown"}`;
      const entry = bySupplier.get(key) ?? {
        supplier_id: r.supplier_id ?? null,
        supplier: r.supplier ?? "Unknown supplier",
        outstanding: 0,
        invoices: [],
      };
      entry.outstanding += outstanding;
      entry.invoices.push({
        id: r.id,
        invoice_number: r.invoice_number,
        timestamp: r.timestamp,
        invoice_amount: invoiceAmount,
        amount_paid: r.amount_paid ?? 0,
        outstanding,
      });
      bySupplier.set(key, entry);
    }

    const suppliers = [...bySupplier.values()].sort((a, b) => b.outstanding - a.outstanding);
    for (const s of suppliers) s.invoices.sort((a, b) => a.timestamp - b.timestamp);

    return {
      suppliers,
      total: suppliers.reduce((sum, s) => sum + s.outstanding, 0),
      invoiceCount: suppliers.reduce((sum, s) => sum + s.invoices.length, 0),
    };
  },

  /**
   * Invoices raised against each of these orders, keyed by order id.
   *
   * Batched deliberately: the Orders list renders many cards and a per-card
   * query would be a round trip each.
   */
  async getInvoicesByOrder(orderIds) {
    const map = new Map();
    if (!orderIds?.length) return map;
    const receipts = await db.stock_receipts
      .where("order_id").anyOf(orderIds)
      .toArray();
    for (const r of receipts) {
      const invoiceAmount = r.invoice_amount ?? 0;
      const amountPaid = r.amount_paid ?? 0;
      const list = map.get(r.order_id) ?? [];
      list.push({
        ...r,
        invoice_amount: invoiceAmount,
        amount_paid: amountPaid,
        outstanding: Math.max(0, invoiceAmount - amountPaid),
        payment_status: r.payment_status ?? statusFor(invoiceAmount, amountPaid),
      });
      map.set(r.order_id, list);
    }
    return map;
  },

  async getUnsyncedPayments() {
    return db.supplier_payments.filter((p) => !p.synced).toArray();
  },

  async markPaymentSynced(id, cloudId) {
    await db.supplier_payments.update(id, { synced: true, cloud_id: cloudId });
  },
};
