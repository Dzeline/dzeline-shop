import Dexie from "dexie";

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

// Seed initial data on first run
db.on("populate", async () => {
  console.log("🌱 Seeding database with initial data...");

  // Add test products
  await db.products.bulkAdd([
    {
      barcode: "2001",
      name: "Unga 2kg",
      price: 200,
      stock: 50,
      category: "Grains",
      tags: ["flour", "baking"],
    },
    {
      barcode: "2002",
      name: "Sugar 1kg",
      price: 150,
      stock: 30,
      category: "Sugar",
      tags: ["sugar", "sweetener"],
    },
    {
      barcode: "2003",
      name: "Milk 500ml",
      price: 60,
      stock: 100,
      category: "Dairy",
      tags: ["milk", "dairy", "fresh"],
    },
    {
      barcode: "2004",
      name: "Cooking Oil 1L",
      price: 280,
      stock: 20,
      category: "Oils",
      tags: ["oil", "cooking"],
    },
    {
      barcode: "2005",
      name: "Rice 1kg",
      price: 180,
      stock: 40,
      category: "Grains",
      tags: ["rice", "grains"],
    },
    {
      barcode: "2006",
      name: "Bread 400g",
      price: 50,
      stock: 25,
      category: "Bakery",
      tags: ["bread", "bakery", "fresh"],
    },
    {
      barcode: "2007",
      name: "Eggs (Tray)",
      price: 350,
      stock: 15,
      category: "Dairy",
      tags: ["eggs", "protein"],
    },
    {
      barcode: "2008",
      name: "Tea Leaves 250g",
      price: 120,
      stock: 60,
      category: "Beverages",
      tags: ["tea", "drinks"],
    },
    {
      barcode: "2009",
      name: "Salt 500g",
      price: 40,
      stock: 100,
      category: "Spices",
      tags: ["salt", "seasoning"],
    },
    {
      barcode: "2010",
      name: "Soap 200g",
      price: 80,
      stock: 45,
      category: "Household",
      tags: ["soap", "cleaning"],
    },
  ]);

  // Add default staff (admin)
  await db.staff.add({
    name: "Admin",
    pin: "1234", // CHANGE THIS IN PRODUCTION!
    active: true,
    created_at: new Date().toISOString(),
  });

  // Add default settings
  await db.settings.bulkAdd([
    { key: "shop_name", value: "Dzeline Supermarket" },
    { key: "kra_pin", value: "P051234567X" }, // Replace with real PIN
    { key: "mpesa_till", value: "1234567" }, // Replace with real Till
    { key: "vat_rate", value: "0.16" }, // 16% VAT in Kenya
    { key: "currency", value: "KES" },
    { key: "last_sync", value: null },
  ]);

  console.log("✅ Database seeded successfully!");
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

  // Get unsynced transactions
  async getUnsyncedTransactions() {
    return await db.transactions.where("synced").equals(false).toArray();
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
          mpesa_code: payment.mpesaCode ?? payment.pochiCode ?? null,
          synced: false,
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
            code: payment.mpesaCode ?? payment.pochiCode,
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

  // Get recent transactions with line items enriched with product names
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

    return txns.map((txn, i) => ({
      ...txn,
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

  async getStaffByPin(pin) {
    return await db.staff
      .filter((s) => s.pin === pin && s.active)
      .first();
  },

  async addStaff(name, pin) {
    return await db.staff.add({
      name,
      pin,
      active: true,
      created_at: new Date().toISOString(),
    });
  },

  async updateStaffPin(staffId, newPin) {
    return await db.staff.update(staffId, { pin: newPin });
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

  async addStockReceipt({ supplier, invoice_number, photo_blob, items, staff_id }) {
    return await db.transaction("rw", [db.stock_receipts, db.products], async () => {
      const itemsWithBefore = await Promise.all(
        items.map(async ({ product_id, qty_added }) => {
          const product = await db.products.get(product_id);
          const qty_before = product ? product.stock : 0;
          if (product) await db.products.update(product_id, { stock: qty_before + qty_added });
          return { product_id, product_name: product?.name ?? "Unknown", qty_before, qty_added };
        })
      );
      return await db.stock_receipts.add({
        timestamp: Date.now(),
        supplier,
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

  async getDailySummary(startMs) {
    const start = startMs ?? (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    const txns = await db.transactions
      .where("timestamp")
      .above(start)
      .toArray();

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
};

export default db;
