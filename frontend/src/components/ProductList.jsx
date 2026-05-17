import { useState, useEffect } from "react";
import { dbHelpers } from "../services/db";
import { useCartStore } from "../store/cartStore";

export default function ProductList() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const addItem = useCartStore((state) => state.addItem);

  // Load products on mount
  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const allProducts = await dbHelpers.getAllProducts();
      setProducts(allProducts);
    } catch (error) {
      console.error("Failed to load products:", error);
    } finally {
      setLoading(false);
    }
  }

  // Search products
  async function handleSearch(query) {
    setSearch(query);
    if (query.trim() === "") {
      loadProducts();
      return;
    }

    const results = await dbHelpers.searchProducts(query);
    setProducts(results);
  }

  function handleAddToCart(product) {
    addItem({ ...product });
    // Show visual feedback
    console.log(`Added ${product.name} to cart`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-500">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <div
            key={product.id}
            className="border border-gray-200 rounded-lg p-4 flex flex-col hover:shadow-lg transition"
          >
            {/* Product Info */}
            <div className="flex-1">
              <h3 className="font-semibold text-sm mb-1">{product.name}</h3>
              <p className="text-xs text-gray-500 mb-2">{product.category}</p>
              <p className="text-lg font-bold text-primary">
                KES {product.price}
              </p>
              <p className="text-xs text-gray-400">Stock: {product.stock}</p>
            </div>

            {/* Add Button */}
            <button
              onClick={() => handleAddToCart(product)}
              disabled={product.stock === 0}
              className={`mt-3 w-full py-2 rounded-lg font-semibold ${
                product.stock > 0
                  ? "bg-primary text-white hover:bg-blue-600"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              {product.stock > 0 ? "Add to Cart" : "Out of Stock"}
            </button>
          </div>
        ))}
      </div>

      {/* No results */}
      {products.length === 0 && (
        <div className="text-center text-gray-500 mt-8">No products found</div>
      )}
    </div>
  );
}
