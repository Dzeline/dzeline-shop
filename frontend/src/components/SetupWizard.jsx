import { useState } from "react";
import { dbHelpers } from "../services/db";
import { etimsService } from "../services/etims";
import { showToast } from "../utils/toast";

const SETUP_BG = "linear-gradient(160deg, #0f172a 0%, #1e1b4b 38%, #312e81 68%, #4338ca 100%)";

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
    subtitle: "M-Pesa Till and Pochi numbers",
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
    label: "Admin PIN",
    title: "Secure Your Account",
    subtitle: "Set a PIN to protect admin access",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
];

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→"];

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

// Inline bolt used in logo
function BoltIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 48 46" fill="none">
      <path fill="white"
        d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
      />
    </svg>
  );
}

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState("right"); // "right" | "left"
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
  const [mpesaTill, setMpesaTill] = useState("");
  const [pochiNumber, setPochiNumber] = useState("");

  // Step 1 — eTIMS (under Tax step)
  const [etimsEnabled, setEtimsEnabled] = useState(false);
  const [etimsBhfId, setEtimsBhfId] = useState("00");

  // Step 3 — Admin PIN
  const [adminName, setAdminName] = useState("Admin");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState("enter");
  const [pinError, setPinError] = useState("");

  function goNext() {
    setDirection("right");
    setStep((s) => s + 1);
  }

  function goBack(target) {
    setDirection("left");
    setStep(target ?? (step - 1));
  }

  function handlePinKey(key) {
    const current = pinStage === "enter" ? pin : pinConfirm;
    const setter = pinStage === "enter" ? setPin : setPinConfirm;
    setPinError("");

    if (key === "⌫") { setter(current.slice(0, -1)); return; }

    if (key === "→") {
      if (current.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
      if (pinStage === "enter") { setPinStage("confirm"); return; }
      if (current !== pin) {
        setPinError("PINs don't match — try again");
        setPinConfirm("");
        // Stay on confirm stage so user only re-enters the second PIN
        return;
      }
      handleFinish();
      return;
    }

    if (current.length >= 6) return;
    setter(current + key);
  }

  function nextStep() {
    if (step === 0 && !shopName.trim()) { showToast("Shop name is required"); return; }
    if (step === 1 && kraRegistered && !kraPin.trim()) { showToast("Enter your KRA PIN or uncheck KRA registered"); return; }
    goNext();
  }

  async function handleFinish() {
    if (pin.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
    setSaving(true);
    try {
      await dbHelpers.saveShopSettings({
        shop_name: shopName.trim() || "My Shop",
        town: town.trim(),
        phone: phone.trim(),
        kra_pin: kraRegistered ? kraPin.trim() : "NOT_REGISTERED",
        vat_enabled: String(vatEnabled),
        vat_rate: String(parseFloat(vatRate) / 100 || 0.16),
        mpesa_till: mpesaTill.trim(),
        pochi_number: pochiNumber.trim(),
        currency: "KES",
        setup_complete: "true",
      });
      await dbHelpers.addStaff(adminName.trim() || "Admin", pin, "admin");

      // eTIMS optional setup (non-fatal)
      if (etimsEnabled && kraRegistered && kraPin.trim()) {
        try {
          const serial = "VSCU" + kraPin.trim().replace(/[^A-Z0-9]/g, "").slice(0, 8).padEnd(8, "0");
          await etimsService.saveConfig({
            tin: kraPin.trim(),
            bhf_id: etimsBhfId || "00",
            dvc_srl_no: serial,
            env: "sandbox",
          });
          await etimsService.initDevice();
        } catch {
          // Non-fatal: user can complete eTIMS setup from Settings later
        }
      }

      showToast("Setup complete!");
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
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-2.5 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.5), rgba(37,99,235,0.5))",
            boxShadow: "0 8px 32px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          <BoltIcon />
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">Let&apos;s get started</h1>
        <p className="text-white/45 text-sm mt-0.5">Set up your shop in 4 quick steps</p>
      </div>

      {/* Progress bar (outside card, always visible) */}
      <div className="w-full max-w-sm mb-4">
        <ProgressBar step={step} />
      </div>

      {/* Step card — key triggers re-mount → animation replays */}
      <div
        key={step}
        className={`${slideClass} bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6`}
      >
        <StepHeader step={step} />

        {/* Step 0 — Shop Details */}
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
                placeholder="e.g. Nairobi" className={INPUT} />
            </div>
            <div>
              <label className={TOGGLE_LABEL}>Phone Number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0712 345 678" className={INPUT} />
            </div>
            <button onClick={nextStep}
              className="w-full mt-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition">
              Continue →
            </button>
          </div>
        )}

        {/* Step 1 — Tax */}
        {step === 1 && (
          <div className="space-y-3.5">
            <Toggle value={kraRegistered} onChange={setKraRegistered}
              label="KRA Registered" sub="PIN-holder for iTax" />
            {kraRegistered && (
              <div>
                <label className={TOGGLE_LABEL}>KRA PIN</label>
                <input type="text" value={kraPin} onChange={(e) => setKraPin(e.target.value.toUpperCase())}
                  placeholder="e.g. P051234567X" className={`${INPUT} font-mono uppercase`} maxLength={11} />
              </div>
            )}
            <Toggle value={vatEnabled} onChange={setVatEnabled}
              label="Charge VAT" sub="Add 16% to all sales" />
            {vatEnabled && (
              <div>
                <label className={TOGGLE_LABEL}>VAT Rate (%)</label>
                <input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                  min={0} max={100} step={0.5} className={INPUT} />
              </div>
            )}
            <Toggle value={etimsEnabled} onChange={setEtimsEnabled}
              label="Set up eTIMS" sub="Electronic Tax Invoice Management System" />
            {etimsEnabled && (
              <div>
                <label className={TOGGLE_LABEL}>Branch ID <span className="font-normal normal-case text-gray-400">Leave as 00 for single-branch businesses</span></label>
                <input type="text" value={etimsBhfId} onChange={(e) => setEtimsBhfId(e.target.value)}
                  placeholder="00" maxLength={2} className={INPUT} />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => goBack(0)} className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition">
                ← Back
              </button>
              <button onClick={nextStep} className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Payments */}
        {step === 2 && (
          <div className="space-y-3.5">
            <p className="text-xs text-gray-400 font-medium -mt-1">Leave blank if you don&apos;t use these methods</p>
            <div>
              <label className={TOGGLE_LABEL}>M-Pesa Till / Paybill</label>
              <input type="tel" value={mpesaTill} onChange={(e) => setMpesaTill(e.target.value)}
                placeholder="e.g. 5012345" className={INPUT} />
            </div>
            <div>
              <label className={TOGGLE_LABEL}>Pochi la Biashara</label>
              <input type="tel" value={pochiNumber} onChange={(e) => setPochiNumber(e.target.value)}
                placeholder="e.g. 0712 345 678" className={INPUT} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => goBack(1)} className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition">
                ← Back
              </button>
              <button onClick={nextStep} className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Admin PIN */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className={TOGGLE_LABEL}>Admin Name</label>
              <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)}
                placeholder="e.g. Jane" className={INPUT} />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {pinStage === "enter" ? "Create a PIN (4–6 digits)" : "Confirm your PIN"}
              </p>
              <div className={saving ? "pointer-events-none opacity-50" : ""}>
                <PinPad pin={pinStage === "enter" ? pin : pinConfirm} onKey={handlePinKey} />
              </div>
            </div>

            {pinError && <p className="text-center text-red-500 text-sm font-medium">{pinError}</p>}
            {saving && <p className="text-center text-sm text-gray-400 font-medium">Setting up your shop…</p>}

            <button onClick={() => goBack(2)} disabled={saving}
              className="w-full py-3 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed">
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
