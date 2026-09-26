import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { dbHelpers } from "../services/db";
import { syncService } from "../services/sync";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import { useDebounce } from "../utils/useDebounce";
import { compressImage } from "../utils/imageCompression";
import ProductAddModal from "./ProductAddModal";

// Lazy-loaded: pulls in the zxing decoder, only needed once the scanner opens.
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

export default function StockReceiving({ currentStaffId, onClose }) {
  const [products, setProducts] = useState([]);
  const [savedSuppliers, setSavedSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);

  const [supplier, setSupplier] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showLineScanner, setShowLineScanner] = useState(false);

  useEffect(() => {
    Promise.all([
      dbHelpers.getAllProducts().then(setProducts),
      dbHelpers.getAllSuppliers().then(setSavedSuppliers),
    ]);
  }, []);

  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode || "").includes(debouncedSearch.trim()) ||
        (p.tags || []).some((t) => t.includes(q))
    );
  }, [products, debouncedSearch]);

  // ── Photo capture ────────────────────────────────────────────────────────

  function handlePhotoCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result).catch(() => ev.target.result);
      setPhotoBlob(compressed);
    };
    reader.readAsDataURL(file);
  }

  // ── Line item helpers ────────────────────────────────────────────────────

  function handleAddProduct(product) {
    if (lineItems.find((li) => li.product_id === product.id)) {
      showToast(`${product.name} already added`);
      return;
    }
    setLineItems((prev) => [
      ...prev,
      {
        product_id:    product.id,
        product_name:  product.name,
        qty_added:     1,
        unit_cost:     "",
        current_stock: product.stock,
        expiry_date:   "",
        condition:     "good",
      },
    ]);
    setSearch("");
  }

  async function handleLineScan(barcode) {
    setShowLineScanner(false);
    const product = await dbHelpers.getProductByBarcode(barcode);
    if (product) {
      handleAddProduct(product);
    } else {
      setSearch(barcode);
      showToast(`Barcode ${barcode} — not found`);
    }
  }

  // Clamping on every keystroke made the field impossible to clear-and-retype:
  // backspacing to "" instantly snapped back to 1 before a new digit could be
  // entered. Keep the raw (possibly empty/partial) string while typing, only
  // clamp to a valid integer on blur.
  function handleQtyChange(product_id, value) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, qty_added: value } : li)
    );
  }

  function handleQtyBlur(product_id) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id
        ? { ...li, qty_added: Math.max(1, parseInt(li.qty_added) || 1) }
        : li
      )
    );
  }

  function handleQtyStep(product_id, delta) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id
        ? { ...li, qty_added: Math.max(1, (parseInt(li.qty_added) || 0) + delta) }
        : li
      )
    );
  }

  function handleCostChange(product_id, value) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, unit_cost: value } : li)
    );
  }

  function handleExpiryChange(product_id, value) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, expiry_date: value } : li)
    );
  }

  function handleConditionChange(product_id, value) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, condition: value } : li)
    );
  }

  function handleRemoveLine(product_id) {
    setLineItems((prev) => prev.filter((li) => li.product_id !== product_id));
  }

  function handleNewProductSaved(newProduct) {
    setProducts((prev) => [...prev, newProduct]);
    setShowAddProduct(false);
    handleAddProduct(newProduct);
    showToast(`${newProduct.name} created and added`);
  }

  async function handleSubmit() {
    if (!supplier.trim()) { showToast("Enter supplier name"); return; }
    if (lineItems.length === 0) { showToast("Add at least one product"); return; }
    setSubmitting(true);
    try {
      await dbHelpers.addStockReceipt({
        supplier:       supplier.trim(),
        supplier_id:    selectedSupplierId,
        invoice_number: invoiceNumber.trim() || null,
        photo_blob:     photoBlob,
        items: lineItems.map(({ product_id, qty_added, unit_cost, expiry_date, condition }) => ({
          product_id,
          // Defensive — the field normally clamps on blur, but a submit tap
          // that doesn't trigger blur first shouldn't be able to send an
          // empty/invalid quantity.
          qty_added:   Math.max(1, parseInt(qty_added) || 1),
          unit_cost:   parseFloat(unit_cost) || null,
          expiry_date: expiry_date || null,
          condition:   condition || "good",
        })),
        staff_id: currentStaffId,
      });
      setSubmitted(true);
      showToast("Submitted for pricing review");
      syncService.pushUnsyncedReceipts().catch(() => {});
    } catch (err) {
      console.error(err);
      showToast("Failed to save — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (showAddProduct) {
    return (
      <ProductAddModal
        onSave={handleNewProductSaved}
        onClose={() => setShowAddProduct(false)}
        onOpenExisting={(product) => {
          // What they were trying to do anyway: put this product on the delivery.
          setShowAddProduct(false);
          handleAddProduct(product);
        }}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col h-full bg-gray-900">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
          {onClose && (
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
            >
              ‹
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-white">Stock Receiving</h2>
            <p className="text-xs text-gray-400">
              {lineItems.length} product{lineItems.length !== 1 ? "s" : ""} added
            </p>
          </div>

        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!submitted ? (
            <>
              {/* Supplier details */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <p className="font-bold text-gray-700 text-sm">Supplier Details</p>

                {savedSuppliers.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1.5 block">Saved Suppliers</label>
                    <div className="flex flex-wrap gap-2">
                      {savedSuppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSupplier(s.name); setSelectedSupplierId(s.id); }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                            selectedSupplierId === s.id
                              ? "bg-primary text-white"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Supplier Name *{selectedSupplierId ? " (linked)" : ""}
                  </label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => { setSupplier(e.target.value); setSelectedSupplierId(null); }}
                    placeholder="e.g. Unga Group, Bidco"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Invoice No. (optional)</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="e.g. INV-2024-001"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Invoice photo */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Invoice Photo</label>
                  {photoPreview ? (
                    <div className="relative">
                      <img
                        src={photoPreview}
                        alt="Invoice"
                        className="w-full max-h-48 object-cover rounded-xl border border-gray-200"
                      />
                      <button
                        onClick={() => { setPhotoBlob(null); setPhotoPreview(null); }}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {/* Camera — opens device camera directly */}
                      <label className="flex flex-col items-center justify-center gap-2 py-4 bg-violet-50 border-2 border-violet-200 rounded-xl cursor-pointer hover:bg-violet-100 hover:border-violet-400 transition active:scale-[0.97]">
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                        <svg className="w-6 h-6 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-xs font-semibold text-violet-600">Take Photo</span>
                      </label>
                      {/* Gallery — opens file picker */}
                      <label className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 border-2 border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 hover:border-gray-300 transition active:scale-[0.97]">
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs font-semibold text-gray-500">From Gallery</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Products received */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-gray-700 text-sm">Products Received</p>
                  <button
                    onClick={() => setShowAddProduct(true)}
                    className="text-xs font-semibold text-primary hover:text-blue-700 transition"
                  >
                    + New product
                  </button>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search existing products to add..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLineScanner(true)}
                    className="shrink-0 w-10 h-10 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-xl transition"
                    title="Scan product barcode"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 4H4v8M20 4h-4v4m4 4v8h-8M4 20h4v-4M3 3h4M17 3h4M3 21h4M17 21h4" />
                    </svg>
                  </button>
                </div>

                {filteredProducts.length > 0 && (
                  <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                    {filteredProducts.slice(0, 5).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAddProduct(p)}
                        className="w-full text-left px-3 py-2.5 flex justify-between items-center hover:bg-blue-50 transition"
                      >
                        <span className="font-medium text-sm text-gray-800">{p.name}</span>
                        <span className="text-xs text-gray-400 shrink-0 ml-2">Stock: {p.stock}</span>
                      </button>
                    ))}
                  </div>
                )}

                {debouncedSearch.trim() && filteredProducts.length === 0 && (
                  <div className="text-center py-3 space-y-2">
                    <p className="text-sm text-gray-400">No existing products found</p>
                    <button
                      onClick={() => setShowAddProduct(true)}
                      className="text-sm font-semibold text-primary hover:text-blue-700 transition"
                    >
                      + Create "{debouncedSearch.trim()}" as a new product
                    </button>
                  </div>
                )}

                {lineItems.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {lineItems.map((li) => (
                      <div key={li.product_id} className="bg-gray-50 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-800 truncate">{li.product_name}</p>
                            <p className="text-xs text-gray-400">Stock before: {li.current_stock}</p>
                          </div>
                          <button
                            onClick={() => handleRemoveLine(li.product_id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition shrink-0"
                          >
                            ×
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Qty received</label>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleQtyStep(li.product_id, -1)}
                                className="w-7 h-7 bg-white border border-gray-200 rounded-lg text-gray-600 font-bold flex items-center justify-center hover:bg-gray-100"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                value={li.qty_added}
                                onChange={(e) => handleQtyChange(li.product_id, e.target.value)}
                                onBlur={() => handleQtyBlur(li.product_id)}
                                className="flex-1 min-w-0 text-center text-sm font-bold border border-gray-200 rounded-lg py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                              <button
                                onClick={() => handleQtyStep(li.product_id, 1)}
                                className="w-7 h-7 bg-white border border-gray-200 rounded-lg text-gray-600 font-bold flex items-center justify-center hover:bg-gray-100"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">
                              Unit cost {li.unit_cost && `(${formatPrice(parseFloat(li.unit_cost) || 0)})`}
                            </label>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              value={li.unit_cost}
                              onChange={(e) => handleCostChange(li.product_id, e.target.value)}
                              placeholder="0.00"
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                        </div>

                        {li.unit_cost && parseFloat(li.unit_cost) > 0 && (
                          <p className="text-xs text-gray-500 text-right">
                            Line total: <span className="font-semibold text-gray-700">
                              {formatPrice(li.qty_added * parseFloat(li.unit_cost))}
                            </span>
                          </p>
                        )}

                        {/* Expiry date + condition */}
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Expiry date</label>
                            <input
                              type="date"
                              value={li.expiry_date || ""}
                              onChange={(e) => handleExpiryChange(li.product_id, e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Condition</label>
                            <div className="flex gap-1">
                              {[
                                { id: "good",         label: "✓",  title: "Good" },
                                { id: "short_expiry", label: "⏳", title: "Short expiry" },
                                { id: "damaged",      label: "⚠️", title: "Damaged" },
                              ].map(({ id, label, title }) => (
                                <button
                                  key={id}
                                  type="button"
                                  title={title}
                                  onClick={() => handleConditionChange(li.product_id, id)}
                                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition ${
                                    li.condition === id
                                      ? id === "good"
                                        ? "bg-green-100 border-green-400 text-green-700"
                                        : id === "short_expiry"
                                        ? "bg-amber-100 border-amber-400 text-amber-700"
                                        : "bg-red-100 border-red-400 text-red-700"
                                      : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {lineItems.some((li) => parseFloat(li.unit_cost) > 0) && (
                      <div className="flex justify-between items-center px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
                        <span className="text-sm font-semibold text-gray-700">Invoice Total</span>
                        <span className="text-sm font-bold text-primary">
                          {formatPrice(
                            lineItems.reduce((sum, li) => sum + li.qty_added * (parseFloat(li.unit_cost) || 0), 0)
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {lineItems.length === 0 && !search.trim() && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    Search for a product, or scan its barcode, to add it to this delivery
                  </p>
                )}
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || lineItems.length === 0 || !supplier.trim()}
                className={`w-full py-4 rounded-xl font-bold text-base transition ${
                  submitting || lineItems.length === 0 || !supplier.trim()
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-primary text-white hover:bg-blue-600 active:scale-95"
                }`}
              >
                {submitting ? "Saving…" : "Submit for Pricing Review"}
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 py-16">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-3xl text-blue-600">
                ✓
              </div>
              <h3 className="font-bold text-xl text-white">Submitted!</h3>
              <p className="text-gray-400 text-sm text-center px-6">
                {lineItems.length} product{lineItems.length !== 1 ? "s" : ""} from{" "}
                <span className="font-semibold text-gray-300">{supplier}</span> are pending manager pricing.
                Stock will be added once a manager reviews and activates.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-8 py-3 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 active:scale-95 transition"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      {showLineScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleLineScan} onClose={() => setShowLineScanner(false)} />
        </Suspense>
      )}
    </>
  );
}
