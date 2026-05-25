import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useStaffStore } from "../store/staffStore";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

const LOGIN_BG = "linear-gradient(162deg, #d1d5db 0%, #9ca3af 28%, #93c5fd 62%, #3b82f6 100%)";

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

    if (next.length === 4) {
      const staff = await dbHelpers.getStaffByPin(next);
      if (staff && staff.id === selected.id) { setStaff(staff); return; }
    }

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
    <div
      className="min-h-screen flex flex-col items-center justify-start pt-14 sm:pt-20 px-6 pb-10"
      style={{ background: LOGIN_BG }}
    >
      {/* Logo — rises in with a gentle fade */}
      <div className="text-center mb-8 animate-fade-logo">
        <h1
          className="text-3xl font-extrabold tracking-tight text-white"
          style={{ textShadow: "0 2px 14px rgba(0,0,0,0.22)" }}
        >
          Dzeline Shop
        </h1>
        <p className="text-white/65 text-sm mt-1 font-medium tracking-wide">
          Point of Sale
        </p>
      </div>

      {/* Card — key forces remount (re-triggers drop-in) when view changes */}
      <div
        key={selected ? "pin-entry" : "staff-select"}
        className="animate-drop-in bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
      >
        {!selected ? (
          <>
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide text-center mb-4">
              Who&apos;s working today?
            </p>

            {loadingStaff && (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-2xl animate-pulse" />
                ))}
              </div>
            )}

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
            {/* Back + selected name */}
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

            {/* PIN dots */}
            <div className={`flex justify-center gap-3 mb-4 ${shake ? "animate-shake" : ""}`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length ? "bg-primary border-primary" : "bg-transparent border-gray-300"
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
