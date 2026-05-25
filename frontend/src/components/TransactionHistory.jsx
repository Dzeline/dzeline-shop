import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { formatPrice, formatDate } from "../utils/formatters";

function SkeletonList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
      ))}
    </div>
  );
}

const METHOD_STYLES = {
  CASH: "bg-blue-100 text-blue-700",
  MPESA: "bg-green-100 text-green-700",
  POCHI: "bg-orange-100 text-orange-700",
};
const METHOD_LABELS = { CASH: "Cash", MPESA: "M-Pesa", POCHI: "Pochi" };

export default function TransactionHistory({ onClose }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dbHelpers.getTransactionHistory(50);
      setTransactions(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      <header className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 shrink-0"
        >
          ‹
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-800">Transaction History</h2>
          <p className="text-xs text-gray-400">
            {loading ? "Loading…" : `${transactions.length} recent sale${transactions.length !== 1 ? "s" : ""}`}
          </p>
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <SkeletonList />}

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

        {!loading && !error && transactions.length === 0 && (
          <div className="text-center text-gray-400 mt-16">
            <svg className="w-14 h-14 opacity-25 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-lg font-semibold">No transactions yet</p>
            <p className="text-sm mt-1">Completed sales will appear here</p>
          </div>
        )}

        {!loading && !error && transactions.map((txn) => {
          const isOpen = expanded === txn.id;
          const methodStyle = METHOD_STYLES[txn.payment_method] ?? "bg-gray-100 text-gray-600";
          const methodLabel = METHOD_LABELS[txn.payment_method] ?? txn.payment_method;

          return (
            <div key={txn.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => toggle(txn.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-bold text-gray-800 text-sm">
                      #{String(txn.id).padStart(6, "0")}
                    </p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${methodStyle}`}>
                      {methodLabel}
                    </span>
                    {!txn.synced && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                        Local
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    {formatDate(txn.timestamp)} · {txn.items.length} item{txn.items.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-extrabold text-primary text-sm">{formatPrice(txn.total)}</p>
                  <svg
                    className={`w-3 h-3 text-gray-400 mx-auto mt-1 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-1.5 bg-gray-50">
                  {txn.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-xs">
                      <span className="text-gray-600 truncate flex-1 pr-2">
                        {item.name ?? `Product #${item.product_id}`} × {item.quantity}
                      </span>
                      <span className="font-semibold text-gray-700 shrink-0">{formatPrice(item.subtotal)}</span>
                    </div>
                  ))}

                  <div className="border-t border-gray-200 pt-1.5 mt-1 space-y-0.5">
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Subtotal</span>
                      <span>{formatPrice(txn.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>VAT 16%</span>
                      <span>{formatPrice(txn.vat)}</span>
                    </div>

                    {txn.payment_method === "MPESA" && txn.mpesa_code && (
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>M-Pesa Code</span>
                        <span className="font-bold text-green-600 tracking-wider">{txn.mpesa_code}</span>
                      </div>
                    )}
                    {txn.payment_method === "POCHI" && txn.mpesa_code && (
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Pochi Code</span>
                        <span className="font-bold text-orange-600 tracking-wider">{txn.mpesa_code}</span>
                      </div>
                    )}
                    {txn.payment_method === "CASH" && txn.change_given > 0 && (
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Change given</span>
                        <span>{formatPrice(txn.change_given)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
