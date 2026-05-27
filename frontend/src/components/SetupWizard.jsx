import { useState } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";

const SETUP_BG = "linear-gradient(162deg, #d1d5db 0%, #9ca3af 28%, #93c5fd 62%, #3b82f6 100%)";
const STEPS = ["Shop", "Tax", "Payments", "Admin PIN"];

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→"];

function ProgressBar({ step }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className={`h-1 w-full rounded-full transition-all duration-300 ${
              i <= step ? "bg-primary" : "bg-gray-200"
            }`}
          />
          <span className={`text-xs font-medium ${i === step ? "text-primary" : "text-gray-400"}`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function PinPad({ pin, onKey, label, placeholder = "Enter PIN" }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-600 mb-3">{label}</p>
      <div className="flex justify-center gap-3 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors ${
              i < pin.length ? "bg-primary border-primary" : "bg-transparent border-gray-300"
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

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
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

  // Step 3 — Admin PIN
  const [adminName, setAdminName] = useState("Admin");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState("enter"); // "enter" | "confirm"
  const [pinError, setPinError] = useState("");

  function handlePinKey(key) {
    const current = pinStage === "enter" ? pin : pinConfirm;
    const setter = pinStage === "enter" ? setPin : setPinConfirm;
    setPinError("");

    if (key === "⌫") { setter(current.slice(0, -1)); return; }

    if (key === "→") {
      if (current.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
      if (pinStage === "enter") { setPinStage("confirm"); return; }
      // confirm stage
      if (current !== pin) {
        setPinError("PINs don't match — try again");
        setPinConfirm("");
        setPinStage("enter");
        setPin("");
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
    setStep((s) => s + 1);
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

      const adminDisplayName = adminName.trim() || "Admin";
      await dbHelpers.addStaff(adminDisplayName, pin, "admin");

      showToast("Setup complete!");
      onComplete();
    } catch (err) {
      console.error("Setup failed:", err);
      showToast("Setup failed — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start pt-14 sm:pt-20 px-6 pb-10"
      style={{ background: SETUP_BG }}
    >
      <div className="text-center mb-8 animate-fade-logo">
        <h1
          className="text-3xl font-extrabold tracking-tight text-white"
          style={{ textShadow: "0 2px 14px rgba(0,0,0,0.22)" }}
        >
          Welcome
        </h1>
        <p className="text-white/65 text-sm mt-1 font-medium tracking-wide">
          Let&apos;s set up your shop
        </p>
      </div>

      <div
        key={step}
        className="animate-drop-in bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
      >
        <ProgressBar step={step} />

        {/* Step 0 — Shop Details */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Shop Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. Wanjiku Supermarket"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Town / City
              </label>
              <input
                type="text"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                placeholder="e.g. Nairobi"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0712345678"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>
            <button
              onClick={nextStep}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition mt-2"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 1 — Tax */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border-2 border-gray-100">
              <div>
                <p className="font-bold text-sm text-gray-800">KRA Registered</p>
                <p className="text-xs text-gray-400 mt-0.5">PIN-holder for iTax</p>
              </div>
              <button
                type="button"
                onClick={() => setKraRegistered((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors ${kraRegistered ? "bg-primary" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${kraRegistered ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>

            {kraRegistered && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  KRA PIN
                </label>
                <input
                  type="text"
                  value={kraPin}
                  onChange={(e) => setKraPin(e.target.value.toUpperCase())}
                  placeholder="e.g. P051234567X"
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-mono font-medium uppercase"
                  maxLength={11}
                />
              </div>
            )}

            <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border-2 border-gray-100">
              <div>
                <p className="font-bold text-sm text-gray-800">Charge VAT</p>
                <p className="text-xs text-gray-400 mt-0.5">Add 16% to all sales</p>
              </div>
              <button
                type="button"
                onClick={() => setVatEnabled((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors ${vatEnabled ? "bg-primary" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${vatEnabled ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>

            {vatEnabled && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  VAT Rate (%)
                </label>
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  min={0}
                  max={100}
                  step={0.5}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
                />
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setStep(0)}
                className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition"
              >
                Back
              </button>
              <button
                onClick={nextStep}
                className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Payments */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 font-medium -mt-1 mb-1">
              Leave blank if you don&apos;t use these payment methods
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                M-Pesa Till / Paybill Number
              </label>
              <input
                type="tel"
                value={mpesaTill}
                onChange={(e) => setMpesaTill(e.target.value)}
                placeholder="e.g. 5012345"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Pochi la Biashara Number
              </label>
              <input
                type="tel"
                value={pochiNumber}
                onChange={(e) => setPochiNumber(e.target.value)}
                placeholder="e.g. 0712345678"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition"
              >
                Back
              </button>
              <button
                onClick={nextStep}
                className="flex-1 py-3.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Admin PIN */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Admin Name
              </label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Admin"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:outline-none focus:border-primary text-sm font-medium"
              />
            </div>

            <PinPad
              pin={pinStage === "enter" ? pin : pinConfirm}
              onKey={handlePinKey}
              label={pinStage === "enter" ? "Create a PIN (4–6 digits)" : "Confirm your PIN"}
            />

            {pinError && (
              <p className="text-center text-red-500 text-sm font-medium">{pinError}</p>
            )}

            {saving && (
              <p className="text-center text-sm text-gray-400 font-medium">Saving…</p>
            )}

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl border-2 border-gray-100 text-gray-500 font-bold text-sm hover:bg-gray-50 active:scale-95 transition"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
