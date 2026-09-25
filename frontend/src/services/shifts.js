/**
 * Cash reconciliation — did the money in the drawer match the sales?
 *
 * The app could always say what was sold. It could not say whether the cash was
 * there, which is the mechanism an owner uses to notice money going missing.
 *
 * A shift is **per user, per day**. One person moves between devices during a
 * day — a phone while handling suppliers in the morning, the desktop at the
 * counter during the rush — so a shift belonging to a device would split their
 * takings across two records and reconcile neither. It follows the person,
 * because that is who the money is accountable to.
 *
 * The number that matters, expected cash, is **derived, never accumulated**:
 *
 *     expected = opening float
 *              + cash taken in sales   (that staff member, that date)
 *              + cash paid in
 *              - cash paid out
 *
 * Deriving it from the transactions means a sale rung up on the other device
 * counts the moment it syncs, and a running total that drifted from the sales
 * it claims to represent is impossible by construction.
 */
import { db, dbHelpers } from "./db";

export const SHIFT_STATUS = { OPEN: "open", CLOSED: "closed" };
export const MOVEMENT = { IN: "in", OUT: "out" };

// A shift belongs to a calendar day in the shop's own timezone. Using the local
// date rather than a UTC timestamp keeps "today" meaning what the cashier means.
export function businessDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayBounds(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return { start, end };
}

// Cash differences are compared to the shilling; anything smaller is float noise.
const EPSILON = 0.5;

export const shifts = {
  SHIFT_STATUS,

  /**
   * Open a shift with a counted float.
   *
   * Returns the existing one if this person already has today's shift open —
   * including one they opened on a different device, which is the whole point
   * of keying it to the user rather than the till.
   */
  async open({ staff_id, staff_name, opening_float = 0 }) {
    const date = businessDate();
    const existing = await this.getOpenShift(staff_id);
    if (existing) return existing;

    const deviceId = await dbHelpers.getDeviceId();
    const id = await db.shifts.add({
      staff_id,
      staff_name: staff_name ?? null,
      business_date: date,
      opening_float: Number(opening_float) || 0,
      opened_at: Date.now(),
      closed_at: null,
      counted_cash: null,
      expected_cash: null,
      difference: null,
      note: null,
      status: SHIFT_STATUS.OPEN,
      synced: false,
      cloud_id: null,
      device_id: deviceId,
    });
    return db.shifts.get(id);
  },

  /** This person's open shift, whichever device opened it. */
  async getOpenShift(staff_id) {
    if (!staff_id) return null;
    return db.shifts
      .where("[staff_id+business_date]")
      .equals([staff_id, businessDate()])
      .filter((s) => s.status === SHIFT_STATUS.OPEN)
      .first();
  },

  /** Money into or out of the drawer mid-shift — a float top-up, a supplier paid in cash. */
  async recordMovement({ shift_id, type, amount, reason, staff_id }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Amount must be positive");
    if (type !== MOVEMENT.IN && type !== MOVEMENT.OUT) throw new Error("Unknown movement type");
    if (!reason?.trim()) throw new Error("A reason is required");

    const deviceId = await dbHelpers.getDeviceId();
    await db.cash_movements.add({
      shift_id,
      type,
      amount: value,
      reason: reason.trim(),
      staff_id: staff_id ?? null,
      created_at: Date.now(),
      synced: false,
      cloud_id: null,
      device_id: deviceId,
    });
  },

  async getMovements(shiftId) {
    return db.cash_movements.where("shift_id").equals(shiftId).reverse().sortBy("created_at");
  },

  /**
   * What should be in the drawer, and the sales behind it.
   *
   * Counts every sale by this staff member on this date, from any device, which
   * is why the figure is computed rather than stored. Voided sales are excluded
   * — the goods went back and so did the money.
   *
   * Only CASH adds to the drawer. M-Pesa and Pochi are money the shop received
   * without anything entering the till, so they are reported separately rather
   * than folded into the expected count.
   */
  async summarise(shift) {
    const { start, end } = dayBounds(shift.business_date);
    const txns = await db.transactions
      .where("timestamp").between(start, end, true, true)
      .filter((t) => t.staff_id === shift.staff_id && !t.voided)
      .toArray();

    const byMethod = { CASH: 0, MPESA: 0, POCHI: 0, OTHER: 0 };
    for (const t of txns) {
      const key = byMethod[t.payment_method] !== undefined ? t.payment_method : "OTHER";
      byMethod[key] += t.total ?? 0;
    }

    const movements = await this.getMovements(shift.id);
    const cashIn = movements.filter((m) => m.type === MOVEMENT.IN).reduce((s, m) => s + m.amount, 0);
    const cashOut = movements.filter((m) => m.type === MOVEMENT.OUT).reduce((s, m) => s + m.amount, 0);

    const voided = await db.transactions
      .where("timestamp").between(start, end, true, true)
      .filter((t) => t.staff_id === shift.staff_id && t.voided)
      .toArray();

    const expected = (shift.opening_float ?? 0) + byMethod.CASH + cashIn - cashOut;

    return {
      salesByMethod: byMethod,
      salesTotal: Object.values(byMethod).reduce((a, b) => a + b, 0),
      transactionCount: txns.length,
      voidedCount: voided.length,
      voidedTotal: voided.reduce((s, t) => s + (t.total ?? 0), 0),
      openingFloat: shift.opening_float ?? 0,
      cashIn,
      cashOut,
      movements,
      expectedCash: expected,
    };
  },

  /**
   * Close the shift against a counted drawer.
   *
   * Expected and difference are frozen onto the row at this moment. The figure
   * is derived while the shift is open so late-syncing sales are picked up, but
   * once it is closed it is a record of what was counted against what was
   * expected *then* — and must not silently change afterwards.
   */
  async close({ shift_id, counted_cash, note }) {
    const counted = Number(counted_cash);
    if (!Number.isFinite(counted) || counted < 0) throw new Error("Counted cash must be a number");

    const shift = await db.shifts.get(shift_id);
    if (!shift) throw new Error("Shift not found");
    if (shift.status === SHIFT_STATUS.CLOSED) return shift;

    const summary = await this.summarise(shift);
    const difference = counted - summary.expectedCash;

    await db.shifts.update(shift_id, {
      status: SHIFT_STATUS.CLOSED,
      closed_at: Date.now(),
      counted_cash: counted,
      expected_cash: summary.expectedCash,
      difference,
      note: note?.trim() || null,
      synced: false,
    });

    return { ...(await db.shifts.get(shift_id)), summary, difference };
  },

  /** Closed shifts, newest first — the owner's read of who balanced and who did not. */
  async getHistory(limit = 30) {
    const rows = await db.shifts.orderBy("opened_at").reverse().limit(limit).toArray();
    return rows.map((s) => ({
      ...s,
      // A difference inside the epsilon is a rounding artefact, not a discrepancy
      // worth an accusation.
      balanced: s.difference === null ? null : Math.abs(s.difference) <= EPSILON,
    }));
  },

  /** Anyone still open from a previous day — a shift nobody closed is a reconciliation nobody did. */
  async getStaleOpenShifts() {
    const today = businessDate();
    return db.shifts.filter((s) => s.status === SHIFT_STATUS.OPEN && s.business_date < today).toArray();
  },

  async getUnsynced() {
    const rows = await db.shifts.filter((s) => !s.synced).toArray();
    return Promise.all(
      rows.map(async (s) => ({
        ...s,
        movements: await db.cash_movements.where("shift_id").equals(s.id).toArray(),
      })),
    );
  },

  async markSynced(id, cloudId) {
    await db.shifts.update(id, { synced: true, cloud_id: cloudId });
  },
};
