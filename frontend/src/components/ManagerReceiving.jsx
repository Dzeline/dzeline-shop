import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { syncService } from "../services/sync";
import { purchaseOrders } from "../services/purchaseOrders";
import { supplierLedger } from "../services/supplierLedger";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";
import { useSettingsStore } from "../store/settingsStore";
import { suggestSellingPrice, describePrice, marginBand } from "../utils/pricing";

const CONDITION_LABELS = {
  good:         { label: "Good",         color: "bg-green-100 text-green-700" },
  short_expiry: { label: "Short expiry", color: "bg-amber-100 text-amber-700" },
  damaged:      { label: "Damaged",      color: "bg-red-100 text-red-700"     },
};

const BAND_STYLE = {
  healthy: { text: "text-green-700", chip: "bg-green-100 text-green-700" },
  ok:      { text: "text-yellow-700", chip: "bg-yellow-100 text-yellow-700" },
  thin:    { text: "text-orange-700", chip: "bg-orange-100 text-orange-700" },
  loss:    { text: "text-red-700", chip: "bg-red-100 text-red-700" },
  unknown: { text: "text-gray-500", chip: "bg-gray-100 text-gray-500" },
};

/**
 * Selling price for one delivered line.
 *
 * The field used to be an empty box with a placeholder, so the manager had to
 * work out cost -> margin -> VAT in their head for every item on every
 * delivery. It now opens on a suggestion and shows what any typed price
 * actually earns, so the number can be judged instead of guessed.
 */
function PriceField({ item, value, onChange, vatRate, vatEnabled, defaultMargin }) {
  const cost = item.unit_cost ?? 0;

  const suggestion = suggestSellingPrice({
    cost,
    targetMargin: defaultMargin,
    vatRate,
    vatEnabled,
  });

  const typed = parseFloat(value);
  const outcome = Number.isFinite(typed) && typed > 0
    ? describePrice({ price: typed, cost, vatRate, vatEnabled })
    : null;

  const band = BAND_STYLE[marginBand(outcome?.margin ?? null)] ?? BAND_STYLE.unknown;
  const matchesSuggestion = suggestion && Math.abs(typed - suggestion.price) < 0.005;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">Selling price (KSH)</label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          placeholder={suggestion ? String(suggestion.price) : "e.g. 250"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2.5 py-1.5 border-2 border-gray-200 rounded-lg text-sm font-bold text-right focus:outline-none focus:border-primary"
        />
        {suggestion && !matchesSuggestion && (
          <button
            type="button"
            onClick={() => onChange(String(suggestion.price))}
            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition btn-press"
            title={`Suggested from cost and a ${Math.round(defaultMargin * 100)}% margin`}
          >
            {formatPrice(suggestion.price)}
          </button>
        )}
      </div>

      {/* What this price actually means — the whole point of the change */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5">
        {outcome && outcome.margin !== null ? (
          <>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${band.chip}`}>
              {outcome.margin < 0 ? "Loss" : `${outcome.margin.toFixed(0)}% margin`}
            </span>
            <span className="text-[11px] text-gray-500">
              {formatPrice(outcome.profit)} profit each
            </span>
            {vatEnabled && (
              <span className="text-[11px] text-gray-400">
                incl. {formatPrice(outcome.vatAmount)} VAT
              </span>
            )}
          </>
        ) : cost > 0 ? (
          <span className="text-[11px] text-gray-400">
            Suggested {suggestion ? formatPrice(suggestion.price) : "—"} at {Math.round(defaultMargin * 100)}% margin
          </span>
        ) : (
          <span className="text-[11px] text-amber-600">
            No unit cost recorded — margin can&apos;t be calculated
          </span>
        )}
        {item.current_price > 0 && (
          <span className="text-[11px] text-gray-400">
            · now {formatPrice(item.current_price)}
          </span>
        )}
      </div>
    </div>
  );
}

function ReceiptCard({ receipt, onActivated }) {
  const [open, setOpen]         = useState(false);
  const [prices, setPrices]     = useState({});
  const [activating, setActivating] = useState(false);
  const [showFullPhoto, setShowFullPhoto] = useState(false);
  const vatEnabled    = useSettingsStore((s) => s.vatEnabled);
  const vatRate       = useSettingsStore((s) => s.vatRate);
  const defaultMargin = useSettingsStore((s) => s.defaultMargin);

  // Open on a suggested price rather than an empty box. Lines with no recorded
  // cost stay blank, which still means "keep the current price".
  useEffect(() => {
    if (!open) return;
    const map = {};
    receipt.items.forEach((item) => {
      const suggestion = suggestSellingPrice({
        cost: item.unit_cost ?? 0,
        targetMargin: defaultMargin,
        vatRate,
        vatEnabled,
      });
      map[item.product_id] = suggestion ? String(suggestion.price) : "";
    });
    setPrices(map);
  }, [open, receipt.items, defaultMargin, vatRate, vatEnabled]);

  async function handleActivate() {
    setActivating(true);
    try {
      const pricingMap = {};
      Object.entries(prices).forEach(([pid, val]) => {
        const p = parseFloat(val);
        if (p > 0) pricingMap[Number(pid)] = p;
      });
      const received = await dbHelpers.activateStockReceipt(receipt.id, pricingMap);

      // Close down whatever this delivery covered on open purchase orders, so
      // "on order" stops showing for stock that has now arrived. Best-effort:
      // the stock movement has already committed and must not be undone if the
      // bookkeeping match fails.
      let matched = null;
      try {
        matched = await purchaseOrders.applyDelivery(received);
        // File the invoice against the order it fulfilled, and bill it at the
        // delivery's line total unless someone edits it later. Without this the
        // invoice photo and the amount owed have nothing tying them to the
        // order the supplier is chasing payment for.
        if (matched?.orderIds?.length === 1) {
          await supplierLedger.linkReceiptToOrder(receipt.id, matched.orderIds[0]);
        }
        await supplierLedger.setInvoiceAmount(receipt.id, invoiceTotal);
      } catch (err) {
        console.error("Purchase order match failed:", err);
      }

      showToast(
        matched?.closedOrders
          ? `Stock activated — ${matched.closedOrders} order${matched.closedOrders !== 1 ? "s" : ""} completed`
          : "Stock activated!",
      );
      onActivated();
      syncService.pushUnsyncedReceipts().catch(() => {});
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
    <>
    {showFullPhoto && receipt.photo_blob && (
      <div
        className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
        onClick={() => setShowFullPhoto(false)}
      >
        <img src={receipt.photo_blob} alt="Delivery receipt" className="max-w-full max-h-full object-contain rounded-lg" />
        <button
          onClick={() => setShowFullPhoto(false)}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center text-xl"
        >
          ×
        </button>
      </div>
    )}
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
          {/* Delivery photo — attendant's proof of what arrived, so the
              owner can review it before confirming into inventory */}
          {receipt.photo_blob && (
            <button
              type="button"
              onClick={() => setShowFullPhoto(true)}
              className="block w-full rounded-xl overflow-hidden border border-gray-200"
            >
              <img src={receipt.photo_blob} alt="Delivery receipt" className="w-full max-h-48 object-cover" />
            </button>
          )}

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

                  <PriceField
                    item={item}
                    value={prices[item.product_id]}
                    onChange={(v) =>
                      setPrices((prev) => ({ ...prev, [item.product_id]: v }))
                    }
                    vatRate={vatRate}
                    vatEnabled={vatEnabled}
                    defaultMargin={defaultMargin}
                  />
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 px-1">
            Prices are suggested from cost at a {Math.round(defaultMargin * 100)}% margin —
            edit any of them freely. Clear a field to keep the current price. Stock is added
            for every item either way.
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
    </>
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
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-dot-pulse" />
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
