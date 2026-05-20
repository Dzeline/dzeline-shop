import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useCartStore } from "../store/cartStore";
import { useDebounce } from "../utils/useDebounce";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";

function StockBadge({ stock }) {
  if (stock === 0) {
    return (
      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
        Out of stock
      </span>
    );
  }
  if (stock <= 10) {
    return (
      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
        Low: {stock}
      </span>
    );
  }
  return (
    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      {stock} in stock
    </span>
  );
}

export default function ProductList() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const addItem = useCartStore((state) => state.addItem);

  const debouncedSearch = useDebounce(search, 300);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const allProducts = await dbHelpers.getAllProducts();
      setProducts(allProducts);
    } catch (error) {
      console.error("Failed to load products:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchProducts = useCallback(async (query) => {
    try {
      const results = await dbHelpers.searchProducts(query);
      setProducts(results);
    } catch (error) {
      console.error("Search failed:", error);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (debouncedSearch.trim() === "") {
      loadProducts();
    } else {
      searchProducts(debouncedSearch);
    }
  }, [debouncedSearch, loadProducts, searchProducts]);

  function handleAddToCart(product) {
    addItem({ ...product });
    showToast(`${product.name} added to cart`);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-44 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Search Bar */}
      <div className="mb-4 relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
        />
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <div
            key={product.id}
            className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-400 mb-1">{product.category}</p>
              <h3 className="font-bold text-sm text-gray-800 mb-2 leading-snug">{product.name}</h3>
              <p className="text-xl font-extrabold text-primary mb-2">
                {formatPrice(product.price)}
              </p>
              <StockBadge stock={product.stock} />
            </div>

            <button
              onClick={() => handleAddToCart(product)}
              disabled={product.stock === 0}
              className={`mt-3 w-full py-2.5 rounded-xl font-bold text-sm transition active:scale-95 ${
                product.stock > 0
                  ? "bg-primary text-white hover:bg-blue-600"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {product.stock > 0 ? "Add to Cart" : "Out of Stock"}
            </button>
          </div>
        ))}
      </div>

      {products.length === 0 && !loading && (
        <div className="text-center text-gray-400 mt-16">
          <p className="text-lg font-semibold">No products found</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}
    </div>
  );
}
