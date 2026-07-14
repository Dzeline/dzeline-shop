import { useState } from "react";
import { dbHelpers } from "../services/db";
import { syncService } from "../services/sync";
import { setApiKey } from "../utils/apiHeaders";
import { showToast } from "../utils/toast";

const SETUP_BG = "linear-gradient(160deg, #111827 0%, #1a2235 60%, #1e2a45 100%)";

const STEPS = [
  {
    label: "Shop",
    title: "Your Shop",
    subtitle: "Basic details about your business",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    label: "Tax",
    title: "Tax & KRA",
    subtitle: "VAT and KRA registration details",
    iconBg: "bg-orange-100",
    iconColor: "text-orange-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    label: "Payments",
    title: "Payment Methods",
    subtitle: "M-Pesa and cloud sync setup",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    label: "Admin",
    title: "Secure Your Account",
    subtitle: "Your admin name and PIN",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    label: "Team",
    title: "Add Your Team",
    subtitle: "Add cashiers and staff now (optional)",
    iconBg: "bg-teal-100",
    iconColor: "text-teal-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→"];

const STAFF_ROLES = [
  { value: "cashier",       label: "Cashier",       sub: "POS + basic reports" },
  { value: "stock_keeper",  label: "Stock Keeper",  sub: "POS + stock receiving" },
  { value: "sales_manager", label: "Sales Manager", sub: "POS + reports + eTIMS" },
  { value: "sub_admin",     label: "Sub-Admin",     sub: "Everything except settings" },
];

function ProgressBar({ step }) {
  return (
    <div className="flex items-center gap-1.5 mb-5">
      {STEPS.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
          <div className={`h-1 w-full rounded-full transition-all duration-400 ${i <= step ? "bg-primary" : "bg-gray-200"}`} />
          <span className={`text-[10px] font-semibold leading-none ${i === step ? "text-primary" : "text-gray-300"}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepHeader({ step }) {
  const s = STEPS[step];
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.iconBg} ${s.iconColor}`}>
        {s.icon}
      </div>
      <div>
        <p className="font-extrabold text-gray-800 text-base leading-tight">{s.title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{s.subtitle}</p>
      </div>
    </div>
  );
}

function PinPad({ pin, onKey }) {
  return (
    <div>
      <div className="flex justify-center gap-3 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
              i < pin.length ? "bg-primary border-primary scale-110" : "bg-transparent border-gray-300"
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PAD.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKey(k)}
            className={`h-12 rounded-xl font-bold text-base transition active:scale-95 ${
              k === "→"
                ? "bg-primary text-white hover:bg-blue-600"
                : k === "⌫"
                ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                : "bg-gray-50 text-gray-800 hover:bg-gray-100 border border-gray-100"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      {pin.length > 0 && (
        <p className="text-center text-xs text-gray-400 mt-2">{pin.length} digit{pin.length !== 1 ? "s" : ""} entered</p>
      )}
    </div>
  );
}

// ── Staff mini-form used inside the Team step ─────────────────────────────────

function AddStaffForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("cashier");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState("enter");
  const [err, setErr] = useState("");

  function handleKey(k) {
    const current = pinStage === "enter" ? pin : pinConfirm;
    const setter  = pinStage === "enter" ? setPin : setPinConfirm;
    setErr("");
    if (k === "⌫") { setter(current.slice(0, -1)); return; }
    if (k === "→") {
      if (!name.trim()) { setErr("Enter a name first"); return; }
      if (current.length < 4) { setErr("PIN must be at least 4 digits"); return; }
      if (pinStage === "enter") { setPinStage("confirm"); return; }
      if (current !== pin) { setErr("PINs don't match"); setPinConfirm(""); return; }
      onAdd({ name: name.trim(), pin, role });
      return;
    }
    if (current.length < 6) setter(current + k);
  }

  const INPUT = "w-full px-3 py-2.5 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium";

  return (
    <div className="border-2 border-primary/20 rounded-2xl p-4 space-y-3 bg-blue-50/30">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Staff name e.g. Mary"
        className={INPUT}
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        {STAFF_ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRole(r.value)}
            className={`text-left px-3 py-2 rounded-xl border-2 transition ${
              role === r.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-gray-100 bg-gray-50 text-gray-600"
            }`}
          >
            <p className="text-xs font-bold leading-tight">{r.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{r.sub}</p>
          </button>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">
          {pinStage === "enter" ? "Create PIN (4–6 digits)" : "Confirm PIN"}
        </p>
        <PinPad pin={pinStage === "enter" ? pin : pinConfirm} onKey={handleKey} />
      </div>
      {err && <p className="text-red-500 text-xs font-medium text-center">{err}</p>}
      <button type="button" onClick={onCancel}
        className="w-full py-2 text-xs font-semibold text-gray-400 hover:text-gray-600">
        Cancel
      </button>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState("right");
  const [saving, setSaving] = useState(false);

  // Step 0 — Shop
  const [shopName, setShopName] = useState("");
  const [town, setTown] = useState("");
  const [phone, setPhone] = useState("");

  // Step 1 — Tax
  const [kraRegistered, setKraRegistered] = useState(false);
  const [kraPin, setKraPin] = useState("");
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState("16");

  // Step 2 — Payments
  const [mpesaType, setMpesaType] = useState("till");   // "till" | "paybill" | "none"
  const [mpesaTill, setMpesaTill] = useState("");
  const [pochiNumber, setPochiNumber] = useState("");
  const [apiKey, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState(null);

  // Step 3 — Admin PIN
  const [adminName, setAdminName] = useState("Admin");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState("enter");
  const [pinError, setPinError] = useState("");

  // Step 4 — Team
  const [staffList, setStaffList] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);

  function goNext() { setDirection("right"); setStep((s) => s + 1); }
  function goBack(target) { setDirection("left"); setStep(target ?? (step - 1)); }

  function handlePinKey(key) {
    const current = pinStage === "enter" ? pin : pinConfirm;
    const setter  = pinStage === "enter" ? setPin : setPinConfirm;
    setPinError("");
    if (key === "⌫") { setter(current.slice(0, -1)); return; }
    if (key === "→") {
      if (current.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
      if (pinStage === "enter") { setPinStage("confirm"); return; }
      if (current !== pin) {
        setPinError("PINs don't match — try again");
        setPinConfirm("");
        return;
      }
      // PIN confirmed — move to Team step
      goNext();
      return;
    }
    if (current.length >= 6) return;
    setter(current + key);
  }

  async function handleVerifyKey() {
    const key = apiKey.trim();
    if (!key) { showToast("Enter an API key first"); return; }
    const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
    if (!base) { showToast("API URL not configured — key will be verified on first sync"); return; }
    setApiKeyStatus("checking");
    try {
      const res = await fetch(`${base}/products/`, {
        headers: { "X-API-Key": key },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        setApiKeyStatus("valid");
      } else if (res.status === 401) {
        setApiKeyStatus("invalid");
        showToast("API key not recognised — check with Dzeline support");
      } else if (res.status === 402) {
        setApiKeyStatus("invalid");
        showToast("Subscription has lapsed — please renew");
      } else {
        setApiKeyStatus(null);
        showToast("Server error — key saved, will verify on next sync");
      }
    } catch {
      setApiKeyStatus(null);
      showToast("Offline — key saved, will verify when connected");
    }
  }

  function nextStep() {
    if (step === 0 && !shopName.trim()) { showToast("Shop name is required"); return; }
    if (step === 1 && kraRegistered) {
      if (!kraPin.trim()) { showToast("Enter your KRA PIN or turn off KRA Registered"); return; }
      if (!/^[A-Z]\d{9}[A-Z]$/i.test(kraPin.trim())) {
        showToast("KRA PIN format: 1 letter + 9 digits + 1 letter (e.g. P051234567X)");
        return;
      }
    }
    goNext();
  }

  function validateKenyanPhone(val) {
    const stripped = val.replace(/[\s\-()]/g, "");
    return /^(07\d{8}|01\d{8}|\+2547\d{8}|\+2541\d{8})$/.test(stripped);
  }

  async function handleFinish() {
    if (pin.length < 4) { showToast("Complete your admin PIN first"); return; }
    setSaving(true);
    try {
      await dbHelpers.saveShopSettings({
        shop_name:      shopName.trim() || "My Shop",
        town:           town.trim(),
        phone:          phone.trim(),
        kra_pin:        kraRegistered ? kraPin.trim() : "NOT_REGISTERED",
        vat_enabled:    String(vatEnabled),
        vat_rate:       String(parseFloat(vatRate) / 100 || 0.16),
        mpesa_till:     mpesaType !== "none" ? mpesaTill.trim() : "",
        mpesa_till_type: mpesaType,
        pochi_number:   pochiNumber.trim(),
        currency:       "KES",
        setup_complete: "true",
      });
      if (apiKey.trim()) {
        await dbHelpers.saveApiKey(apiKey.trim());
        setApiKey(apiKey.trim());
      }
      // Create admin
      await dbHelpers.addStaff(adminName.trim() || "Admin", pin, "admin");
      // Create additional staff
      for (const s of staffList) {
        await dbHelpers.addStaff(s.name, s.pin, s.role);
      }
      // Best-effort — so a second device can join right away instead of
      // waiting for this device's next reconnect cycle. Setup still
      // completes immediately if this fails or there's no connection.
      await Promise.all([
        syncService.pushUnsyncedStaff().catch(() => {}),
        syncService.pushSettings().catch(() => {}),
      ]);
      showToast("Setup complete! Welcome to Dzeline.");
      onComplete();
    } catch (err) {
      console.error("Setup failed:", err);
      showToast("Setup failed — please try again");
    } finally {
      setSaving(false);
    }
  }

  const INPUT = "w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium transition";
  const TOGGLE_LABEL = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5";

  function Toggle({ value, onChange, label, sub }) {
    return (
      <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border-2 border-gray-100">
        <div>
          <p className="font-bold text-sm text-gray-800">{label}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`relative w-11 h-6 rounded-full transition-colors ${value ? "bg-primary" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
    );
  }

  const slideClass = direction === "right" ? "animate-slide-in-right" : "animate-slide-in-left";

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-10 sm:pt-16 px-5 pb-10" style={{ background: SETUP_BG }}>
      {/* Logo */}
      <div className="text-center mb-6 animate-fade-logo">
        <img src="/Dzeline.svg" alt="Dzeline"
          className="w-20 h-20 rounded-2xl mx-auto mb-2.5 object-cover shadow-xl" />
        <h1 className="text-xl font-extrabold text-white tracking-tight">Let&apos;s get started</h1>
        <p className="text-white/45 text-sm mt-0.5">Set up your shop in 5 quick steps</p>
      </div>

      <div className="w-full max-w-sm mb-4">
        <ProgressBar step={step} />
      </div>

      <div key={step} className={`${slideClass} bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6`}>
        <StepHeader step={step} />

        {/* ── Step 0: Shop ── */}
        {step === 0 && (
          <div className="space-y-3.5">
            <div>
              <label className={TOGGLE_LABEL}>Shop Name <span className="text-red-400 normal-case">*</span></label>
              <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. Wanjiku Supermarket" className={INPUT} autoFocus />
            </div>
            <div>
              <label className={TOGGLE_LABEL}>Town / City</label>
              <input type="text" value={town} onChange={(e) => setTown(e.target.value)}
                placeholder="e.g. Nairobi, Kisumu, Mombasa" className={INPUT} />
            </div>
            <div>
              <label className={TOGGLE_LABEL}>Shop Phone Number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX" className={INPUT} />
              <p className="text-xs text-gray-400 mt-1">Shown on customer receipts. Format: 07XXXXXXXX or +254XXXXXXXXX</p>
            </div>
            <button onClick={nextStep}
              className="w-full mt-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 btn-press">
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 1: Tax & KRA ── */}
        {step === 1 && (
          <div className="space-y-3.5">
            <Toggle value={kraRegistered} onChange={setKraRegistered}
              label="KRA Registered" sub="Business has a KRA PIN on iTax" />
            {kraRegistered && (
              <div>
                <label className={TOGGLE_LABEL}>KRA PIN</label>
                <input type="text" value={kraPin} onChange={(e) => setKraPin(e.target.value.toUpperCase())}
                  placeholder="e.g. P051234567X" className={`${INPUT} font-mono uppercase`} maxLength={11} />
                <p className="text-xs text-gray-400 mt-1">11 characters: letter · 9 digits · letter</p>
              </div>
            )}
            <Toggle value={vatEnabled} onChange={setVatEnabled}
              label="Charge VAT" sub="16% VAT applied to all sales" />
            {vatEnabled && (
              <div>
                <label className={TOGGLE_LABEL}>VAT Rate (%)</label>
                <input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                  min={0} max={100} step={0.5} className={INPUT} />
              </div>
            )}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700">
              <p className="font-bold mb-0.5">eTIMS / KRA device?</p>
              <p>You can set up your VSCU device serial and initialize eTIMS from Settings → eTIMS after completing setup. You will need your KRA-issued device serial number.</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => goBack(0)} className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 btn-press">
                ← Back
              </button>
              <button onClick={nextStep} className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 btn-press">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Payments ── */}
        {step === 2 && (
          <div className="space-y-3.5">
            {/* M-Pesa type selector */}
            <div>
              <label className={TOGGLE_LABEL}>M-Pesa Payment Type</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "till",    label: "Till",    sub: "Buy Goods\n4–7 digits" },
                  { value: "paybill", label: "Paybill", sub: "Pay Bill\n6 digits" },
                  { value: "none",    label: "None",    sub: "Not using\nM-Pesa" },
                ].map((t) => (
                  <button key={t.value} type="button" onClick={() => setMpesaType(t.value)}
                    className={`py-2.5 px-2 rounded-xl border-2 text-center transition ${
                      mpesaType === t.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-gray-100 bg-gray-50 text-gray-600"
                    }`}>
                    <p className="text-xs font-bold">{t.label}</p>
                    <p className="text-[10px] text-gray-400 whitespace-pre-line mt-0.5">{t.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {mpesaType !== "none" && (
              <div>
                <label className={TOGGLE_LABEL}>
                  {mpesaType === "till" ? "Till Number (Buy Goods)" : "Paybill Number"}
                </label>
                <input type="tel" value={mpesaTill} onChange={(e) => setMpesaTill(e.target.value)}
                  placeholder={mpesaType === "till" ? "e.g. 5012345" : "e.g. 400200"}
                  className={INPUT} />
                {mpesaType === "till" && (
                  <p className="text-xs text-gray-400 mt-1">This is your Lipa na M-Pesa till number — printed on your M-Pesa agent certificate</p>
                )}
                {mpesaType === "paybill" && (
                  <p className="text-xs text-gray-400 mt-1">This is your Pay Bill business number — customers will enter your account number separately</p>
                )}
              </div>
            )}

            <div>
              <label className={TOGGLE_LABEL}>Pochi la Biashara</label>
              <input type="tel" value={pochiNumber} onChange={(e) => setPochiNumber(e.target.value)}
                placeholder="e.g. 0712 345 678" className={INPUT} />
              <p className="text-xs text-gray-400 mt-1">The Safaricom phone number registered for Pochi la Biashara — customers pay directly to this number</p>
            </div>

            <div className="pt-1 border-t border-gray-100">
              <label className={TOGGLE_LABEL}>
                Dzeline Cloud API Key
                <span className="ml-1 font-normal normal-case text-gray-400">(provided by Dzeline)</span>
              </label>
              <div className="flex gap-2 items-stretch">
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => { setApiKeyInput(e.target.value.trim()); setApiKeyStatus(null); }}
                  placeholder="dzl_live_…"
                  className={`${INPUT} font-mono text-xs flex-1`}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                <button
                  type="button"
                  onClick={handleVerifyKey}
                  disabled={!apiKey.trim() || apiKeyStatus === "checking"}
                  className={`shrink-0 px-3 rounded-xl text-xs font-bold border-2 transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    apiKeyStatus === "valid"
                      ? "bg-green-50 border-green-200 text-green-700"
                      : apiKeyStatus === "invalid"
                      ? "bg-red-50 border-red-200 text-red-600"
                      : "bg-gray-50 border-gray-100 text-gray-600 hover:border-primary hover:text-primary"
                  }`}
                >
                  {apiKeyStatus === "checking" ? "…" : apiKeyStatus === "valid" ? "✓ OK" : apiKeyStatus === "invalid" ? "✗" : "Verify"}
                </button>
              </div>
              <p className={`text-xs mt-1 ${apiKeyStatus === "valid" ? "text-green-600" : apiKeyStatus === "invalid" ? "text-red-500" : "text-gray-400"}`}>
                {apiKeyStatus === "valid"
                  ? "Connected — cloud sync, STK Push and eTIMS are enabled."
                  : apiKeyStatus === "invalid"
                  ? "Key not recognised. Double-check or contact Dzeline support."
                  : "Enables real-time sync, M-Pesa STK Push and KRA eTIMS. Leave blank for offline-only mode."}
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => goBack(1)} className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 btn-press">
                ← Back
              </button>
              <button onClick={nextStep} className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 btn-press">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Admin PIN ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className={TOGGLE_LABEL}>Your Name</label>
              <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)}
                placeholder="e.g. Jane (shop owner)" className={INPUT} />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {pinStage === "enter" ? "Create a PIN (4–6 digits)" : "Confirm your PIN"}
              </p>
              <PinPad pin={pinStage === "enter" ? pin : pinConfirm} onKey={handlePinKey} />
            </div>
            {pinError && <p className="text-center text-red-500 text-sm font-medium">{pinError}</p>}
            <button onClick={() => goBack(2)} className="w-full py-3 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 btn-press">
              ← Back
            </button>
          </div>
        )}

        {/* ── Step 4: Team ── */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Admin confirmed */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-primary font-bold text-sm">{(adminName || "A").charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800">{adminName || "Admin"}</p>
                <p className="text-xs text-gray-400">Admin — full access</p>
              </div>
              <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-full">You</span>
            </div>

            {/* Added staff */}
            {staffList.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                  <span className="text-teal-700 font-bold text-sm">{s.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800">{s.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{STAFF_ROLES.find((r) => r.value === s.role)?.label ?? s.role}</p>
                </div>
                <button
                  onClick={() => setStaffList((prev) => prev.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 p-1"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {showAddForm ? (
              <AddStaffForm
                onAdd={(s) => { setStaffList((prev) => [...prev, s]); setShowAddForm(false); }}
                onCancel={() => setShowAddForm(false)}
              />
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 text-sm font-semibold hover:border-primary hover:text-primary transition"
              >
                + Add a staff member
              </button>
            )}

            <p className="text-xs text-center text-gray-400">You can always add or remove staff from Settings → Staff later.</p>

            <button
              onClick={handleFinish}
              disabled={saving || showAddForm}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Setting up your shop…" : "Finish Setup →"}
            </button>

            {/* Remote setup help */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-center">
              <p className="text-xs text-gray-500 mb-2">Need help finishing setup remotely?</p>
              <a
                href="https://wa.me/254708174289?text=Hi%2C%20I%20need%20help%20setting%20up%20Dzeline%20Shop"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-bold text-green-700 hover:text-green-800"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.124 1.532 5.857L0 24l6.335-1.611A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.032-1.386l-.36-.214-3.733.95.988-3.61-.236-.371A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
                </svg>
                Chat with Dzeline Support on WhatsApp
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
