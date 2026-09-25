import { useState, useEffect, useCallback } from "react";
import { purchaseOrders, PO_STATUS, STALE_AFTER_DAYS } from "../services/purchaseOrders";
import { showToast } from "../utils/toast";
import { supplierLedger } from "../services/supplierLedger";
import { formatPrice } from "../utils/formatters";
import RecordPaymentModal from "./RecordPaymentModal";

const STATUS_STYLE = {
  [PO_STATUS.SENT]:      { label: "Sent",      chip: "bg-blue-100 text-blue-700" },
  [PO_STATUS.PARTIAL]:   { label: "Part received", chip: "bg-amber-100 text-amber-700" },
  [PO_STATUS.RECEIVED]:  { label: "Received",  chip: "bg-green-100 text-green-700" },
  [PO_STATUS.CANCELLED]: { label: "Cancelled", chip: "bg-gray-200 text-gray-600" },
  [PO_STATUS.DRAFT]:     { label: "Draft",     chip: "bg-gray-100 text-gray-500" },
};

function daysAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function OrderCard({ order, invoices = [], onChanged, onPay }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const style = STATUS_STYLE[order.status] ?? STATUS_STYLE[PO_STATUS.SENT];

  const outstanding = order.items.reduce((sum, i) => sum + Math.max(0, i.qty_outstanding), 0);
  const ordered = order.items.reduce((sum, i) => sum + (i.qty_ordered ?? 0), 0);

  // Once the goods have arrived the question stops being "did it come?" and
  // becomes "have we paid for it?" — so the card changes what it asks.
  const billed = invoices.reduce((sum, i) => sum + i.invoice_amount, 0);
  const owedOnOrder = invoices.reduce((sum, i) => sum + i.outstanding, 0);
  const isDelivered = order.status === PO_STATUS.RECEIVED || order.status === PO_STATUS.PARTIAL;
  const fullyPaid = invoices.length > 0 && owedOnOrder <= 0.01;

  async function act(cancelled) {
    setBusy(true);
    try {
      await purchaseOrders.close(order.id, { cancelled });
      showToast(cancelled ? "Order cancelled" : "Order marked received");
      onChanged();
    } catch (err) {
      console.error(err);
      showToast("Couldn't update the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition"
      >
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-gray-800 truncate">{order.supplier}</p>
          <p className="text-xs text-gray-400">
            {daysAgo(order.sent_at ?? order.created_at)} &middot; {order.items.length} line
            {order.items.length !== 1 ? "s" : ""}
            {outstanding > 0 ? ` · ${outstanding} of ${ordered} still due` : ""}
            {billed > 0 ? ` · ${formatPrice(billed)} invoiced` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${style.chip}`}>
          {style.label}
        </span>
        {invoices.length > 0 && (
          <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${
            fullyPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            {fullyPaid ? "Paid" : `Owe ${formatPrice(owedOnOrder)}`}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {order.isStale && (
        <div className="px-4 pb-2">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Sent over {STALE_AFTER_DAYS} days ago and still open. It has stopped counting as
            &ldquo;on order&rdquo;, so low stock will be flagged again — close it if it arrived,
            or cancel it.
          </p>
        </div>
      )}

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            {order.items.map((item) => {
              const done = item.qty_outstanding <= 0;
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className={`flex-1 min-w-0 truncate ${done ? "text-gray-400 line-through" : "text-gray-800"}`}>
                    {item.product_name ?? `Product #${item.product_id}`}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {done
                      ? `${item.qty_ordered} received`
                      : `${item.qty_outstanding} of ${item.qty_ordered} due`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Invoices raised against this order */}
          {invoices.length > 0 && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                Invoice{invoices.length !== 1 ? "s" : ""}
              </p>
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3">
                  {inv.photo_blob && (
                    <img
                      src={inv.photo_blob}
                      alt="Invoice"
                      className="w-9 h-9 rounded-lg object-cover border border-gray-200 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Delivery"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatPrice(inv.invoice_amount)}
                      {inv.amount_paid > 0 ? ` · ${formatPrice(inv.amount_paid)} paid` : ""}
                    </p>
                  </div>
                  {inv.outstanding > 0.01 ? (
                    <button
                      onClick={() => onPay(inv)}
                      className="shrink-0 px-3 py-2 rounded-xl bg-green-600 text-white text-xs font-bold hover:bg-green-700 active:scale-95 transition"
                    >
                      Mark as paid · {formatPrice(inv.outstanding)}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">
                      Paid
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Once delivered, "mark received" is meaningless — what is left to do
              is pay. The manual close stays only for orders still waiting. */}
          {isDelivered ? (
            invoices.length === 0 && (
              <p className="text-xs text-gray-400">
                Delivered, but no invoice is filed against this order. Invoices are attached
                when a delivery is activated in Receiving.
              </p>
            )
          ) : (
            <>
              <p className="text-xs text-gray-400">
                Lines close by themselves as deliveries are activated in Receiving. Use these
                only when stock arrived without going through Receiving, or it is not coming.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => act(false)}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 active:scale-95 transition disabled:opacity-50"
                >
                  Mark received
                </button>
                <button
                  onClick={() => act(true)}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50 active:scale-95 transition disabled:opacity-50"
                >
                  Cancel order
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Open purchase orders.
 *
 * Exists so an order has somewhere to be seen and closed. Without it, orders
 * recorded when the WhatsApp message went out would pile up invisibly and the
 * "on order" badge could never be cleared by hand.
 */
export default function PurchaseOrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoicesByOrder, setInvoicesByOrder] = useState(new Map());
  const [payables, setPayables] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [open, past, owed] = await Promise.all([
        purchaseOrders.getOpen(),
        purchaseOrders.getHistory(30),
        supplierLedger.getPayables(),
      ]);
      const closed = past.filter(
        (o) => o.status === PO_STATUS.RECEIVED || o.status === PO_STATUS.CANCELLED,
      );
      setOrders(open);
      setHistory(closed);
      setPayables(owed);
      setInvoicesByOrder(
        await supplierLedger.getInvoicesByOrder([...open, ...closed].map((o) => o.id)),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Orders</h2>
          <p className="text-xs text-gray-400">Sent to suppliers, waiting on delivery</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 transition disabled:opacity-40"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[0, 1].map((i) => <div key={i} className="h-20 bg-gray-800 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {/* What is owed across every supplier — so settling several is one
            screen rather than a hunt through order history. */}
        {!loading && payables?.total > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-baseline justify-between mb-2">
              <p className="font-bold text-gray-700 text-sm">Owed to suppliers</p>
              <p className="text-lg font-extrabold text-red-600">{formatPrice(payables.total)}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {payables.suppliers.map((sup) => (
                <div key={sup.supplier_id ?? sup.supplier} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{sup.supplier}</p>
                    <p className="text-xs text-gray-400">
                      {sup.invoices.length} unpaid invoice{sup.invoices.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-red-600 shrink-0 ml-2">
                    {formatPrice(sup.outstanding)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
              Open an order below, or a supplier in Suppliers, to record a payment.
            </p>
          </div>
        )}

        {!loading && orders.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
            <p className="font-semibold text-gray-700">No open orders</p>
            <p className="text-sm text-gray-400 mt-1">
              Orders appear here when you send one from Stock &rarr; Suppliers.
            </p>
          </div>
        )}

        {!loading && orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            invoices={invoicesByOrder.get(o.id) ?? []}
            onChanged={load}
            onPay={setPaying}
          />
        ))}

        {!loading && history.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs font-bold text-gray-400 uppercase tracking-wide hover:text-gray-300 transition"
            >
              {showHistory ? "Hide" : "Show"} closed orders ({history.length})
            </button>
            {showHistory && (
              <div className="space-y-3 mt-3">
                {history.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    invoices={invoicesByOrder.get(o.id) ?? []}
                    onChanged={load}
                    onPay={setPaying}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {paying && (
        <RecordPaymentModal
          invoice={paying}
          supplier={{ name: paying.supplier }}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); load(); }}
        />
      )}
    </div>
  );
}
