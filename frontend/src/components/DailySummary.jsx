import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";

function Skeletons() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
      </div>
      <div className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
      <div className="h-52 bg-gray-100 rounded-2xl animate-pulse" />
    </div>
  );
}

export default function DailySummary({ onClose }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dbHelpers.getDailySummary();
      setSummary(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toLocaleDateString("en-KE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 shrink-0"
        >
          ‹
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-800">Daily Summary</h2>
          <p className="text-xs text-gray-400 truncate">{today}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition disabled:opacity-40"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

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

            {/* Row 2: Cash vs M-Pesa */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Cash</p>
                <p className="text-xl font-bold text-gray-800">{formatPrice(summary.cashTotal)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">M-Pesa</p>
                <p className="text-xl font-bold text-green-600">{formatPrice(summary.mpesaTotal)}</p>
              </div>
            </div>

            {/* VAT */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">VAT Collected (16%)</p>
                <p className="text-xl font-bold text-gray-800">{formatPrice(summary.vatCollected)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              </div>
            </div>

            {/* Top products */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="font-bold text-gray-700 text-sm mb-3">Top Products Today</p>
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
                <p className="font-semibold text-blue-700">No sales recorded today</p>
                <p className="text-sm mt-1 text-blue-400">Summary updates automatically as sales are made</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
