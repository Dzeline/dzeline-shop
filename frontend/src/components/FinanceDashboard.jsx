import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week",  label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year",  label: "This Year" },
];

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// Status, not series colour — reserved for state and always paired with a
// word, so urgency is never carried by colour alone.
const URGENCY = {
  critical: { chip: "bg-red-100 text-red-700",       dot: "bg-red-500" },
  warning:  { chip: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  watch:    { chip: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
};

function urgencyOf(coverDays) {
  if (coverDays <= 3) return "critical";
  if (coverDays <= 7) return "warning";
  return "watch";
}

function formatCover(days) {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days < 1) return "today";
  if (days < 2) return "1 day";
  if (days < 14) return Math.round(days) + " days";
  return Math.round(days / 7) + " wks";
}

function formatVelocity(perDay) {
  if (!Number.isFinite(perDay) || perDay <= 0) return "—";
  if (perDay >= 10) return Math.round(perDay) + "/day";
  if (perDay >= 1)  return perDay.toFixed(1) + "/day";
  return (perDay * 7).toFixed(1) + "/wk";
}

/**
 * What to reorder, and why.
 *
 * Replaces the ranked "top products by profit" as the lead, because profit rank
 * alone cannot answer it: a product can top the list and still hold four months
 * of stock, while the one that stocks out on Thursday sits fourth. Sorted by
 * how soon it runs out, since that is the deadline.
 */
function RestockPanel({ restock }) {
  if (restock.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="font-bold text-gray-700 text-sm mb-1">Restock</p>
        <p className="text-sm text-gray-400">
          Nothing is running short &mdash; every product that sold in this period has more
          than two weeks of cover.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-baseline justify-between mb-1">
        <p className="font-bold text-gray-700 text-sm">Restock first</p>
        <p className="text-xs text-gray-400">
          {restock.length} product{restock.length !== 1 ? "s" : ""}
        </p>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Selling steadily and close to running out &mdash; soonest first.
      </p>

      <div className="divide-y divide-gray-50">
        {restock.slice(0, 8).map((p) => {
          const u = URGENCY[urgencyOf(p.coverDays)];
          return (
            <div key={p.id ?? p.name} className="flex items-center gap-3 py-2.5 first:pt-0">
              <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + u.dot} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-800 truncate">{p.name}</p>
                <p className="text-xs text-gray-400">
                  {formatVelocity(p.velocity)} &middot; {p.stock ?? 0} left &middot;{" "}
                  {formatPrice(p.profitPerDay)}/day profit
                </p>
              </div>
              <span className={"shrink-0 text-[11px] font-bold px-2 py-1 rounded-full " + u.chip}>
                {formatCover(p.coverDays)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Where the profit actually comes from.
 *
 * One bar, part-to-whole, one hue plus neutral. This is the number owners act
 * on most often — "a handful of lines earn most of my money" — and a ranked
 * list never states it outright.
 */
function ConcentrationPanel({ concentration }) {
  const { top5Share, top5, total, productCount } = concentration;
  if (productCount < 2 || total <= 0) return null;

  const share = Math.min(100, Math.max(0, top5Share));
  const shown = Math.min(5, productCount);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="font-bold text-gray-700 text-sm mb-1">Profit concentration</p>
      <p className="text-sm text-gray-500 mb-3">
        Your top {shown} product{shown !== 1 ? "s" : ""} earn{shown === 1 ? "s" : ""}{" "}
        <span className="font-bold text-gray-800">{share.toFixed(0)}%</span> of gross profit
        {productCount > shown
          ? " — the other " + (productCount - shown) + " make up the rest."
          : "."}
      </p>

      {/* 2px surface gap so the two segments read as separate marks */}
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 gap-0.5">
        <div className="bg-primary rounded-l-full" style={{ width: share + "%" }} />
        <div className="bg-gray-300 rounded-r-full" style={{ width: (100 - share) + "%" }} />
      </div>
      <div className="flex justify-between mt-2 text-xs">
        <span className="font-semibold text-primary">
          Top {shown} &middot; {formatPrice(top5)}
        </span>
        <span className="text-gray-400">
          Rest &middot; {formatPrice(Math.max(0, total - top5))}
        </span>
      </div>
    </div>
  );
}

const MOVER_COLUMNS = [
  { key: "name",         label: "Product",    align: "left",  sortable: false },
  { key: "qty",          label: "Sold",       align: "right", sortable: true },
  { key: "profitPerDay", label: "Profit/day", align: "right", sortable: true },
  { key: "margin",       label: "Margin",     align: "right", sortable: true },
  { key: "stock",        label: "Stock",      align: "right", sortable: true },
  { key: "coverDays",    label: "Cover",      align: "right", sortable: true },
];

/**
 * The full picture, as a table.
 *
 * Six measures that all carry meaning is past the point where more colour
 * helps, so this is deliberately a table rather than a chart — and sorting lets
 * the owner ask their own question instead of only the one a fixed ranking
 * answers.
 */
function MoversTable({ products }) {
  const [sortKey, setSortKey] = useState("profitPerDay");
  const [asc, setAsc] = useState(false);

  if (products.length === 0) return null;

  const sorted = [...products].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    return asc ? av - bv : bv - av;
  });

  function toggle(key) {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="font-bold text-gray-700 text-sm mb-1">Movers</p>
      <p className="text-xs text-gray-400 mb-3">
        Everything sold in this period. Tap a heading to sort.
      </p>

      {/* Only the table scrolls sideways, never the page */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              {MOVER_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={
                    "py-2 font-semibold text-[11px] uppercase tracking-wide text-gray-400 whitespace-nowrap " +
                    (c.align === "right" ? "text-right pl-3" : "text-left")
                  }
                >
                  {c.sortable ? (
                    <button
                      onClick={() => toggle(c.key)}
                      className={
                        "hover:text-gray-600 transition " +
                        (sortKey === c.key ? "text-primary" : "")
                      }
                    >
                      {c.label}
                      {sortKey === c.key ? (asc ? " ↑" : " ↓") : ""}
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id ?? p.name} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 pr-3 font-medium text-gray-800 max-w-40 truncate">{p.name}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums text-gray-600">{p.qty}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums font-semibold text-gray-800">
                  {formatPrice(p.profitPerDay)}
                </td>
                <td className={"py-2.5 pl-3 text-right tabular-nums font-semibold " + marginColor(p.margin)}>
                  {p.margin.toFixed(0)}%
                </td>
                <td className="py-2.5 pl-3 text-right tabular-nums text-gray-600">{p.stock ?? "—"}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums text-gray-600 whitespace-nowrap">
                  {formatCover(p.coverDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [monthlyBreakdown, setMonthlyBreakdown] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await dbHelpers.getFinancialSummary(getRangeStart(range));
      setData(summary);
      if (range === "year") {
        const monthly = await dbHelpers.getMonthlyRevenue(new Date().getFullYear());
        setMonthlyBreakdown(monthly);
      } else {
        setMonthlyBreakdown(null);
        setSelectedMonth(null);
      }
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
            {/* Monthly breakdown — This Year only */}
            {range === "year" && monthlyBreakdown && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="font-bold text-gray-700 text-sm mb-3">Monthly Revenue</p>
                <div className="space-y-1">
                  {monthlyBreakdown.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedMonth(selectedMonth === i ? null : i)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition ${
                        selectedMonth === i ? "bg-primary/10" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className={`text-sm font-semibold ${selectedMonth === i ? "text-primary" : "text-gray-700"}`}>
                        {MONTH_LABELS[i]}
                      </span>
                      <span className="flex items-center gap-3">
                        {selectedMonth === i && (
                          <span className="text-xs text-gray-400">
                            {m.transactionCount} sale{m.transactionCount !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span className={`text-sm font-bold ${selectedMonth === i ? "text-primary" : "text-gray-800"}`}>
                          {formatPrice(m.revenue)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between px-3 pt-3 mt-2 border-t border-gray-100">
                  <span className="text-sm font-bold text-gray-800">Total</span>
                  <span className="text-base font-extrabold text-primary">
                    {formatPrice(monthlyBreakdown.reduce((s, m) => s + m.revenue, 0))}
                  </span>
                </div>
              </div>
            )}

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

            {/* Reorder decisions: what is running out, where profit
                concentrates, then the full sortable picture. Ordered by how
                actionable each block is, not by how it was computed. */}
            <RestockPanel restock={data.restock} />

            <ConcentrationPanel concentration={data.profitConcentration} />

            <MoversTable products={data.products} />

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
