import { db, dbHelpers } from "./db";
import { apiHeaders, apiGetHeaders } from "../utils/apiHeaders";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const syncService = {
  /**
   * Re-query Daraja for any STK Push payments that were in-flight while offline.
   * Picks up all pending_mpesa rows that have a checkout_request_id but are not
   * yet verified, and resolves them via GET /mpesa/stk-query/:id.
   */
  async resumePendingStkChecks() {
    if (!API_BASE) return;
    const pending = await db.pending_mpesa
      .filter((p) => !p.verified && !!p.checkout_request_id)
      .toArray();
    for (const p of pending) {
      try {
        const res = await fetch(
          `${API_BASE}/mpesa/stk-query/${encodeURIComponent(p.checkout_request_id)}`,
          { headers: apiGetHeaders(), signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status === "confirmed") {
          await db.pending_mpesa.update(p.id, { verified: true, code: data.mpesa_code ?? p.code });
        } else if (data.status === "failed") {
          await db.pending_mpesa.update(p.id, { stk_failed: true });
        }
      } catch { /* offline — try again next reconnect */ }
    }
  },

  async pushUnsynced() {
    if (!API_BASE) return { pushed: 0 };

    const unsynced = await db.transactions.where("synced").equals(false).toArray();
    if (unsynced.length === 0) return { pushed: 0 };

    let pushed = 0;
    for (const txn of unsynced) {
      try {
        const items = await db.transaction_items
          .where("transaction_id")
          .equals(txn.id)
          .toArray();

        const res = await fetch(`${API_BASE}/sync/transactions`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ ...txn, items }),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          await db.transactions.update(txn.id, { synced: true });
          pushed++;
        }
      } catch {
        continue;
      }
    }

    return { pushed };
  },

  async initiateMpesaStk(transactionId, phoneNumber, amount) {
    const res = await fetch(`${API_BASE}/mpesa/stk-push`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ transaction_id: transactionId ?? null, phone_number: phoneNumber, amount }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error("STK Push failed");
    return res.json();
  },

  async getMpesaStkStatus(checkoutRequestId) {
    const res = await fetch(
      `${API_BASE}/mpesa/status/${encodeURIComponent(checkoutRequestId)}`,
      { headers: apiGetHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error("Status check failed");
    return res.json(); // { checkout_request_id, status, mpesa_code }
  },

  async pushUnsyncedReceipts() {
    if (!API_BASE) return { pushed: 0 };
    const receipts = await dbHelpers.getUnsyncedReceipts();
    if (receipts.length === 0) return { pushed: 0 };

    let pushed = 0;
    for (const receipt of receipts) {
      try {
        const res = await fetch(`${API_BASE}/stock-receipts`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            local_id:       receipt.id,
            status:         receipt.status,
            supplier:       receipt.supplier,
            supplier_id:    receipt.supplier_id,
            invoice_number: receipt.invoice_number,
            staff_id:       receipt.staff_id,
            created_at:     receipt.timestamp,
            activated_at:   receipt.activated_at ?? null,
            items:          receipt.items,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await dbHelpers.markReceiptSynced(receipt.id);
          pushed++;
        }
      } catch {
        continue;
      }
    }
    return { pushed };
  },

  /**
   * Reconcile manually-entered M-Pesa/Pochi codes (typed by the cashier while
   * offline or when STK Push wasn't used) against codes actually seen by the
   * SMS gateway on the shop's till phone.
   *
   * Matches are marked verified. A code that's been pending for longer than
   * STALE_MS with no matching SMS gets flagged (sms_mismatch) for admin
   * review in Transaction History — the sale itself is never auto-voided,
   * since the goods have already left the shop.
   */
  async reconcileSmsCodes() {
    if (!API_BASE) return { verified: 0, flagged: 0 };
    const STALE_MS = 6 * 60 * 60 * 1000; // 6h grace period for the SMS gateway to catch up
    const since = Date.now() - 24 * 60 * 60 * 1000; // look back 24h of SMS codes

    let verified = 0;
    let flagged = 0;
    try {
      const res = await fetch(
        `${API_BASE}/sms/verified-codes?since=${since}`,
        { headers: apiGetHeaders(), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return { verified, flagged };
      const { codes } = await res.json();
      const smsByCode = new Map(codes.map((c) => [String(c.confirmation_code).toUpperCase(), c]));

      const unverified = await db.pending_mpesa
        .filter((p) => !p.verified && !p.sms_mismatch && !!p.code)
        .toArray();

      for (const p of unverified) {
        if (smsByCode.has(String(p.code).toUpperCase())) {
          await db.pending_mpesa.update(p.id, { verified: true });
          verified++;
        } else if (Date.now() - p.timestamp > STALE_MS) {
          await db.pending_mpesa.update(p.id, { sms_mismatch: true });
          flagged++;
        }
      }
    } catch { /* offline — try again next reconnect */ }
    return { verified, flagged };
  },

  async getMpesaMode() {
    if (!API_BASE) return null;
    try {
      const res = await fetch(`${API_BASE}/mpesa/mode`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      return res.json(); // { sandbox: bool }
    } catch {
      return null;
    }
  },

};
