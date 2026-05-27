import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useCartStore } from "../store/cartStore";
import { useStaffStore } from "../store/staffStore";
import { useDebounce } from "../utils/useDebounce";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import ProductEditModal from "./ProductEditModal";
import ProductAddModal from "./ProductAddModal";
import BarcodeScanner from "./BarcodeScanner";

const CATEGORY_GRADIENT = {
  Grains:    "from-amber-50 to-orange-100",
  Sugar:     "from-rose-50 to-pink-100",
  Dairy:     "from-sky-50 to-blue-100",
  Oils:      "from-orange-50 to-yellow-100",
  Bakery:    "from-yellow-50 to-amber-100",
  Beverages: "from-teal-50 to-cyan-100",
  Spices:    "from-red-50 to-orange-100",
  Household: "from-slate-100 to-gray-200",
  Produce:   "from-green-50 to-emerald-100",
  Other:     "from-gray-100 to-slate-200",
};

const CATEGORY_TEXT = {
  Grains:    "text-amber-400",
  Sugar:     "text-rose-400",
  Dairy:     "text-sky-400",
  Oils:      "text-orange-400",
  Bakery:    "text-yellow-500",
  Beverages: "text-teal-400",
  Spices:    "text-red-400",
  Household: "text-slate-400",
  Produce:   "text-green-500",
  Other:     "text-gray-400",
};

function ProductPlaceholder({ category }) {
  const gradient = CATEGORY_GRADIENT[category] ?? CATEGORY_GRADIENT.Other;
  const textColor = CATEGORY_TEXT[category] ?? "text-gray-300";
  return (
    <div className={`w-full h-24 bg-linear-to-br ${gradient} flex items-center justify-center select-none`}>
      <span className={`text-4xl font-black ${textColor} opacity-60`}>
        {category?.charAt(0) ?? "?"}
      </span>
    </div>
  );
}

function StockBadge({ stock, reorderLevel }) {
  if (stock === 0) return null;
  if (stock <= (reorderLevel ?? 10)) {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 shrink-0">
        Low: {stock}
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">
      {stock}
    </span>
  );
}

export default function ProductList() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const [editMode, setEditMode] = useState(false);

  const addItem = useCartStore((state) => state.addItem);
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const isAdmin = currentStaff?.role === "admin";

  const debouncedSearch = useDebounce(search, 300);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await dbHelpers.getAllProducts());
    } catch (err) {
      console.error("Failed to load products:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchProducts = useCallback(async (query) => {
    try {
      setProducts(await dbHelpers.searchProducts(query));
    } catch (err) {
      console.error("Search failed:", err);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    if (debouncedSearch.trim() === "") {
      loadProducts();
    } else {
      searchProducts(debouncedSearch);
    }
  }, [debouncedSearch, loadProducts, searchProducts]);

  function handleAddToCart(product) {
    addItem({ ...product });
    showToast(`${product.name} added`);
  }

  const handleScan = useCallback(async (barcode) => {
    setShowScanner(false);
    const product = await dbHelpers.getProductByBarcode(barcode);
    if (product) {
      addItem({ ...product });
      showToast(`${product.name} added`);
    } else {
      setSearch(barcode);
      showToast(`Barcode ${barcode} — not found`);
    }
  }, [addItem]);

  if (loading) {
    return (
      <div className="bg-gray-900 min-h-screen px-3 pt-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
              <div className="h-24 bg-gray-200" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-1/2" />
                <div className="h-4 bg-gray-200 rounded w-4/5" />
                <div className="h-4 bg-gray-200 rounded w-3/5" />
                <div className="h-9 bg-gray-200 rounded-xl mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 min-h-screen px-3 pt-3 pb-4">
      {/* Search + Scan + Edit Mode + Add */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
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
            className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="shrink-0 w-10 h-10 flex items-center justify-center bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 active:scale-95 transition"
          title="Scan barcode"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
            <line x1="7" y1="8" x2="7" y2="16" strokeWidth={2} strokeLinecap="round" />
            <line x1="10" y1="8" x2="10" y2="16" strokeWidth={2} strokeLinecap="round" />
            <line x1="13" y1="8" x2="13" y2="12" strokeWidth={2} strokeLinecap="round" />
            <line x1="16" y1="8" x2="16" y2="16" strokeWidth={2} strokeLinecap="round" />
            <line x1="13" y1="14" x2="13" y2="16" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>

        {isAdmin && (
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl active:scale-95 transition ${
              editMode
                ? "bg-primary text-white shadow-lg shadow-primary/30"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
            title={editMode ? "Exit edit mode" : "Edit products"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="shrink-0 w-10 h-10 flex items-center justify-center bg-primary text-white rounded-xl hover:bg-blue-600 active:scale-95 transition"
            title="Add new product"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {/* Edit mode banner */}
      {editMode && (
        <div className="mb-3 flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <p className="text-primary text-xs font-semibold flex-1">Edit mode — tap a product card to edit it</p>
          <button onClick={() => setEditMode(false)} className="text-primary/60 hover:text-primary text-xs font-bold">Done</button>
        </div>
      )}

      {/* Product Grid */}
      {products.length === 0 ? (
        <div className="text-center text-gray-500 mt-20">
          <p className="text-lg font-semibold text-gray-400">No products found</p>
          <p className="text-sm mt-1 text-gray-600">Try a different search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <div
              key={product.id}
              onClick={() => editMode && isAdmin && setEditingProduct(product)}
              className={`bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col transition-shadow ${
                editMode ? "ring-2 ring-primary/40 cursor-pointer hover:ring-primary" : "hover:shadow-md"
              }`}
            >
              {/* Image or gradient placeholder */}
              {product.image_blob ? (
                <img
                  src={product.image_blob}
                  alt={product.name}
                  className="w-full h-24 object-cover"
                />
              ) : (
                <ProductPlaceholder category={product.category} />
              )}

              {/* Content */}
              <div className="p-3 flex flex-col flex-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 truncate">
                  {product.category}
                </p>
                <h3 className="font-bold text-sm text-gray-800 leading-snug mb-2 line-clamp-2 flex-1">
                  {product.name}
                </h3>

                {/* Price + stock on one row */}
                <div className="flex items-center justify-between mb-3 gap-1">
                  <p className="text-lg font-extrabold text-primary leading-none">
                    {formatPrice(product.price)}
                  </p>
                  <StockBadge stock={product.stock} reorderLevel={product.reorder_level} />
                </div>

                {editMode && isAdmin ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                    className="w-full py-2.5 rounded-xl font-bold text-sm bg-primary/10 text-primary hover:bg-primary/20 transition active:scale-95"
                  >
                    Edit Product
                  </button>
                ) : (
                  <button
                    onClick={() => handleAddToCart(product)}
                    disabled={product.stock === 0}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm transition active:scale-95 ${
                      product.stock > 0
                        ? "bg-primary text-white hover:bg-blue-600"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {product.stock > 0 ? "Add to Cart" : "Out of Stock"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          onSave={(updated) => {
            setProducts((prev) => prev.map((p) => p.id === updated.id ? updated : p));
            setEditingProduct(null);
          }}
          onClose={() => setEditingProduct(null)}
        />
      )}

      {showAddModal && (
        <ProductAddModal
          onSave={(newProduct) => {
            setProducts((prev) => [newProduct, ...prev]);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
