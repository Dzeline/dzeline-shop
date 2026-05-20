import { useState } from "react";
import { formatPrice } from "../utils/formatters";
import { SHOP_INFO } from "../utils/constants";

const DENOMINATIONS = [50, 100, 200, 500, 1000, 2000];

export default function CheckoutModal({ items, subtotal, vat, grandTotal, onComplete, onCancel }) {
  const [cashInput, setCashInput] = useState("");

  const cashAmount = parseFloat(cashInput) || 0;
  const change = cashAmount - grandTotal;
  const canComplete = cashAmount >= grandTotal;

  function handleDenomination(value) {
    setCashInput(String(value));
  }

  function handleExact() {
    setCashInput(grandTotal.toFixed(2));
  }

  async function handleComplete() {
    if (!canComplete) return;
    await onComplete({
      method: "CASH",
      subtotal,
      vat,
      total: grandTotal,
      amount: cashAmount,
      change: parseFloat(change.toFixed(2)),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Cash Payment</h2>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Order Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Order Summary
            </p>
            {items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {item.name} × {item.quantity}
                </span>
                <span className="font-medium">{formatPrice(item.price * item.quantity)}</span>
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>VAT (16%)</span>
                <span>{formatPrice(vat)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-gray-800 pt-1">
                <span>Total</span>
                <span className="text-primary">{formatPrice(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Cash Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">
              Cash Received ({SHOP_INFO.currency})
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              placeholder="Enter amount..."
              className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-primary text-right"
            />
          </div>

          {/* Quick Denominations */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Quick Select
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DENOMINATIONS.filter((d) => d >= grandTotal).slice(0, 6).map((d) => (
                <button
                  key={d}
                  onClick={() => handleDenomination(d)}
                  className={`py-2 rounded-lg text-sm font-semibold border transition ${
                    cashAmount === d
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary"
                  }`}
                >
                  {d.toLocaleString()}
                </button>
              ))}
              <button
                onClick={handleExact}
                className={`py-2 rounded-lg text-sm font-semibold border transition col-span-3 ${
                  cashAmount === grandTotal
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary"
                }`}
              >
                Exact ({formatPrice(grandTotal)})
              </button>
            </div>
          </div>

          {/* Change Display */}
          {cashAmount > 0 && (
            <div
              className={`rounded-xl p-4 text-center ${
                canComplete ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
              }`}
            >
              {canComplete ? (
                <>
                  <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Change</p>
                  <p className="text-3xl font-bold text-green-700">{formatPrice(change)}</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">Short by</p>
                  <p className="text-3xl font-bold text-red-600">{formatPrice(grandTotal - cashAmount)}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          <button
            onClick={handleComplete}
            disabled={!canComplete}
            className={`w-full py-4 rounded-xl font-bold text-base transition ${
              canComplete
                ? "bg-primary text-white hover:bg-blue-600 active:scale-95"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Complete Sale
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-semibold text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
