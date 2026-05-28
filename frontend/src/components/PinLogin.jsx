import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { useStaffStore } from "../store/staffStore";
import { useSettingsStore } from "../store/settingsStore";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

const LOGIN_BG = "linear-gradient(160deg, #0f172a 0%, #1e1b4b 38%, #312e81 68%, #4338ca 100%)";

// Colour palette for staff avatars — index 0 reserved for admin
const AVATAR_COLORS = [
  { ring: "#a78bfa", bg: "rgba(139,92,246,0.18)", text: "#c4b5fd" }, // violet — admin
  { ring: "#2dd4bf", bg: "rgba(20,184,166,0.18)", text: "#5eead4" }, // teal
  { ring: "#f472b6", bg: "rgba(236,72,153,0.18)", text: "#f9a8d4" }, // pink
  { ring: "#fb923c", bg: "rgba(249,115,22,0.18)", text: "#fdba74" }, // orange
  { ring: "#38bdf8", bg: "rgba(56,189,248,0.18)", text: "#7dd3fc" }, // sky
  { ring: "#a3e635", bg: "rgba(132,204,22,0.18)", text: "#bef264" }, // lime
];

function avatarColor(staff) {
  if (staff.role === "admin") return AVATAR_COLORS[0];
  return AVATAR_COLORS[((staff.id - 2) % (AVATAR_COLORS.length - 1)) + 1];
}

// Inline bolt SVG used as logo mark
function BoltIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 46" fill="none">
      <path
        fill="white"
        d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
      />
    </svg>
  );
}

export default function PinLogin() {
  const setStaff = useStaffStore((s) => s.setStaff);
  const shopName = useSettingsStore((s) => s.shopName);

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

  const color = selected ? avatarColor(selected) : AVATAR_COLORS[0];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start pt-12 sm:pt-20 px-5 pb-10"
      style={{ background: LOGIN_BG }}
    >
      {/* Logo */}
      <div className="text-center mb-7 animate-fade-logo">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.5) 0%, rgba(37,99,235,0.5) 100%)",
            boxShadow: "0 8px 32px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          <BoltIcon size={30} />
        </div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight leading-tight">
          {shopName || "Dzeline Shop"}
        </h1>
        <p className="text-white/45 text-sm mt-0.5 font-medium tracking-wide">Point of Sale</p>
      </div>

      {/* Card — key forces remount to re-trigger drop-in when view changes */}
      <div
        key={selected ? "pin-entry" : "staff-select"}
        className="animate-drop-in bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
      >
        {!selected ? (
          /* ── Staff selector ──────────────────────────── */
          <div className="p-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-5">
              Who&apos;s working today?
            </p>

            {loadingStaff ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {staffList.map((s, idx) => {
                  const c = avatarColor(s);
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSelected(s); setPin(""); setError(""); }}
                      className="animate-scale-in flex flex-col items-center gap-2.5 py-5 px-3 rounded-2xl border-2 border-gray-100 hover:border-primary/40 hover:bg-blue-50/60 transition active:scale-95"
                      style={{ animationDelay: `${idx * 0.05}s` }}
                    >
                      {/* Avatar circle */}
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center ring-2"
                        style={{ background: c.bg, ringColor: c.ring, boxShadow: `0 0 0 2px ${c.ring}` }}
                      >
                        <span className="text-xl font-black" style={{ color: c.ring }}>
                          {s.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-800 text-sm leading-tight truncate max-w-full">
                          {s.name}
                        </p>
                        {s.role === "admin" && (
                          <p className="text-yellow-500 text-xs font-semibold mt-0.5">Admin ★</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── PIN entry ───────────────────────────────── */
          <>
            {/* Coloured header strip */}
            <div
              className="px-5 py-4 flex items-center gap-3"
              style={{ background: `linear-gradient(135deg, ${color.ring}33 0%, ${color.ring}18 100%)`, borderBottom: `1px solid ${color.ring}33` }}
            >
              <button
                onClick={() => { setSelected(null); setPin(""); setError(""); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 text-gray-700 shrink-0 transition"
              >
                ‹
              </button>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: color.bg, boxShadow: `0 0 0 2px ${color.ring}` }}
              >
                <span className="text-base font-black" style={{ color: color.ring }}>
                  {selected.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-bold text-gray-800 text-sm leading-tight">{selected.name}</p>
                <p className="text-xs text-gray-400">Enter your PIN</p>
              </div>
            </div>

            <div className="p-5">
              {/* PIN dots */}
              <div className={`flex justify-center gap-3 mb-1 ${shake ? "animate-shake" : ""}`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-3.5 h-3.5 rounded-full border-2 transition-all duration-150"
                    style={
                      i < pin.length
                        ? { background: color.ring, borderColor: color.ring, transform: "scale(1.15)" }
                        : { background: "transparent", borderColor: "#d1d5db" }
                    }
                  />
                ))}
              </div>

              {error ? (
                <p className="text-center text-red-500 text-xs mb-4 font-semibold">{error}</p>
              ) : (
                <div className="h-6 mb-4" />
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-2">
                {PAD.map((k) => (
                  <button
                    key={k}
                    onClick={() => handleKey(k)}
                    className={`h-14 rounded-2xl font-bold text-xl transition active:scale-90 ${
                      k === "✓"
                        ? "text-white hover:opacity-90"
                        : k === "⌫"
                        ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        : "bg-gray-50 text-gray-800 hover:bg-gray-100 border border-gray-100"
                    }`}
                    style={k === "✓" ? { background: `linear-gradient(135deg, ${color.ring}, ${color.ring}cc)` } : undefined}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
