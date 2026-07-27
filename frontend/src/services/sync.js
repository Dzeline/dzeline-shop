import { db, dbHelpers } from "./db";
import { apiHeaders, apiGetHeaders } from "../utils/apiHeaders";
import { useStaffStore } from "../store/staffStore";
import { useSettingsStore } from "../store/settingsStore";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

// Guards against overlapping sync cycles. Every pull function snapshots
// local state near its start and writes new rows near its end — if two
// invocations of the same pull (or a reconnect-triggered cycle overlapping
// an in-progress interval cycle) run concurrently, both can decide the same
// cloud row "isn't local yet" before either has finished inserting it,
// producing a duplicate — a double-counted, double-pushed phantom sale for
// pullTransactions specifically. Shared across runFullSync/runPullSync so
// a running reconnect cycle also blocks a concurrent interval tick and vice
// versa, since both touch the same tables.
let _syncInFlight = false;

async function _withSyncGuard(fn) {
  if (_syncInFlight) return { skipped: true };
  _syncInFlight = true;
  try {
    return await fn();
  } finally {
    _syncInFlight = false;
  }
}

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

    // .filter(), not .where().equals(false) — IndexedDB rejects booleans as
    // keys (IDBKeyRange.bound throws "not a valid key" DataError on browsers
    // that enforce the spec), so any .equals() on a boolean index throws.
    // Deliberately NOT using getUnsyncedTransactions() here — that excludes
    // voided transactions, but voidTransaction() resets synced:false so the
    // voided status itself gets pushed; excluding them here would silently
    // stop void state from ever reaching the cloud.
    const unsynced = await db.transactions.filter((t) => !t.synced).toArray();
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
        // Also attach cost_price as a sale-time snapshot for cross-device COGS.
        const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
        const products = await db.products.bulkGet(productIds);
        const cloudIdMap = new Map(products.filter(Boolean).map((p) => [p.id, p.cloud_id]));
        const costPriceMap = new Map(products.filter(Boolean).map((p) => [p.id, p.cost_price]));
        const itemsWithCloudIds = items.map((i) => ({
          ...i,
          cloud_product_id: cloudIdMap.get(i.product_id) ?? null,
          cost_price: i.cost_price ?? costPriceMap.get(i.product_id) ?? null,
        }));

        // mpesa_code lives in pending_mpesa, not on the transaction row —
        // resolve it here so it actually reaches the backend (previously the
        // spread of `txn` alone never carried it, so no synced transaction
        // has ever had a real mpesa_code server-side until this fix).
        const mpesaRec = await db.pending_mpesa.where("transaction_id").equals(txn.id).first();
        const staffRec = txn.staff_id ? await db.staff.get(txn.staff_id) : null;

        const res = await fetch(`${API_BASE}/sync/transactions`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            ...txn,
            device_id: deviceId,
            mpesa_code: mpesaRec?.code ?? txn.mpesa_code ?? null,
            staff_name: staffRec?.name ?? null,
            items: itemsWithCloudIds,
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          const data = await res.json();
          await db.transactions.update(txn.id, { synced: true, cloud_id: data.id });
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
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || "STK Push failed");
    }
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

  /**
   * Push drafts and activated receipts. Branches on whether the local row
   * already has a cloud_id: no cloud_id -> POST (brand-new local draft,
   * device-scoped create); has cloud_id -> PUT by real id, which covers both
   * "I created this and I'm updating my own draft" AND "I pulled this and
   * I'm activating someone else's draft" — activation is a genuinely
   * cross-device write, so it can't go through the device-scoped POST path.
   */
  async pushUnsyncedReceipts() {
    if (!API_BASE) return { pushed: 0 };
    const receipts = await dbHelpers.getUnsyncedReceipts();
    if (receipts.length === 0) return { pushed: 0 };

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const receipt of receipts) {
      try {
        const productIds = [...new Set(receipt.items.map((i) => i.product_id).filter(Boolean))];
        const products = await db.products.bulkGet(productIds);
        const cloudIdMap = new Map(products.filter(Boolean).map((p) => [p.id, p.cloud_id]));
        const itemsWithCloudIds = receipt.items.map((i) => ({
          ...i,
          cloud_product_id: i.cloud_product_id ?? cloudIdMap.get(i.product_id) ?? null,
        }));

        let res;
        if (receipt.cloud_id) {
          res = await fetch(`${API_BASE}/stock-receipts/${receipt.cloud_id}`, {
            method: "PUT",
            headers: apiHeaders(),
            body: JSON.stringify({
              status:       receipt.status,
              activated_at: receipt.activated_at ?? null,
              items: itemsWithCloudIds.map((i) => ({
                product_id:       i.product_id,
                cloud_product_id: i.cloud_product_id,
                selling_price:    i.selling_price,
                unit_cost:        i.unit_cost,
              })),
            }),
            signal: AbortSignal.timeout(10_000),
          });
        } else {
          res = await fetch(`${API_BASE}/stock-receipts`, {
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
              // Create-only — never resent on the PUT (activation) branch
              // above, since the photo never changes after submission.
              photo_blob:     receipt.photo_blob ?? null,
              items:          itemsWithCloudIds,
            }),
            signal: AbortSignal.timeout(10_000),
          });
        }

        if (res.ok) {
          const data = await res.json();
          await dbHelpers.markReceiptSynced(receipt.id, data.id);
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
    if (!API_BASE) return { pushed: 0, reason: "no API_BASE configured" };
    const unsynced = await dbHelpers.getUnsyncedStaff();
    if (unsynced.length === 0) return { pushed: 0, reason: "nothing unsynced" };

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    const errors = [];
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
        } else {
          const detail = await res.text().catch(() => "");
          console.error("pushUnsyncedStaff: server rejected", res.status, detail);
          errors.push(`${res.status}: ${detail}`);
        }
      } catch (err) {
        console.error("pushUnsyncedStaff: request failed", err);
        errors.push(String(err?.message ?? err));
      }
    }
    return { pushed, total: unsynced.length, errors };
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
          if (currentStaff?.id === existing.id) {
            if (!r.active) {
              useStaffStore.getState().logout();
            } else if (currentStaff.role !== r.role) {
              // A role change alone (not deactivation) refreshes the live
              // session in place rather than forcing a full logout — a
              // demoted admin's UI updates immediately instead of staying
              // stale (with the old permissions) until they happen to log
              // out manually, which was the previously-known gap.
              useStaffStore.getState().setStaff({ ...currentStaff, role: r.role, permissions });
            }
          }
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

  // ── Transaction pull ─────────────────────────────────────────────────────
  // Cross-device Reports correlation: pull other devices' synced sales into
  // the *same* transactions/transaction_items tables (tagged with device_id/
  // cloud_id), rather than a separate mirror table — see plan doc for why.
  //
  // LOAD-BEARING INVARIANT: a foreign-origin row (device_id !== this device's
  // id) must never have `synced` flipped back to false locally. If it is,
  // the next push cycle sends it under *this* device's device_id, the
  // backend's duplicate lookup misses (different device_id), and a phantom
  // duplicate transaction is inserted tenant-wide — double-counting real
  // revenue. This is why TransactionHistory.jsx hides the Void button for
  // txn.origin === "remote". Do not add any other write path that could
  // touch a foreign row's `synced` flag without preserving this guarantee.

  async pullTransactions() {
    if (!API_BASE) return;
    try {
      const myDeviceId = await dbHelpers.getDeviceId();
      const sinceRaw = await dbHelpers.getSetting("last_txn_pull_at");
      // ~35 days back on first-ever pull — covers Reports' widest realistic range.
      const since = sinceRaw ? Number(sinceRaw) : Date.now() - 35 * 24 * 60 * 60 * 1000;

      const res = await fetch(`${API_BASE}/sync/transactions?since=${since}&limit=300`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (rows.length === 0) return;

      const local = await db.transactions.toArray();
      const byCloudId = new Map(local.filter((t) => t.cloud_id != null).map((t) => [t.cloud_id, t]));
      const myLocalIds = new Set(local.filter((t) => t.device_id === myDeviceId).map((t) => t.id));

      const products = await db.products.toArray();
      const productByCloudId = new Map(products.filter((p) => p.cloud_id != null).map((p) => [p.cloud_id, p]));

      let maxUpdatedAt = since;
      for (const r of rows) {
        maxUpdatedAt = Math.max(maxUpdatedAt, r.updated_at ?? 0);

        // "Mine" primarily by device_id match. The local_id fallback covers
        // rows pushed before device_id tracking existed on the backend
        // (NULL there) — without it, this device's own pre-existing history
        // would look foreign and get duplicated locally.
        const isMine = r.device_id === myDeviceId || (r.device_id == null && myLocalIds.has(r.local_id));
        if (isMine) {
          const mine = byCloudId.get(r.id) ?? (myLocalIds.has(r.local_id) ? local.find((t) => t.id === r.local_id) : null);
          if (mine && mine.cloud_id == null) {
            await db.transactions.update(mine.id, { cloud_id: r.id });
          }
          continue; // never re-insert my own transaction
        }

        const existing = byCloudId.get(r.id);
        if (existing) {
          // Items are immutable once synced — only mutable header fields refresh.
          await db.transactions.update(existing.id, { voided: r.voided, etims_status: r.etims_status });
          continue;
        }

        const localTxnId = await db.transactions.add({
          timestamp: r.timestamp,
          subtotal: r.subtotal,
          vat: r.vat,
          total: r.total,
          payment_method: r.payment_method,
          payment_amount: r.payment_amount,
          change_given: r.change_given,
          mpesa_code: r.mpesa_code,
          staff_id: null,
          staff_name: r.staff_name,
          customer_name: r.customer_name,
          customer_phone: r.customer_phone,
          voided: r.voided,
          etims_status: r.etims_status,
          synced: true,
          cloud_id: r.id,
          device_id: r.device_id,
        });

        for (const item of r.items ?? []) {
          await db.transaction_items.add({
            transaction_id: localTxnId,
            product_id: productByCloudId.get(item.cloud_product_id)?.id ?? null,
            // Kept even when product_id resolves — if this device hasn't
            // synced the product yet, it's the only stable identity left for
            // downstream uses (e.g. eTIMS item-code derivation).
            cloud_product_id: item.cloud_product_id ?? null,
            name: item.product_name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
            cost_price: item.cost_price ?? null,
          });
        }
      }

      await dbHelpers.updateSetting("last_txn_pull_at", String(maxUpdatedAt));
    } catch { /* offline — try again next reconnect */ }
  },

  // ── Supplier sync ────────────────────────────────────────────────────────

  async pushUnsyncedSuppliers() {
    if (!API_BASE) return { pushed: 0 };
    const unsynced = await dbHelpers.getUnsyncedSuppliers();
    if (unsynced.length === 0) return { pushed: 0 };

    const deviceId = await dbHelpers.getDeviceId();
    let pushed = 0;
    for (const s of unsynced) {
      try {
        const body = {
          device_id: deviceId,
          local_id: s.id,
          name: s.name,
          phone: s.phone ?? null,
          email: s.email ?? null,
          notes: s.notes ?? null,
        };
        const url = s.cloud_id ? `${API_BASE}/suppliers/${s.cloud_id}` : `${API_BASE}/suppliers`;
        const res = await fetch(url, {
          method: s.cloud_id ? "PUT" : "POST",
          headers: apiHeaders(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          await dbHelpers.markSupplierSynced(s.id, data.id);
          pushed++;
        }
      } catch {
        continue;
      }
    }
    return { pushed };
  },

  /**
   * Pull the tenant's supplier directory and reconcile into local Dexie —
   * same shape as pullStaff: unmatched cloud rows insert locally, a local
   * row with a pending unsynced edit is left alone this cycle, a cloud row
   * marked deleted_at soft-deletes the local row.
   */
  async pullSuppliers() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/suppliers`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const rows = await res.json();

      const local = await db.suppliers.toArray();
      const byCloudId = new Map(local.filter((s) => s.cloud_id != null).map((s) => [s.cloud_id, s]));

      for (const r of rows) {
        const existing = byCloudId.get(r.id);

        if (r.deleted_at) {
          if (existing && !existing.deleted_at) {
            await db.suppliers.update(existing.id, { deleted_at: r.deleted_at, synced: true });
          }
          continue;
        }

        if (existing) {
          if (!existing.synced) continue; // pending local edit — don't clobber
          await db.suppliers.update(existing.id, {
            name: r.name, phone: r.phone, email: r.email, notes: r.notes, synced: true,
          });
        } else {
          await db.suppliers.add({
            name: r.name, phone: r.phone, email: r.email, notes: r.notes,
            created_at: new Date(r.updated_at).toISOString(),
            cloud_id: r.id, deleted_at: null, synced: true, updated_at: r.updated_at,
          });
        }
      }
    } catch { /* offline — try again next reconnect */ }
  },

  // ── Stock receipt sync ───────────────────────────────────────────────────

  /**
   * Pull the tenant's stock receipts (drafts and activated) and reconcile
   * into local Dexie. Unlike transactions, there's no "foreign rows are
   * read-only" rule here — the whole point is that a manager on a different
   * device needs to activate a draft someone else created. That write goes
   * out through pushUnsyncedReceipts()'s PUT-by-cloud_id path, not through
   * this pull; this function only ever reads from the cloud.
   */
  async pullReceipts() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/stock-receipts`, {
        headers: apiGetHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const rows = await res.json();

      const local = await db.stock_receipts.toArray();
      const byCloudId = new Map(local.filter((r) => r.cloud_id != null).map((r) => [r.cloud_id, r]));

      const products = await db.products.toArray();
      const productByCloudId = new Map(products.filter((p) => p.cloud_id != null).map((p) => [p.cloud_id, p]));

      for (const r of rows) {
        const existing = byCloudId.get(r.id);

        if (existing) {
          if (!existing.synced) continue; // pending local edit — don't clobber
          await db.stock_receipts.update(existing.id, {
            status: r.status, activated_at: r.activated_at, synced: true,
          });
          for (const item of r.items ?? []) {
            const local_item = await db.stock_receipt_items
              .where("receipt_id").equals(existing.id)
              .filter((li) => li.cloud_product_id === item.cloud_product_id || li.product_id === item.product_id)
              .first();
            if (local_item) {
              await db.stock_receipt_items.update(local_item.id, {
                selling_price: item.selling_price, unit_cost: item.unit_cost,
              });
            }
          }
          continue;
        }

        const localReceiptId = await db.stock_receipts.add({
          timestamp: r.created_at, supplier: r.supplier, supplier_id: r.supplier_id,
          invoice_number: r.invoice_number, staff_id: r.staff_id,
          status: r.status, activated_at: r.activated_at ?? null,
          photo_blob: r.photo_blob ?? null,
          synced: true, cloud_id: r.id, device_id: r.device_id,
        });
        for (const item of r.items ?? []) {
          await db.stock_receipt_items.add({
            receipt_id: localReceiptId,
            product_id: productByCloudId.get(item.cloud_product_id)?.id ?? null,
            cloud_product_id: item.cloud_product_id ?? null,
            product_name: item.product_name,
            qty_added: item.qty_added,
            qty_before: item.qty_before,
            unit_cost: item.unit_cost,
            selling_price: item.selling_price,
            expiry_date: item.expiry_date,
            condition: item.condition,
          });
        }
      }
    } catch { /* offline — try again next reconnect */ }
  },

  // ── Guarded orchestration ────────────────────────────────────────────────
  // App.jsx calls these instead of firing each push/pull individually, so a
  // slow cycle (e.g. a large first-ever pullTransactions on a poor
  // connection) can't overlap with the next reconnect edge or interval tick.
  // Individual push*/pull* functions stay directly callable and unguarded —
  // components that push immediately after a local mutation (StaffManagement,
  // SuppliersScreen, StockReceiving, etc.) must stay responsive to that one
  // user action regardless of whether a background cycle happens to be running.

  async runFullSync() {
    return _withSyncGuard(async () => {
      await Promise.allSettled([
        this.pushUnsynced(),
        this.pushUnsyncedReceipts(),
        this.resumePendingStkChecks(),
        this.reconcileSmsCodes(),
        this.pushUnsyncedProducts(),
        this.pushUnsyncedStaff(),
        this.pushUnsyncedSuppliers(),
      ]);
      await Promise.allSettled([
        this.pullProducts(),
        this.pullStaff(),
        this.pullSettings(),
        this.pullTransactions(),
        this.pullSuppliers(),
        this.pullReceipts(),
      ]);
    });
  },

  async runPullSync() {
    return _withSyncGuard(async () => {
      await Promise.allSettled([
        this.pullProducts(),
        this.pullStaff(),
        this.pullSettings(),
        this.pullTransactions(),
        this.pullSuppliers(),
        this.pullReceipts(),
      ]);
    });
  },

};
