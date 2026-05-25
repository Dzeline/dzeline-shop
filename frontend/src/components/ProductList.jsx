import { useState, useEffect, useCallback, useRef } from "react";
import { dbHelpers } from "../services/db";
import { useCartStore } from "../store/cartStore";
import { useStaffStore } from "../store/staffStore";
import { useDebounce } from "../utils/useDebounce";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import ProductEditModal from "./ProductEditModal";
import ProductAddModal from "./ProductAddModal";

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

function BarcodeScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | error

  useEffect(() => {
    if (!("BarcodeDetector" in window)) {
      setStatus("unsupported");
      return;
    }
    const detector = new window.BarcodeDetector({
      formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e", "code_39", "qr_code"],
    });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setStatus("scanning");
          timerRef.current = setInterval(async () => {
            if (!videoRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                clearInterval(timerRef.current);
                navigator.vibrate?.(40);
                onScan(barcodes[0].rawValue);
              }
            } catch {}
          }, 250);
        }
      })
      .catch(() => setStatus("denied"));

    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/70 shrink-0">
        <p className="text-white font-semibold text-sm">Scan Barcode</p>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
        >×</button>
      </div>

      {(status === "error" || status === "denied" || status === "unsupported") ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
          <p className="text-white font-semibold">
            {status === "unsupported"
              ? "Barcode scanning not supported on this browser"
              : "Camera access denied"}
          </p>
          <p className="text-white/50 text-sm">Type the barcode number in the search box instead</p>
          <button onClick={onClose} className="px-5 py-2 bg-white/20 text-white rounded-xl text-sm font-semibold">
            Close
          </button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {/* Viewfinder */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-64 h-32">
              <div className="absolute inset-0 rounded-lg"
                style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
              <div className="absolute inset-0 border-2 border-white/80 rounded-lg" />
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-lg" />
              {status === "scanning" && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/80 animate-bounce" />
              )}
            </div>
          </div>
          <p className="absolute bottom-10 inset-x-0 text-center text-white/70 text-sm">
            {status === "starting" ? "Starting camera…" : "Point at a barcode"}
          </p>
        </div>
      )}
    </div>
  );
}

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

  const addItem = useCartStore((state) => state.addItem);
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const isAdmin = currentStaff?.id === 1;

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
      <div className="bg-zinc-200 min-h-screen px-3 pt-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
              <div className="h-24 bg-zinc-200" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-zinc-200 rounded w-1/2" />
                <div className="h-4 bg-zinc-200 rounded w-4/5" />
                <div className="h-4 bg-zinc-200 rounded w-3/5" />
                <div className="h-9 bg-zinc-200 rounded-xl mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-200 min-h-screen px-3 pt-3 pb-4">
      {/* Search + Scan + Add */}
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
            className="w-full pl-9 pr-4 py-2.5 bg-white border-0 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="shrink-0 w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm hover:bg-gray-100 active:scale-95 transition"
          title="Scan barcode"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            onClick={() => setShowAddModal(true)}
            className="shrink-0 w-10 h-10 flex items-center justify-center bg-primary text-white rounded-xl shadow-sm hover:bg-blue-600 active:scale-95 transition"
            title="Add new product"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {/* Product Grid */}
      {products.length === 0 ? (
        <div className="text-center text-gray-400 mt-20">
          <p className="text-lg font-semibold">No products found</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
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

                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={product.stock === 0}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm transition active:scale-95 ${
                    product.stock > 0
                      ? "bg-primary text-white hover:bg-blue-600"
                      : "bg-zinc-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {product.stock > 0 ? "Add to Cart" : "Out of Stock"}
                </button>

                {isAdmin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                    className="mt-1.5 w-full py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
                  >
                    Edit
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
