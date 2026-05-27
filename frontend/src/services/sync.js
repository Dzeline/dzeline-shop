import { db } from "./db";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const syncService = {
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
          headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: transactionId ?? null, phone_number: phoneNumber, amount }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error("STK Push failed");
    return res.json();
  },

  async getMpesaStkStatus(checkoutRequestId) {
    const res = await fetch(
      `${API_BASE}/mpesa/status/${encodeURIComponent(checkoutRequestId)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error("Status check failed");
    return res.json(); // { checkout_request_id, status, mpesa_code }
  },
};
