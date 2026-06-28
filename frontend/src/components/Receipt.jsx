import { useState } from "react";
import { formatPrice, formatDate } from "../utils/formatters";
import { useSettingsStore } from "../store/settingsStore";
import { thermalPrinter } from "../services/thermalPrinter";

export default function Receipt({ sale, onNewSale }) {
  const shopName = useSettingsStore((s) => s.shopName);
  const kraPin = useSettingsStore((s) => s.kraPin);
  const kraRegistered = useSettingsStore((s) => s.kraRegistered);
  const vatRate = useSettingsStore((s) => s.vatRate);
  const currency = useSettingsStore((s) => s.currency) || "KSH";
  const isMpesa = sale.method === "MPESA";
  const isPochi = sale.method === "POCHI";
  const isDigital = isMpesa || isPochi;

  const [printing, setPrinting] = useState(false);
  const [printErr, setPrintErr] = useState("");

  const printerSettings = { shopName, kraPin, kraRegistered, vatRate, currency };

  async function handleBluetoothPrint() {
    setPrintErr("");
    setPrinting(true);
    try {
      if (!thermalPrinter.isConnected) {
        await thermalPrinter.connect();
      }
      await thermalPrinter.printBluetooth(sale, printerSettings);
    } catch (e) {
      setPrintErr(e.message ?? "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  function handleBrowserPrint() {
    thermalPrinter.printBrowser(sale, printerSettings);
  }

  const bannerBg = isMpesa ? "bg-green-600" : isPochi ? "bg-orange-500" : "bg-primary";
  const bannerText = isMpesa ? "text-green-100" : isPochi ? "text-orange-100" : "text-blue-100";
  const bannerSubtitle = isMpesa
    ? `M-Pesa · ${sale.mpesaCode}`
    : isPochi
    ? `Pochi · ${sale.pochiCode}`
    : "Cash payment received";

  return (
    <div className="p-4 max-w-sm mx-auto">
      {/* Receipt Card */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        {/* Success Banner */}
        <div className={`text-white text-center py-5 ${bannerBg}`}>
          <div className="text-4xl mb-1">✓</div>
          <p className="font-bold text-lg">Sale Complete!</p>
          <p className={`text-sm ${bannerText}`}>{bannerSubtitle}</p>
        </div>

        {/* Receipt Body */}
        <div className="p-5 font-mono text-sm">
          {/* Shop Header */}
          <div className="text-center mb-4 pb-4 border-b border-dashed border-gray-200">
            <p className="font-bold text-base text-gray-800">{shopName}</p>
            {kraRegistered && kraPin && (
              <p className="text-gray-400 text-xs">KRA PIN: {kraPin}</p>
            )}
            <p className="text-gray-400 text-xs mt-1">
              Receipt #{String(sale.id).padStart(6, "0")}
            </p>
            <p className="text-gray-400 text-xs">{formatDate(sale.timestamp)}</p>
            {sale.staff_name && (
              <p className="text-gray-400 text-xs">Cashier: {sale.staff_name}</p>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2 mb-4 pb-4 border-b border-dashed border-gray-200">
            {sale.items.map((item) => (
              <div key={item.id} className="flex justify-between">
                <div className="flex-1 pr-2">
                  <p className="text-gray-800 font-semibold text-xs">{item.name}</p>
                  <p className="text-gray-400 text-xs">
                    {item.quantity} × {formatPrice(item.price)}
                  </p>
                </div>
                <span className="text-gray-800 font-bold text-xs">
                  {formatPrice(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-1 mb-4 pb-4 border-b border-dashed border-gray-200">
            <div className="flex justify-between text-gray-500 text-xs">
              <span>Subtotal</span>
              <span>{formatPrice(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-500 text-xs">
              <span>VAT {Math.round(vatRate * 100)}%</span>
              <span>{formatPrice(sale.vat)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-800 text-sm pt-1">
              <span>TOTAL</span>
              <span>{formatPrice(sale.total)}</span>
            </div>
          </div>

          {/* Payment details */}
          <div className="space-y-1 mb-4">
            {isDigital ? (
              <>
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>Payment</span>
                  <span>{isMpesa ? "M-Pesa" : "Pochi la Biashara"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Code</span>
                  <span className={`font-bold tracking-wider ${isMpesa ? "text-green-700" : "text-orange-600"}`}>
                    {isMpesa ? sale.mpesaCode : sale.pochiCode}
                  </span>
                </div>
                <div className="mt-2 text-center text-xs text-orange-600 font-semibold bg-orange-50 rounded-lg py-1.5">
                  Pending verification
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>Cash Paid</span>
                  <span>{formatPrice(sale.amount)}</span>
                </div>
                <div className="flex justify-between font-bold text-green-600 text-sm">
                  <span>Change</span>
                  <span>{formatPrice(sale.change)}</span>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-gray-400 text-xs pt-4 border-t border-dashed border-gray-200">
            <p>Thank you for shopping at</p>
            <p className="font-semibold text-gray-500">{shopName}!</p>
          </div>
        </div>
      </div>

      {/* Print buttons */}
      <div className="mt-4 space-y-2">
        {printErr && (
          <p className="text-xs text-red-500 text-center font-medium px-2">{printErr}</p>
        )}
        <div className="flex gap-2">
          {thermalPrinter.isBluetoothAvailable && (
            <button
              onClick={handleBluetoothPrint}
              disabled={printing}
              className="flex-1 py-3 rounded-xl text-sm font-bold border-2 border-gray-200 text-gray-700 hover:border-primary hover:text-primary active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {printing ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
              )}
              {thermalPrinter.isConnected ? "Print (BT)" : "BT Print"}
            </button>
          )}
          <button
            onClick={handleBrowserPrint}
            className="flex-1 py-3 rounded-xl text-sm font-bold border-2 border-gray-200 text-gray-700 hover:border-primary hover:text-primary active:scale-95 transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {/* New Sale Button */}
      <button
        onClick={onNewSale}
        className="mt-3 w-full py-4 bg-primary text-white rounded-xl font-bold text-base hover:bg-blue-600 active:scale-95 transition"
      >
        New Sale
      </button>
    </div>
  );
}
