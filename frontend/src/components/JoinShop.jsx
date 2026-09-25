import { useEffect, useState } from "react";
import { db, dbHelpers } from "../services/db";
import { setApiKey } from "../utils/apiHeaders";
import { syncService } from "../services/sync";
import { backup } from "../services/backup";

const BG = "linear-gradient(160deg, #111827 0%, #1a2235 60%, #1e2a45 100%)";

function parseJoinLink() {
  // "#join?key=...&shop=..." — the fragment never reaches the server, so a
  // link-preview crawler (WhatsApp/Telegram) that fetches the URL server-side
  // before a human taps it never sees the key.
  const hash = window.location.hash.replace(/^#join\??/, "");
  const params = new URLSearchParams(hash);
  return { key: params.get("key") ?? "", shopName: params.get("shop") ?? "this shop" };
}

async function performJoin(key, onProgress) {
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  onProgress("Checking key…");
  const res = await fetch(`${base}/products/`, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new Error("This invite link is no longer valid — ask the shop owner for a new one.");
  if (res.status === 402) throw new Error("This shop's subscription has lapsed — ask the owner to renew.");
  if (!res.ok) throw new Error("Could not reach the server — check your connection and try again.");

  setApiKey(key);
  await dbHelpers.saveApiKey(key);

  onProgress("Clearing demo data…");
  await db.products.clear(); // demo-seeded products from db.on("populate") on this fresh install

  // Everything, not just the catalogue. A device joining a shop is usually a
  // replacement for one that was lost, and the history is the point.
  const { recovered, failed } = await syncService.recoverEverything({
    onProgress: (label) => onProgress(`Pulling ${label}…`),
  });

  await dbHelpers.updateSetting("setup_complete", "true");
  return { recovered, failed };
}

export default function JoinShop() {
  const [{ key, shopName }] = useState(parseJoinLink);
  const [alreadySetup, setAlreadySetup] = useState(null);
  const [currentShopName, setCurrentShopName] = useState("");
  const [confirmedWipe, setConfirmedWipe] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | error | done
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    dbHelpers.isSetupComplete().then(async (done) => {
      setAlreadySetup(done);
      if (done) {
        const s = await dbHelpers.getShopSettings();
        setCurrentShopName(s.shop_name || "this shop");
      }
    });
  }, []);

  async function handleJoin() {
    if (!key) { setError("This link is missing its key — ask for a fresh invite."); setStatus("error"); return; }
    setStatus("working");
    setError("");
    try {
      if (alreadySetup) await backup.wipeShopData();
      const outcome = await performJoin(key, setProgress);
      setResult(outcome);
      setStatus("done");
      // A clean join gets out of the way. A partial one waits to be read: a
      // device that came back without its sales history should say so now, not
      // leave somebody to discover it during a stock take.
      if (!outcome.failed.length) {
        setTimeout(finish, 2500);
      }
    } catch (err) {
      setError(err.message || "Could not join — try again.");
      setStatus("error");
    }
  }

  function finish() {
    window.location.hash = "";
    window.location.reload();
  }

  function handleCancel() {
    window.location.hash = "";
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: BG }}>
      <div className="bg-[#0e1d35] border border-[#1a2d4a] rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-500/15 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2.13a4 4 0 100-8 4 4 0 000 8zm6 4v-2a4 4 0 00-3-3.87m-9-.13a4 4 0 100-8 4 4 0 000 8z" />
          </svg>
        </div>

        {status === "done" ? (
          <>
            <h1 className="text-lg font-bold text-white mb-1">You're in!</h1>
            <div className="text-left bg-[#0a1628] rounded-xl p-3 my-3 space-y-1">
              {[
                ["Products", result?.recovered?.products],
                ["Sales", result?.recovered?.transactions],
                ["Deliveries", result?.recovered?.stock_receipts],
                ["Suppliers", result?.recovered?.suppliers],
                ["Payments", result?.recovered?.supplier_payments],
              ].map(([label, n]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="text-white font-semibold tabular-nums">
                    {(n ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            {result?.failed?.length ? (
              <>
                <p className="text-amber-400 text-xs mb-3">
                  Couldn't pull {result.failed.join(", ")}. The rest is here. Once you have a
                  better connection, open Settings and sync again.
                </p>
                <button onClick={finish}
                  className="w-full bg-sky-500 hover:bg-sky-400 text-white font-bold py-2.5 rounded-xl text-sm transition">
                  Continue
                </button>
              </>
            ) : (
              <p className="text-slate-400 text-sm">Loading {shopName}…</p>
            )}
          </>
        ) : alreadySetup === null ? (
          <p className="text-slate-400 text-sm py-6">Checking this device…</p>
        ) : alreadySetup && !confirmedWipe ? (
          <>
            <h1 className="text-lg font-bold text-white mb-1">This device is already set up</h1>
            <p className="text-slate-400 text-sm mb-4">
              It's currently configured for <strong className="text-white">{currentShopName}</strong>.
              Joining <strong className="text-white">{shopName}</strong> will
              {" "}<strong className="text-amber-400">replace all local data on this device, including any unsynced sales</strong>.
              This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={handleCancel}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-[#1a2d4a] transition">
                Cancel
              </button>
              <button onClick={() => setConfirmedWipe(true)}
                className="flex-1 bg-red-500/90 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm transition">
                I understand, continue
              </button>
            </div>
          </>
        ) : status === "working" ? (
          <>
            <h1 className="text-lg font-bold text-white mb-1">Joining {shopName}…</h1>
            <p className="text-slate-400 text-sm">{progress}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-white mb-1">Join {shopName}?</h1>
            <p className="text-slate-400 text-sm mb-4">
              This will set up this device for {shopName} and pull in everything — the product
              catalogue, staff, suppliers, deliveries and the full sales history. On a slow
              connection that can take a few minutes. Log in afterwards with the PIN the shop
              owner gave you.
            </p>
            {status === "error" && (
              <p className="text-red-400 text-xs mb-3">{error}</p>
            )}
            <div className="flex gap-2">
              <button onClick={handleCancel}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-[#1a2d4a] transition">
                Cancel
              </button>
              <button onClick={handleJoin}
                className="flex-1 bg-sky-500 hover:bg-sky-400 text-white font-bold py-2.5 rounded-xl text-sm transition">
                Join
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
