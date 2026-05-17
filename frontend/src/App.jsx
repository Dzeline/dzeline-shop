import { useState } from "react";
import ProductList from "./components/ProductList";
import Cart from "./components/Cart";
import { useOnline } from "./utils/useOnline";
import { useCartStore } from "./store/cartStore";

function App() {
  const [activeTab, setActiveTab] = useState("products"); // 'products' or 'cart'
  const isOnline = useOnline();
  const itemCount = useCartStore((state) => state.getItemCount());

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky-header bg-primary text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Dzeline Shop</h1>

          {/* Online Status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`}
            />
            <span className="text-sm">{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
        {activeTab === "products" && <ProductList />}
        {activeTab === "cart" && <Cart />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex">
        <button
          onClick={() => setActiveTab("products")}
          className={`flex-1 py-4 text-center ${
            activeTab === "products"
              ? "text-primary font-semibold border-t-2 border-primary"
              : "text-gray-500"
          }`}
        >
          Products
        </button>
        <button
          onClick={() => setActiveTab("cart")}
          className={`flex-1 py-4 text-center relative ${
            activeTab === "cart"
              ? "text-primary font-semibold border-t-2 border-primary"
              : "text-gray-500"
          }`}
        >
          Cart
          {itemCount > 0 && (
            <span className="absolute top-2 right-1/4 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {itemCount}
            </span>
          )}
        </button>
      </nav>
    </div>
  );
}

export default App;
