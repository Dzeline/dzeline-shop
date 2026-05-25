import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useStaffStore } from "../store/staffStore";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

export default function PinLogin() {
  const setStaff = useStaffStore((s) => s.setStaff);

  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    dbHelpers.getAllStaff().then((list) => {
      setStaffList(list.filter((s) => s.active));
      setLoadingStaff(false);
    });
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  async function handleKey(key) {
    if (!selected) return;
    setError("");

    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }

    if (key === "✓") {
      if (pin.length === 0) return;
      const staff = await dbHelpers.getStaffByPin(pin);
      if (staff && staff.id === selected.id) {
        setStaff(staff);
      } else {
        setError("Wrong PIN — try again");
        triggerShake();
        setPin("");
      }
      return;
    }

    if (pin.length >= 6) return;
    const next = pin + key;
    setPin(next);

    // Auto-submit at 4 digits only if correct for the selected user
    if (next.length === 4) {
      const staff = await dbHelpers.getStaffByPin(next);
      if (staff && staff.id === selected.id) { setStaff(staff); return; }
    }

    // Force-submit at 6 digits regardless
    if (next.length === 6) {
      const staff = await dbHelpers.getStaffByPin(next);
      if (staff && staff.id === selected.id) {
        setStaff(staff);
      } else {
        setError("Wrong PIN — try again");
        triggerShake();
        setPin("");
      }
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-primary to-blue-800 flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="text-center text-white mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Dzeline Shop</h1>
        <p className="text-blue-200 text-sm mt-1">Point of Sale</p>
      </div>

      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
        {!selected ? (
          <>
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide text-center mb-4">
              Who&apos;s working today?
            </p>
            {loadingStaff ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-2xl animate-pulse bg-gray-100" />
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              {staffList.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelected(s); setPin(""); setError(""); }}
                  className="py-4 rounded-2xl border-2 border-gray-100 bg-gray-50 hover:border-primary hover:bg-blue-50 font-bold text-gray-700 transition active:scale-95"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Selected staff header */}
            <div className="flex items-center gap-3 mb-5">
              <button
                onClick={() => { setSelected(null); setPin(""); setError(""); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 shrink-0"
              >
                ‹
              </button>
              <div>
                <p className="font-bold text-gray-800">{selected.name}</p>
                <p className="text-xs text-gray-400">Enter your PIN</p>
              </div>
            </div>

            {/* PIN dots — up to 6 */}
            <div className={`flex justify-center gap-3 mb-4 ${shake ? "animate-shake" : ""}`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length
                      ? "bg-primary border-primary"
                      : "bg-transparent border-gray-300"
                  }`}
                />
              ))}
            </div>

            {error && (
              <p className="text-center text-red-500 text-sm mb-3 font-medium">{error}</p>
            )}

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-2">
              {PAD.map((k) => (
                <button
                  key={k}
                  onClick={() => handleKey(k)}
                  className={`h-14 rounded-2xl font-bold text-lg transition active:scale-95 ${
                    k === "✓"
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
          </>
        )}
      </div>
    </div>
  );
}
