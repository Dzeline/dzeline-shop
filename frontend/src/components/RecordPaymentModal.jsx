import { useState } from "react";
import { supplierLedger, PAY_METHODS, payMethodLabel } from "../services/supplierLedger";
import { useStaffStore } from "../store/staffStore";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";
import { useEscapeKey } from "../hooks/useEscapeKey";

function shortDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Settle an invoice, in full or in part.
 *
 * Opens on the outstanding amount because paying in full is what usually
 * happens, but a part payment is a single edit away — shops do pay big invoices
 * in instalments, and recording that honestly is the whole point of keeping
 * payments as rows.
 */
export default function RecordPaymentModal({ invoice, supplier, onClose, onSaved }) {
  useEscapeKey(onClose);
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const [amount, setAmount] = useState(String(invoice.outstanding.toFixed(2)));
  const [method, setMethod] = useState(supplier?.pay_method ?? "cash");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  const value = parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0;
  const overpay = valid && value > invoice.outstanding + 0.01;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await supplierLedger.recordPayment({
        receipt_id: invoice.id,
        amount: value,
        method,
        reference,
        staff_id: currentStaff?.id ?? null,
      });
      showToast(`${formatPrice(value)} recorded`);
      onSaved();
    } catch (err) {
      console.error(err);
      showToast("Couldn't record the payment");
    } finally {
      setSaving(false);
    }
  }

  const methodSpec = PAY_METHODS.find((m) => m.id === method);

  return (
    <div className="fixed inset-0 z-70 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h3 className="font-bold text-gray-800">Record payment</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {supplier?.name} · {invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : shortDate(invoice.timestamp)}
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Invoice</span>
            <span className="font-semibold text-gray-800">{formatPrice(invoice.invoice_amount)}</span>
          </div>
          {invoice.amount_paid > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Already paid</span>
              <span className="font-semibold text-gray-600">{formatPrice(invoice.amount_paid)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm pt-1 border-t border-gray-200">
            <span className="text-gray-600 font-semibold">Outstanding</span>
            <span className="font-bold text-red-600">{formatPrice(invoice.outstanding)}</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Amount paid (KSH)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-lg font-bold text-right focus:outline-none focus:border-primary"
          />
          {overpay && (
            <p className="text-xs text-amber-600 mt-1">
              More than the outstanding balance — recorded as an overpayment.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Paid by</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {PAY_METHODS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          {supplier?.pay_account && method === supplier.pay_method && (
            <p className="text-xs text-gray-400 mt-1">
              {payMethodLabel(supplier.pay_method)} {supplier.pay_account}
              {supplier.pay_name ? ` · ${supplier.pay_name}` : ""}
            </p>
          )}
        </div>

        {methodSpec?.needsRef && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Reference (optional)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="M-Pesa code or transfer reference"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || saving}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
