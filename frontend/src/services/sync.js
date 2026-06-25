import { db } from "./db";
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
        break;
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
