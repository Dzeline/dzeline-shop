import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";
import { useSettingsStore } from "../store/settingsStore";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week",  label: "This Week" },
  { key: "month", label: "This Month" },
];

function getRangeStart(range) {
  const d = new Date();
  if (range === "week") {
    d.setDate(d.getDate() - d.getDay());
  } else if (range === "month") {
    d.setDate(1);
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Skeletons() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => <div key={i} className="h-24 bg-gray-800 rounded-2xl animate-pulse" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-800 rounded-2xl animate-pulse" />)}
      </div>
      <div className="h-20 bg-gray-800 rounded-2xl animate-pulse" />
      <div className="h-52 bg-gray-800 rounded-2xl animate-pulse" />
    </div>
  );
}

export default function DailySummary({ onClose }) {
  const [range, setRange] = useState("today");
  const [summary, setSummary] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const vatRate = useSettingsStore((s) => s.vatRate);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, low] = await Promise.all([
        dbHelpers.getDailySummary(getRangeStart(range)),
        dbHelpers.getLowStockProducts(),
      ]);
      setSummary(data);
      setLowStock(low);
    } catch (err) {
      console.error(err);
      setError("Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const rangeLabel = range === "today"
    ? new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : range === "week" ? "This Week" : "This Month";

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        {onClose && (
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
          >
            ‹
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Summary</h2>
          <p className="text-xs text-gray-400 truncate">{rangeLabel}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 transition disabled:opacity-40"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {/* Range tabs */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 pb-3 pt-2 shrink-0">
        <div className="flex gap-1 bg-gray-800 p-1 rounded-xl">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                range === r.key ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <Skeletons />}

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <p className="text-red-600 font-semibold mb-3">{error}</p>
            <button
              onClick={load}
              className="px-5 py-2 bg-red-100 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-200 transition"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && summary && (
          <>
            {/* Row 1: Total Sales + Transactions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Total Sales</p>
                <p className="text-2xl font-extrabold text-primary">{formatPrice(summary.totalSales)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Transactions</p>
                <p className="text-2xl font-extrabold text-gray-800">{summary.transactionCount}</p>
              </div>
            </div>

            {/* Row 2: Cash / M-Pesa / Pochi */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Cash</p>
                <p className="text-lg font-bold text-gray-800">{formatPrice(summary.cashTotal)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">M-Pesa</p>
                <p className="text-lg font-bold text-green-600">{formatPrice(summary.mpesaTotal)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pochi</p>
                <p className="text-lg font-bold text-orange-500">{formatPrice(summary.pochiTotal)}</p>
              </div>
            </div>

            {/* VAT */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  VAT Collected ({Math.round(vatRate * 100)}%)
                </p>
                <p className="text-xl font-bold text-gray-800">{formatPrice(summary.vatCollected)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              </div>
            </div>

            {/* Cashier shift report */}
            {summary.staffBreakdown.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="font-bold text-gray-700 text-sm mb-3">Cashier Breakdown</p>
                <div className="space-y-2">
                  {summary.staffBreakdown.map((s) => (
                    <div key={s.name} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{s.name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400">{s.count} sale{s.count !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-700 shrink-0">{formatPrice(s.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Low stock alert */}
            {lowStock.length > 0 && (
              <div className="bg-white rounded-2xl border border-orange-200 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="font-bold text-gray-700 text-sm">
                    Low Stock — {lowStock.length} product{lowStock.length !== 1 ? "s" : ""} need reordering
                  </p>
                </div>
                <div className="space-y-2">
                  {lowStock.map((p) => (
                    <div key={p.id} className="flex justify-between items-center text-sm">
                      <span className="text-gray-700 font-medium truncate flex-1">{p.name}</span>
                      <span className={`font-bold shrink-0 ml-2 ${p.stock === 0 ? "text-red-500" : "text-orange-500"}`}>
                        {p.stock === 0 ? "Out of stock" : `${p.stock} left`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top products */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="font-bold text-gray-700 text-sm mb-3">Top Products</p>
              {summary.topProducts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No sales recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {summary.topProducts.map((product, index) => (
                    <div key={product.product_id} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-800 truncate">
                          {product.name ?? "Unknown product"}
                        </p>
                        <p className="text-xs text-gray-400">{formatPrice(product.totalRevenue)}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-600 shrink-0">
                        ×{product.totalQty}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Zero-state banner */}
            {summary.transactionCount === 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 text-center">
                <p className="font-semibold text-blue-700">No sales recorded</p>
                <p className="text-sm mt-1 text-blue-400">Summary updates automatically as sales are made</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
