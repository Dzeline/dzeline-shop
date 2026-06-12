import Dexie from "dexie";

// SHA-256 PIN hashing via Web Crypto (no external dependency)
export async function hashPin(pin) {
  const encoded = new TextEncoder().encode(String(pin));
  const buf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Initialize database
export const db = new Dexie("DzelineShop");

// Define schema
db.version(1).stores({
  // Products table
  products: "++id, barcode, name, price, stock, category, *tags",

  // Transactions (completed sales)
  transactions: "++id, timestamp, total, payment_method, synced, staff_id",

  // Transaction items (line items for each sale)
  transaction_items:
    "++id, transaction_id, product_id, quantity, price, subtotal",

  // Pending M-Pesa payments (needs verification)
  pending_mpesa: "++id, transaction_id, code, timestamp, verified, amount",

  // Sync queue (operations waiting to sync to server)
  sync_queue: "++id, type, data, attempts, last_attempt, status",

  // Staff (cashiers)
  staff: "++id, name, pin, active, created_at",

  // App settings
  settings: "key, value",
});

db.version(2).stores({
  stock_receipts: "++id, timestamp, supplier, staff_id",
});

db.version(3).stores({
  products: "++id, barcode, name, price, stock, category, reorder_level, *tags",
});

db.version(4).stores({
  suppliers: "++id, name, created_at",
});

db.version(5).stores({
  sync_queue: null,                                                        // drop unused table
  staff: "++id, name, pin, role, active, created_at",                     // add role index
  stock_receipts: "++id, timestamp, supplier, supplier_id, staff_id",     // add supplier_id FK
}).upgrade(async (tx) => {
  // Assign roles from the old id===1 convention and hash any plaintext PINs
  await tx.table("staff").toCollection().modify(async (s) => {
    s.role = s.id === 1 ? "admin" : "cashier";
    if (s.pin && s.pin.length < 64) {
      s.pin = await hashPin(s.pin);
    }
  });
  await tx.table("stock_receipts").toCollection().modify({ supplier_id: null });
  await tx.table("transactions").toCollection().modify({ voided: false });
});

// Version 6: add cost_price to products index (stored as field since v1, now indexed)
db.version(6).stores({
  products: "++id, barcode, name, price, cost_price, stock, category, reorder_level, *tags",
});

// Version 7: eTIMS — index etims_status on transactions, etims_item_cd on products
db.version(7).stores({
  products:     "++id, barcode, name, price, cost_price, stock, category, etims_item_cd, reorder_level, *tags",
  transactions: "++id, timestamp, total, payment_method, synced, staff_id, etims_status",
}).upgrade((tx) => {
  // Backfill etims_status = "pending" for all existing transactions
  return tx.table("transactions").toCollection().modify({ etims_status: "pending" });
});

// Version 8: M-Pesa deferred verification — index checkout_request_id on pending_mpesa
db.version(8).stores({
  pending_mpesa: "++id, transaction_id, code, checkout_request_id, timestamp, verified, amount",
});

// Seed initial data on first run
db.on("populate", async () => {
  // Seed demo products so new users see a working product list immediately.
  // No admin is seeded here — the Setup Wizard creates the real admin so there
  // is never a "default PIN 1234" vulnerability on production installs.
  await db.products.bulkAdd([
    { barcode: "2001", name: "Unga 2kg",        price: 200, stock: 50,  category: "Grains",    tags: ["flour", "baking"] },
    { barcode: "2002", name: "Sugar 1kg",        price: 150, stock: 30,  category: "Sugar",     tags: ["sugar", "sweetener"] },
    { barcode: "2003", name: "Milk 500ml",       price: 60,  stock: 100, category: "Dairy",     tags: ["milk", "dairy", "fresh"] },
    { barcode: "2004", name: "Cooking Oil 1L",   price: 280, stock: 20,  category: "Oils",      tags: ["oil", "cooking"] },
    { barcode: "2005", name: "Rice 1kg",         price: 180, stock: 40,  category: "Grains",    tags: ["rice", "grains"] },
    { barcode: "2006", name: "Bread 400g",       price: 50,  stock: 25,  category: "Bakery",    tags: ["bread", "bakery", "fresh"] },
    { barcode: "2007", name: "Eggs (Tray)",      price: 350, stock: 15,  category: "Dairy",     tags: ["eggs", "protein"] },
    { barcode: "2008", name: "Tea Leaves 250g",  price: 120, stock: 60,  category: "Beverages", tags: ["tea", "drinks"] },
    { barcode: "2009", name: "Salt 500g",        price: 40,  stock: 100, category: "Spices",    tags: ["salt", "seasoning"] },
    { barcode: "2010", name: "Soap 200g",        price: 80,  stock: 45,  category: "Household", tags: ["soap", "cleaning"] },
  ]);

  // Mark setup as explicitly pending so isSetupComplete() never short-circuits
  // via the staff-count auto-migration path on a fresh install.
  await db.settings.bulkAdd([
    { key: "setup_complete", value: "false" },
    { key: "vat_rate",       value: "0.16" },
    { key: "currency",       value: "KES" },
  ]);
});

// Helper functions for common operations
export const dbHelpers = {
  // Get all products
  async getAllProducts() {
    return await db.products.toArray();
  },

  // Search products by name or barcode
  async searchProducts(query) {
    const lowerQuery = query.toLowerCase();
    return await db.products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          p.barcode.includes(query) ||
          p.tags.some((tag) => tag.includes(lowerQuery)),
      )
      .toArray();
  },

  // Get product by barcode
  async getProductByBarcode(barcode) {
    return await db.products.where("barcode").equals(barcode).first();
  },

  // Update product stock
  async updateStock(productId, newStock) {
    return await db.products.update(productId, { stock: newStock });
  },

  // Update any product fields (name, price, image_blob, reorder_level, etc.)
  async updateProduct(productId, updates) {
    return await db.products.update(productId, updates);
  },

  // Get products at or below their reorder level
  async getLowStockProducts(threshold = 10) {
    return await db.products
      .filter((p) => p.stock <= (p.reorder_level ?? threshold) && p.stock >= 0)
      .toArray();
  },

  // Add transaction
  async addTransaction(transaction) {
    return await db.transactions.add(transaction);
  },

  // Get unsynced transactions (excludes voided)
  async getUnsyncedTransactions() {
    return await db.transactions
      .where("synced").equals(false)
      .filter((t) => !t.voided)
      .toArray();
  },

  // Void a transaction — marks it as voided and resets synced flag
  async voidTransaction(id) {
    return await db.transactions.update(id, { voided: true, synced: false });
  },

  // Get setting value
  async getSetting(key) {
    const setting = await db.settings.get(key);
    return setting ? setting.value : null;
  },

  // Update setting
  async updateSetting(key, value) {
    return await db.settings.put({ key, value });
  },

  // Cloud API key (set during Setup Wizard or Settings screen)
  async getApiKey() {
    return await this.getSetting("api_key");
  },

  async saveApiKey(key) {
    return await db.settings.put({ key: "api_key", value: key });
  },

  // Get today's sales
  async getTodaySales() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return await db.transactions
      .where("timestamp")
      .above(startOfDay.getTime())
      .toArray();
  },

  // Calculate today's total
  async getTodayTotal() {
    const sales = await this.getTodaySales();
    return sales.reduce((sum, txn) => sum + txn.total, 0);
  },

  // Complete a sale atomically: insert transaction, line items, decrement stock
  async completeTransaction(cartItems, payment, staffId = 1) {
    return await db.transaction(
      "rw",
      [db.transactions, db.transaction_items, db.products, db.pending_mpesa],
      async () => {
        const now = Date.now();
        const transactionId = await db.transactions.add({
          timestamp: now,
          subtotal: payment.subtotal,
          vat: payment.vat,
          total: payment.total,
          payment_method: payment.method,
          payment_amount: payment.amount,
          change_given: payment.method === "CASH" ? payment.change : 0,
          synced: false,
          voided: false,
          staff_id: staffId,
        });

        for (const item of cartItems) {
          await db.transaction_items.add({
            transaction_id: transactionId,
            product_id: item.id,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.price * item.quantity,
          });

          const product = await db.products.get(item.id);
          if (product) {
            await db.products.update(item.id, {
              stock: Math.max(0, product.stock - item.quantity),
            });
          }
        }

        if (payment.method === "MPESA" || payment.method === "POCHI") {
          await db.pending_mpesa.add({
            transaction_id: transactionId,
            code: payment.mpesaCode ?? payment.pochiCode ?? null,
            checkout_request_id: payment.checkoutRequestId ?? null,
            timestamp: now,
            verified: false,
            amount: payment.total,
          });
        }

        return {
          id: transactionId,
          items: cartItems,
          timestamp: now,
          staff_id: staffId,
          ...payment,
        };
      }
    );
  },

  // Get recent transactions with line items enriched with product names and mpesa codes
  async getTransactionHistory(limit = 20) {
    const txns = await db.transactions
      .orderBy("timestamp")
      .reverse()
      .limit(limit)
      .toArray();

    const allItems = await Promise.all(
      txns.map((txn) =>
        db.transaction_items.where("transaction_id").equals(txn.id).toArray()
      )
    );

    const productIds = [...new Set(allItems.flat().map((i) => i.product_id))];
    const products = await db.products.bulkGet(productIds);
    const nameMap = new Map(products.filter(Boolean).map((p) => [p.id, p.name]));

    // Attach M-Pesa / Pochi codes from pending_mpesa (single source of truth)
    const txnIds = txns.map((t) => t.id);
    const mpesaRecs = await db.pending_mpesa
      .where("transaction_id").anyOf(txnIds).toArray();
    const mpesaMap = new Map(mpesaRecs.map((r) => [r.transaction_id, r.code]));

    return txns.map((txn, i) => ({
      ...txn,
      mpesa_code: mpesaMap.get(txn.id) ?? null,
      items: allItems[i].map((item) => ({
        ...item,
        name: nameMap.get(item.product_id) ?? null,
      })),
    }));
  },

  // ── Staff helpers ─────────────────────────────────────────────────────────

  async getAllStaff() {
    return await db.staff.toArray();
  },

  async getStaffByPin(pin, staffId = null) {
    const hashed = await hashPin(pin);
    const matchHashed = staffId != null
      ? (s) => s.pin === hashed && s.active && s.id === staffId
      : (s) => s.pin === hashed && s.active;
    let staff = await db.staff.filter(matchHashed).first();
    if (staff) return staff;
    // Backward-compat: v5 migration may have left some PINs unhashed
    const matchPlain = staffId != null
      ? (s) => s.pin === pin && s.active && s.id === staffId
      : (s) => s.pin === pin && s.active;
    staff = await db.staff.filter(matchPlain).first();
    if (staff) {
      await db.staff.update(staff.id, { pin: hashed });
      return staff;
    }
    return null;
  },

  async addStaff(name, pin, role = "cashier", permissions = []) {
    const hashed = await hashPin(pin);
    return await db.staff.add({
      name,
      pin: hashed,
      role,
      permissions: role === "custom" ? permissions : [],
      active: true,
      created_at: new Date().toISOString(),
    });
  },

  async updateStaffRole(staffId, role, permissions = []) {
    return await db.staff.update(staffId, {
      role,
      permissions: role === "custom" ? permissions : [],
    });
  },

  async updateStaffPin(staffId, newPin) {
    const hashed = await hashPin(newPin);
    return await db.staff.update(staffId, { pin: hashed });
  },

  async updateStaffName(staffId, name) {
    return await db.staff.update(staffId, { name });
  },

  async toggleStaffActive(staffId, active) {
    return await db.staff.update(staffId, { active });
  },

  async deleteStaff(staffId) {
    return await db.staff.delete(staffId);
  },

  // ── Stock receiving ───────────────────────────────────────────────────────

  async addStockReceipt({ supplier, supplier_id, invoice_number, photo_blob, items, staff_id }) {
    return await db.transaction("rw", [db.stock_receipts, db.products], async () => {
      const itemsWithBefore = await Promise.all(
        items.map(async ({ product_id, qty_added, unit_cost }) => {
          const product = await db.products.get(product_id);
          const qty_before = product ? product.stock : 0;
          const productUpdate = { stock: qty_before + qty_added };
          if (unit_cost != null && unit_cost > 0) productUpdate.cost_price = unit_cost;
          if (product) await db.products.update(product_id, productUpdate);
          return { product_id, product_name: product?.name ?? "Unknown", qty_before, qty_added, unit_cost: unit_cost ?? null };
        })
      );
      return await db.stock_receipts.add({
        timestamp: Date.now(),
        supplier,
        supplier_id: supplier_id ?? null,
        invoice_number: invoice_number || null,
        photo_blob: photo_blob || null,
        items: itemsWithBefore,
        staff_id,
      });
    });
  },

  async getStockReceiptHistory(limit = 20) {
    return await db.stock_receipts.orderBy("timestamp").reverse().limit(limit).toArray();
  },

  // ── Shop settings ────────────────────────────────────────────────────────

  async getShopSettings() {
    const keys = [
      "shop_name", "town", "phone", "kra_pin",
      "vat_enabled", "vat_rate", "mpesa_till", "pochi_number",
      "currency", "setup_complete",
    ];
    const rows = await db.settings.bulkGet(keys);
    const result = {};
    keys.forEach((k, i) => { result[k] = rows[i]?.value ?? null; });
    return result;
  },

  async saveShopSettings(obj) {
    const entries = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    await db.settings.bulkPut(entries);
  },

  async isSetupComplete() {
    const flag = await this.getSetting("setup_complete");
    if (flag === "true") return true;
    if (flag !== null) return false;
    // Auto-migrate: existing install with staff already seeded
    const staffCount = await db.staff.count();
    if (staffCount > 0) {
      await this.updateSetting("setup_complete", "true");
      return true;
    }
    return false;
  },

  // ── Daily analytics ───────────────────────────────────────────────────────

  // ── Suppliers ─────────────────────────────────────────────────────────────

  async getAllSuppliers() {
    return await db.suppliers.orderBy("name").toArray();
  },

  async addSupplier({ name, phone, email, notes }) {
    return await db.suppliers.add({
      name,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
      created_at: new Date().toISOString(),
    });
  },

  async updateSupplier(id, updates) {
    return await db.suppliers.update(id, updates);
  },

  async deleteSupplier(id) {
    return await db.suppliers.delete(id);
  },

  // ── Daily analytics ───────────────────────────────────────────────────────

  async getDailySummary(startMs) {
    const start = startMs ?? (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    const txns = (await db.transactions
      .where("timestamp")
      .above(start)
      .toArray())
      .filter((t) => !t.voided);

    const empty = {
      totalSales: 0, transactionCount: 0,
      cashTotal: 0, mpesaTotal: 0, pochiTotal: 0,
      vatCollected: 0, topProducts: [], staffBreakdown: [],
    };
    if (txns.length === 0) return empty;

    const allItems = await db.transaction_items
      .where("transaction_id")
      .anyOf(txns.map((t) => t.id))
      .toArray();

    const productMap = new Map();
    for (const item of allItems) {
      const e = productMap.get(item.product_id) || { product_id: item.product_id, name: null, totalQty: 0, totalRevenue: 0 };
      e.totalQty += item.quantity;
      e.totalRevenue += item.subtotal;
      productMap.set(item.product_id, e);
    }

    const products = await db.products.bulkGet([...productMap.keys()]);
    products.forEach((p) => { if (p) productMap.get(p.id).name = p.name; });

    // Cashier breakdown
    const staffIds = [...new Set(txns.map((t) => t.staff_id).filter(Boolean))];
    const staffMembers = await db.staff.bulkGet(staffIds);
    const staffNameMap = new Map(staffMembers.filter(Boolean).map((s) => [s.id, s.name]));
    const staffTotals = {};
    for (const txn of txns) {
      const name = staffNameMap.get(txn.staff_id) ?? "Unknown";
      if (!staffTotals[name]) staffTotals[name] = { name, count: 0, total: 0 };
      staffTotals[name].count++;
      staffTotals[name].total += txn.total || 0;
    }

    return {
      totalSales: txns.reduce((s, t) => s + (t.total || 0), 0),
      transactionCount: txns.length,
      cashTotal: txns.filter((t) => t.payment_method === "CASH").reduce((s, t) => s + (t.total || 0), 0),
      mpesaTotal: txns.filter((t) => t.payment_method === "MPESA").reduce((s, t) => s + (t.total || 0), 0),
      pochiTotal: txns.filter((t) => t.payment_method === "POCHI").reduce((s, t) => s + (t.total || 0), 0),
      vatCollected: txns.reduce((s, t) => s + (t.vat || 0), 0),
      topProducts: [...productMap.values()].sort((a, b) => b.totalQty - a.totalQty).slice(0, 5),
      staffBreakdown: Object.values(staffTotals).sort((a, b) => b.total - a.total),
    };
  },

  // ── eTIMS helpers ─────────────────────────────────────────────────────────

  async getEtimsQueue(limit = 200) {
    // Returns transactions that haven't been successfully submitted yet
    return await db.transactions
      .where("etims_status")
      .anyOf(["pending", "failed"])
      .filter((t) => !t.voided)
      .reverse()
      .limit(limit)
      .toArray();
  },

  async getEtimsSubmitted(limit = 100) {
    return await db.transactions
      .where("etims_status").equals("submitted")
      .reverse()
      .limit(limit)
      .toArray();
  },

  async updateEtimsStatus(txnId, status, etimsData = {}) {
    return await db.transactions.update(txnId, {
      etims_status: status,
      ...etimsData,
    });
  },

  async bulkUpdateEtimsStatus(results) {
    // results: [{ local_id, status, cu_invc_no, rcpt_sign, sdc_id, invc_no, error }]
    await db.transaction("rw", db.transactions, async () => {
      for (const r of results) {
        const updates = { etims_status: r.status };
        if (r.cu_invc_no)  updates.etims_cu_invc_no  = r.cu_invc_no;
        if (r.rcpt_sign)   updates.etims_rcpt_sign    = r.rcpt_sign;
        if (r.sdc_id)      updates.etims_sdc_id       = r.sdc_id;
        if (r.invc_no)     updates.etims_invc_no      = r.invc_no;
        if (r.error)       updates.etims_error        = r.error;
        await db.transactions.update(r.local_id, updates);
      }
    });
  },

  async getTransactionWithItems(txnId) {
    const txn = await db.transactions.get(txnId);
    if (!txn) return null;
    const items = await db.transaction_items
      .where("transaction_id").equals(txnId)
      .toArray();
    // Enrich items with product details for eTIMS payload
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const products = await db.products.bulkGet(productIds);
    const productMap = new Map(products.filter(Boolean).map((p) => [p.id, p]));
    return {
      ...txn,
      items: items.map((item) => {
        const product = productMap.get(item.product_id) || {};
        return {
          product_id:    item.product_id,
          name:          item.name || product.name || "Unknown",
          barcode:       product.barcode || null,
          qty:           item.quantity,
          price:         item.price,
          etims_item_cd: product.etims_item_cd || null,
          item_cls_cd:   product.item_cls_cd || "10000000",
          pkg_unit_cd:   product.pkg_unit_cd || "NT",
          qty_unit_cd:   product.qty_unit_cd || "U",
        };
      }),
    };
  },
};

export default db;
