import { useCartStore } from "../store/cartStore";
import { VAT_RATE } from "../utils/constants";
import { formatPrice } from "../utils/formatters";

export default function Cart() {
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const getTotal = useCartStore((state) => state.getTotal);
  const clearCart = useCartStore((state) => state.clearCart);

  const total = getTotal();
  const vat = total * VAT_RATE; // 16% VAT
  const grandTotal = total + vat;

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p className="text-lg mb-2">Cart is empty</p>
        <p className="text-sm">Add products to get started</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Cart Items */}
      <div className="space-y-3 mb-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg"
          >
            {/* Product Info */}
            <div className="flex-1">
              <h4 className="font-semibold text-sm">{item.name}</h4>
              <p className="text-xs text-gray-500">
                KES {item.price} × {item.quantity}
              </p>
            </div>

            {/* Quantity Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                className="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300"
              >
                -
              </button>
              <span className="w-8 text-center font-semibold">
                {item.quantity}
              </span>
              <button
                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                className="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300"
              >
                +
              </button>
            </div>

            {/* Subtotal & Remove */}
            <div className="text-right">
              <p className="font-bold text-primary">
                KES {(item.price * item.quantity).toFixed(2)}
              </p>
              <button
                onClick={() => removeItem(item.id)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-gray-300 pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Subtotal:</span>
          <span>KES {total.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>VAT (16%):</span>
          <span>KES {vat.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold">
          <span>{formatPrice(total)}:</span>
          <span className="text-primary">KES {grandTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 space-y-3">
        <button
          onClick={() => alert("Checkout coming in Week 3!")}
          className="w-full py-3 bg-primary text-white rounded-lg font-semibold hover:bg-blue-600"
        >
          Proceed to Checkout
        </button>
        <button
          onClick={clearCart}
          className="w-full py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
        >
          Clear Cart
        </button>
      </div>
    </div>
  );
}
