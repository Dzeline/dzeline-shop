import { useState, useEffect, useMemo } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";
import { useDebounce } from "../utils/useDebounce";

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
        p.barcode.includes(debouncedSearch.trim()) ||
        p.tags.some((t) => t.includes(q))
    );
  }, [products, debouncedSearch]);

  function handlePhotoCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoBlob(ev.target.result);
    reader.readAsDataURL(file);
  }

  function handleAddProduct(product) {
    if (lineItems.find((li) => li.product_id === product.id)) {
      showToast(`${product.name} already added`);
      return;
    }
    setLineItems((prev) => [
      ...prev,
      { product_id: product.id, product_name: product.name, qty_added: 1, current_stock: product.stock },
    ]);
    setSearch("");
  }

  function handleQtyChange(product_id, value) {
    const qty = Math.max(1, parseInt(value) || 1);
    setLineItems((prev) =>
      prev.map((li) => li.product_id === product_id ? { ...li, qty_added: qty } : li)
    );
  }

  function handleRemoveLine(product_id) {
    setLineItems((prev) => prev.filter((li) => li.product_id !== product_id));
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
        items: lineItems.map(({ product_id, qty_added }) => ({ product_id, qty_added })),
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

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
        >
          ‹
        </button>
        <div>
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

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Invoice Photo (optional)</label>
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
                  <label className="block w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-center cursor-pointer hover:border-primary hover:bg-blue-50 transition">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoCapture}
                    />
                    <svg className="w-6 h-6 text-gray-300 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm text-gray-400">Tap to capture invoice photo</span>
                  </label>
                )}
              </div>
            </div>

            {/* Products received */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <p className="font-bold text-gray-700 text-sm">Products Received</p>

              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search products to add..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Search results */}
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
                <p className="text-sm text-gray-400 text-center py-2">No products found</p>
              )}

              {/* Line items */}
              {lineItems.length > 0 && (
                <div className="space-y-2 pt-1">
                  {lineItems.map((li) => (
                    <div key={li.product_id} className="flex items-center gap-2 bg-gray-50 rounded-xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-800 truncate">{li.product_name}</p>
                        <p className="text-xs text-gray-400">Current stock: {li.current_stock}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
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
                          className="w-12 text-center text-sm font-bold border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <button
                          onClick={() => handleQtyChange(li.product_id, li.qty_added + 1)}
                          className="w-7 h-7 bg-white border border-gray-200 rounded-lg text-gray-600 font-bold flex items-center justify-center hover:bg-gray-100"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => handleRemoveLine(li.product_id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {lineItems.length === 0 && !search.trim() && (
                <p className="text-sm text-gray-400 text-center py-4">
                  Search and add products received from supplier
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
          /* Success state */
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
  );
}
