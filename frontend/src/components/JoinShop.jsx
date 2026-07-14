import { useEffect, useState } from "react";
import { db, dbHelpers } from "../services/db";
import { setApiKey } from "../utils/apiHeaders";
import { syncService } from "../services/sync";

const BG = "linear-gradient(160deg, #111827 0%, #1a2235 60%, #1e2a45 100%)";

function parseJoinLink() {
  // "#join?key=...&shop=..." — the fragment never reaches the server, so a
  // link-preview crawler (WhatsApp/Telegram) that fetches the URL server-side
  // before a human taps it never sees the key.
  const hash = window.location.hash.replace(/^#join\??/, "");
  const params = new URLSearchParams(hash);
  return { key: params.get("key") ?? "", shopName: params.get("shop") ?? "this shop" };
}

async function wipeLocalData() {
  await db.transaction(
    "rw",
    [db.transactions, db.transaction_items, db.pending_mpesa, db.staff, db.products,
     db.stock_receipts, db.stock_receipt_items, db.suppliers, db.settings],
    async () => {
      await Promise.all([
        db.transactions.clear(),
        db.transaction_items.clear(),
        db.pending_mpesa.clear(),
        db.staff.clear(),
        db.products.clear(),
        db.stock_receipts.clear(),
        db.stock_receipt_items.clear(),
        db.suppliers.clear(),
      ]);
      // Keep device_id (it's a hardware/install identifier, not shop-specific)
      // but drop everything shop-specific so the join below starts clean.
      const deviceId = await db.settings.get("device_id");
      await db.settings.clear();
      if (deviceId) await db.settings.put(deviceId);
    },
  );
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

  onProgress("Pulling products…");
  await syncService.pullProducts();
  onProgress("Pulling staff…");
  await syncService.pullStaff();
  onProgress("Pulling shop settings…");
  await syncService.pullSettings();

  await dbHelpers.updateSetting("setup_complete", "true");
}

export default function JoinShop() {
  const [{ key, shopName }] = useState(parseJoinLink);
  const [alreadySetup, setAlreadySetup] = useState(null);
  const [currentShopName, setCurrentShopName] = useState("");
  const [confirmedWipe, setConfirmedWipe] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | error | done
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

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
      if (alreadySetup) await wipeLocalData();
      await performJoin(key, setProgress);
      setStatus("done");
      setTimeout(() => {
        window.location.hash = "";
        window.location.reload();
      }, 1200);
    } catch (err) {
      setError(err.message || "Could not join — try again.");
      setStatus("error");
    }
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
            <p className="text-slate-400 text-sm">Loading {shopName}…</p>
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
              This will set up this device for {shopName} and pull in the product catalogue and staff list.
              Log in afterwards with the PIN the shop owner gave you.
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
