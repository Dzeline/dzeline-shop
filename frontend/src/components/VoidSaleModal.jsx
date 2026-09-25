import { useState, useEffect } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice } from "../utils/formatters";
import { useEscapeKey } from "../hooks/useEscapeKey";

/**
 * Voiding a sale — with a reason, and a decision about the stock.
 *
 * Replaces a `window.confirm` that warned stock would not be restored and
 * captured nothing. Two things changed and both matter:
 *
 * The goods go back on the shelf by default, because that is what usually
 * happened physically — the old behaviour left the count wrong on every void.
 * The exception (damaged, or the customer kept them) is one tap away and is
 * recorded, so a count that did not come back is never mistaken for one that
 * did.
 *
 * And a reason is required. A void is where theft hides; an unexplained one is
 * exactly the thing an owner needs to be able to ask about later. Picking from
 * a short list is what stops people typing "x" to get past the dialog.
 */
export default function VoidSaleModal({ txn, onClose, onVoided }) {
  useEscapeKey(onClose);
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dbHelpers.getVoidReasons().then(setReasons).catch(() => setReasons([]));
  }, []);

  const chosen = reason === "__other" ? custom.trim() : reason;
  const valid = chosen.length > 0;

  async function confirm() {
    if (!valid) return;
    setBusy(true);
    try {
      // A one-off reason is worth keeping — the same situation recurs, and the
      // list is more useful for having learned it.
      if (reason === "__other" && custom.trim()) {
        await dbHelpers.addVoidReason(custom).catch(() => {});
      }
      await onVoided(chosen, restock);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-70 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h3 className="font-bold text-gray-800">Void this sale?</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Sale #{String(txn.id).padStart(6, "0")} · {formatPrice(txn.total)}
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Reason</label>
          <div className="space-y-1.5">
            {reasons.map((r) => (
              <button
                key={r.id}
                onClick={() => setReason(r.label)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition ${
                  reason === r.label
                    ? "border-primary bg-primary/5 text-primary font-semibold"
                    : "border-gray-100 text-gray-600 hover:border-gray-200"
                }`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setReason("__other")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition ${
                reason === "__other"
                  ? "border-primary bg-primary/5 text-primary font-semibold"
                  : "border-gray-100 text-gray-600 hover:border-gray-200"
              }`}
            >
              Other…
            </button>
          </div>
          {reason === "__other" && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Type the reason"
              className="mt-2 w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary"
            />
          )}
        </div>

        {/* Stock — the correctness half */}
        <label className="flex items-start gap-2.5 cursor-pointer bg-gray-50 rounded-xl p-3">
          <input
            type="checkbox"
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-primary shrink-0"
          />
          <span className="text-xs text-gray-600 leading-snug">
            Put the goods back into stock
            <span className="block text-[11px] text-gray-400 mt-0.5">
              Untick only if they are not coming back — damaged, or the customer kept them.
            </span>
          </span>
        </label>

        <p className="text-xs text-gray-400">This cannot be undone.</p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Keep sale
          </button>
          <button
            onClick={confirm}
            disabled={!valid || busy}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition disabled:opacity-40"
          >
            {busy ? "Voiding…" : "Void sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
