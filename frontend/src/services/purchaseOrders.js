/**
 * Purchase orders — what has been ordered from a supplier and not yet arrived.
 *
 * Kept beside `dbHelpers` rather than inside it only because that file is
 * already 1000 lines; the same rule applies — components import these helpers,
 * never `db` directly.
 *
 * The shape of the problem: an order used to exist only in the supplier's
 * WhatsApp inbox, so nothing in the app knew a product was already coming. Two
 * consequences the shop actually felt — reordering the same thing twice, and
 * low-stock alerts that could not say "already on order".
 *
 * The design rule that keeps it honest: **"on order" is derived, never a flag**.
 * `qty_outstanding` falls as deliveries are activated against a line, and a
 * line at zero is closed. Nobody has to remember to tick anything.
 */
import { db } from "./db";
import { dbHelpers } from "./db";

export const PO_STATUS = {
  DRAFT: "draft",
  SENT: "sent",
  PARTIAL: "partially_received",
  RECEIVED: "received",
  CANCELLED: "cancelled",
};

// An order nobody has closed is not evidence that stock is still coming — it is
// usually evidence that somebody forgot. After this long it stops suppressing
// reorder warnings, and the Orders screen nudges to close it.
export const STALE_AFTER_DAYS = 21;

const OPEN_STATUSES = [PO_STATUS.SENT, PO_STATUS.PARTIAL];

export const purchaseOrders = {
  /**
   * Record an order at the moment it is sent to the supplier.
   *
   * Called *before* the WhatsApp/mailto window opens: if the message is never
   * actually sent the order can be cancelled, which is recoverable, whereas a
   * sent order that was never recorded is exactly the invisible state this
   * table exists to remove.
   */
  async create({ supplier, supplier_id, items, staff_id, note }) {
    const deviceId = await dbHelpers.getDeviceId();
    const now = Date.now();

    return db.transaction("rw", [db.purchase_orders, db.purchase_order_items], async () => {
      const orderId = await db.purchase_orders.add({
        supplier: supplier ?? "Unknown supplier",
        supplier_id: supplier_id ?? null,
        staff_id: staff_id ?? null,
        note: note ?? null,
        status: PO_STATUS.SENT,
        created_at: now,
        sent_at: now,
        closed_at: null,
        synced: false,
        cloud_id: null,
        device_id: deviceId,
      });

      await Promise.all(
        items.map((i) =>
          db.purchase_order_items.add({
            order_id: orderId,
            product_id: i.product_id,
            product_name: i.name ?? null,
            qty_ordered: i.qty,
            qty_received: 0,
            qty_outstanding: i.qty,
            unit_cost: i.unit_cost ?? null,
          }),
        ),
      );

      return orderId;
    });
  },

  /** Orders still waiting on stock, newest first, with their lines attached. */
  async getOpen() {
    const orders = await db.purchase_orders
      .where("status").anyOf(OPEN_STATUSES)
      .reverse()
      .sortBy("created_at");

    return Promise.all(
      orders.map(async (o) => ({
        ...o,
        items: await db.purchase_order_items.where("order_id").equals(o.id).toArray(),
        isStale: Date.now() - (o.sent_at ?? o.created_at) > STALE_AFTER_DAYS * 86400000,
      })),
    );
  },

  async getHistory(limit = 30) {
    const orders = await db.purchase_orders.orderBy("created_at").reverse().limit(limit).toArray();
    return Promise.all(
      orders.map(async (o) => ({
        ...o,
        items: await db.purchase_order_items.where("order_id").equals(o.id).toArray(),
      })),
    );
  },

  /**
   * How many units of each product are on order right now.
   *
   * The map every other screen reads: the alert badge, and the duplicate
   * warning in the order builder. Stale orders are excluded — an order nobody
   * has closed in three weeks should stop hiding a genuine shortage.
   *
   * @returns Map<product_id, { qty, orders: [{ id, supplier, sent_at }] }>
   */
  async getOnOrderMap() {
    const open = await this.getOpen();
    const map = new Map();

    for (const order of open) {
      if (order.isStale) continue;
      for (const item of order.items) {
        if (!item.product_id || item.qty_outstanding <= 0) continue;
        const entry = map.get(item.product_id) ?? { qty: 0, orders: [] };
        entry.qty += item.qty_outstanding;
        entry.orders.push({ id: order.id, supplier: order.supplier, sent_at: order.sent_at });
        map.set(item.product_id, entry);
      }
    }
    return map;
  },

  /**
   * Match a delivery against open orders and close down what it covers.
   *
   * Called when a stock receipt is activated. Oldest order first, so a repeat
   * order for the same product settles the order that has been waiting longest.
   * Over-delivery is absorbed rather than left as a negative outstanding.
   *
   * @param received [{ product_id, qty }]
   * @returns { closedOrders, matchedLines, orderIds } — orderIds is what the
   *          delivery settled, so the receipt can be filed against it
   */
  async applyDelivery(received) {
    if (!received || received.length === 0) return { closedOrders: 0, matchedLines: 0, orderIds: [] };

    return db.transaction("rw", [db.purchase_orders, db.purchase_order_items], async () => {
      const open = await db.purchase_orders.where("status").anyOf(OPEN_STATUSES).toArray();
      open.sort((a, b) => (a.sent_at ?? a.created_at) - (b.sent_at ?? b.created_at));

      let matchedLines = 0;
      const touched = new Set();

      for (const { product_id, qty } of received) {
        let remaining = qty;
        if (!product_id || remaining <= 0) continue;

        for (const order of open) {
          if (remaining <= 0) break;
          const lines = await db.purchase_order_items
            .where("order_id").equals(order.id)
            .filter((l) => l.product_id === product_id && l.qty_outstanding > 0)
            .toArray();

          for (const line of lines) {
            if (remaining <= 0) break;
            const applied = Math.min(line.qty_outstanding, remaining);
            await db.purchase_order_items.update(line.id, {
              qty_received: (line.qty_received ?? 0) + applied,
              qty_outstanding: line.qty_outstanding - applied,
            });
            remaining -= applied;
            matchedLines++;
            touched.add(order.id);
          }
        }
        // Anything left over was not on any order — a delivery can legitimately
        // include extras, and that is not an error worth blocking activation.
      }

      // An order is finished when none of its lines are still outstanding.
      let closedOrders = 0;
      for (const orderId of touched) {
        const lines = await db.purchase_order_items.where("order_id").equals(orderId).toArray();
        const outstanding = lines.reduce((sum, l) => sum + Math.max(0, l.qty_outstanding), 0);
        const status = outstanding === 0 ? PO_STATUS.RECEIVED : PO_STATUS.PARTIAL;
        await db.purchase_orders.update(orderId, {
          status,
          closed_at: outstanding === 0 ? Date.now() : null,
          synced: false,
        });
        if (outstanding === 0) closedOrders++;
      }

      return { closedOrders, matchedLines, orderIds: [...touched] };
    });
  },

  /** Close an order by hand — it arrived off-book, or it is never coming. */
  async close(orderId, { cancelled = false } = {}) {
    await db.purchase_orders.update(orderId, {
      status: cancelled ? PO_STATUS.CANCELLED : PO_STATUS.RECEIVED,
      closed_at: Date.now(),
      synced: false,
    });
  },

  async getUnsynced() {
    const orders = await db.purchase_orders.filter((o) => !o.synced).toArray();
    return Promise.all(
      orders.map(async (o) => ({
        ...o,
        items: await db.purchase_order_items.where("order_id").equals(o.id).toArray(),
      })),
    );
  },

  async markSynced(orderId, cloudId) {
    await db.purchase_orders.update(orderId, { synced: true, cloud_id: cloudId });
  },
};
