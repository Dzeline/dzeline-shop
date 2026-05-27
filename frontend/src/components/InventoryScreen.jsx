import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";

const CATEGORY_BG_GRADIENT = {
  Grains:    "from-amber-400 to-gray-900",
  Sugar:     "from-rose-400 to-gray-900",
  Dairy:     "from-sky-400 to-gray-900",
  Oils:      "from-orange-400 to-gray-900",
  Bakery:    "from-yellow-400 to-gray-900",
  Beverages: "from-teal-400 to-gray-900",
  Spices:    "from-red-400 to-gray-900",
  Household: "from-slate-400 to-gray-900",
  Produce:   "from-green-500 to-gray-900",
  Other:     "from-gray-400 to-gray-900",
};

function stockBorderClass(stock, reorderLevel) {
  if (stock === 0) return "border-l-red-400";
  if (stock <= (reorderLevel ?? 10)) return "border-l-orange-400";
  return "border-l-transparent";
}

function StockPill({ stock, reorderLevel }) {
  if (stock === 0)
    return (
      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-600 whitespace-nowrap">
        Out of stock
      </span>
    );
  if (stock <= (reorderLevel ?? 10))
    return (
      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-600 whitespace-nowrap">
        Low · {stock}
      </span>
    );
  return (
    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
      {stock} in stock
    </span>
  );
}

function ProductRow({ p }) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3.5 border-l-[6px] ${stockBorderClass(p.stock, p.reorder_level)}`}>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 text-sm leading-snug">{p.name}</p>
        {p.barcode && (
          <p className="text-xs text-gray-400 font-mono mt-0.5">{p.barcode}</p>
        )}
        <div className="mt-1.5">
          <StockPill stock={p.stock} reorderLevel={p.reorder_level} />
        </div>
      </div>
      <div className="text-right shrink-0 pt-0.5">
        <p className="font-bold text-gray-800 text-sm">{formatPrice(p.price)}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {formatPrice((p.stock || 0) * p.price)} val
        </p>
      </div>
    </div>
  );
}

export default function InventoryScreen({ onClose }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState({});
  const [viewMode, setViewMode] = useState("category");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await dbHelpers.getAllProducts();
      setProducts(all);
      const cats = [...new Set(all.map((p) => p.category || "Other"))];
      setExpandedCats(Object.fromEntries(cats.map((c) => [c, true])));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode || "").includes(search)
      )
    : products;

  const totalSKUs = filtered.length;
  const totalUnits = filtered.reduce((s, p) => s + (p.stock || 0), 0);
  const totalValue = filtered.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0);
  const outOfStockCount = filtered.filter((p) => p.stock === 0).length;
  const lowStockCount = filtered.filter(
    (p) => p.stock > 0 && p.stock <= (p.reorder_level ?? 10)
  ).length;
  const alertCount = outOfStockCount + lowStockCount;

  const byCategory = filtered.reduce((acc, p) => {
    const cat = p.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});
  const sortedCats = Object.keys(byCategory).sort();

  const alertProducts = filtered
    .filter((p) => p.stock === 0 || p.stock <= (p.reorder_level ?? 10))
    .sort((a, b) => a.stock - b.stock);

  function toggleCat(cat) {
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-bold text-white text-base flex-1">Inventory</h2>
        {alertCount > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 shrink-0">
            {alertCount} alert{alertCount !== 1 ? "s" : ""}
          </span>
        )}
        <button
          onClick={load}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Stats bar — horizontally scrollable on small screens */}
          <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex gap-5 overflow-x-auto shrink-0">
            <div className="shrink-0">
              <p className="text-xl font-extrabold text-white leading-none">{totalSKUs}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5">Products</p>
            </div>
            <div className="w-px bg-gray-700 shrink-0 self-stretch" />
            <div className="shrink-0">
              <p className="text-xl font-extrabold text-white leading-none">{totalUnits.toLocaleString()}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5">Units</p>
            </div>
            <div className="w-px bg-gray-700 shrink-0 self-stretch" />
            <div className="shrink-0">
              <p className="text-xl font-extrabold text-primary leading-none">{formatPrice(totalValue)}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5">Stock Value</p>
            </div>
            {outOfStockCount > 0 && (
              <>
                <div className="w-px bg-gray-700 shrink-0 self-stretch" />
                <div className="shrink-0">
                  <p className="text-xl font-extrabold text-red-500 leading-none">{outOfStockCount}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Out of stock</p>
                </div>
              </>
            )}
            {lowStockCount > 0 && (
              <>
                <div className="w-px bg-gray-700 shrink-0 self-stretch" />
                <div className="shrink-0">
                  <p className="text-xl font-extrabold text-orange-500 leading-none">{lowStockCount}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Low stock</p>
                </div>
              </>
            )}
          </div>

          {/* View tabs */}
          <div className="bg-gray-900 border-b border-gray-800 px-4 pb-3 pt-2 shrink-0">
            <div className="flex gap-1 bg-gray-800 p-1 rounded-xl">
              <button
                onClick={() => setViewMode("category")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  viewMode === "category"
                    ? "bg-white text-primary shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                By Category
              </button>
              <button
                onClick={() => setViewMode("alerts")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  viewMode === "alerts"
                    ? "bg-white text-red-500 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Alerts
                {alertCount > 0 && (
                  <span className={`text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center ${
                    viewMode === "alerts" ? "bg-red-100 text-red-500" : "bg-gray-300 text-gray-600"
                  }`}>
                    {alertCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-10">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search products or barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border-0 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            </div>

            {/* Alerts view */}
            {viewMode === "alerts" && (
              alertProducts.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
                  <div className="text-4xl mb-3">✓</div>
                  <p className="font-bold text-gray-700">All products well-stocked</p>
                  <p className="text-sm text-gray-400 mt-1">No reorders needed right now</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <p className="font-bold text-gray-700 text-sm">
                      {alertProducts.length} product{alertProducts.length !== 1 ? "s" : ""} need attention
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {alertProducts.map((p) => <ProductRow key={p.id} p={p} />)}
                  </div>
                </div>
              )
            )}

            {/* Category view */}
            {viewMode === "category" && (
              sortedCats.length === 0 ? (
                <p className="text-center text-gray-400 text-sm mt-10">No products found</p>
              ) : (
                sortedCats.map((cat) => {
                  const items = byCategory[cat];
                  const catUnits = items.reduce((s, p) => s + (p.stock || 0), 0);
                  const catValue = items.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0);
                  const catAlerts = items.filter(
                    (p) => p.stock === 0 || p.stock <= (p.reorder_level ?? 10)
                  ).length;
                  const bgGrad = CATEGORY_BG_GRADIENT[cat] ?? "from-gray-400 to-gray-900";
                  const isOpen = expandedCats[cat] !== false;

                  return (
                    <div key={cat} className="rounded-2xl shadow-sm overflow-hidden">
                      <button
                        onClick={() => toggleCat(cat)}
                        className={`w-full px-4 py-3.5 transition text-left bg-linear-to-r ${bgGrad}`}
                      >
                        {/* Top row: name + alert badge + chevron */}
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold text-base flex-1 text-white">{cat}</span>
                          {catAlerts > 0 && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/20 text-white shrink-0">
                              {catAlerts}
                            </span>
                          )}
                          <svg
                            className={`w-4 h-4 text-white/70 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        {/* Bottom row: summary stats */}
                        <div className="flex gap-3 mt-1">
                          <span className="text-xs text-white/60">{items.length} item{items.length !== 1 ? "s" : ""}</span>
                          <span className="text-xs text-white/40">·</span>
                          <span className="text-xs text-white/60">{catUnits} units</span>
                          <span className="text-xs text-white/40">·</span>
                          <span className="text-xs font-semibold text-white/80">{formatPrice(catValue)}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="divide-y divide-gray-50 border-t border-gray-100">
                          {items
                            .slice()
                            .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
                            .map((p) => <ProductRow key={p.id} p={p} />)}
                        </div>
                      )}
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
