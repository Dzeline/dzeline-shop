import { db, dbHelpers } from "./db";
import { apiHeaders, apiGetHeaders } from "../utils/apiHeaders";
import { useStaffStore } from "../store/staffStore";
import { useSettingsStore } from "../store/settingsStore";

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

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const txn of unsynced) {
      try {
        const items = await db.transaction_items
          .where("transaction_id")
          .equals(txn.id)
          .toArray();

        // Attach each item's cloud product id (if the product has synced at
        // least once) so the backend can decrement Product.stock server-side
        // — this is how a sale's stock change reaches other devices, not a
        // product push (which would fight with this on an absolute value).
        const productIds = [...new Set(items.map((i) => i.product_id))];
        const products = await db.products.bulkGet(productIds);
        const cloudIdMap = new Map(products.filter(Boolean).map((p) => [p.id, p.cloud_id]));
        const itemsWithCloudIds = items.map((i) => ({
          ...i,
          cloud_product_id: cloudIdMap.get(i.product_id) ?? null,
        }));

        const res = await fetch(`${API_BASE}/sync/transactions`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ ...txn, device_id: deviceId, items: itemsWithCloudIds }),
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

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const receipt of receipts) {
      try {
        const res = await fetch(`${API_BASE}/stock-receipts`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            local_id:       receipt.id,
            device_id:      deviceId,
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

  // ── Staff sync ───────────────────────────────────────────────────────────
  // Cloud is transport only — PIN login always stays a local Dexie lookup.

  async pushUnsyncedStaff() {
    if (!API_BASE) return { pushed: 0 };
    const unsynced = await dbHelpers.getUnsyncedStaff();
    if (unsynced.length === 0) return { pushed: 0 };

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const s of unsynced) {
      try {
        const body = {
          device_id: deviceId,
          local_id: s.id,
          name: s.name,
          pin_hash: s.pin,
          role: s.role,
          permissions: s.role === "custom" ? JSON.stringify(s.permissions ?? []) : null,
          active: s.active,
        };
        const url = s.cloud_id ? `${API_BASE}/staff/${s.cloud_id}` : `${API_BASE}/staff`;
        const res = await fetch(url, {
          method: s.cloud_id ? "PUT" : "POST",
          headers: apiHeaders(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          await dbHelpers.markStaffSynced(s.id, data.id);
          pushed++;
        }
      } catch {
        continue;
      }
    }
    return { pushed };
  },

  /**
   * Pull the tenant's staff roster and reconcile into local Dexie.
   * - Unmatched cloud rows (new cloud_id) insert locally.
   * - A local row with pending unsynced edits is left alone this cycle —
   *   overwriting it would silently discard the not-yet-pushed change.
   * - A cloud row marked deleted_at soft-deletes the local row and force-logs
   *   out that staff member's session if it's open on this device.
   */
  async pullStaff() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/staff`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const rows = await res.json();

      const local = await db.staff.toArray();
      const byCloudId = new Map(local.filter((s) => s.cloud_id != null).map((s) => [s.cloud_id, s]));
      const currentStaff = useStaffStore.getState().currentStaff;

      for (const r of rows) {
        const existing = byCloudId.get(r.id);
        const permissions = r.permissions ? JSON.parse(r.permissions) : [];

        if (r.deleted_at) {
          if (existing && !existing.deleted_at) {
            await db.staff.update(existing.id, { active: false, deleted_at: r.deleted_at, synced: true });
            if (currentStaff?.id === existing.id) useStaffStore.getState().logout();
          }
          continue;
        }

        if (existing) {
          if (!existing.synced) continue; // pending local edit — don't clobber
          await db.staff.update(existing.id, {
            name: r.name, pin: r.pin_hash, role: r.role, permissions, active: r.active, synced: true,
          });
          if (currentStaff?.id === existing.id && !r.active) useStaffStore.getState().logout();
        } else {
          await db.staff.add({
            name: r.name, pin: r.pin_hash, role: r.role, permissions, active: r.active,
            created_at: new Date(r.updated_at).toISOString(),
            cloud_id: r.id, deleted_at: null, synced: true, updated_at: r.updated_at,
          });
        }
      }
    } catch { /* offline — try again next reconnect */ }
  },

  // ── Product sync ─────────────────────────────────────────────────────────

  async pushUnsyncedProducts() {
    if (!API_BASE) return { pushed: 0 };
    const unsynced = await dbHelpers.getUnsyncedProducts();
    if (unsynced.length === 0) return { pushed: 0 };

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const p of unsynced) {
      try {
        const body = {
          device_id: deviceId,
          local_id: p.id,
          barcode: p.barcode ?? null,
          name: p.name,
          price: p.price,
          stock: p.stock,
          category: p.category ?? null,
          reorder_level: p.reorder_level ?? 10,
        };
        const url = p.cloud_id ? `${API_BASE}/products/${p.cloud_id}` : `${API_BASE}/products/`;
        const res = await fetch(url, {
          method: p.cloud_id ? "PUT" : "POST",
          headers: apiHeaders(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          await dbHelpers.markProductSynced(p.id, data.id);
          pushed++;
        }
      } catch {
        continue;
      }
    }
    return { pushed };
  },

  /**
   * Pull the tenant's product catalogue and reconcile into local Dexie.
   * Stock is deliberately NOT overwritten for a product referenced by a
   * transaction or stock receipt that hasn't pushed yet — sale-driven stock
   * changes reach the cloud via /sync/transactions' server-side decrement,
   * not this path, and a stale snapshot landing mid-flight must not revert
   * a till's own in-progress decrement.
   */
  async pullProducts() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/products/`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const rows = await res.json();

      const [unsyncedTxns, unsyncedReceipts] = await Promise.all([
        dbHelpers.getUnsyncedTransactions(),
        dbHelpers.getUnsyncedReceipts(),
      ]);
      const protectedIds = new Set();
      for (const t of unsyncedTxns) {
        const items = await db.transaction_items.where("transaction_id").equals(t.id).toArray();
        items.forEach((i) => protectedIds.add(i.product_id));
      }
      for (const r of unsyncedReceipts) {
        (r.items ?? []).forEach((i) => protectedIds.add(i.product_id));
      }

      const local = await db.products.toArray();
      const byCloudId = new Map(local.filter((p) => p.cloud_id != null).map((p) => [p.cloud_id, p]));

      for (const r of rows) {
        const existing = byCloudId.get(r.id);
        if (existing) {
          if (!existing.synced) continue; // pending local edit — don't clobber
          const update = {
            barcode: r.barcode, name: r.name, price: r.price,
            category: r.category, reorder_level: r.reorder_level,
            synced: true, updated_at: r.updated_at,
          };
          if (!protectedIds.has(existing.id)) update.stock = r.stock;
          await db.products.update(existing.id, update);
        } else {
          await db.products.add({
            barcode: r.barcode, name: r.name, price: r.price, stock: r.stock,
            category: r.category, reorder_level: r.reorder_level, tags: [],
            cloud_id: r.id, synced: true, updated_at: r.updated_at,
          });
        }
      }
    } catch { /* offline — try again next reconnect */ }
  },

  // ── Shop settings sync ───────────────────────────────────────────────────
  // Push only fires from explicit user actions (Setup Wizard finish, Settings
  // screen save) — not the recurring reconnect/interval loop, which only
  // pulls. Settings change rarely and are admin-driven from one device at a
  // time; pushing unconditionally on every reconnect from every device would
  // race with itself for no benefit.

  async pushSettings() {
    if (!API_BASE) return;
    try {
      const s = await dbHelpers.getShopSettings();
      await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: apiHeaders(),
        body: JSON.stringify({
          shop_name: s.shop_name || null,
          town: s.town || null,
          phone: s.phone || null,
          kra_pin: s.kra_pin || null,
          vat_enabled: s.vat_enabled !== "false",
          vat_rate: parseFloat(s.vat_rate) || null,
          till_number: s.mpesa_till || null,
          pochi_number: s.pochi_number || null,
          mpesa_till_type: s.mpesa_till_type || null,
          currency: s.currency || null,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* offline — try again next reconnect */ }
  },

  /**
   * Pull shop settings from the cloud. Skips applying anything if no device
   * has ever pushed settings yet (settings_updated_at is null) — otherwise a
   * fresh/empty tenant record would blank out a perfectly good local setup.
   */
  async pullSettings() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const s = await res.json();
      if (!s.settings_updated_at) return;

      await dbHelpers.saveShopSettings({
        shop_name: s.shop_name ?? "Dzeline Shop",
        town: s.town ?? "",
        phone: s.phone ?? "",
        kra_pin: s.kra_pin ?? "",
        vat_enabled: String(s.vat_enabled ?? true),
        vat_rate: String(s.vat_rate ?? 0.16),
        mpesa_till: s.till_number ?? "",
        mpesa_till_type: s.mpesa_till_type ?? "",
        pochi_number: s.pochi_number ?? "",
        currency: s.currency ?? "KES",
      });
      useSettingsStore.getState().reload();
    } catch { /* offline — try again next reconnect */ }
  },

};
