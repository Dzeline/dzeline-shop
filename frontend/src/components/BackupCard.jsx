import { useState, useRef } from "react";
import { backup } from "../services/backup";
import { showToast } from "../utils/toast";
import { useEscapeKey } from "../hooks/useEscapeKey";

function when(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-KE", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * What is in the file, before it replaces everything.
 *
 * Restoring is destructive and not undoable, so the confirmation shows the
 * contents rather than asking "are you sure?" about a filename. Somebody about
 * to wipe a shop's history should be able to see it is the right shop and the
 * right day.
 */
function RestoreModal({ payload, summary, onClose, onDone }) {
  useEscapeKey(onClose);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const armed = confirmText.trim().toUpperCase() === "RESTORE";

  async function run() {
    setBusy(true);
    try {
      const result = await backup.restore(payload, {
        onProgress: (table, i, total) => setProgress(`${table} (${i + 1}/${total})`),
      });
      const rows = Object.values(result.restored).reduce((a, b) => a + b, 0);
      showToast(`Restored ${rows.toLocaleString()} rows`);
      onDone();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Restore failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-70 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h3 className="font-bold text-gray-800">Restore this backup?</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {summary.shopName ?? "Unknown shop"} · {when(summary.exportedAt)}
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 space-y-1">
          {[
            ["Products", summary.counts.products ?? 0],
            ["Sales", summary.counts.transactions ?? 0],
            ["Deliveries", summary.counts.stock_receipts ?? 0],
            ["Suppliers", summary.counts.suppliers ?? 0],
            ["Staff", summary.counts.staff ?? 0],
          ].map(([label, n]) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="font-semibold text-gray-800 tabular-nums">{n.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm pt-1 border-t border-gray-200">
            <span className="text-gray-600 font-semibold">Total rows</span>
            <span className="font-bold text-gray-800 tabular-nums">{summary.totalRows.toLocaleString()}</span>
          </div>
          {!summary.includesPhotos && (
            <p className="text-xs text-amber-600 pt-1">
              This backup has no photos — product images and invoice pictures will be blank.
            </p>
          )}
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm font-bold text-red-700">This replaces everything on this device</p>
          <p className="text-xs text-red-600 mt-1">
            Every sale, product and supplier currently here is deleted and replaced by what is
            in the file. It cannot be undone. Take a backup of this device first if you are
            not certain.
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Type RESTORE to confirm</label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESTORE"
            className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-bold tracking-widest uppercase focus:outline-none focus:border-red-400"
          />
        </div>

        {busy && progress && (
          <p className="text-xs text-gray-500 text-center">Restoring {progress}…</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={!armed || busy}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-40"
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Download a backup, or restore one.
 *
 * The copy the shop owns and we cannot take away — it works with the backend
 * down, which is the condition under which people actually go looking for it.
 */
export default function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [pending, setPending] = useState(null);
  const fileRef = useRef(null);

  async function download(includePhotos) {
    setBusy(true);
    setProgress("starting");
    try {
      const payload = await backup.create({
        includePhotos,
        onProgress: (table, i, total) => setProgress(`${table} (${i + 1}/${total})`),
      });
      const json = JSON.stringify(payload);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backup.filename(payload.meta);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a delay: revoking immediately can cancel the download on
      // some mobile browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      const mb = blob.size / (1024 * 1024);
      showToast(`Backup saved — ${payload.meta.counts.transactions ?? 0} sales, ${mb.toFixed(1)} MB`);
    } catch (err) {
      console.error(err);
      showToast(err.message || "Backup failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const summary = backup.inspect(payload);
      setPending({ payload, summary });
    } catch (err) {
      console.error(err);
      showToast(err.message || "Couldn't read that file");
    }
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          A copy of everything on this device, as one file. Keep it somewhere that is not this
          phone — email it to yourself, or save it to a computer. It works with no internet.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => download(true)}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-blue-600 transition disabled:opacity-50"
          >
            {busy ? "Working…" : "Download backup"}
          </button>
          <button
            onClick={() => download(false)}
            disabled={busy}
            className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200 transition disabled:opacity-50"
            title="Smaller file — product images and invoice photos are left out"
          >
            Without photos
          </button>
        </div>

        {busy && progress && (
          <p className="text-xs text-gray-500">Reading {progress}…</p>
        )}

        <div className="pt-2 border-t border-gray-100">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Restore from a backup file
          </button>
          <p className="text-xs text-gray-400 mt-1.5">
            Replaces everything on this device. Use it on a new phone, or after storage was
            cleared.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={pickFile}
            className="hidden"
          />
        </div>
      </div>

      {pending && (
        <RestoreModal
          payload={pending.payload}
          summary={pending.summary}
          onClose={() => setPending(null)}
          onDone={() => window.location.reload()}
        />
      )}
    </>
  );
}
