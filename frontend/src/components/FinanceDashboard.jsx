import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week",  label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year",  label: "This Year" },
];

function getRangeStart(range) {
  const d = new Date();
  if (range === "week")  d.setDate(d.getDate() - d.getDay());
  if (range === "month") d.setDate(1);
  if (range === "year")  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function marginColor(pct) {
  if (pct >= 30) return "text-green-400";
  if (pct >= 15) return "text-yellow-400";
  return "text-red-400";
}

function marginBg(pct) {
  if (pct >= 30) return "bg-green-500";
  if (pct >= 15) return "bg-yellow-400";
  return "bg-red-500";
}

function KpiCard({ label, value, accent, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-extrabold ${accent ?? "text-gray-800"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="space-y-4">
      <div className="h-28 bg-gray-800 rounded-2xl animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => <div key={i} className="h-24 bg-gray-800 rounded-2xl animate-pulse" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-800 rounded-2xl animate-pulse" />)}
      </div>
      <div className="h-16 bg-gray-800 rounded-2xl animate-pulse" />
      <div className="h-48 bg-gray-800 rounded-2xl animate-pulse" />
    </div>
  );
}

export default function FinanceDashboard() {
  const [range, setRange] = useState("today");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await dbHelpers.getFinancialSummary(getRangeStart(range));
      setData(summary);
    } catch (err) {
      console.error(err);
      setError("Failed to load financial data");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const cogsRatio  = data && data.revenue > 0 ? Math.round((data.cogs / data.revenue) * 100) : 0;
  const marginPct  = data ? Math.round(data.grossMargin) : 0;

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Finance / P&amp;L</h2>
          <p className="text-xs text-gray-400">Profit, cost &amp; stock valuation</p>
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
                range === r.key ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-300"
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

        {!loading && !error && data && (
          <>
            {/* Hero: Gross Profit + Margin */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Gross Profit</p>
              <p className={`text-3xl font-extrabold mb-3 ${marginColor(marginPct)}`}>
                {formatPrice(data.grossProfit)}
              </p>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${marginBg(marginPct)}`}
                    style={{ width: `${Math.min(100, Math.max(0, marginPct))}%` }}
                  />
                </div>
                <span className={`text-sm font-bold shrink-0 ${marginColor(marginPct)}`}>
                  {marginPct.toFixed(1)}% margin
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {data.transactionCount} sale{data.transactionCount !== 1 ? "s" : ""} · avg {formatPrice(data.avgTransaction)}
              </p>
            </div>

            {/* Revenue vs COGS */}
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label="Revenue"
                value={formatPrice(data.revenue)}
                accent="text-primary"
              />
              <KpiCard
                label="Cost of Goods"
                value={formatPrice(data.cogs)}
                accent={data.cogs === 0 ? "text-gray-400" : "text-orange-500"}
                sub={data.cogs === 0 ? "Set cost prices" : `${cogsRatio}% of revenue`}
              />
            </div>

            {/* Comparison bars */}
            {data.revenue > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Breakdown</p>
                {[
                  { label: "Revenue", pct: 100, color: "bg-primary" },
                  { label: "Cost",    pct: cogsRatio, color: "bg-orange-400" },
                  { label: "Profit",  pct: Math.max(0, marginPct), color: marginBg(marginPct) },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-8 text-right shrink-0">{pct}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Net Revenue / VAT / Avg */}
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Net Revenue" value={formatPrice(data.netRevenue)} />
              <KpiCard label="VAT" value={formatPrice(data.vatCollected)} accent="text-blue-600" />
              <KpiCard label="Avg Sale" value={formatPrice(data.avgTransaction)} />
            </div>

            {/* Stock Valuation */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Stock Valuation</p>
                <p className="text-xl font-bold text-gray-800">{formatPrice(data.stockValue)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Current inventory at cost</p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
                </svg>
              </div>
            </div>

            {/* Top products by profit */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="font-bold text-gray-700 text-sm mb-3">Top Products by Profit</p>
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No sales in this period</p>
              ) : (
                <div className="space-y-3">
                  {data.topProducts.map((product, i) => (
                    <div key={product.id} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-800 truncate">{product.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${marginBg(product.margin)}`}
                              style={{ width: `${Math.min(100, Math.max(0, product.margin))}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold shrink-0 ${marginColor(product.margin)}`}>
                            {product.margin.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-700">{formatPrice(product.profit)}</p>
                        <p className="text-xs text-gray-400">×{product.qty}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.cogs === 0 && data.revenue > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="font-semibold text-amber-700 text-sm">Cost prices not set</p>
                <p className="text-xs text-amber-600 mt-1">
                  Add cost prices to products in Stock → Inventory to see accurate COGS and gross margin.
                </p>
              </div>
            )}

            {data.transactionCount === 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 text-center">
                <p className="font-semibold text-blue-700">No sales in this period</p>
                <p className="text-sm mt-1 text-blue-400">Stock valuation above reflects current inventory value</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
