import { useRef, useState } from "react";
import { db } from "../services/db";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { parseImportFile } from "../utils/productImport";

// ── Main component ────────────────────────────────────────────────────────────

export default function CsvImport({ onClose, onImported }) {
  useEscapeKey(onClose);
  const fileRef = useRef(null);
  const [stage, setStage] = useState("pick");   // pick | preview | importing | done
  const [error, setError] = useState("");
  const [preview, setPreview] = useState([]);   // first 5 products
  const [products, setProducts] = useState([]); // all parsed products
  const [skipped, setSkipped] = useState(0);
  const [mode, setMode] = useState("upsert");   // upsert | skip
  const [result, setResult] = useState(null);   // { added, updated }
  const [layout, setLayout] = useState(null);   // aronium | generic

  // Products the file could not price. They import, because a shop moving over
  // needs its catalogue, but the till refuses to sell them until somebody sets a
  // price - see the guard in cartStore.
  const unpriced = products.filter((p) => !p.price).length;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";           // so picking the same file twice still fires
    if (!file) return;
    setError("");
    setLayout(null);

    const outcome = await parseImportFile(file);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }

    setProducts(outcome.products);
    setPreview(outcome.products.slice(0, 5));
    setSkipped(outcome.skipped);
    setLayout(outcome.layout);
    setStage("preview");
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
                Choose a spreadsheet exported from your old POS — Excel (.xlsx) or CSV.
                Columns are detected automatically.
              </p>
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3 text-xs text-violet-200 leading-relaxed">
                <span className="font-semibold text-violet-100">Aronium POS</span> exports are
                recognised as they come. Its stock report has no price column, so prices are
                worked out from the stock value — products with no stock arrive without a price
                and are listed for pricing afterwards.
              </div>
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
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm"
              >
                Choose File
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
                {unpriced > 0 && (
                  <div className="flex-1 bg-gray-800 rounded-xl py-3">
                    <p className="text-xl font-extrabold text-amber-400">{unpriced}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Need a price</p>
                  </div>
                )}
                {skipped > 0 && (
                  <div className="flex-1 bg-gray-800 rounded-xl py-3">
                    <p className="text-xl font-extrabold text-orange-400">{skipped}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Skipped (no name)</p>
                  </div>
                )}
              </div>

              {layout === "aronium" && (
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3 text-xs text-violet-200 leading-relaxed">
                  Read as an <span className="font-semibold text-violet-100">Aronium stock
                  report</span>. Prices come from the stock value divided by the quantity. The
                  Code column is Aronium&apos;s own numbering, not a barcode, so it is ignored.
                </div>
              )}

              {unpriced > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-xs text-amber-200 leading-relaxed">
                  <span className="font-semibold text-amber-100">
                    {unpriced.toLocaleString()} product{unpriced === 1 ? "" : "s"} have no price
                    in this file.
                  </span>{" "}
                  They will import so you keep the catalogue, but the till will refuse to sell
                  them until a price is set. Find them under{" "}
                  <span className="font-semibold text-amber-100">Products → Needs price</span>.
                  If your old POS can also export a product list <em>with</em> prices, importing
                  that afterwards will fill them in.
                </div>
              )}

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
