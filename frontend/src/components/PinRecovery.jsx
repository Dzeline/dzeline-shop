import { useState } from "react";
import { dbHelpers } from "../services/db";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

export default function PinRecovery({ onClose }) {
  const [step, setStep] = useState("verify"); // "verify" | "reset" | "done"
  const [shopNameInput, setShopNameInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [confirmStage, setConfirmStage] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleVerify(e) {
    e.preventDefault();
    if (!shopNameInput.trim()) { setError("Enter your shop name"); return; }
    const stored = await dbHelpers.getSetting("shop_name");
    if (!stored || stored.trim().toLowerCase() !== shopNameInput.trim().toLowerCase()) {
      setError("Shop name doesn't match — check spelling");
      return;
    }
    setError("");
    setStep("reset");
  }

  function handleKey(key) {
    const active = confirmStage ? confirmPin : newPin;
    const setActive = confirmStage ? setConfirmPin : setNewPin;
    setError("");

    if (key === "⌫") { setActive((p) => p.slice(0, -1)); return; }

    if (key === "✓") {
      if (active.length < 4) { setError("PIN must be at least 4 digits"); return; }
      if (!confirmStage) {
        setConfirmStage(true);
        return;
      }
      if (newPin !== confirmPin) {
        setError("PINs don't match — try again");
        setConfirmPin("");
        return;
      }
      doReset();
      return;
    }

    if (active.length >= 6) return;
    setActive((p) => p + key);
  }

  async function doReset() {
    setSaving(true);
    try {
      const admin = await dbHelpers.getAllStaff().then((list) => list.find((s) => s.role === "admin"));
      if (!admin) { setError("No admin account found"); setSaving(false); return; }
      await dbHelpers.updateStaffPin(admin.id, newPin);
      setStep("done");
    } catch {
      setError("Failed to update PIN — try again");
    } finally {
      setSaving(false);
    }
  }

  const displayPin = confirmStage ? confirmPin : newPin;

  return (
    <div className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 sm:pb-0">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-drop-in">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 shrink-0 transition"
          >
            ✕
          </button>
          <div>
            <p className="font-bold text-gray-800 text-sm">Account Recovery</p>
            <p className="text-xs text-gray-400">Reset admin PIN</p>
          </div>
        </div>

        <div className="p-5">
          {step === "verify" && (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
                To reset the admin PIN, confirm your shop name.
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Shop Name
                </label>
                <input
                  type="text"
                  value={shopNameInput}
                  onChange={(e) => { setShopNameInput(e.target.value); setError(""); }}
                  placeholder="Enter your shop name exactly"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-indigo-400 transition"
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-xs font-semibold">{error}</p>}
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 active:scale-95 transition"
              >
                Continue
              </button>
            </form>
          )}

          {step === "reset" && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-1">
                {confirmStage ? "Confirm new PIN" : "Enter new PIN"}
              </p>

              {/* PIN dots */}
              <div className="flex justify-center gap-3 mt-3 mb-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-3.5 h-3.5 rounded-full border-2 transition-all duration-150"
                    style={
                      i < displayPin.length
                        ? { background: "#6366f1", borderColor: "#6366f1", transform: "scale(1.15)" }
                        : { background: "transparent", borderColor: "#d1d5db" }
                    }
                  />
                ))}
              </div>

              {error ? (
                <p className="text-center text-red-500 text-xs font-semibold mb-3">{error}</p>
              ) : (
                <div className="h-5 mb-3" />
              )}

              <div className="grid grid-cols-3 gap-2">
                {PAD.map((k) => (
                  <button
                    key={k}
                    onClick={() => handleKey(k)}
                    disabled={saving}
                    className={`h-14 rounded-2xl font-bold text-xl transition active:scale-90 ${
                      k === "✓"
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : k === "⌫"
                        ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        : "bg-gray-50 text-gray-800 hover:bg-gray-100 border border-gray-100"
                    }`}
                  >
                    {saving && k === "✓" ? "…" : k}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-gray-800">PIN Updated</p>
                <p className="text-sm text-gray-500 mt-1">Admin PIN has been reset. You can now log in with the new PIN.</p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition"
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
