import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { syncService } from "../services/sync";
import { showToast } from "../utils/toast";
import { formatPrice } from "../utils/formatters";

// ── Add/Edit supplier modal ────────────────────────────────────────────────

function SupplierModal({ supplier, onSave, onClose }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { showToast("Supplier name required"); return; }
    setSaving(true);
    try {
      if (supplier) {
        await dbHelpers.updateSupplier(supplier.id, {
          name: name.trim(), phone: phone.trim() || null,
          email: email.trim() || null, notes: notes.trim() || null,
        });
        onSave({ ...supplier, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null });
      } else {
        const id = await dbHelpers.addSupplier({
          name: name.trim(), phone: phone.trim(), email: email.trim(), notes: notes.trim(),
        });
        onSave({ id, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null });
      }
      syncService.pushUnsyncedSuppliers().catch(() => {});
    } catch {
      showToast("Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800">{supplier ? "Edit Supplier" : "New Supplier"}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">×</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Supplier Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bidco East Africa"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">WhatsApp / Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0722000000"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-gray-400 mt-0.5">Used to send orders via WhatsApp</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="supplier@example.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Delivers on Tuesdays"
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-blue-600 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Order builder modal ────────────────────────────────────────────────────

function OrderModal({ supplier, onClose }) {
  const [products, setProducts] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [tab, setTab] = useState("low"); // "low" | "custom"
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    async function init() {
      const all = await dbHelpers.getAllProducts();
      setProducts(all);
      // Pre-populate with low-stock products
      const low = all.filter((p) => p.stock <= (p.reorder_level ?? 10));
      setOrderItems(
        low.map((p) => ({
          product_id: p.id,
          name: p.name,
          current_stock: p.stock,
          reorder_level: p.reorder_level ?? 10,
          qty: Math.max(1, (p.reorder_level ?? 10) - p.stock + 5),
        }))
      );
    }
    init();
  }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const q = search.toLowerCase();
    setSearchResults(
      products.filter((p) => p.name.toLowerCase().includes(q) || (p.barcode || "").includes(search)).slice(0, 6)
    );
  }, [search, products]);

  function addProduct(p) {
    if (orderItems.find((i) => i.product_id === p.id)) {
      showToast(`${p.name} already in order`);
      return;
    }
    setOrderItems((prev) => [
      ...prev,
      { product_id: p.id, name: p.name, current_stock: p.stock, reorder_level: p.reorder_level ?? 10, qty: 1 },
    ]);
    setSearch("");
  }

  function updateQty(product_id, value) {
    const qty = Math.max(1, parseInt(value) || 1);
    setOrderItems((prev) => prev.map((i) => i.product_id === product_id ? { ...i, qty } : i));
  }

  function removeLine(product_id) {
    setOrderItems((prev) => prev.filter((i) => i.product_id !== product_id));
  }

  function buildOrderText(shopName = "Dzeline Supermarket") {
    const date = new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });
    const lines = orderItems
      .map((i) => `• ${i.name} — Qty: ${i.qty}  (current stock: ${i.current_stock})`)
      .join("\n");
    return `*Purchase Order — ${shopName}*\nDate: ${date}\n\n${lines}\n\nPlease confirm availability and delivery date. Thank you.`;
  }

  function sendWhatsApp() {
    if (orderItems.length === 0) { showToast("Add at least one product"); return; }
    if (!supplier.phone) { showToast("No phone number saved for this supplier"); return; }
    const raw = supplier.phone.replace(/\D/g, "");
    const international = raw.startsWith("0") ? "254" + raw.slice(1) : raw;
    const text = encodeURIComponent(buildOrderText());
    window.open(`https://wa.me/${international}?text=${text}`, "_blank");
  }

  function sendEmail() {
    if (orderItems.length === 0) { showToast("Add at least one product"); return; }
    if (!supplier.email) { showToast("No email saved for this supplier"); return; }
    const subject = encodeURIComponent(`Purchase Order — ${new Date().toLocaleDateString("en-KE")}`);
    const body = encodeURIComponent(buildOrderText());
    window.open(`mailto:${supplier.email}?subject=${subject}&body=${body}`, "_blank");
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-800">Create Order</h3>
            <p className="text-xs text-gray-400 truncate">{supplier.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0">×</button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 pb-2 shrink-0">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setTab("low")}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${tab === "low" ? "bg-white text-primary shadow-sm" : "text-gray-500"}`}
            >
              Low Stock
            </button>
            <button
              onClick={() => setTab("custom")}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${tab === "custom" ? "bg-white text-primary shadow-sm" : "text-gray-500"}`}
            >
              Custom
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
          {/* Custom tab — product search */}
          {tab === "custom" && (
            <div className="space-y-2">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search and add products…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 overflow-hidden">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full text-left px-3 py-2.5 flex justify-between items-center hover:bg-blue-50 transition"
                    >
                      <span className="font-medium text-sm text-gray-800">{p.name}</span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">Stock: {p.stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Low stock info banner */}
          {tab === "low" && orderItems.length === 0 && (
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <p className="font-semibold text-green-700 text-sm">All products well-stocked</p>
              <p className="text-xs text-green-500 mt-1">No reorders needed right now</p>
            </div>
          )}

          {/* Order line items */}
          {orderItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {orderItems.length} product{orderItems.length !== 1 ? "s" : ""}
              </p>
              {orderItems.map((item) => (
                <div key={item.product_id} className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">In stock: {item.current_stock}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => updateQty(item.product_id, item.qty - 1)}
                      className="w-7 h-7 bg-white border border-gray-200 rounded-lg text-gray-600 font-bold flex items-center justify-center hover:bg-gray-100"
                    >−</button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={item.qty}
                      onChange={(e) => updateQty(item.product_id, e.target.value)}
                      className="w-12 text-center text-sm font-bold border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => updateQty(item.product_id, item.qty + 1)}
                      className="w-7 h-7 bg-white border border-gray-200 rounded-lg text-gray-600 font-bold flex items-center justify-center hover:bg-gray-100"
                    >+</button>
                  </div>
                  <button
                    onClick={() => removeLine(item.product_id)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition shrink-0"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Send buttons */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 space-y-2 shrink-0">
          {orderItems.length === 0 && (
            <p className="text-xs text-gray-400 text-center pb-1">Add products to the order before sending</p>
          )}
          <button
            onClick={sendWhatsApp}
            disabled={orderItems.length === 0 || !supplier.phone}
            className="w-full py-3.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-green-500 text-white hover:bg-green-600 active:scale-95"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.116 1.528 5.845L.057 23.885l6.185-1.62A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.893a9.881 9.881 0 01-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374A9.86 9.86 0 012.107 12C2.107 6.588 6.589 2.107 12 2.107S21.893 6.588 21.893 12 17.411 21.893 12 21.893z"/>
            </svg>
            {supplier.phone ? "Send via WhatsApp" : "No phone saved"}
          </button>
          {supplier.email && (
            <button
              onClick={sendEmail}
              disabled={orderItems.length === 0}
              className="w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 disabled:opacity-40 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Send via Email
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Suppliers screen ──────────────────────────────────────────────────

export default function SuppliersScreen({ onClose }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [orderSupplier, setOrderSupplier] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [lowStockCount, setLowStockCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, low] = await Promise.all([
        dbHelpers.getAllSuppliers(),
        dbHelpers.getLowStockProducts(),
      ]);
      setSuppliers(all);
      setLowStockCount(low.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    await dbHelpers.deleteSupplier(id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setConfirmDelete(null);
    showToast("Supplier removed");
    syncService.pushUnsyncedSuppliers().catch(() => {});
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h2 className="font-bold text-white text-base flex-1">Suppliers</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center bg-primary text-white rounded-full hover:bg-blue-600 active:scale-95 transition"
          title="Add supplier"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-10">
          {/* Low stock banner */}
          {lowStockCount > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <svg className="w-5 h-5 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-orange-800 font-medium flex-1">
                <span className="font-bold">{lowStockCount} product{lowStockCount !== 1 ? "s" : ""}</span> need reordering — tap a supplier to create an order
              </p>
            </div>
          )}

          {suppliers.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center shadow-sm mt-4">
              <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <p className="font-bold text-gray-700">No suppliers yet</p>
              <p className="text-sm text-gray-400 mt-1">Add your first supplier to start sending orders</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition"
              >
                Add Supplier
              </button>
            </div>
          ) : (
            suppliers.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3.5">
                  {/* Name + contacts */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-extrabold text-primary">{s.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800">{s.name}</p>
                      {s.phone && (
                        <p className="text-xs text-gray-500 mt-0.5">{s.phone}</p>
                      )}
                      {s.email && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{s.email}</p>
                      )}
                      {s.notes && (
                        <p className="text-xs text-gray-400 mt-1 italic">{s.notes}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setOrderSupplier(s)}
                      className="flex-1 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-blue-600 transition active:scale-95"
                    >
                      Create Order
                    </button>
                    <button
                      onClick={() => setEditingSupplier(s)}
                      className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200 transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(s)}
                      className="px-3 py-2 rounded-xl bg-red-50 text-red-400 text-xs font-semibold hover:bg-red-100 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add modal */}
      {showAddModal && (
        <SupplierModal
          onSave={(saved) => {
            setSuppliers((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
            setShowAddModal(false);
            showToast("Supplier added");
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Edit modal */}
      {editingSupplier && (
        <SupplierModal
          supplier={editingSupplier}
          onSave={(updated) => {
            setSuppliers((prev) => prev.map((s) => s.id === updated.id ? updated : s));
            setEditingSupplier(null);
            showToast("Supplier updated");
          }}
          onClose={() => setEditingSupplier(null)}
        />
      )}

      {/* Order modal */}
      {orderSupplier && (
        <OrderModal
          supplier={orderSupplier}
          onClose={() => setOrderSupplier(null)}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full sm:max-w-sm rounded-2xl shadow-2xl p-5 space-y-4">
            <h3 className="font-bold text-gray-800">Remove Supplier?</h3>
            <p className="text-sm text-gray-600">
              Remove <span className="font-semibold">{confirmDelete.name}</span> from your supplier list? This won't affect any existing stock records.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
