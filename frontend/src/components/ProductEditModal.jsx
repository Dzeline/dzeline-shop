import { useState } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";
import BarcodeScanner from "./BarcodeScanner";
import { CATEGORIES } from "./ProductAddModal";

const LABEL = "text-sm font-semibold text-gray-700 mb-1.5 block";
const INPUT = "w-full px-3 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary";

export default function ProductEditModal({ product, onSave, onClose }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [costPrice, setCostPrice] = useState(product.cost_price ? String(product.cost_price) : "");
  const [reorderLevel, setReorderLevel] = useState(String(product.reorder_level ?? 10));
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [category, setCategory] = useState(product.category ?? "Other");
  const [imageBlob, setImageBlob] = useState(null);
  const [imagePreview, setImagePreview] = useState(product.image_blob ?? null);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  function handlePhotoCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (ev) => setImageBlob(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!name.trim()) { showToast("Name required"); return; }
    const parsedPrice = parseFloat(price);
    if (!parsedPrice || parsedPrice <= 0) { showToast("Enter a valid price"); return; }
    setSaving(true);
    try {
      const updates = {
        name: name.trim(),
        price: parsedPrice,
        cost_price: parseFloat(costPrice) || null,
        reorder_level: Math.max(1, parseInt(reorderLevel) || 10),
        category,
        barcode: barcode.trim() || product.barcode,
      };
      if (imageBlob) updates.image_blob = imageBlob;
      await dbHelpers.updateProduct(product.id, updates);
      showToast("Product updated");
      onSave({ ...product, ...updates });
    } catch (err) {
      console.error(err);
      showToast("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  }

  if (showScanner) {
    return (
      <BarcodeScanner
        onScan={(code) => { setBarcode(code); setShowScanner(false); }}
        onClose={() => setShowScanner(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-800">Edit Product</h2>
            <p className="text-xs text-gray-400">{product.category}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Product image */}
          <div>
            <label className={LABEL}>Product Photo</label>
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt={name}
                  className="w-full h-40 object-cover rounded-xl border border-gray-200"
                />
                <button
                  onClick={() => { setImageBlob(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col items-center justify-center gap-2 py-5 bg-blue-50 border-2 border-blue-200 rounded-xl cursor-pointer hover:bg-blue-100 hover:border-primary transition active:scale-[0.97] active:bg-blue-200">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-xs font-semibold text-primary">Take Photo</span>
                </label>
                <label className="flex flex-col items-center justify-center gap-2 py-5 bg-gray-50 border-2 border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 hover:border-gray-300 transition active:scale-[0.97]">
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-500">Gallery</span>
                </label>
              </div>
            )}
          </div>

          {/* Name */}
          <div>
            <label className={LABEL}>Product Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </div>

          {/* Category */}
          <div>
            <label className={LABEL}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${INPUT} bg-white`}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Selling Price + Cost Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>
                Selling Price ({formatPrice(parseFloat(price) || 0)})
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>
                Cost Price {costPrice ? `(${formatPrice(parseFloat(costPrice) || 0)})` : "(optional)"}
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0.00"
                className={INPUT}
              />
            </div>
          </div>

          {/* Reorder level */}
          <div>
            <label className={LABEL}>Reorder at (units)</label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
              className={INPUT}
            />
          </div>

          {/* Barcode with scan button */}
          <div>
            <label className={LABEL}>Barcode</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Leave blank to keep current"
                className={`${INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="shrink-0 w-12 h-12 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-xl transition"
                title="Scan barcode"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 4H4v8M20 4h-4v4m4 4v8h-8M4 20h4v-4M3 3h4M17 3h4M3 21h4M17 21h4" />
                </svg>
              </button>
            </div>
            {barcode && (
              <p className="text-xs text-green-600 font-semibold mt-1">Barcode: {barcode}</p>
            )}
          </div>

          {/* Current stock — read only */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex justify-between text-sm">
            <span className="text-gray-500">Current stock</span>
            <span className={`font-bold ${product.stock === 0 ? "text-red-500" : product.stock <= (product.reorder_level ?? 10) ? "text-orange-500" : "text-gray-800"}`}>
              {product.stock} units
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 space-y-2 shrink-0 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-3.5 rounded-xl font-bold text-base transition ${
              saving ? "bg-gray-200 text-gray-400" : "bg-primary text-white hover:bg-blue-600 active:scale-95"
            }`}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-semibold text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
