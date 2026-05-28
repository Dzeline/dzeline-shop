/**
 * eTIMS frontend service.
 * Builds submission payloads from local IndexedDB data and sends them
 * to our FastAPI backend, which handles the KRA API calls.
 */
import { dbHelpers } from "./db";

const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const etimsService = {
  /**
   * Check whether the backend has eTIMS credentials configured.
   */
  async getStatus() {
    const resp = await fetch(`${BACKEND_URL}/etims/status`);
    if (!resp.ok) throw new Error(`eTIMS status check failed: ${resp.status}`);
    return resp.json();
  },

  /**
   * Load current eTIMS config from backend DB.
   */
  async loadConfig() {
    const resp = await fetch(`${BACKEND_URL}/etims/config`);
    if (!resp.ok) throw new Error(`eTIMS config load failed: ${resp.status}`);
    return resp.json();
  },

  /**
   * Save eTIMS config to backend DB.
   * @param {{ tin: string, bhf_id: string, dvc_srl_no: string, env: string }} cfg
   */
  async saveConfig(cfg) {
    const resp = await fetch(`${BACKEND_URL}/etims/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Config save failed: ${resp.status}`);
    }
    return resp.json();
  },

  /**
   * Query KRA for branches registered under a TIN.
   * @param {string} tin
   * @param {string} bhfId
   */
  async getBranches(tin, bhfId = "00") {
    const resp = await fetch(`${BACKEND_URL}/etims/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tin, bhf_id: bhfId }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Branch query failed: ${resp.status}`);
    }
    return resp.json();
  },

  /**
   * Initialize device with KRA. Backend reads config from DB.
   */
  async initDevice() {
    const resp = await fetch(`${BACKEND_URL}/etims/device/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Device init failed: ${resp.status}`);
    }
    return resp.json();
  },

  /**
   * Submit a batch of transactions to KRA via the backend.
   * @param {number[]} txnIds - Local transaction IDs to submit
   * @param {object}   opts   - { vatRate, taxpayerName }
   * @returns {object} { results, submitted, failed, skipped }
   */
  async submitBatch(txnIds, { vatRate = 0.16, taxpayerName = "Admin" } = {}) {
    // Fetch full transaction+items data for each ID
    const transactions = (
      await Promise.all(txnIds.map((id) => dbHelpers.getTransactionWithItems(id)))
    ).filter(Boolean).map((txn) => ({
      local_id:       txn.id,
      timestamp:      txn.timestamp,
      items:          txn.items,
      subtotal:       txn.subtotal,
      vat:            txn.vat,
      total:          txn.total,
      payment_method: txn.payment_method,
      voided:         txn.voided || false,
      rcpt_typ:       txn.voided ? "R" : "S",
    }));

    if (transactions.length === 0) return { results: [], submitted: 0, failed: 0, skipped: 0 };

    const resp = await fetch(`${BACKEND_URL}/etims/submit-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions, vat_rate: vatRate, taxpayer_name: taxpayerName }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Submission failed: ${resp.status}`);
    }

    const data = await resp.json();

    // Write KRA results back to IndexedDB
    await dbHelpers.bulkUpdateEtimsStatus(data.results);

    return data;
  },

  /**
   * Register products with KRA's item catalogue.
   * @param {object[]} products - Array of product objects from IndexedDB
   */
  async registerItems(products) {
    const items = products.map((p) => ({
      product_id:    p.id,
      name:          p.name,
      barcode:       p.barcode || null,
      price:         p.price,
      etims_item_cd: p.etims_item_cd || null,
      item_cls_cd:   p.item_cls_cd || "10000000",
      pkg_unit_cd:   p.pkg_unit_cd || "NT",
      qty_unit_cd:   p.qty_unit_cd || "U",
      tax_typ_cd:    "A",
    }));

    const resp = await fetch(`${BACKEND_URL}/etims/items/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Item registration failed: ${resp.status}`);
    }
    return resp.json();
  },
};
