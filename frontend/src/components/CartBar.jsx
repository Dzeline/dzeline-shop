import { useCartStore } from "../store/cartStore";
import { formatPrice } from "../utils/formatters";

/**
 * Running cart total, pinned above the bottom nav while shopping on a phone.
 *
 * On a desktop till the cart rail is always on screen, so this is the small
 * screen's stand-in: the cashier (and the customer leaning over the counter)
 * can see the total climb without leaving the product grid.
 */
export default function CartBar({ onOpenCart }) {
  const items = useCartStore((s) => s.items);
  const count = useCartStore((s) => s.getItemCount());
  const total = useCartStore((s) => s.getTotal());

  if (items.length === 0) return null;

  return (
    <button
      onClick={onOpenCart}
      className="lg:hidden shrink-0 w-full flex items-center gap-3 px-4 py-3 bg-primary text-white shadow-[0_-4px_16px_rgba(0,0,0,0.3)] btn-press"
    >
      <span className="flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-white/20 text-sm font-bold shrink-0">
        {count}
      </span>
      <span className="text-sm font-semibold">{count === 1 ? "item" : "items"}</span>
      <span className="flex-1 text-right text-lg font-extrabold tabular-nums truncate">
        {formatPrice(total)}
      </span>
      <svg className="w-4 h-4 shrink-0 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
