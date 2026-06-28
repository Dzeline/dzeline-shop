import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";

const CONDITION_LABELS = {
  good:         { label: "Good",         color: "bg-green-100 text-green-700" },
  short_expiry: { label: "Short expiry", color: "bg-amber-100 text-amber-700" },
  damaged:      { label: "Damaged",      color: "bg-red-100 text-red-700"     },
};

function ReceiptCard({ receipt, onActivated }) {
  const [open, setOpen]         = useState(false);
  const [prices, setPrices]     = useState({});
  const [activating, setActivating] = useState(false);

  // Pre-fill selling price fields with current product prices
  useEffect(() => {
    if (!open) return;
    const map = {};
    receipt.items.forEach((item) => { map[item.product_id] = ""; });
    setPrices(map);
  }, [open, receipt.items]);

  async function handleActivate() {
    setActivating(true);
    try {
      const pricingMap = {};
      Object.entries(prices).forEach(([pid, val]) => {
        const p = parseFloat(val);
        if (p > 0) pricingMap[Number(pid)] = p;
      });
      await dbHelpers.activateStockReceipt(receipt.id, pricingMap);
      showToast("Stock activated!");
      onActivated();
    } catch (err) {
      console.error(err);
      showToast("Failed to activate — try again");
    } finally {
      setActivating(false);
    }
  }

  const date = new Date(receipt.timestamp).toLocaleString("en-KE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const invoiceTotal = receipt.items.reduce(
    (sum, i) => sum + (i.qty_added ?? 0) * (i.unit_cost ?? 0), 0
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
          <svg className="w-4.5 h-4.5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-gray-800 truncate">{receipt.supplier || "Unknown supplier"}</p>
          <p className="text-xs text-gray-400">
            {date} · {receipt.items.length} item{receipt.items.length !== 1 ? "s" : ""}
            {receipt.invoice_number ? ` · ${receipt.invoice_number}` : ""}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {invoiceTotal > 0 && (
            <span className="text-xs font-bold text-gray-600">{formatPrice(invoiceTotal)}</span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Items */}
          <div className="space-y-2">
            {receipt.items.map((item) => {
              const cond = CONDITION_LABELS[item.condition] ?? CONDITION_LABELS.good;
              return (
                <div key={item.id} className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{item.product_name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-gray-400">×{item.qty_added}</span>
                        {item.unit_cost > 0 && (
                          <span className="text-xs text-gray-400">cost {formatPrice(item.unit_cost)}</span>
                        )}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cond.color}`}>
                          {cond.label}
                        </span>
                        {item.expiry_date && (
                          <span className="text-[10px] text-amber-600 font-medium">
                            Exp {item.expiry_date}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Selling price input */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 shrink-0">Selling price (KSH)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="e.g. 250"
                      value={prices[item.product_id] ?? ""}
                      onChange={(e) =>
                        setPrices((prev) => ({ ...prev, [item.product_id]: e.target.value }))
                      }
                      className="flex-1 px-2.5 py-1.5 border-2 border-gray-200 rounded-lg text-sm font-bold text-right focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 px-1">
            Leave selling price blank to keep the current price. Stock will be added for all items.
          </p>

          <button
            onClick={handleActivate}
            disabled={activating}
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-green-600 text-white hover:bg-green-700 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {activating ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Activating…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Activate Stock
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ManagerReceiving({ onCountChange }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pending = await dbHelpers.getPendingReceipts();
      setReceipts(pending);
      onCountChange?.(pending.length);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (receipts.length === 0) return null;

  return (
    <div className="px-4 pt-4 pb-2 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <p className="text-xs font-bold text-amber-600 uppercase tracking-wide">
          {receipts.length} pending review
        </p>
      </div>
      {receipts.map((r) => (
        <ReceiptCard
          key={r.id}
          receipt={r}
          onActivated={load}
        />
      ))}
      <div className="border-t border-gray-700 mt-2" />
    </div>
  );
}
