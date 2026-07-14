import { useState, useEffect } from "react";
import { dbHelpers } from "../services/db";
import { syncService } from "../services/sync";
import { etimsService } from "../services/etims";
import { useSettingsStore } from "../store/settingsStore";
import { showToast } from "../utils/toast";
import { setApiKey } from "../utils/apiHeaders";
import { thermalPrinter } from "../services/thermalPrinter";

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
          className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-6" : ""
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
  const [mpesaType, setMpesaType] = useState("till");   // "till" | "paybill" | "none"
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

  // Printer
  const [printerName, setPrinterName] = useState(() => thermalPrinter.savedDeviceName);
  const [printerConnecting, setPrinterConnecting] = useState(false);
  const [printerErr, setPrinterErr] = useState("");

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
      setMpesaType(s.mpesa_till_type || (s.mpesa_till ? "till" : "none"));
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
        mpesa_till: mpesaType !== "none" ? mpesaTill.trim() : "",
        mpesa_till_type: mpesaType,
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
      syncService.pushSettings().catch(() => {});
    } catch (err) {
      console.error("Save settings failed:", err);
      showToast("Failed to save — try again");
    } finally {
      setSaving(false);
    }
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
            <Field label="M-Pesa Payment Type">
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[
                  { value: "till",    label: "Till",    sub: "Buy Goods" },
                  { value: "paybill", label: "Paybill", sub: "Pay Bill" },
                  { value: "none",    label: "None",    sub: "Not using" },
                ].map((t) => (
                  <button key={t.value} type="button"
                    onClick={() => { setMpesaType(t.value); mark(); }}
                    className={`py-2 px-2 rounded-xl border-2 text-center transition ${
                      mpesaType === t.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-gray-100 bg-gray-50 text-gray-600"
                    }`}>
                    <p className="text-xs font-bold">{t.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t.sub}</p>
                  </button>
                ))}
              </div>
            </Field>
            {mpesaType !== "none" && (
              <Field label={mpesaType === "till" ? "Till Number (Buy Goods)" : "Paybill Number"}>
                <input
                  type="tel"
                  value={mpesaTill}
                  onChange={(e) => { setMpesaTill(e.target.value); mark(); }}
                  placeholder={mpesaType === "till" ? "e.g. 5012345" : "e.g. 400200"}
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {mpesaType === "till"
                    ? "Lipa na M-Pesa till number — printed on your M-Pesa agent certificate"
                    : "Pay Bill business number — customers enter your account number separately"}
                </p>
              </Field>
            )}
            <Field label="Pochi la Biashara Number">
              <input
                type="tel"
                value={pochiNumber}
                onChange={(e) => { setPochiNumber(e.target.value); mark(); }}
                placeholder="e.g. 0712345678"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1">Safaricom number registered for Pochi la Biashara — customers pay directly to this number</p>
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

          {/* Printer */}
          <SectionCard title="Receipt Printer">
            {printerErr && (
              <p className="text-xs text-red-500 font-medium">{printerErr}</p>
            )}
            {printerName ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <p className="text-sm font-bold text-gray-800 truncate">{printerName}</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 pl-4">
                    {thermalPrinter.isConnected ? "Connected" : "Paired — tap Print on any receipt to reconnect"}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await thermalPrinter.disconnect();
                    setPrinterName(null);
                    setPrinterErr("");
                  }}
                  className="shrink-0 px-3 py-1.5 text-xs font-bold text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {thermalPrinter.isBluetoothAvailable ? (
                  <>
                    <p className="text-xs text-gray-500">
                      Pair a Bluetooth ESC/POS thermal printer (58mm or 80mm roll).
                    </p>
                    <button
                      onClick={async () => {
                        setPrinterErr("");
                        setPrinterConnecting(true);
                        try {
                          const name = await thermalPrinter.connect();
                          setPrinterName(name);
                          showToast(`${name} connected`);
                        } catch (e) {
                          setPrinterErr(e.message ?? "Could not connect printer");
                        } finally {
                          setPrinterConnecting(false);
                        }
                      }}
                      disabled={printerConnecting}
                      className="w-full py-3 rounded-xl font-bold text-sm bg-primary text-white hover:bg-blue-600 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {printerConnecting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Searching…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                          </svg>
                          Connect Bluetooth Printer
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-3 font-medium">
                    Web Bluetooth isn't available in this browser. Use Chrome on Android, or use the
                    <strong> Print</strong> button on any receipt to print via USB.
                  </p>
                )}
              </div>
            )}
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
            <Field label="VSCU Device Serial Number">
              <input
                type="text"
                value={etimsDvcSrlNo}
                onChange={(e) => setEtimsDvcSrlNo(e.target.value.toUpperCase())}
                placeholder="e.g. VSCUP051234X0001"
                className={`${inputCls} font-mono uppercase`}
              />
              <p className="text-xs text-gray-400 mt-1">
                Issued by KRA when your VSCU device is provisioned — found on the device sticker or your KRA provisioning letter. Do not invent this number.
              </p>
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

          {/* Support */}
          <SectionCard title="Support">
            <p className="text-xs text-gray-500 leading-relaxed">
              Need help with setup or have a question? Reach the Dzeline team directly.
            </p>
            <a
              href="https://wa.me/254708174289?text=Hi%2C%20I%20need%20help%20with%20Dzeline%20Shop"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl bg-green-50 border border-green-200 text-green-700 font-semibold text-sm hover:bg-green-100 transition"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.124 1.532 5.857L0 24l6.335-1.611A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.032-1.386l-.36-.214-3.733.95.988-3.61-.236-.371A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
              </svg>
              Chat on WhatsApp
            </a>
            <a
              href="mailto:kipchirchirdeline@gmail.com?subject=Dzeline%20Shop%20Support"
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-100 transition"
            >
              <svg className="w-5 h-5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              kipchirchirdeline@gmail.com
            </a>
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
