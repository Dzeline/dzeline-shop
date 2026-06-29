import { useRef, useState } from "react";
import { db } from "../services/db";

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
    updated_at:    Date.now(),
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CsvImport({ onClose, onImported }) {
  const fileRef = useRef(null);
  const [stage, setStage] = useState("pick");   // pick | preview | importing | done
  const [error, setError] = useState("");
  const [preview, setPreview] = useState([]);   // first 5 products
  const [products, setProducts] = useState([]); // all parsed products
  const [skipped, setSkipped] = useState(0);
  const [mode, setMode] = useState("upsert");   // upsert | skip
  const [result, setResult] = useState(null);   // { added, updated }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCsv(ev.target.result);
        if (rows.length < 2) { setError("CSV has no data rows."); return; }

        const headers = rows[0];
        const colMap = buildColumnMap(headers);

        if (colMap.name == null) {
          setError(
            `Could not find a product name column. Headers found: ${headers.join(", ")}\n` +
            `Expected one of: ${ALIASES.name.join(", ")}`
          );
          return;
        }

        const parsed = [];
        let badRows = 0;
        for (let i = 1; i < rows.length; i++) {
          const p = rowToProduct(rows[i], colMap);
          if (p) parsed.push(p); else badRows++;
        }

        setProducts(parsed);
        setPreview(parsed.slice(0, 5));
        setSkipped(badRows);
        setStage("preview");
      } catch {
        setError("Could not parse the file. Make sure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setStage("importing");
    try {
      let added = 0;
      let updated = 0;

      if (mode === "upsert") {
        // Match existing records by barcode; update if found, insert if not.
        const withBarcode = products.filter((p) => p.barcode);
        const noBarcode = products.filter((p) => !p.barcode);

        const existingMap = new Map();
        if (withBarcode.length > 0) {
          const barcodes = withBarcode.map((p) => p.barcode);
          const existing = await db.products.where("barcode").anyOf(barcodes).toArray();
          for (const e of existing) existingMap.set(e.barcode, e.id);
        }

        await db.transaction("rw", db.products, async () => {
          for (const p of withBarcode) {
            const existingId = existingMap.get(p.barcode);
            if (existingId) {
              await db.products.update(existingId, p);
              updated++;
            } else {
              await db.products.add(p);
              added++;
            }
          }
          for (const p of noBarcode) {
            await db.products.add(p);
            added++;
          }
        });
      } else {
        // Skip mode — only add products whose barcode doesn't already exist.
        const withBarcode = products.filter((p) => p.barcode);
        const noBarcode = products.filter((p) => !p.barcode);

        const existingBarcodes = new Set();
        if (withBarcode.length > 0) {
          const existing = await db.products.where("barcode").anyOf(withBarcode.map((p) => p.barcode)).toArray();
          for (const e of existing) existingBarcodes.add(e.barcode);
        }

        const toAdd = [
          ...withBarcode.filter((p) => !existingBarcodes.has(p.barcode)),
          ...noBarcode,
        ];
        await db.products.bulkAdd(toAdd);
        added = toAdd.length;
        updated = 0;
      }

      setResult({ added, updated });
      setStage("done");
      onImported?.();
    } catch (err) {
      setError("Import failed: " + (err?.message ?? "unknown error"));
      setStage("preview");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800">
          <h2 className="font-bold text-white text-base">Import Products from CSV</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* ── PICK ── */}
          {stage === "pick" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-400">
                Select a CSV exported from your desktop POS. Columns are detected automatically.
              </p>
              <div className="bg-gray-800 rounded-xl p-4 text-xs text-gray-400 leading-relaxed">
                <p className="font-semibold text-gray-300 mb-1">Recognised columns (any order)</p>
                <p><span className="text-white">Name</span> — product / item / description <span className="text-red-400">*required</span></p>
                <p><span className="text-white">Barcode</span> — sku / upc / product_id</p>
                <p><span className="text-white">Price</span> — unit_price / selling_price</p>
                <p><span className="text-white">Stock</span> — stock_quantity / qty</p>
                <p><span className="text-white">Category</span> — category / dept</p>
                <p><span className="text-white">Reorder level</span> — reorder_level / min_stock</p>
                <p><span className="text-white">Status</span> — active / status (Active/Discontinued)</p>
              </div>

              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300 whitespace-pre-wrap">
                  {error}
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm"
              >
                Choose CSV File
              </button>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {stage === "preview" && (
            <div className="flex flex-col gap-4">
              {/* Summary */}
              <div className="flex gap-4 text-center">
                <div className="flex-1 bg-gray-800 rounded-xl py-3">
                  <p className="text-xl font-extrabold text-white">{products.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">To import</p>
                </div>
                {skipped > 0 && (
                  <div className="flex-1 bg-gray-800 rounded-xl py-3">
                    <p className="text-xl font-extrabold text-orange-400">{skipped}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Skipped (no name)</p>
                  </div>
                )}
              </div>

              {/* Conflict mode */}
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-300 mb-2">If a barcode already exists:</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode("upsert")}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      mode === "upsert"
                        ? "bg-primary text-white"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    Update existing
                  </button>
                  <button
                    onClick={() => setMode("skip")}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      mode === "skip"
                        ? "bg-primary text-white"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    Skip duplicates
                  </button>
                </div>
              </div>

              {/* Preview rows */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Preview (first {preview.length} rows)</p>
                <div className="rounded-xl overflow-hidden border border-gray-800">
                  {preview.map((p, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-3 py-2.5 text-xs ${
                        i < preview.length - 1 ? "border-b border-gray-800" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold truncate">{p.name}</p>
                        <p className="text-gray-500 truncate">{p.category}{p.barcode ? ` · ${p.barcode}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white font-bold">KES {p.price.toFixed(2)}</p>
                        <p className="text-gray-500">{p.stock} units</p>
                      </div>
                      {!p.active && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                          inactive
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setStage("pick"); setProducts([]); setPreview([]); }}
                  className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 font-semibold text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  className="flex-1 py-3 rounded-xl bg-primary text-white font-bold text-sm"
                >
                  Import {products.length} Products
                </button>
              </div>
            </div>
          )}

          {/* ── IMPORTING ── */}
          {stage === "importing" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-white font-semibold">Importing {products.length} products…</p>
              <p className="text-xs text-gray-500">This may take a moment for large catalogues</p>
            </div>
          )}

          {/* ── DONE ── */}
          {stage === "done" && result && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="w-16 h-16 rounded-full bg-green-900/40 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-bold text-white text-lg">Import complete</p>
                <p className="text-sm text-gray-400 mt-1">
                  {result.added} product{result.added !== 1 ? "s" : ""} added
                  {result.updated > 0 && `, ${result.updated} updated`}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
