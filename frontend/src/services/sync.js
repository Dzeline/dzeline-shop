import { db } from "./db";

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
          { signal: AbortSignal.timeout(15_000) },
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

  /**
   * Pull recently SMS-verified M-Pesa codes from the backend (posted there
   * by android-sms-gateway) and mark matching pending_mpesa rows as verified.
   */
  async reconcileSmsVerifications() {
    if (!API_BASE) return;
    const lastCheck = await db.settings.get("sms_verify_last_check");
    const since = lastCheck?.value ?? "0";
    try {
      const res = await fetch(
        `${API_BASE}/sms/verified-codes?since=${since}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return;
      const { codes } = await res.json();
      for (const item of codes) {
        const row = await db.pending_mpesa
          .filter((p) => !p.verified && p.code === item.confirmation_code)
          .first();
        if (row) {
          await db.pending_mpesa.update(row.id, { verified: true });
        }
      }
      await db.settings.put({ key: "sms_verify_last_check", value: String(Date.now()) });
    } catch { /* backend offline — skip */ }
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
