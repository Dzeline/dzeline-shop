import { useState, useEffect } from "react";
import { dbHelpers } from "../services/db";
import { useSettingsStore } from "../store/settingsStore";
import { showToast } from "../utils/toast";

function SectionCard({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-4 pt-4 pb-2">
        {title}
      </p>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${checked ? "bg-primary" : "bg-gray-300"}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium";

export default function SettingsScreen({ onClose }) {
  const reload = useSettingsStore((s) => s.reload);

  // Shop
  const [shopName, setShopName] = useState("");
  const [town, setTown] = useState("");
  const [phone, setPhone] = useState("");

  // Tax
  const [kraRegistered, setKraRegistered] = useState(false);
  const [kraPin, setKraPin] = useState("");
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState("16");

  // Payments
  const [mpesaTill, setMpesaTill] = useState("");
  const [pochiNumber, setPochiNumber] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    dbHelpers.getShopSettings().then((s) => {
      setShopName(s.shop_name || "");
      setTown(s.town || "");
      setPhone(s.phone || "");
      const registered = !!s.kra_pin && s.kra_pin !== "NOT_REGISTERED";
      setKraRegistered(registered);
      setKraPin(registered ? s.kra_pin : "");
      setVatEnabled(s.vat_enabled !== "false");
      setVatRate(s.vat_rate ? String(Math.round(parseFloat(s.vat_rate) * 100)) : "16");
      setMpesaTill(s.mpesa_till || "");
      setPochiNumber(s.pochi_number || "");
      setLoading(false);
    });
  }, []);

  function mark() { setDirty(true); }

  async function handleSave() {
    if (!shopName.trim()) { showToast("Shop name is required"); return; }
    if (kraRegistered && !kraPin.trim()) { showToast("Enter your KRA PIN or disable KRA registered"); return; }
    setSaving(true);
    try {
      await dbHelpers.saveShopSettings({
        shop_name: shopName.trim(),
        town: town.trim(),
        phone: phone.trim(),
        kra_pin: kraRegistered ? kraPin.trim() : "NOT_REGISTERED",
        vat_enabled: String(vatEnabled),
        vat_rate: String(parseFloat(vatRate) / 100 || 0.16),
        mpesa_till: mpesaTill.trim(),
        pochi_number: pochiNumber.trim(),
        currency: "KES",
      });
      await reload();
      setDirty(false);
      showToast("Settings saved");
    } catch (err) {
      console.error("Save settings failed:", err);
      showToast("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-bold text-white text-base flex-1">Shop Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className={`px-4 py-1.5 rounded-xl text-sm font-bold transition active:scale-95 ${
            dirty && !saving
              ? "bg-primary text-white hover:bg-blue-600"
              : "bg-gray-100 text-gray-400 cursor-default"
          }`}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-10">
          {/* Shop Details */}
          <SectionCard title="Shop Details">
            <Field label="Shop Name">
              <input
                type="text"
                value={shopName}
                onChange={(e) => { setShopName(e.target.value); mark(); }}
                placeholder="e.g. Wanjiku Supermarket"
                className={inputCls}
              />
            </Field>
            <Field label="Town / City">
              <input
                type="text"
                value={town}
                onChange={(e) => { setTown(e.target.value); mark(); }}
                placeholder="e.g. Nairobi"
                className={inputCls}
              />
            </Field>
            <Field label="Phone Number">
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); mark(); }}
                placeholder="e.g. 0712345678"
                className={inputCls}
              />
            </Field>
          </SectionCard>

          {/* Tax */}
          <SectionCard title="Tax">
            <Toggle
              checked={kraRegistered}
              onChange={(v) => { setKraRegistered(v); if (!v) setKraPin(""); mark(); }}
              label="KRA Registered"
              description="PIN-holder for iTax filing"
            />
            {kraRegistered && (
              <Field label="KRA PIN">
                <input
                  type="text"
                  value={kraPin}
                  onChange={(e) => { setKraPin(e.target.value.toUpperCase()); mark(); }}
                  placeholder="e.g. P051234567X"
                  className={`${inputCls} font-mono uppercase`}
                  maxLength={11}
                />
              </Field>
            )}
            <Toggle
              checked={vatEnabled}
              onChange={(v) => { setVatEnabled(v); mark(); }}
              label="Charge VAT"
              description="Add VAT to all sales"
            />
            {vatEnabled && (
              <Field label="VAT Rate (%)">
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => { setVatRate(e.target.value); mark(); }}
                  min={0}
                  max={100}
                  step={0.5}
                  className={inputCls}
                />
              </Field>
            )}
          </SectionCard>

          {/* Payments */}
          <SectionCard title="Payments">
            <Field label="M-Pesa Till / Paybill Number">
              <input
                type="tel"
                value={mpesaTill}
                onChange={(e) => { setMpesaTill(e.target.value); mark(); }}
                placeholder="e.g. 5012345"
                className={inputCls}
              />
            </Field>
            <Field label="Pochi la Biashara Number">
              <input
                type="tel"
                value={pochiNumber}
                onChange={(e) => { setPochiNumber(e.target.value); mark(); }}
                placeholder="e.g. 0712345678"
                className={inputCls}
              />
            </Field>
          </SectionCard>

          {/* Save button — also at bottom for long-scroll convenience */}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition active:scale-95 ${
              dirty && !saving
                ? "bg-primary text-white hover:bg-blue-600"
                : "bg-gray-200 text-gray-400 cursor-default"
            }`}
          >
            {saving ? "Saving…" : dirty ? "Save Changes" : "No changes"}
          </button>
        </div>
      )}
    </div>
  );
}
