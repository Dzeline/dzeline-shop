import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useCartStore } from "../store/cartStore";
import { useDebounce } from "../utils/useDebounce";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import ProductEditModal from "./ProductEditModal";
import ProductAddModal from "./ProductAddModal";
import BarcodeScanner from "./BarcodeScanner";
import { usePermissions } from "../hooks/usePermissions";
import { FEATURES } from "../utils/permissions";

const CATEGORY_ACCENT = {
  Grains:    "#f59e0b",
  Sugar:     "#fb7185",
  Dairy:     "#38bdf8",
  Oils:      "#fb923c",
  Bakery:    "#eab308",
  Beverages: "#2dd4bf",
  Spices:    "#f87171",
  Household: "#94a3b8",
  Produce:   "#4ade80",
  Other:     "#9ca3af",
};

function accent(category) {
  return CATEGORY_ACCENT[category] ?? CATEGORY_ACCENT.Other;
}

function StockBar({ stock, reorderLevel }) {
  const [width, setWidth] = useState(0);
  const pct = Math.min(100, Math.max(0, stock));
  const low = stock <= (reorderLevel ?? 10);
  const color = stock === 0 ? "#ef4444" : low ? "#f97316" : "#22c55e";

  useEffect(() => {
    const id = setTimeout(() => setWidth(pct), 60);
    return () => clearTimeout(id);
  }, [pct]);

  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${width}%`,
          background: color,
          transition: "width 0.65s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
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
  const { can } = usePermissions();
  const canEdit = can(FEATURES.EDIT_PRODUCTS);
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
    if (debouncedSearch.trim() === "") loadProducts();
    else searchProducts(debouncedSearch);
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
      <div className="bg-gray-900 px-2.5 pt-3">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-white rounded-3xl overflow-hidden animate-pulse">
              <div className="h-1.5 bg-gray-200" />
              <div className="p-2.5 space-y-2 pt-3">
                <div className="h-2 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-4/5" />
                <div className="h-1 bg-gray-100 rounded-full mt-2" />
                <div className="h-3.5 bg-gray-100 rounded w-1/2 mt-1" />
                <div className="h-7 bg-gray-100 rounded-2xl mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 px-2.5 pt-3 pb-3">
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

        {canEdit && (
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

        {canEdit && (
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
          <p className="text-primary text-xs font-semibold flex-1">Tap a product to edit it</p>
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
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
          {products.map((product, idx) => {
            const col = accent(product.category);
            const outOfStock = product.stock === 0;

            return (
              <div
                key={product.id}
                onClick={() => editMode && canEdit && setEditingProduct(product)}
                className={`animate-scale-in bg-white rounded-3xl shadow-sm overflow-hidden flex flex-col transition-shadow ${
                  editMode ? "ring-2 ring-primary/40 cursor-pointer hover:ring-primary" : "hover:shadow-md"
                }`}
                style={{ animationDelay: `${Math.min(idx, 8) * 0.04}s` }}
              >
                {/* Category accent strip */}
                <div className="h-1.5 shrink-0" style={{ background: col }} />

                {/* Content */}
                <div className="p-2.5 flex flex-col flex-1 gap-1">
                  {/* Thumbnail + category + name row */}
                  <div className="flex items-start gap-1.5">
                    {/* Small square thumbnail / initial placeholder */}
                    {product.image_blob ? (
                      <img
                        src={product.image_blob}
                        alt={product.name}
                        className="w-8 h-8 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-extrabold"
                        style={{ background: col }}
                      >
                        {(product.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[9px] font-bold uppercase tracking-widest leading-none truncate"
                        style={{ color: col }}
                      >
                        {product.category ?? "Other"}
                      </p>
                      <h3 className="font-bold text-xs text-gray-800 leading-snug line-clamp-2 flex-1 mt-0.5">
                        {product.name}
                      </h3>
                    </div>
                  </div>

                  {/* Stock bar */}
                  <StockBar stock={product.stock} reorderLevel={product.reorder_level} />

                  {/* Price + stock count */}
                  <div className="flex items-end justify-between gap-1 mt-0.5">
                    <p className={`text-sm font-extrabold leading-none ${outOfStock ? "text-gray-300" : "text-primary"}`}>
                      {formatPrice(product.price)}
                    </p>
                    {!outOfStock && (
                      <span className={`text-[9px] font-semibold leading-none pb-px ${
                        product.stock <= (product.reorder_level ?? 10) ? "text-orange-400" : "text-gray-400"
                      }`}>
                        {product.stock}
                      </span>
                    )}
                  </div>

                  {/* Action button */}
                  {editMode && canEdit ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                      className="w-full py-1.5 rounded-2xl font-bold text-xs bg-primary/10 text-primary hover:bg-primary/20 transition active:scale-95 mt-0.5"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAddToCart(product)}
                      disabled={outOfStock}
                      className={`w-full py-1.5 rounded-2xl font-bold text-xs transition active:scale-95 mt-0.5 ${
                        outOfStock
                          ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                          : "bg-primary text-white hover:bg-blue-600"
                      }`}
                    >
                      {outOfStock ? "Sold Out" : "Add"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
