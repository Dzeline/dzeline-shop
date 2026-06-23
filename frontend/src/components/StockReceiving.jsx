import { useState, useEffect, useMemo, useRef } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import { useDebounce } from "../utils/useDebounce";
import { apiHeaders } from "../utils/apiHeaders";
import { useOnline } from "../utils/useOnline";
import ProductAddModal from "./ProductAddModal";

// ── Product matching ─────────────────────────────────────────────────────────

function matchProductName(scannedName, products) {
  const q = scannedName.toLowerCase();
  const exact = products.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact;
  const contains = products.find(
    (p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())
  );
  if (contains) return contains;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  return products.find((p) =>
    words.length > 0 && words.every((w) => p.name.toLowerCase().includes(w))
  ) ?? null;
}

// ── Scan results overlay ─────────────────────────────────────────────────────

function ScanOverlay({ results, onApply, onDismiss }) {
  const matched = results.items.filter((i) => i.product !== null);
  const unmatched = results.items.filter((i) => i.product === null);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onDismiss}
      />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up sm:animate-drop-in max-h-[85dvh] flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800">Invoice Scanned</p>
              {results.supplier && (
                <p className="text-sm text-gray-500 truncate">Supplier: <span className="font-semibold text-gray-700">{results.supplier}</span></p>
              )}
              {results.invoice_number && (
                <p className="text-xs text-gray-400">Invoice: {results.invoice_number}</p>
              )}
            </div>
            <button onClick={onDismiss} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {results.items.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No items could be read — try a clearer, well-lit photo</p>
          )}
          {matched.map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{item.product.name}</p>
                <p className="text-xs text-gray-400 truncate">"{item.name}"</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-gray-700">×{item.qty}</p>
                {item.unit_cost != null && (
                  <p className="text-xs text-gray-400">{formatPrice(item.unit_cost)}</p>
                )}
              </div>
            </div>
          ))}
          {unmatched.map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 opacity-60">
              <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-500 truncate">"{item.name}"</p>
                <p className="text-xs text-orange-400">Not in catalog — will be skipped</p>
              </div>
              <p className="text-xs font-bold text-gray-400 shrink-0">×{item.qty}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <span className="text-green-500 font-semibold">{matched.length} matched</span>
            {unmatched.length > 0 && <><span>·</span><span className="text-orange-400">{unmatched.length} skipped</span></>}
          </div>
          <button
            onClick={onApply}
            disabled={matched.length === 0}
            className={`w-full py-3 rounded-2xl font-bold text-sm transition active:scale-95 ${
              matched.length > 0
                ? "bg-primary text-white hover:bg-blue-600"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Apply {matched.length} matched item{matched.length !== 1 ? "s" : ""} to form
          </button>
          <button onClick={onDismiss} className="w-full py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 transition">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StockReceiving({ currentStaffId, onClose }) {
  const isOnline = useOnline();
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [showScanMenu, setShowScanMenu] = useState(false);

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

  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);

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
    setScanError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoBlob(ev.target.result);
      if (isOnline) handleAnalyze(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  // ── AI scan ──────────────────────────────────────────────────────────────

  async function handleAnalyze(blob) {
    const imageData = blob ?? photoBlob;
    if (!imageData) return;
    setScanning(true);
    setScanError(null);
    setScanResults(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/scan/invoice`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ image_base64: imageData }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Scan failed" }));
        throw new Error(err.detail ?? "Scan failed");
      }
      const data = await res.json();
      const enrichedItems = data.items.map((item) => ({
        ...item,
        product: matchProductName(item.name, products),
      }));
      setScanResults({ ...data, items: enrichedItems });
    } catch (err) {
      setScanError(err.message ?? "Could not analyze invoice");
    } finally {
      setScanning(false);
    }
  }

  // Triggered from header "Scan Invoice" button
  function handleScanButtonClick() {
    if (photoBlob) {
      handleAnalyze(photoBlob);
    } else {
      setShowScanMenu(true);
    }
  }

  function handleScanCapture(e) {
    setShowScanMenu(false);
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setScanError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoBlob(ev.target.result);
      if (isOnline) handleAnalyze(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  // ── Apply scan results ───────────────────────────────────────────────────

  function handleApplyScan() {
    if (!scanResults) return;
    if (!supplier.trim() && scanResults.supplier) {
      setSupplier(scanResults.supplier);
      setSelectedSupplierId(null);
    }
    if (!invoiceNumber.trim() && scanResults.invoice_number) {
      setInvoiceNumber(scanResults.invoice_number);
    }
    const matched = scanResults.items.filter((i) => i.product !== null);
    const newLines = matched
      .filter((item) => !lineItems.find((li) => li.product_id === item.product.id))
      .map((item) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        qty_added: Math.max(1, Math.round(item.qty)),
        unit_cost: item.unit_cost ? String(item.unit_cost) : "",
        current_stock: item.product.stock,
      }));
    if (newLines.length > 0) setLineItems((prev) => [...prev, ...newLines]);
    setScanResults(null);
    showToast(`${newLines.length} item${newLines.length !== 1 ? "s" : ""} added from invoice`);
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
        product_id: product.id,
        product_name: product.name,
        qty_added: 1,
        unit_cost: "",
        current_stock: product.stock,
      },
    ]);
    setSearch("");
  }

  function handleQtyChange(product_id, value) {
    const qty = Math.max(1, parseInt(value) || 1);
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, qty_added: qty } : li)
    );
  }

  function handleCostChange(product_id, value) {
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, unit_cost: value } : li)
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
        supplier: supplier.trim(),
        supplier_id: selectedSupplierId,
        invoice_number: invoiceNumber.trim() || null,
        photo_blob: photoBlob,
        items: lineItems.map(({ product_id, qty_added, unit_cost }) => ({
          product_id,
          qty_added,
          unit_cost: parseFloat(unit_cost) || null,
        })),
        staff_id: currentStaffId,
      });
      setSubmitted(true);
      showToast("Stock received successfully");
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
      />
    );
  }

  return (
    <>
      {/* Hidden file inputs — camera-first and gallery-first for scan flow */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleScanCapture}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleScanCapture}
      />

      {/* Scan source chooser */}
      {showScanMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowScanMenu(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-t-3xl p-5 pb-8 space-y-3 shadow-2xl">
            <p className="text-sm font-bold text-gray-700 text-center mb-4">Add Invoice Photo</p>
            <label
              className="flex items-center gap-4 p-4 bg-violet-50 border-2 border-violet-200 rounded-2xl cursor-pointer hover:bg-violet-100 transition active:scale-[0.98]"
            >
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScanCapture} />
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-sm text-violet-700">Take Photo</p>
                <p className="text-xs text-violet-500">Open camera & scan invoice</p>
              </div>
            </label>
            <label
              className="flex items-center gap-4 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-100 transition active:scale-[0.98]"
            >
              <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleScanCapture} />
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-sm text-gray-700">Choose from Gallery</p>
                <p className="text-xs text-gray-500">Select a saved invoice photo</p>
              </div>
            </label>
            <button onClick={() => setShowScanMenu(false)} className="w-full py-3 text-sm font-semibold text-gray-400 hover:text-gray-600 transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Scan results overlay */}
      {scanResults && (
        <ScanOverlay
          results={scanResults}
          onApply={handleApplyScan}
          onDismiss={() => setScanResults(null)}
        />
      )}

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

          {/* AI Scan button */}
          {isOnline && (
            <button
              onClick={handleScanButtonClick}
              disabled={scanning}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition active:scale-95 shrink-0 ${
                scanning
                  ? "bg-violet-900/50 text-violet-400 cursor-wait"
                  : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/40"
              }`}
              title="Scan invoice with AI"
            >
              {scanning ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Scanning…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Scan Invoice
                </>
              )}
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!submitted ? (
            <>
              {/* Scan error banner */}
              {scanError && (
                <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
                  <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-sm text-orange-700 flex-1">{scanError}</p>
                  <button onClick={() => setScanError(null)} className="text-orange-400 hover:text-orange-600 text-lg leading-none shrink-0">×</button>
                </div>
              )}

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
                        onClick={() => { setPhotoBlob(null); setPhotoPreview(null); setScanError(null); }}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70"
                      >
                        ×
                      </button>
                      {/* Re-analyze button shown on photo */}
                      {isOnline && !scanning && (
                        <button
                          onClick={() => handleAnalyze(photoBlob)}
                          className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-xl shadow-lg hover:bg-violet-500 active:scale-95 transition"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          Re-analyze
                        </button>
                      )}
                      {scanning && (
                        <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center">
                          <div className="bg-white rounded-2xl px-4 py-3 flex items-center gap-2 shadow-lg">
                            <svg className="w-4 h-4 text-violet-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span className="text-sm font-semibold text-gray-700">Reading invoice…</span>
                          </div>
                        </div>
                      )}
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

                <div className="relative">
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
                                onClick={() => handleQtyChange(li.product_id, li.qty_added - 1)}
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
                                className="flex-1 text-center text-sm font-bold border border-gray-200 rounded-lg py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                              <button
                                onClick={() => handleQtyChange(li.product_id, li.qty_added + 1)}
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
                    Search and add products, or use <span className="text-violet-500 font-semibold">Scan Invoice</span> to auto-fill
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
                {submitting ? "Saving..." : "Confirm Stock Receipt"}
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 py-16">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl text-green-600">
                ✓
              </div>
              <h3 className="font-bold text-xl text-gray-800">Stock Updated!</h3>
              <p className="text-gray-400 text-sm text-center px-6">
                {lineItems.length} product{lineItems.length !== 1 ? "s" : ""} from{" "}
                <span className="font-semibold text-gray-600">{supplier}</span> added to inventory.
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
    </>
  );
}
