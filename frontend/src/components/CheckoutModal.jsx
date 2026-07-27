import { useState, useEffect } from "react";
import { formatPrice } from "../utils/formatters";
import { useSettingsStore } from "../store/settingsStore";
import { useOnline } from "../utils/useOnline";
import { syncService } from "../services/sync";

const DENOMINATIONS = [50, 100, 200, 500, 1000, 2000];

function CashTab({ grandTotal, onComplete }) {
  const [cashInput, setCashInput] = useState("");
  const currency = useSettingsStore((s) => s.currency);

  const cashAmount = parseFloat(cashInput) || 0;
  const change = cashAmount - grandTotal;
  const canComplete = cashAmount >= grandTotal;

  function handleDenomination(value) { setCashInput(String(value)); }
  function handleExact() { setCashInput(grandTotal.toFixed(2)); }

  function handleComplete() {
    if (!canComplete) return;
    onComplete({
      method: "CASH",
      amount: cashAmount,
      change: parseFloat(change.toFixed(2)),
    });
  }

  const quickDenoms = DENOMINATIONS.filter((d) => d >= grandTotal).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Cash Input */}
      <div>
        <label className="block text-sm font-semibold text-gray-600 mb-2">
          Cash Received ({currency})
        </label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={cashInput}
          onChange={(e) => { if (parseFloat(e.target.value) >= 0 || e.target.value === "") setCashInput(e.target.value); }}
          placeholder="Enter amount..."
          className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-primary text-right"
        />
      </div>

      {/* Quick Denominations */}
      <div>
        {quickDenoms.length > 0 && (
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Quick Select</p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {quickDenoms.map((d) => (
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
            className={`py-2 rounded-lg text-sm font-semibold border transition ${
              quickDenoms.length % 3 === 0 ? "col-span-3" : "col-span-2"
            } ${
              cashAmount === grandTotal
                ? "bg-primary text-white border-primary"
                : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary"
            }`}
          >
            Exact ({formatPrice(grandTotal)})
          </button>
        </div>
      </div>

      {/* Change display */}
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
    </div>
  );
}

function MpesaManualEntry({ grandTotal, onComplete }) {
  const [code, setCode] = useState("");
  const trimmedCode = code.trim().toUpperCase();
  const canComplete = trimmedCode.length >= 8;
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-gray-600 mb-2">
          M-Pesa Confirmation Code
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. QF94ELB2HX"
          maxLength={12}
          className="w-full px-4 py-4 text-xl font-bold tracking-widest border-2 border-gray-200 rounded-xl focus:outline-none focus:border-green-500 uppercase"
        />
        <p className="text-xs text-gray-400 mt-1">Customer receives this code via SMS after payment</p>
      </div>
      {canComplete && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 font-medium">
          Code <span className="font-extrabold">{trimmedCode}</span> will be saved for verification
        </div>
      )}
      <button
        onClick={() => { if (canComplete) onComplete({ method: "MPESA", amount: grandTotal, change: 0, mpesaCode: trimmedCode }); }}
        disabled={!canComplete}
        className={`w-full py-4 rounded-xl font-bold text-base transition ${
          canComplete ? "bg-green-600 text-white hover:bg-green-700 active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"
        }`}
      >
        Confirm M-Pesa Payment
      </button>
    </div>
  );
}

function MpesaTab({ grandTotal, onComplete }) {
  // phase: idle | requesting | waiting | manual | failed
  const [phase, setPhase] = useState("idle");
  const [phone, setPhone] = useState("");
  const [checkoutId, setCheckoutId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [isSandbox, setIsSandbox] = useState(false);

  const mpesaTill = useSettingsStore((s) => s.mpesaTill);
  const isOnline = useOnline();

  useEffect(() => {
    syncService.getMpesaMode().then((data) => {
      if (data?.sandbox) setIsSandbox(true);
    });
  }, []);

  // STK push: poll Daraja status every 3 s until confirmed/failed/expired
  useEffect(() => {
    if (phase !== "waiting" || !checkoutId) return;
    let alive = true;
    let pollTimer;

    const countdownId = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(countdownId);
          if (alive) {
            setPhase("failed");
            setErrorMsg("Payment request expired. Enter the code manually or try again.");
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    async function poll() {
      if (!alive) return;
      try {
        const res = await syncService.getMpesaStkStatus(checkoutId);
        if (!alive) return;
        if (res.status === "confirmed") {
          clearInterval(countdownId);
          onComplete({ method: "MPESA", amount: grandTotal, change: 0, mpesaCode: res.mpesa_code, checkoutRequestId: checkoutId });
          return;
        }
        if (res.status === "failed") {
          clearInterval(countdownId);
          setPhase("failed");
          setErrorMsg("Payment was declined. Enter the code manually or try again.");
          return;
        }
      } catch { /* network hiccup — keep polling */ }
      pollTimer = setTimeout(poll, 3000);
    }

    pollTimer = setTimeout(poll, 3000);
    return () => {
      alive = false;
      clearInterval(countdownId);
      clearTimeout(pollTimer);
    };
  }, [phase, checkoutId, grandTotal, onComplete]);


  async function handleRequest() {
    setErrorMsg("");
    setPhase("requesting");
    setSecondsLeft(120);
    try {
      const result = await syncService.initiateMpesaStk(null, phone, grandTotal);
      setCheckoutId(result.checkout_request_id);
      setPhase("waiting");
    } catch (err) {
      setPhase("failed");
      setErrorMsg(err.message || "Could not send payment request. Check connection or enter the code manually.");
    }
  }

  function reset() {
    setPhase("idle");
    setCheckoutId(null);
    setSecondsLeft(120);
    setErrorMsg("");
  }

  const validPhone = phone.replace(/\D/g, "").length >= 9;

  if (phase === "requesting") {
    return (
      <div className="flex flex-col items-center py-10 gap-4">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="font-semibold text-gray-700">Sending payment request…</p>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center py-6 gap-3">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 border-4 border-green-100 rounded-full" />
            <div className="absolute inset-0 border-4 border-green-500 border-b-transparent border-r-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-green-600">{secondsLeft}s</span>
            </div>
          </div>
          <p className="font-bold text-gray-800">Waiting for payment</p>
          <p className="text-sm text-gray-500">{phone}</p>
          <div className="bg-green-50 border border-green-200 rounded-xl px-8 py-3 text-center">
            <p className="text-2xl font-extrabold text-green-700">{formatPrice(grandTotal)}</p>
          </div>
          <p className="text-xs text-gray-400 text-center">Customer will see an M-Pesa prompt on their phone</p>
          {isSandbox && (
            <div className="w-full bg-red-50 border border-red-300 rounded-xl px-3 py-2 text-center">
              <p className="text-xs font-bold text-red-600">⚠️ SANDBOX — Tell customer: do NOT enter real PIN</p>
            </div>
          )}
        </div>
        <button onClick={reset} className="w-full py-3 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition">
          Cancel
        </button>
        <button onClick={() => setPhase("manual")} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition text-center">
          Enter code manually instead →
        </button>
      </div>
    );
  }

  if (phase === "manual") {
    return (
      <div className="space-y-4">
        <button onClick={reset} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition">
          ← Back
        </button>
        <MpesaManualEntry grandTotal={grandTotal} onComplete={onComplete} />
      </div>
    );
  }

  // idle or failed
  return (
    <div className="space-y-4">
      {isSandbox && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-3 flex gap-2.5 items-start">
          <span className="text-red-500 text-lg leading-none shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-bold text-red-700">SANDBOX MODE — Test Environment</p>
            <p className="text-xs text-red-600 mt-0.5">Real M-Pesa PINs will deduct real money. Use Safaricom test number <span className="font-mono font-bold">0708374149</span> only.</p>
          </div>
        </div>
      )}

      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-green-800 mb-1">Customer pays to Till:</p>
        <p className="text-2xl font-extrabold text-green-700">{mpesaTill || "—"}</p>
        <p className="text-sm text-green-600 mt-1">Amount: <span className="font-bold">{formatPrice(grandTotal)}</span></p>
      </div>

      {phase === "failed" && errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 font-medium">{errorMsg}</div>
      )}

      {isOnline ? (
        <>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">Customer's Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrorMsg(""); }}
              placeholder="e.g. 0712 345 678"
              className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            onClick={handleRequest}
            disabled={!validPhone}
            className={`w-full py-4 rounded-xl font-bold text-base transition ${
              validPhone ? "bg-green-600 text-white hover:bg-green-700 active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Send Payment Request
          </button>
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-xs text-gray-400">or enter code manually</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>
        </>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 font-medium">
          Device is offline — enter confirmation code below
        </div>
      )}

      <MpesaManualEntry grandTotal={grandTotal} onComplete={onComplete} />
    </div>
  );
}

function PochiTab({ grandTotal, onComplete }) {
  const [code, setCode] = useState("");
  const pochiNumber = useSettingsStore((s) => s.pochiNumber);
  const trimmedCode = code.trim().toUpperCase();
  const canComplete = trimmedCode.length >= 8;

  function handleComplete() {
    if (!canComplete) return;
    onComplete({ method: "POCHI", amount: grandTotal, change: 0, pochiCode: trimmedCode });
  }

  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-orange-800 mb-1">Customer sends via M-Pesa:</p>
        <p className="text-lg font-extrabold text-orange-700">
          Send Money → {pochiNumber || "—"}
        </p>
        <p className="text-sm text-orange-600 mt-1">
          Amount: <span className="font-bold">{formatPrice(grandTotal)}</span>
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-600 mb-2">
          M-Pesa Confirmation Code
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. QF94ELB2HX"
          maxLength={12}
          className="w-full px-4 py-4 text-xl font-bold tracking-widest border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 uppercase"
        />
        <p className="text-xs text-gray-400 mt-1">Customer receives this code via SMS after sending</p>
      </div>

      {canComplete && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 font-medium">
          Code <span className="font-extrabold">{trimmedCode}</span> will be saved for verification
        </div>
      )}

      <button
        onClick={handleComplete}
        disabled={!canComplete}
        className={`w-full py-4 rounded-xl font-bold text-base transition ${
          canComplete
            ? "bg-orange-500 text-white hover:bg-orange-600 active:scale-95"
            : "bg-gray-200 text-gray-400 cursor-not-allowed"
        }`}
      >
        Confirm Pochi Payment
      </button>
    </div>
  );
}

export default function CheckoutModal({ items, subtotal, vat, grandTotal, onComplete, onCancel }) {
  const [tab, setTab] = useState("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const vatEnabled = useSettingsStore((s) => s.vatEnabled);
  const vatRate = useSettingsStore((s) => s.vatRate);

  function handleComplete(payment) {
    onComplete({
      ...payment,
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-800">Checkout</h2>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Customer (optional) */}
          <div className="flex gap-2">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-primary"
            />
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              className="w-36 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-primary"
            />
          </div>

          {/* Order Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Order Summary</p>
            {items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-600">{item.name} × {item.quantity}</span>
                <span className="font-medium">{formatPrice(item.price * item.quantity)}</span>
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span><span>{formatPrice(subtotal)}</span>
              </div>
              {vatEnabled && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>VAT ({Math.round(vatRate * 100)}%)</span><span>{formatPrice(vat)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-800 pt-1">
                <span>Total</span>
                <span className="text-primary">{formatPrice(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Payment method tabs */}
          <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setTab("cash")}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                tab === "cash" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Cash
            </button>
            <button
              onClick={() => setTab("mpesa")}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                tab === "mpesa" ? "bg-white text-green-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              M-Pesa
            </button>
            <button
              onClick={() => setTab("pochi")}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                tab === "pochi" ? "bg-white text-orange-500 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Pochi
            </button>
          </div>

          {/* Tab content */}
          {tab === "cash" && <CashTab grandTotal={grandTotal} onComplete={handleComplete} />}
          {tab === "mpesa" && <MpesaTab grandTotal={grandTotal} onComplete={handleComplete} />}
          {tab === "pochi" && <PochiTab grandTotal={grandTotal} onComplete={handleComplete} />}
        </div>

        {/* Cancel footer */}
        <div className="px-5 pb-5 shrink-0">
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-semibold text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
