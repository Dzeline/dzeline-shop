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

// Version 9: staged stock receiving — receipts now sit as "draft" until manager activates them.
//   stock_receipts gains status + synced indices.
//   stock_receipt_items is a new normalised table replacing the embedded items array.
//   Existing receipts backfilled as "activated" (stock was already incremented for them).
db.version(9).stores({
  stock_receipts:      "++id, timestamp, supplier, supplier_id, staff_id, status, synced",
  stock_receipt_items: "++id, receipt_id, product_id",
}).upgrade((tx) =>
  tx.table("stock_receipts").toCollection().modify({ status: "activated", synced: true })
);

// Version 10: multi-device sync — staff and products can now push to / pull
// from the cloud. cloud_id links a local row to its backend id (null until
// first successfully pushed); synced follows the same idiom already used on
// transactions/stock_receipts; deleted_at is a tombstone (staff are now
// soft-deleted so an unsynced delete can't be silently undone by a pull that
// lands first).
db.version(10).stores({
  staff:    "++id, name, pin, role, active, created_at, cloud_id, updated_at, deleted_at, synced",
  products: "++id, barcode, name, price, cost_price, stock, category, etims_item_cd, reorder_level, cloud_id, updated_at, synced, *tags",
}).upgrade(async (tx) => {
  const now = Date.now();
  // Mark everything unsynced so it pushes to the cloud on first reconnect
  // after upgrading — existing local rosters/catalogs have never been pushed.
  await tx.table("staff").toCollection().modify({ cloud_id: null, updated_at: now, deleted_at: null, synced: false });
  await tx.table("products").toCollection().modify({ cloud_id: null, updated_at: now, synced: false });
});

// Version 11: cross-device transaction pull — transactions can now be pulled
// down from other devices, not just pushed up. device_id tags who created a
// row (needed to tell "mine" from "foreign" on pull, so foreign rows are
// never re-inserted or re-pushed); cloud_id links a local row to its backend
// id. Every pre-existing local transaction was created on this device.
db.version(11).stores({
  transactions: "++id, timestamp, total, payment_method, synced, staff_id, etims_status, cloud_id, device_id",
}).upgrade(async (tx) => {
  let deviceRow = await tx.table("settings").get("device_id");
  let deviceId = deviceRow?.value;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await tx.table("settings").put({ key: "device_id", value: deviceId });
  }
  await tx.table("transactions").toCollection().modify({ cloud_id: null, device_id: deviceId });
});

// Version 12: supplier directory sync — same cloud_id/synced/deleted_at
// idiom as staff/products, so two tills stop building independent,
// uncorrelated supplier lists.
db.version(12).stores({
  suppliers: "++id, name, created_at, cloud_id, updated_at, deleted_at, synced",
}).upgrade(async (tx) => {
  const now = Date.now();
  await tx.table("suppliers").toCollection().modify({ cloud_id: null, updated_at: now, deleted_at: null, synced: false });
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
    return await db.products.update(productId, { stock: newStock, synced: false, updated_at: Date.now() });
  },

  // Update any product fields (name, price, image_blob, reorder_level, etc.)
  async updateProduct(productId, updates) {
    return await db.products.update(productId, { ...updates, synced: false, updated_at: Date.now() });
  },

  // Add a new product — attaches sync metadata so it pushes on next reconnect
  async addProduct(product) {
    return await db.products.add({
      ...product,
      cloud_id: null,
      synced: false,
      updated_at: Date.now(),
    });
  },

  // Get products at or below their reorder level
  async getLowStockProducts(threshold = 10) {
    return await db.products
      .filter((p) => p.stock <= (p.reorder_level ?? threshold) && p.stock >= 0)
      .toArray();
  },

  // ── Product sync ─────────────────────────────────────────────────────────

  async getUnsyncedProducts() {
    // .filter(), not .where().equals(false) — IndexedDB rejects booleans as
    // keys (IDBKeyRange.bound throws "not a valid key"), so any .equals() on
    // a boolean-valued index throws a DataError on browsers that enforce it.
    return await db.products.filter((p) => !p.synced).toArray();
  },

  async markProductSynced(id, cloudId) {
    return await db.products.update(id, { synced: true, cloud_id: cloudId });
  },

  // Add transaction
  async addTransaction(transaction) {
    return await db.transactions.add(transaction);
  },

  // Get unsynced transactions (excludes voided)
  async getUnsyncedTransactions() {
    // .filter(), not .where().equals(false) — see getUnsyncedProducts() note.
    return await db.transactions
      .filter((t) => !t.synced && !t.voided)
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

  // Stable per-device identifier — get-or-create, so it's correct on both a
  // fresh install (no upgrade hook runs) and an existing device upgrading.
  async getDeviceId() {
    const row = await db.settings.get("device_id");
    if (row) return row.value;
    const id = crypto.randomUUID();
    await db.settings.put({ key: "device_id", value: id });
    return id;
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
    // Resolved before the transaction block — getDeviceId() touches
    // db.settings, which isn't in the table list below.
    const deviceId = await this.getDeviceId();
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
          customer_name: payment.customer_name ?? null,
          customer_phone: payment.customer_phone ?? null,
          device_id: deviceId,
          cloud_id: null,
        });

        for (const item of cartItems) {
          const product = await db.products.get(item.id);

          await db.transaction_items.add({
            transaction_id: transactionId,
            product_id: item.id,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.price * item.quantity,
            cost_price: product?.cost_price ?? null,
          });

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
    const myDeviceId = await this.getDeviceId();
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

    const productIds = [...new Set(allItems.flat().map((i) => i.product_id).filter(Boolean))];
    const products = await db.products.bulkGet(productIds);
    const nameMap = new Map(products.filter(Boolean).map((p) => [p.id, p.name]));

    // Attach M-Pesa / Pochi codes from pending_mpesa (single source of truth
    // for locally-made sales) — foreign/pulled transactions have no local
    // pending_mpesa row, so fall back to the denormalized code from the cloud.
    const txnIds = txns.map((t) => t.id);
    const mpesaRecs = await db.pending_mpesa
      .where("transaction_id").anyOf(txnIds).toArray();
    const mpesaMap = new Map(mpesaRecs.map((r) => [r.transaction_id, r.code]));
    const mismatchMap = new Map(mpesaRecs.map((r) => [r.transaction_id, !!r.sms_mismatch]));

    return txns.map((txn, i) => ({
      ...txn,
      mpesa_code: mpesaMap.get(txn.id) ?? txn.mpesa_code ?? null,
      sms_mismatch: mismatchMap.get(txn.id) ?? false,
      origin: (txn.device_id && txn.device_id !== myDeviceId) ? "remote" : "local",
      items: allItems[i].map((item) => ({
        ...item,
        // Prefer the item's own denormalized name (needed for foreign items
        // whose product_id may not resolve locally) before a products lookup.
        name: item.name ?? nameMap.get(item.product_id) ?? null,
      })),
    }));
  },

  // ── Staff helpers ─────────────────────────────────────────────────────────

  async getAllStaff() {
    return await db.staff.filter((s) => !s.deleted_at).toArray();
  },

  async getStaffByPin(pin, staffId = null) {
    const hashed = await hashPin(pin);
    const matchHashed = staffId != null
      ? (s) => s.pin === hashed && s.active && !s.deleted_at && s.id === staffId
      : (s) => s.pin === hashed && s.active && !s.deleted_at;
    let staff = await db.staff.filter(matchHashed).first();
    if (staff) return staff;
    // Backward-compat: v5 migration may have left some PINs unhashed
    const matchPlain = staffId != null
      ? (s) => s.pin === pin && s.active && !s.deleted_at && s.id === staffId
      : (s) => s.pin === pin && s.active && !s.deleted_at;
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
      cloud_id: null,
      deleted_at: null,
      synced: false,
      updated_at: Date.now(),
    });
  },

  async updateStaffRole(staffId, role, permissions = []) {
    return await db.staff.update(staffId, {
      role,
      permissions: role === "custom" ? permissions : [],
      synced: false,
      updated_at: Date.now(),
    });
  },

  async updateStaffPin(staffId, newPin) {
    const hashed = await hashPin(newPin);
    return await db.staff.update(staffId, { pin: hashed, synced: false, updated_at: Date.now() });
  },

  async updateStaffName(staffId, name) {
    return await db.staff.update(staffId, { name, synced: false, updated_at: Date.now() });
  },

  async toggleStaffActive(staffId, active) {
    return await db.staff.update(staffId, { active, synced: false, updated_at: Date.now() });
  },

  // Soft delete — an unsynced delete must not be silently undone by a pull
  // that lands before the delete has pushed.
  async deleteStaff(staffId) {
    const now = Date.now();
    return await db.staff.update(staffId, { active: false, deleted_at: now, updated_at: now, synced: false });
  },

  // ── Staff sync ───────────────────────────────────────────────────────────

  async getUnsyncedStaff() {
    // .filter(), not .where().equals(false) — see getUnsyncedProducts() note.
    return await db.staff.filter((s) => !s.synced).toArray();
  },

  async markStaffSynced(id, cloudId) {
    return await db.staff.update(id, { synced: true, cloud_id: cloudId });
  },

  // ── Stock receiving ───────────────────────────────────────────────────────

  /**
   * Save a new delivery as a DRAFT — does NOT increment stock yet.
   * Items land in stock_receipt_items; stock only moves on activateStockReceipt().
   */
  async addStockReceipt({ supplier, supplier_id, invoice_number, photo_blob, items, staff_id }) {
    return await db.transaction("rw", [db.stock_receipts, db.stock_receipt_items, db.products], async () => {
      const receiptId = await db.stock_receipts.add({
        timestamp:      Date.now(),
        supplier:       supplier,
        supplier_id:    supplier_id ?? null,
        invoice_number: invoice_number || null,
        photo_blob:     photo_blob || null,
        staff_id,
        status:  "draft",
        synced:  false,
      });

      await Promise.all(
        items.map(async ({ product_id, qty_added, unit_cost, expiry_date, condition }) => {
          const product    = await db.products.get(product_id);
          const qty_before = product ? product.stock : 0;
          return db.stock_receipt_items.add({
            receipt_id:    receiptId,
            product_id,
            product_name:  product?.name ?? "Unknown",
            qty_added:     qty_added,
            qty_before,
            unit_cost:     unit_cost ?? null,
            selling_price: null,       // filled in by manager before activation
            expiry_date:   expiry_date || null,
            condition:     condition || "good",
          });
        })
      );

      return receiptId;
    });
  },

  /**
   * Manager activates a draft receipt: increments stock, updates prices, marks done.
   * @param {number} receiptId
   * @param {Object} pricingMap  { [product_id]: sellingPrice } — may be empty
   */
  async activateStockReceipt(receiptId, pricingMap = {}) {
    return await db.transaction("rw", [db.stock_receipts, db.stock_receipt_items, db.products], async () => {
      const items = await db.stock_receipt_items.where("receipt_id").equals(receiptId).toArray();

      await Promise.all(
        items.map(async (item) => {
          const product = await db.products.get(item.product_id);
          if (!product) return;

          const update = {
            stock: (product.stock ?? 0) + item.qty_added,
            synced: false,       // receipt-driven stock changes push via the product sync path
            updated_at: Date.now(),
          };
          if (item.unit_cost  > 0) update.cost_price = item.unit_cost;

          const sellingPrice = pricingMap[item.product_id];
          if (sellingPrice > 0) update.price = sellingPrice;

          await db.products.update(item.product_id, update);

          // Persist selling_price on the item for receipt history
          if (sellingPrice > 0) {
            await db.stock_receipt_items.update(item.id, { selling_price: sellingPrice });
          }
        })
      );

      await db.stock_receipts.update(receiptId, {
        status:       "activated",
        activated_at: Date.now(),
        synced:       false,   // needs re-sync to cloud with final prices
      });
    });
  },

  /** Returns all draft receipts with their items — for manager review. */
  async getPendingReceipts() {
    const receipts = await db.stock_receipts
      .where("status").equals("draft")
      .reverse()
      .toArray();
    return Promise.all(
      receipts.map(async (r) => ({
        ...r,
        items: await db.stock_receipt_items.where("receipt_id").equals(r.id).toArray(),
      }))
    );
  },

  async getStockReceiptHistory(limit = 20) {
    return await db.stock_receipts.orderBy("timestamp").reverse().limit(limit).toArray();
  },

  /** Returns unsynced receipts (status=activated, synced=false) with their items. */
  async getUnsyncedReceipts() {
    // .filter(), not .where().equals(false) — see getUnsyncedProducts() note.
    const receipts = await db.stock_receipts
      .filter((r) => !r.synced && r.status === "activated")
      .toArray();
    return Promise.all(
      receipts.map(async (r) => ({
        ...r,
        items: await db.stock_receipt_items.where("receipt_id").equals(r.id).toArray(),
      }))
    );
  },

  async markReceiptSynced(receiptId) {
    return db.stock_receipts.update(receiptId, { synced: true });
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
    return await db.suppliers.orderBy("name").filter((s) => !s.deleted_at).toArray();
  },

  async addSupplier({ name, phone, email, notes }) {
    return await db.suppliers.add({
      name,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
      created_at: new Date().toISOString(),
      cloud_id: null,
      deleted_at: null,
      synced: false,
      updated_at: Date.now(),
    });
  },

  async updateSupplier(id, updates) {
    return await db.suppliers.update(id, { ...updates, synced: false, updated_at: Date.now() });
  },

  // Soft delete — an unsynced delete must not be silently undone by a pull
  // that lands before the delete has pushed.
  async deleteSupplier(id) {
    const now = Date.now();
    return await db.suppliers.update(id, { deleted_at: now, updated_at: now, synced: false });
  },

  // ── Supplier sync ────────────────────────────────────────────────────────

  async getUnsyncedSuppliers() {
    return await db.suppliers.filter((s) => !s.synced).toArray();
  },

  async markSupplierSynced(id, cloudId) {
    return await db.suppliers.update(id, { synced: true, cloud_id: cloudId });
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

    // Grouped by product_id when resolvable, else by name — a foreign item
    // whose product isn't synced locally still gets its own bucket instead
    // of collapsing into a single shared "unresolved" entry.
    const productMap = new Map();
    for (const item of allItems) {
      const key = item.product_id ?? `name:${item.name}`;
      const e = productMap.get(key) || { product_id: item.product_id, name: item.name ?? null, totalQty: 0, totalRevenue: 0 };
      e.totalQty += item.quantity;
      e.totalRevenue += item.subtotal;
      productMap.set(key, e);
    }

    const localProductIds = [...productMap.values()].map((e) => e.product_id).filter(Boolean);
    const products = await db.products.bulkGet(localProductIds);
    const productNameMap = new Map(products.filter(Boolean).map((p) => [p.id, p.name]));
    for (const e of productMap.values()) {
      if (!e.name && e.product_id) e.name = productNameMap.get(e.product_id) ?? null;
    }

    // Cashier breakdown — staff_name is a denormalized snapshot for foreign
    // (pulled) transactions, since staff_id is only meaningful on its own device.
    const staffIds = [...new Set(txns.map((t) => t.staff_id).filter(Boolean))];
    const staffMembers = await db.staff.bulkGet(staffIds);
    const staffNameMap = new Map(staffMembers.filter(Boolean).map((s) => [s.id, s.name]));
    const staffTotals = {};
    for (const txn of txns) {
      const name = txn.staff_name ?? staffNameMap.get(txn.staff_id) ?? "Unknown";
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

  // ── Financial analytics (Phase C) ────────────────────────────────────────

  async getFinancialSummary(startMs) {
    const start = startMs ?? (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    const txns = (await db.transactions.where("timestamp").above(start).toArray())
      .filter((t) => !t.voided);

    const empty = {
      revenue: 0, cogs: 0, grossProfit: 0, grossMargin: 0,
      netRevenue: 0, vatCollected: 0, avgTransaction: 0,
      transactionCount: 0, stockValue: 0, topProducts: [],
    };

    const allProducts = await db.products.toArray();
    const stockValue = allProducts.reduce((s, p) => s + (p.stock * (p.cost_price ?? 0)), 0);

    if (txns.length === 0) return { ...empty, stockValue };

    const allItems = await db.transaction_items
      .where("transaction_id").anyOf(txns.map((t) => t.id))
      .toArray();

    const productIds = [...new Set(allItems.map((i) => i.product_id).filter(Boolean))];
    const products = await db.products.bulkGet(productIds);
    const productMap = new Map(products.filter(Boolean).map((p) => [p.id, p]));

    let cogs = 0;
    const productMetrics = new Map();
    for (const item of allItems) {
      const product = productMap.get(item.product_id);
      // Prefer the item's own cost-at-sale-time snapshot — the puller's
      // current product catalog may have a different cost_price today than
      // whatever it was when a foreign device made this sale.
      const costPrice = item.cost_price ?? product?.cost_price ?? 0;
      const itemCogs = item.quantity * costPrice;
      cogs += itemCogs;

      const key = item.product_id ?? `name:${item.name}`;
      const m = productMetrics.get(key) ?? {
        id: item.product_id, name: item.name ?? product?.name ?? "Unknown",
        revenue: 0, cogs: 0, profit: 0, qty: 0,
      };
      m.revenue += item.subtotal;
      m.cogs += itemCogs;
      m.profit += item.subtotal - itemCogs;
      m.qty += item.quantity;
      productMetrics.set(key, m);
    }

    const revenue = txns.reduce((s, t) => s + (t.total || 0), 0);
    const netRevenue = txns.reduce((s, t) => s + (t.subtotal || 0), 0);
    const vatCollected = txns.reduce((s, t) => s + (t.vat || 0), 0);
    const grossProfit = revenue - cogs;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const topProducts = [...productMetrics.values()]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5)
      .map((p) => ({ ...p, margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0 }));

    return {
      revenue, cogs, grossProfit, grossMargin,
      netRevenue, vatCollected,
      avgTransaction: revenue / txns.length,
      transactionCount: txns.length,
      stockValue, topProducts,
    };
  },

  // ── eTIMS helpers ─────────────────────────────────────────────────────────

  async getEtimsQueue(limit = 200) {
    // Returns transactions that haven't been successfully submitted yet,
    // tenant-wide — any device with eTIMS access (already role-gated) can see
    // and submit any pending sale, not just its own. Safe because submission
    // now dedupes server-side on the real transaction id (cloud_id), not the
    // per-device-ambiguous local id — see backend/app/routers/etims.py.
    // Requires cloud_id: a transaction still mid-sync has no stable identity
    // to submit against yet (narrow, self-healing window).
    return await db.transactions
      .where("etims_status")
      .anyOf(["pending", "failed"])
      .filter((t) => !t.voided && t.cloud_id != null)
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
    // Enrich items with product details for eTIMS payload. A foreign item
    // whose product hasn't synced locally has product_id: null — filter it
    // out before bulkGet, since null isn't a valid IndexedDB key (previously
    // impossible to reach here at all, since such items were excluded
    // upstream; now that the eTIMS queue is tenant-wide, they can be).
    const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
    const products = await db.products.bulkGet(productIds);
    const productMap = new Map(products.filter(Boolean).map((p) => [p.id, p]));
    return {
      ...txn,
      items: items.map((item) => {
        const product = productMap.get(item.product_id) || {};
        return {
          product_id:    item.product_id,
          // Tenant-wide stable id (assigned once a product first syncs) —
          // lets the backend derive a KRA item code that's the same
          // regardless of which till's local product_id made the sale.
          // Prefer the item's own stored value (set for foreign/pulled items
          // whose product_id may not resolve locally) before a live lookup.
          cloud_product_id: item.cloud_product_id ?? product.cloud_id ?? null,
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
