import { useState } from "react";
import { syncService } from "../services/sync";
import { downloadCsv, transactionsToCsv } from "../utils/csvExport";
import { showToast } from "../utils/toast";
import { useSettingsStore } from "../store/settingsStore";

const MODES = [
  { key: "month", label: "Month" },
  { key: "year",  label: "Year" },
];

function monthInputDefault() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function SalesExport() {
  const shopName = useSettingsStore((s) => s.shopName);
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const [mode, setMode] = useState("month");
  const [monthValue, setMonthValue] = useState(monthInputDefault());
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleExport() {
    setLoading(true);
    setError("");
    try {
      let periodStart, periodEnd, label;
      if (mode === "month") {
        const [y, m] = monthValue.split("-").map(Number);
        periodStart = new Date(y, m - 1, 1).getTime();
        periodEnd   = new Date(y, m, 1).getTime();
        label = monthValue;
      } else {
        periodStart = new Date(year, 0, 1).getTime();
        periodEnd   = new Date(year + 1, 0, 1).getTime();
        label = String(year);
      }

      const all = await syncService.fetchAllTransactions();
      const inRange = all.filter((t) => t.timestamp >= periodStart && t.timestamp < periodEnd);

      if (inRange.length === 0) {
        showToast("No sales found for that period");
        return;
      }

      const slug = (shopName || "shop").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      downloadCsv(`${slug}-sales-${label}.csv`, transactionsToCsv(inRange));
      showToast(`Exported ${inRange.length} invoice${inRange.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error(err);
      setError("Couldn't reach the server — check your connection and try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 shrink-0">
        <h2 className="font-bold text-white">Export Sales</h2>
        <p className="text-xs text-gray-400">A CSV of every invoice for a month or year, for your accountant</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  mode === m.key ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Period picker */}
          {mode === "month" ? (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Month</label>
              <input
                type="month"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 font-medium">{error}</p>
          )}

          <button
            onClick={handleExport}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-sm bg-primary text-white hover:bg-blue-600 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Fetching sales…
              </>
            ) : (
              "Export CSV"
            )}
          </button>
        </div>

        <p className="text-xs text-gray-500 px-1">
          Pulls the shop's complete sales record from the cloud, so it includes every till —
          not just this device. Requires an internet connection.
        </p>
      </div>
    </div>
  );
}
