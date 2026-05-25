import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";

const CATEGORY_DOT = {
  Grains:    "bg-amber-400",
  Sugar:     "bg-rose-400",
  Dairy:     "bg-sky-400",
  Oils:      "bg-orange-400",
  Bakery:    "bg-yellow-400",
  Beverages: "bg-teal-400",
  Spices:    "bg-red-400",
  Household: "bg-slate-400",
  Produce:   "bg-green-500",
  Other:     "bg-gray-400",
};

function StockPill({ stock, reorderLevel }) {
  if (stock === 0)
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Out</span>;
  if (stock <= (reorderLevel ?? 10))
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">Low: {stock}</span>;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{stock}</span>;
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex-1 min-w-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide truncate">{label}</p>
      <p className="text-xl font-extrabold text-gray-800 mt-1 truncate">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export default function InventoryScreen({ onClose }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await dbHelpers.getAllProducts();
      setProducts(all);
      // Start with all categories expanded
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

  // Aggregate totals
  const totalSKUs = filtered.length;
  const totalUnits = filtered.reduce((s, p) => s + (p.stock || 0), 0);
  const totalValue = filtered.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0);
  const outOfStock = filtered.filter((p) => p.stock === 0).length;

  // Group by category
  const byCategory = filtered.reduce((acc, p) => {
    const cat = p.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});
  const sortedCats = Object.keys(byCategory).sort();

  function toggleCat(cat) {
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-200 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-bold text-gray-800 text-base flex-1">Inventory</h2>
        <button
          onClick={load}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-10">
          {/* Summary cards */}
          <div className="flex gap-3">
            <SummaryCard label="Products" value={totalSKUs} sub="SKUs" />
            <SummaryCard label="Total Units" value={totalUnits.toLocaleString()} />
            <SummaryCard
              label="Stock Value"
              value={formatPrice(totalValue)}
              sub={outOfStock > 0 ? `${outOfStock} out of stock` : "all stocked"}
            />
          </div>

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

          {/* Category sections */}
          {sortedCats.length === 0 ? (
            <p className="text-center text-gray-400 text-sm mt-10">No products found</p>
          ) : (
            sortedCats.map((cat) => {
              const items = byCategory[cat];
              const catUnits = items.reduce((s, p) => s + (p.stock || 0), 0);
              const catValue = items.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0);
              const dot = CATEGORY_DOT[cat] ?? "bg-gray-400";
              const isOpen = expandedCats[cat] !== false;

              return (
                <div key={cat} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  {/* Category header — tappable to collapse */}
                  <button
                    onClick={() => toggleCat(cat)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                    <span className="font-bold text-gray-800 text-sm flex-1 text-left">{cat}</span>
                    <span className="text-xs text-gray-400 font-medium mr-1">{items.length} item{items.length !== 1 ? "s" : ""}</span>
                    <span className="text-xs font-semibold text-gray-500 mr-1">{catUnits} units</span>
                    <span className="text-xs font-bold text-primary mr-2">{formatPrice(catValue)}</span>
                    <svg
                      className={`w-4 h-4 text-gray-300 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="divide-y divide-gray-50 border-t border-gray-100">
                      {items
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((p) => (
                          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                              {p.barcode && (
                                <p className="text-xs text-gray-400 font-mono">{p.barcode}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-gray-700">{formatPrice(p.price)}</p>
                              <p className="text-xs text-gray-400">
                                {formatPrice((p.stock || 0) * p.price)} total
                              </p>
                            </div>
                            <StockPill stock={p.stock} reorderLevel={p.reorder_level} />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
