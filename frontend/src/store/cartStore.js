import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useCartStore = create(
  persist(
    (set, get) => ({
      // Cart state
      items: [],

      /**
       * Put a product in the cart, unless it has no price.
       *
       * A catalogue imported from another POS can arrive with prices missing -
       * Aronium's stock report, for one, only reveals a price for products that
       * had stock at the time of export. Without this guard a cashier scans such
       * an item, it rings up at zero, and the shop gives away stock without
       * anyone noticing until the day's takings are counted.
       *
       * The refusal lives here rather than at the three call sites (tap, camera
       * scan, USB scanner) so none of them can miss it, and it returns the reason
       * instead of showing a message, because what the cashier should see differs
       * between a toast and the in-camera overlay.
       */
      addItem: (product) => {
        if (!product?.price || product.price <= 0) {
          return { ok: false, reason: "no-price" };
        }
        set((state) => {
          const existingItem = state.items.find(
            (item) => item.id === product.id,
          );
          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.id === product.id
                  ? { ...item, quantity: item.quantity + 1 }
                  : item,
              ),
            };
          }
          return { items: [...state.items, { ...product, quantity: 1 }] };
        });
        return { ok: true };
      },

      // Remove item from cart
      removeItem: (productId) => {
        set({
          items: get().items.filter((item) => item.id !== productId),
        });
      },

      // Update item quantity
      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }

        set({
          items: get().items.map((item) =>
            item.id === productId ? { ...item, quantity } : item,
          ),
        });
      },

      // Clear cart
      clearCart: () => {
        set({ items: [] });
      },

      // Calculate total
      getTotal: () => {
        return get().items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
      },

      // Get item count
      getItemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: "dzeline-cart-storage",
      version: 1,
    },
  ),
);
