import { useState, useEffect, useCallback } from "react";
import { supplierLedger, PAYMENT_STATUS, payMethodLabel } from "../services/supplierLedger";
import { formatPrice } from "../utils/formatters";
import { useEscapeKey } from "../hooks/useEscapeKey";
import RecordPaymentModal from "./RecordPaymentModal";

const STATUS_CHIP = {
  [PAYMENT_STATUS.PAID]:    "bg-green-100 text-green-700",
  [PAYMENT_STATUS.PARTIAL]: "bg-amber-100 text-amber-700",
  [PAYMENT_STATUS.UNPAID]:  "bg-red-100 text-red-700",
};
const STATUS_LABEL = {
  [PAYMENT_STATUS.PAID]:    "Paid",
  [PAYMENT_STATUS.PARTIAL]: "Part paid",
  [PAYMENT_STATUS.UNPAID]:  "Unpaid",
};

function shortDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function InvoiceCard({ invoice, onPay, onViewPhoto }) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[invoice.payment_status] ?? STATUS_CHIP[PAYMENT_STATUS.UNPAID];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition"
      >
        {/* The invoice photo, kept from receiving — proof of what was billed */}
        {invoice.photo_blob ? (
          <img
            src={invoice.photo_blob}
            alt="Invoice"
            className="w-10 h-10 rounded-lg object-cover shrink-0 border border-gray-200"
            onClick={(e) => { e.stopPropagation(); onViewPhoto(invoice.photo_blob); }}
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-800 truncate">
            {invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Delivery"}
          </p>
          <p className="text-xs text-gray-400">
            {shortDate(invoice.timestamp)} · {invoice.items.length} line{invoice.items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm text-gray-800">{formatPrice(invoice.invoice_amount)}</p>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${chip}`}>
            {STATUS_LABEL[invoice.payment_status]}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="space-y-1">
            {invoice.items.map((item) => (
              <div key={item.id} className="flex justify-between text-xs">
                <span className="text-gray-600 truncate">{item.product_name} ×{item.qty_added}</span>
                <span className="text-gray-500 shrink-0 ml-2">
                  {formatPrice((item.qty_added ?? 0) * (item.unit_cost ?? 0))}
                </span>
              </div>
            ))}
          </div>

          {invoice.payments.length > 0 && (
            <div className="border-t border-gray-100 pt-2 space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Payments</p>
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="text-gray-500">
                    {shortDate(p.paid_at)} · {payMethodLabel(p.method) ?? "Payment"}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="font-semibold text-green-700 shrink-0 ml-2">{formatPrice(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {invoice.outstanding > 0.01 && (
            <button
              onClick={() => onPay(invoice)}
              className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 active:scale-95 transition"
            >
              Mark as paid · {formatPrice(invoice.outstanding)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One supplier's whole relationship: what was ordered, what arrived, what was
 * billed, and what has been paid.
 *
 * Reached by tapping the supplier in the Suppliers list. Before this, an
 * invoice photo captured at receiving had nowhere to be seen again and nothing
 * recorded whether the supplier had been paid — so paying them happened outside
 * the system, from memory.
 */
export default function SupplierDetail({ supplier, onClose, onCreateOrder }) {
  useEscapeKey(onClose);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [photo, setPhoto] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await supplierLedger.getSupplierHistory(supplier.id));
    } finally {
      setLoading(false);
    }
  }, [supplier.id]);

  useEffect(() => { load(); }, [load]);

  const balance = data?.balance;

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-50 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-5 py-4 bg-white rounded-t-3xl border-b border-gray-100 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-base font-extrabold text-primary">
                {supplier.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-800 truncate">{supplier.name}</h3>
              <p className="text-xs text-gray-400">
                {supplier.phone || "No phone"}
                {supplier.email ? ` · ${supplier.email}` : ""}
              </p>
              {supplier.pay_method && (
                <p className="text-xs text-gray-500 mt-1">
                  <span className="font-semibold">{payMethodLabel(supplier.pay_method)}</span>
                  {supplier.pay_account ? ` ${supplier.pay_account}` : ""}
                  {supplier.pay_name ? ` · ${supplier.pay_name}` : ""}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0"
            >×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="space-y-3">
              {[0, 1].map((i) => <div key={i} className="h-16 bg-gray-200 rounded-2xl animate-pulse-light" />)}
            </div>
          )}

          {!loading && data && (
            <>
              {/* Balance */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Billed</p>
                    <p className="text-sm font-bold text-gray-800 mt-0.5">{formatPrice(balance.billed)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Paid</p>
                    <p className="text-sm font-bold text-green-700 mt-0.5">{formatPrice(balance.paid)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Owed</p>
                    <p className={`text-sm font-extrabold mt-0.5 ${balance.outstanding > 0 ? "text-red-600" : "text-gray-400"}`}>
                      {formatPrice(balance.outstanding)}
                    </p>
                  </div>
                </div>
                {balance.unpaidCount > 0 && (
                  <p className="text-xs text-gray-400 text-center mt-2 pt-2 border-t border-gray-100">
                    {balance.unpaidCount} unpaid invoice{balance.unpaidCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <button
                onClick={() => { onClose(); onCreateOrder(supplier); }}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-blue-600 active:scale-95 transition"
              >
                Create new order
              </button>

              {/* Invoices */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                  Invoices &amp; deliveries
                </p>
                {data.invoices.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
                    <p className="text-sm text-gray-400">
                      Nothing delivered yet. Invoices appear here once a delivery from this
                      supplier is activated into stock.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.invoices.map((inv) => (
                      <InvoiceCard
                        key={inv.id}
                        invoice={inv}
                        onPay={setPaying}
                        onViewPhoto={setPhoto}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Orders */}
              {data.orders.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Order history
                  </p>
                  <div className="space-y-2">
                    {data.orders.map((o) => {
                      const outstanding = o.items.reduce((s, i) => s + Math.max(0, i.qty_outstanding), 0);
                      return (
                        <div key={o.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800">
                                {shortDate(o.sent_at ?? o.created_at)}
                              </p>
                              <p className="text-xs text-gray-400">
                                {o.items.length} line{o.items.length !== 1 ? "s" : ""}
                                {outstanding > 0 ? ` · ${outstanding} still due` : " · fully received"}
                              </p>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600 shrink-0">
                              {o.status.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {paying && (
        <RecordPaymentModal
          invoice={paying}
          supplier={supplier}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); load(); }}
        />
      )}

      {photo && (
        <div
          className="fixed inset-0 z-80 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPhoto(null)}
        >
          <img src={photo} alt="Invoice" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
