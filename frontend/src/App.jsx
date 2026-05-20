import { useState } from "react";
import ProductList from "./components/ProductList";
import Cart from "./components/Cart";
import { useOnline } from "./utils/useOnline";
import { useCartStore } from "./store/cartStore";

function App() {
  const [activeTab, setActiveTab] = useState("products");
  const isOnline = useOnline();
  const itemCount = useCartStore((state) => state.getItemCount());

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky-header bg-linear-to-r from-primary to-blue-700 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Dzeline Shop</h1>
            <p className="text-blue-200 text-xs">Point of Sale</p>
          </div>

          <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
            <div
              className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`}
            />
            <span className="text-xs font-medium">
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
        {activeTab === "products" && <ProductList />}
        {activeTab === "cart" && (
          <Cart onNewSale={() => setActiveTab("products")} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex shadow-lg">
        <button
          onClick={() => setActiveTab("products")}
          className={`flex-1 py-4 flex flex-col items-center gap-1 transition ${
            activeTab === "products"
              ? "text-primary border-t-2 border-primary -mt-px"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span className={`text-xs font-semibold ${activeTab === "products" ? "" : "font-normal"}`}>
            Products
          </span>
        </button>

        <button
          onClick={() => setActiveTab("cart")}
          className={`flex-1 py-4 flex flex-col items-center gap-1 relative transition ${
            activeTab === "cart"
              ? "text-primary border-t-2 border-primary -mt-px"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <div className="relative">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13l-1-4m9 10a1 1 0 100 2 1 1 0 000-2zm-6 0a1 1 0 100 2 1 1 0 000-2z" />
            </svg>
            {itemCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-4.5 h-4.5 flex items-center justify-center px-1">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </div>
          <span className={`text-xs ${activeTab === "cart" ? "font-semibold" : "font-normal"}`}>
            Cart
          </span>
        </button>
      </nav>
    </div>
  );
}

export default App;
