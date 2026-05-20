import { formatPrice, formatDate } from "../utils/formatters";
import { SHOP_INFO } from "../utils/constants";

export default function Receipt({ sale, onNewSale }) {
  return (
    <div className="p-4 max-w-sm mx-auto">
      {/* Receipt Card */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        {/* Success Banner */}
        <div className="bg-green-500 text-white text-center py-5">
          <div className="text-4xl mb-1">✓</div>
          <p className="font-bold text-lg">Sale Complete!</p>
          <p className="text-green-100 text-sm">Payment received successfully</p>
        </div>

        {/* Receipt Body */}
        <div className="p-5 font-mono text-sm">
          {/* Shop Header */}
          <div className="text-center mb-4 pb-4 border-b border-dashed border-gray-200">
            <p className="font-bold text-base text-gray-800">{SHOP_INFO.name}</p>
            <p className="text-gray-400 text-xs">KRA PIN: {SHOP_INFO.kraPin}</p>
            <p className="text-gray-400 text-xs mt-1">
              Receipt #{String(sale.id).padStart(6, "0")}
            </p>
            <p className="text-gray-400 text-xs">{formatDate(sale.timestamp)}</p>
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
              <span>VAT 16%</span>
              <span>{formatPrice(sale.vat)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-800 text-sm pt-1">
              <span>TOTAL</span>
              <span>{formatPrice(sale.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-1 mb-4">
            <div className="flex justify-between text-gray-500 text-xs">
              <span>Cash Paid</span>
              <span>{formatPrice(sale.amount)}</span>
            </div>
            <div className="flex justify-between font-bold text-green-600 text-sm">
              <span>Change</span>
              <span>{formatPrice(sale.change)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-gray-400 text-xs pt-4 border-t border-dashed border-gray-200">
            <p>Thank you for shopping at</p>
            <p className="font-semibold text-gray-500">{SHOP_INFO.name}!</p>
          </div>
        </div>
      </div>

      {/* New Sale Button */}
      <button
        onClick={onNewSale}
        className="mt-5 w-full py-4 bg-primary text-white rounded-xl font-bold text-base hover:bg-blue-600 active:scale-95 transition"
      >
        New Sale
      </button>
    </div>
  );
}
