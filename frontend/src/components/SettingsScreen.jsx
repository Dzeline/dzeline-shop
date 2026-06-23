import { useState, useEffect } from "react";
import { dbHelpers } from "../services/db";
import { etimsService } from "../services/etims";
import { useSettingsStore } from "../store/settingsStore";
import { showToast } from "../utils/toast";
import { setApiKey } from "../utils/apiHeaders";

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
        className={`relative w-12 h-6 rounded-full transition-all duration-200 shrink-0 ml-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ring-1 ${
          checked
            ? "bg-primary ring-primary/60 shadow-[0_0_0_0px_transparent]"
            : "bg-gray-200 ring-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
            checked ? "translate-x-6 shadow-md" : "translate-x-0.5 shadow"
          }`}
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
  const [apiKey, setApiKeyInput] = useState("");

  // eTIMS
  const [etimsTin, setEtimsTin] = useState("");
  const [etimsBhfId, setEtimsBhfId] = useState("00");
  const [etimsDvcSrlNo, setEtimsDvcSrlNo] = useState("");
  const [etimsInitialized, setEtimsInitialized] = useState(false);
  const [etimsBranches, setEtimsBranches] = useState([]);
  const [etimsSaving, setEtimsSaving] = useState(false);
  const [etimsIniting, setEtimsIniting] = useState(false);
  const [etimsConfigSaved, setEtimsConfigSaved] = useState(false);
  const [etimsInitResult, setEtimsInitResult] = useState(null);

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
      const pin = registered ? s.kra_pin : "";
      setKraPin(pin);
      setVatEnabled(s.vat_enabled !== "false");
      setVatRate(s.vat_rate ? String(Math.round(parseFloat(s.vat_rate) * 100)) : "16");
      setMpesaTill(s.mpesa_till || "");
      setPochiNumber(s.pochi_number || "");

      dbHelpers.getApiKey().then((k) => { if (k) setApiKeyInput(k); });

      // Pre-fill eTIMS TIN from KRA PIN
      if (registered && pin) setEtimsTin(pin);

      setLoading(false);
    });

    // Load eTIMS config from backend (non-fatal if offline)
    etimsService.loadConfig().then((cfg) => {
      if (cfg.tin) setEtimsTin(cfg.tin);
      if (cfg.bhf_id) setEtimsBhfId(cfg.bhf_id);
      if (cfg.dvc_srl_no) setEtimsDvcSrlNo(cfg.dvc_srl_no);
      setEtimsInitialized(!!cfg.initialized);
      setEtimsConfigSaved(!!cfg.tin);
    }).catch(() => {
      // Backend offline — show gracefully below
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
      if (apiKey.trim()) {
        await dbHelpers.saveApiKey(apiKey.trim());
        setApiKey(apiKey.trim());
      }
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

  function autoSerial(tin) {
    return "VSCU" + tin.replace(/[^A-Z0-9]/g, "").slice(0, 8).padEnd(8, "0");
  }

  async function handleEtimsSave() {
    if (!etimsTin.trim()) { showToast("TIN is required"); return; }
    setEtimsSaving(true);
    try {
      await etimsService.saveConfig({
        tin: etimsTin.trim(),
        bhf_id: etimsBhfId.trim() || "00",
        dvc_srl_no: etimsDvcSrlNo.trim(),
      });
      setEtimsConfigSaved(true);
      setEtimsInitialized(false);
      setEtimsInitResult(null);
      showToast("eTIMS config saved");
    } catch (err) {
      showToast(err.message || "Failed to save eTIMS config");
    } finally {
      setEtimsSaving(false);
    }
  }

  async function handleEtimsInit() {
    setEtimsIniting(true);
    setEtimsInitResult(null);
    try {
      const res = await etimsService.initDevice();
      setEtimsInitialized(true);
      setEtimsInitResult({ success: true, message: "Device initialized successfully" });
      showToast("Device initialized with KRA");
      // Refresh config to get updated initialized_at
      etimsService.loadConfig().then((cfg) => {
        setEtimsInitialized(!!cfg.initialized);
      }).catch(() => {});
    } catch (err) {
      setEtimsInitResult({ success: false, message: err.message || "Initialization failed" });
    } finally {
      setEtimsIniting(false);
    }
  }

  async function handleQueryBranches() {
    if (!etimsTin.trim()) { showToast("Enter a TIN first"); return; }
    try {
      const res = await etimsService.getBranches(etimsTin.trim(), "00");
      setEtimsBranches(res.branches || []);
      if ((res.branches || []).length === 0) showToast("No branches found");
    } catch (err) {
      showToast(err.message || "Branch query failed");
    }
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
        <h2 className="font-bold text-white text-base flex-1">Shop Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className={`px-4 py-1.5 rounded-xl text-sm font-bold btn-press ${
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
            <Field label="Cloud Sync API Key">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => { setApiKeyInput(e.target.value.trim()); mark(); }}
                placeholder="dzl_live_… (provided by Dzeline)"
                className={`${inputCls} font-mono text-xs`}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
              />
              <p className="text-xs text-gray-400 mt-1">
                Required for cloud sync, STK Push and eTIMS. Leave blank for offline-only mode.
              </p>
            </Field>
          </SectionCard>

          {/* KRA eTIMS */}
          <SectionCard title="KRA eTIMS">
            {/* Status banner */}
            {etimsInitialized && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs font-bold text-green-700">Device Active</span>
              </div>
            )}

            {/* TIN */}
            <Field label="TIN (KRA PIN)">
              <input
                type="text"
                value={etimsTin}
                onChange={(e) => setEtimsTin(e.target.value.toUpperCase())}
                placeholder="e.g. P051234567X"
                className={`${inputCls} font-mono uppercase`}
                maxLength={11}
              />
            </Field>

            {/* Branch ID + Query */}
            <Field label="Branch ID">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={etimsBhfId}
                  onChange={(e) => setEtimsBhfId(e.target.value)}
                  placeholder="00"
                  maxLength={2}
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  onClick={handleQueryBranches}
                  className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200 transition shrink-0"
                >
                  Query KRA
                </button>
              </div>
            </Field>

            {/* Branch list */}
            {etimsBranches.length > 0 && (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                {etimsBranches.map((b) => (
                  <button
                    key={b.bhfId}
                    type="button"
                    onClick={() => setEtimsBhfId(b.bhfId)}
                    className={`w-full text-left px-3 py-2 text-xs transition hover:bg-gray-50 ${
                      etimsBhfId === b.bhfId ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-700"
                    }`}
                  >
                    <span className="font-mono font-bold">{b.bhfId}</span>
                    {b.bhfNm && <span className="ml-2 text-gray-500">{b.bhfNm}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Device Serial */}
            <Field label="Device Serial Number">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={etimsDvcSrlNo}
                  onChange={(e) => setEtimsDvcSrlNo(e.target.value)}
                  placeholder="e.g. VSCUP051234X0"
                  className={`${inputCls} flex-1 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setEtimsDvcSrlNo(autoSerial(etimsTin))}
                  className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200 transition shrink-0"
                >
                  Auto
                </button>
              </div>
            </Field>

            {/* Save config button */}
            <button
              type="button"
              onClick={handleEtimsSave}
              disabled={etimsSaving}
              className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-blue-600 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {etimsSaving ? "Saving…" : "Save eTIMS Config"}
            </button>

            {/* Init device — only shown once config is saved */}
            {etimsConfigSaved && (
              <>
                <div className="border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={handleEtimsInit}
                    disabled={etimsIniting}
                    className="w-full py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {etimsIniting ? "Initializing…" : "Initialize Device with KRA"}
                  </button>

                  {etimsInitResult && (
                    <p className={`mt-2 text-xs font-semibold text-center ${etimsInitResult.success ? "text-green-600" : "text-red-500"}`}>
                      {etimsInitResult.success ? "Device initialized ✓" : etimsInitResult.message}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-gray-400 text-center leading-relaxed">
                    Requires prior eTIMS approval through KRA&apos;s iTax portal.<br />
                    For sandbox testing, use any TIN format.
                  </p>
                </div>
              </>
            )}
          </SectionCard>

          {/* Save button — also at bottom for long-scroll convenience */}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`w-full py-3.5 rounded-xl font-bold text-sm btn-press ${
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
