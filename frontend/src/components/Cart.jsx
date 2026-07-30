import { useState } from "react";
import { useCartStore } from "../store/cartStore";
import { useStaffStore } from "../store/staffStore";
import { formatPrice } from "../utils/formatters";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";
import { useSettingsStore } from "../store/settingsStore";
import { syncService } from "../services/sync";
import CheckoutModal from "./CheckoutModal";
import Receipt from "./Receipt";

export default function Cart({ onNewSale }) {
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const getTotal = useCartStore((state) => state.getTotal);
  const clearCart = useCartStore((state) => state.clearCart);
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const vatEnabled = useSettingsStore((s) => s.vatEnabled);
  const vatRate = useSettingsStore((s) => s.vatRate);

  const [view, setView] = useState("cart"); // 'cart' | 'checkout' | 'receipt'
  const [completedSale, setCompletedSale] = useState(null);
  const [processing, setProcessing] = useState(false);

  // Prices are VAT-inclusive (shelf price = what customer pays).
  // VAT is extracted from the total for receipt/KRA purposes, not added on top.
  const grandTotal = getTotal();
  const subtotal = vatEnabled ? grandTotal / (1 + vatRate) : grandTotal;
  const vat = vatEnabled ? grandTotal - subtotal : 0;

  async function handleCheckoutComplete(payment) {
    setProcessing(true);
    try {
      const staffId = currentStaff?.id ?? 1;
      const sale = await dbHelpers.completeTransaction(
        items,
        { ...payment, subtotal, vat, total: grandTotal },
        staffId
      );
      const saleWithStaff = { ...sale, staff_name: currentStaff?.name };
      setCompletedSale(saleWithStaff);
      try {
        await dbHelpers.enqueuePrintJob(saleWithStaff);
        syncService.pushUnsyncedPrintJobs().catch(() => {});
      } catch { /* best-effort — the sale itself already succeeded */ }
      clearCart();
      setView("receipt");
    } catch (err) {
      console.error("Sale failed:", err);
      showToast("Sale failed — please try again");
    } finally {
      setProcessing(false);
    }
  }

  function handleNewSale() {
    setView("cart");
    setCompletedSale(null);
    onNewSale?.();
  }

  if (view === "receipt" && completedSale) {
    return <Receipt sale={completedSale} onNewSale={handleNewSale} />;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-600 gap-3">
        <svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13l-1-4m9 10a1 1 0 100 2 1 1 0 000-2zm-6 0a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-400">Cart is empty</p>
          <p className="text-sm text-gray-600">Add products to get started</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-4">
        {/* Cart Items */}
        <div className="space-y-3 mb-6">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm text-gray-800 truncate">{item.name}</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatPrice(item.price)} each
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateQuantity(item.id, item.quantity - 1)}
                  className="w-8 h-8 bg-gray-100 rounded-full hover:bg-gray-200 font-bold text-gray-600 flex items-center justify-center"
                >
                  −
                </button>
                <span className="w-8 text-center font-bold text-sm">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.id, Math.min(item.stock, item.quantity + 1))}
                  disabled={item.quantity >= item.stock}
                  className="w-8 h-8 bg-gray-100 rounded-full hover:bg-gray-200 font-bold text-gray-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>

              <div className="text-right shrink-0">
                <p className="font-bold text-sm text-primary">
                  {formatPrice(item.price * item.quantity)}
                </p>
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-red-400 hover:text-red-600 mt-0.5"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-2 mb-5">
          {vatEnabled && (
            <div className="flex justify-between text-sm text-gray-500">
              <span>Net (ex-VAT)</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
          )}
          {vatEnabled && (
            <div className="flex justify-between text-sm text-gray-500">
              <span>VAT ({Math.round(vatRate * 100)}%)</span>
              <span>{formatPrice(vat)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-gray-800 pt-2 border-t border-gray-100">
            <span>Total</span>
            <span className="text-primary">{formatPrice(grandTotal)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={() => setView("checkout")}
            className="w-full py-4 bg-primary text-white rounded-xl font-bold text-base hover:bg-blue-600 active:scale-95 transition"
          >
            Proceed to Checkout
          </button>
          <button
            onClick={() => { if (window.confirm("Clear all items from cart?")) clearCart(); }}
            className="w-full py-3 bg-gray-800 text-gray-300 rounded-xl font-semibold hover:bg-gray-700 transition"
          >
            Clear Cart
          </button>
        </div>
      </div>

      {/* Checkout Modal — rendered outside scroll area */}
      {view === "checkout" && (
        <CheckoutModal
          items={items}
          subtotal={subtotal}
          vat={vat}
          grandTotal={grandTotal}
          onComplete={handleCheckoutComplete}
          onCancel={() => setView("cart")}
        />
      )}

      {/* Full-screen processing overlay */}
      {processing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-600 font-semibold">Processing sale...</p>
          </div>
        </div>
      )}
    </>
  );
}
