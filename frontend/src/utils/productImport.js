/**
 * Turning a spreadsheet from another POS into products.
 *
 * Its own module, not part of the import screen, because this is where an import
 * silently goes wrong - a stock value landing in the price field, a row number in
 * the barcode - and none of that is visible from the outside. It is tested
 * directly by scripts/verify-import.mjs against a real Aronium export.
 */
import { isXlsxFile, isLegacyXlsFile } from "./xlsx";

// ── Column name aliases ───────────────────────────────────────────────────────
// Lowercase keys map CSV headers to our product fields.
// Covers common POS exports + the specific Kaggle sample dataset.
const ALIASES = {
  name:          ["product_name", "name", "item_name", "item", "description", "product", "product name", "item name"],
  barcode:       ["barcode", "sku", "upc", "ean", "product_id", "item_code", "code", "item_id", "product id"],
  price:         ["unit_price", "price", "selling_price", "sale_price", "retail_price", "unit price", "selling price"],
  cost_price:    ["cost", "cost_price", "unit_cost", "purchase_price", "buy_price", "cost price", "unit cost"],
  stock:         ["stock_quantity", "stock", "qty", "quantity", "on_hand", "current_stock", "quantity on hand", "units"],
  category:      ["catagory", "category", "dept", "department", "type", "product_category", "product category"],
  reorder_level: ["reorder_level", "reorder_point", "min_stock", "minimum_stock", "min stock", "reorder level"],
  active:        ["status", "active", "enabled", "is_active"],
};

// ── Aronium POS stock report ──────────────────────────────────────────────────
//
// Clients migrating from Aronium bring its "Stock" export, which does not fit the
// generic mapping above and would be silently mangled by it. Two traps in
// particular:
//
// Its "Code" column is Aronium's own row number (1287, 1265), not a barcode - and
// "code" is in the barcode aliases, so a generic import would fill the barcode
// field with numbers that scan as nothing and collide with each other.
//
// It has no price column at all. What it has is "Total", the stock value, so the
// unit price is Total / Qty - recoverable only for rows that have stock. In a real
// 1,311-product export, 220 rows had a price to recover and 1,091 did not.
//
// The product name is sometimes the barcode instead, for items that were never
// given a name.

const ARONIUM_HEADERS = ["code", "product group", "product", "qty."];

function detectAroniumStock(headers) {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  const hasAll = ARONIUM_HEADERS.every((h) => lower.includes(h));
  // "Total" distinguishes the stock report from a plain item list, and is what
  // the price is derived from.
  return hasAll && lower.some((h) => h === "total" || h === "total before tax");
}

const BARCODE_SHAPE = /^\d{8,14}$/;

function aroniumRowToProduct(row, headers) {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  const at = (label) => {
    const i = lower.indexOf(label);
    return i === -1 ? "" : String(row[i] ?? "").trim();
  };

  const name = at("product");
  if (!name) return null;

  const qty = parseStock(at("qty."));
  // "Total" is tax-inclusive where the two differ; shelf prices here are
  // VAT-inclusive, which is the figure the shop actually charges.
  const total = parsePrice(at("total")) || parsePrice(at("total before tax"));
  // Only divide when there is something to divide. A zero-stock row tells us
  // nothing about price, and inventing one would be worse than admitting it.
  const price = qty > 0 && total > 0 ? Math.round((total / qty) * 100) / 100 : 0;

  const cost = parsePrice(at("cost incl. tax")) || parsePrice(at("cost price")) || 0;
  const group = at("product group");

  return {
    name,
    // The name doubles as the barcode for items that were never named. The Code
    // column is deliberately ignored: it is a row number, not a barcode.
    barcode: BARCODE_SHAPE.test(name) ? name : null,
    price,
    cost_price: cost > 0 ? cost : null,
    stock: qty,
    category: group && group !== "(none)" ? group : "Other",
    reorder_level: 10,
    active: true,
    etims_status: "pending",
    // Imported rows are changes like any other and have to reach the other
    // tills; without this an update would sit on this device for ever.
    synced: false,
    updated_at: Date.now(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(val) {
  if (val == null || val === "") return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseStock(val) {
  if (val == null || val === "") return 0;
  const n = parseInt(String(val).replace(/[,\s]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseActive(val) {
  if (val == null || val === "") return true;
  const v = String(val).toLowerCase().trim();
  return !["discontinued", "inactive", "disabled", "false", "0", "no", "n"].includes(v);
}

// Minimal CSV parser — handles quoted fields with embedded commas and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        if (ch === "\r") i++;
        row.push(field);
        field = "";
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length) { row.push(field); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

// Auto-detect which CSV header maps to which product field.
function buildColumnMap(headers) {
  const map = {};  // field → column index
  const normalised = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const idx = normalised.indexOf(alias.replace(/\s+/g, "_"));
      if (idx !== -1) { map[field] = idx; break; }
    }
  }
  return map;
}

// Convert a raw CSV row to a product record using the column map.
function rowToProduct(row, colMap) {
  const get = (field) => (colMap[field] != null ? (row[colMap[field]] ?? "").trim() : "");
  const name = get("name");
  if (!name) return null;
  return {
    name,
    barcode:       get("barcode") || null,
    price:         parsePrice(get("price")),
    cost_price:    colMap.cost_price != null ? parsePrice(get("cost_price")) || null : null,
    stock:         parseStock(get("stock")),
    category:      get("category") || "Other",
    reorder_level: get("reorder_level") ? parseInt(get("reorder_level"), 10) || 10 : 10,
    active:        colMap.active != null ? parseActive(get("active")) : true,
    etims_status:  "pending",
    synced:        false,
    updated_at:    Date.now(),
  };
}

// ── Reading a file ────────────────────────────────────────────────────────────

/**
 * Turn a spreadsheet into products.
 *
 * Exported because this is where an import can go silently wrong - a price in the
 * stock column, a row number in the barcode field - and none of that is visible
 * from the outside. Tested directly by scripts/verify-import.mjs against a real
 * Aronium export.
 *
 * @returns { layout, products, skipped, unpriced } or { error }
 */
export async function parseImportFile(file) {
  let rows;
  try {
    if (isLegacyXlsFile(file)) {
      return {
        error:
          "That is an older .xls file. Open it in Excel and use File > Save As to save it " +
          "as .xlsx or CSV, then import that.",
      };
    }
    if (isXlsxFile(file)) {
      // Loaded on demand: a shop imports a product list once, and the reader has
      // no business in the bundle everyone downloads.
      const { readXlsx } = await import("../utils/xlsx");
      rows = await readXlsx(file);
    } else {
      rows = parseCsv(await file.text());
    }
  } catch (err) {
    return { error: err.message || "Could not read that file." };
  }

  if (rows.length < 2) return { error: "That file has no data rows." };
  const headers = rows[0].map((h) => String(h ?? ""));

  const aronium = detectAroniumStock(headers);
  const colMap = aronium ? null : buildColumnMap(headers);

  if (!aronium && colMap.name == null) {
    return {
      error:
        `Could not find a product name column. Headers found: ${headers.join(", ")}\n` +
        `Expected one of: ${ALIASES.name.join(", ")}`,
    };
  }

  const products = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const product = aronium
      ? aroniumRowToProduct(rows[i], headers)
      : rowToProduct(rows[i], colMap);
    if (product) products.push(product); else skipped++;
  }

  return {
    layout: aronium ? "aronium" : "generic",
    products,
    skipped,
    unpriced: products.filter((product) => !product.price || product.price <= 0).length,
  };
}


/**
 * The key an imported row is matched on.
 *
 * Barcode first, and the name when there is none. Most exports from a small
 * shop's POS have no barcodes at all - 1,307 of the 1,311 rows in the Aronium
 * export that prompted this - so matching on barcode alone means matching almost
 * nothing, and a second import of the same shop duplicates the entire catalogue.
 */
export function matchKey(product) {
  if (product.barcode) return `barcode:${product.barcode}`;
  const name = String(product.name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  return name ? `name:${name}` : null;
}

/**
 * What an update may change about a product that already exists.
 *
 * Importing must never destroy work the shop has done since the last import.
 * A stock report with no price column would otherwise reset every price
 * somebody had keyed in by hand to zero - and because the till refuses to sell
 * an unpriced product, that would take the whole shop offline at once.
 *
 * So a blank in the file means "no information", not "set it to nothing".
 * Quantities are the exception: updating them is what a stock import is for.
 */
export function mergeForUpdate(incoming, existing) {
  const next = { ...incoming };
  if (!next.price && existing.price) next.price = existing.price;
  if (next.cost_price == null && existing.cost_price != null) next.cost_price = existing.cost_price;
  if (!next.barcode && existing.barcode) next.barcode = existing.barcode;
  if ((!next.category || next.category === "Other") && existing.category) {
    next.category = existing.category;
  }
  return next;
}
