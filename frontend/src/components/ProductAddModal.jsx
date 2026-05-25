import { useState } from "react";
import { db } from "../services/db";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";

const CATEGORIES = [
  "Grains", "Sugar", "Dairy", "Oils", "Bakery",
  "Beverages", "Spices", "Household", "Produce", "Other",
];

export default function ProductAddModal({ onSave, onClose }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Grains");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [barcode, setBarcode] = useState("");
  const [reorderLevel, setReorderLevel] = useState("10");
  const [imageBlob, setImageBlob] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);

  function handlePhotoCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (ev) => setImageBlob(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!name.trim()) { showToast("Product name required"); return; }
    const parsedPrice = parseFloat(price);
    if (!parsedPrice || parsedPrice <= 0) { showToast("Enter a valid price"); return; }
    setSaving(true);
    try {
      const newProduct = {
        name: name.trim(),
        category,
        price: parsedPrice,
        stock: Math.max(0, parseInt(stock) || 0),
        barcode: barcode.trim() || String(Date.now()),
        reorder_level: Math.max(1, parseInt(reorderLevel) || 10),
        tags: [category.toLowerCase()],
        ...(imageBlob && { image_blob: imageBlob }),
      };
      const id = await db.products.add(newProduct);
      showToast(`${newProduct.name} added`);
      onSave({ id, ...newProduct });
    } catch (err) {
      console.error(err);
      showToast("Failed to add product — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-800">Add New Product</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Photo */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">Product Photo</label>
            {imagePreview ? (
              <div className="relative">
                <img src={imagePreview} alt={name} className="w-full h-40 object-cover rounded-xl border border-gray-200" />
                <button
                  onClick={() => { setImageBlob(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="block w-full py-5 border-2 border-dashed border-gray-200 rounded-xl text-center cursor-pointer hover:border-primary hover:bg-blue-50 transition">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                <svg className="w-7 h-7 text-gray-300 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm text-gray-400">Tap to add photo (optional)</span>
              </label>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">Product Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Unga 2kg"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Price + Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">
                Price {price && `(${formatPrice(parseFloat(price) || 0)})`}
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">Opening Stock</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Barcode + Reorder */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">Barcode (optional)</label>
              <input
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="e.g. 2011"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">Reorder at (units)</label>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 space-y-2 shrink-0 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-3.5 rounded-xl font-bold text-base transition ${
              saving ? "bg-gray-200 text-gray-400" : "bg-primary text-white hover:bg-blue-600 active:scale-95"
            }`}
          >
            {saving ? "Adding..." : "Add Product"}
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
