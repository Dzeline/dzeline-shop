import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { etimsService } from "../services/etims";
import { useSettingsStore } from "../store/settingsStore";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";

const STATUS_META = {
  pending:   { label: "Pending",   color: "text-blue-500",  bg: "bg-blue-50",  dot: "bg-blue-400" },
  failed:    { label: "Failed",    color: "text-red-500",   bg: "bg-red-50",   dot: "bg-red-400" },
  submitted: { label: "Submitted", color: "text-green-600", bg: "bg-green-50", dot: "bg-green-500" },
  skipped:   { label: "Skipped",   color: "text-gray-400",  bg: "bg-gray-50",  dot: "bg-gray-300" },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${m.color} ${m.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function EtimsModal({ onClose }) {
  const vatRate = useSettingsStore((s) => s.vatRate);
  const shopName = useSettingsStore((s) => s.shopName);

  const [queue, setQueue] = useState([]);
  const [submitted, setSubmitted] = useState([]);
  const [tab, setTab] = useState("queue"); // "queue" | "submitted"
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [backendOk, setBackendOk] = useState(null); // null=checking true/false

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, s, status] = await Promise.all([
        dbHelpers.getEtimsQueue(),
        dbHelpers.getEtimsSubmitted(),
        etimsService.getStatus().catch(() => null),
      ]);
      setQueue(q);
      setSubmitted(s);
      setBackendOk(status?.configured ?? false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setSelected(new Set(queue.map((t) => t.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    if (!backendOk) {
      showToast("Backend not configured — set ETIMS_TIN in server environment");
      return;
    }
    setSubmitting(true);
    try {
      const result = await etimsService.submitBatch([...selected], {
        vatRate,
        taxpayerName: shopName || "Admin",
      });
      showToast(`Submitted ${result.submitted}, failed ${result.failed}`);
      setSelected(new Set());
      await load();
    } catch (err) {
      showToast(err.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (selected.size === 0) return;
    await Promise.all(
      [...selected].map((id) => dbHelpers.updateEtimsStatus(id, "skipped"))
    );
    setSelected(new Set());
    await load();
    showToast(`${selected.size} transaction${selected.size !== 1 ? "s" : ""} marked as skipped`);
  }

  const pendingTotal = queue.reduce((s, t) => s + (t.total || 0), 0);
  const selectedItems = tab === "queue" ? queue.filter((t) => selected.has(t.id)) : [];
  const selectedTotal = selectedItems.reduce((s, t) => s + (t.total || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col animate-slide-up">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white"
        >‹</button>
        <div className="flex-1">
          <p className="font-bold text-white text-sm">eTIMS Submission</p>
          <p className="text-white/50 text-xs">KRA Electronic Tax Invoice</p>
        </div>
        {backendOk === false && (
          <span className="text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-1 rounded-full">
            Not configured
          </span>
        )}
        {backendOk === true && (
          <span className="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
            Sandbox
          </span>
        )}
      </div>

      {/* Not configured warning */}
      {backendOk === false && (
        <div className="bg-orange-500/10 border-b border-orange-500/20 px-4 py-3">
          <p className="text-orange-400 text-xs font-medium">
            eTIMS credentials not set on the backend. Add <span className="font-mono">ETIMS_TIN</span> to your server environment variables to enable submissions.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3 shrink-0">
        <div className="bg-blue-900/30 rounded-xl p-3">
          <p className="text-blue-300 text-xs font-semibold">Pending / Failed</p>
          <p className="text-white text-xl font-extrabold">{queue.length}</p>
          <p className="text-blue-300/70 text-xs">{formatPrice(pendingTotal)}</p>
        </div>
        <div className="bg-green-900/30 rounded-xl p-3">
          <p className="text-green-300 text-xs font-semibold">Submitted to KRA</p>
          <p className="text-white text-xl font-extrabold">{submitted.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 p-1 mx-4 rounded-xl shrink-0">
        {["queue", "submitted"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
              tab === t ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"
            }`}
          >
            {t === "queue" ? `Queue (${queue.length})` : `Submitted (${submitted.length})`}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : tab === "queue" ? (
          queue.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-3xl mb-2">✓</p>
              <p className="font-semibold">All caught up</p>
              <p className="text-sm mt-1">No pending transactions</p>
            </div>
          ) : (
            queue.map((txn) => (
              <button
                key={txn.id}
                onClick={() => toggleSelect(txn.id)}
                className={`w-full text-left rounded-xl border-2 p-3 transition ${
                  selected.has(txn.id)
                    ? "border-blue-500 bg-blue-900/20"
                    : "border-gray-700 bg-gray-800 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition ${
                      selected.has(txn.id) ? "border-blue-500 bg-blue-500" : "border-gray-600"
                    }`}>
                      {selected.has(txn.id) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold">{formatDate(txn.timestamp)}</p>
                      <p className="text-gray-400 text-xs truncate">
                        {txn.payment_method} · TXN{String(txn.id).padStart(6, "0")}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-bold text-sm">{formatPrice(txn.total)}</p>
                    <StatusBadge status={txn.etims_status || "pending"} />
                  </div>
                </div>
                {txn.etims_error && (
                  <p className="text-red-400 text-xs mt-1.5 truncate">{txn.etims_error}</p>
                )}
              </button>
            ))
          )
        ) : (
          submitted.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">No submitted invoices yet</p>
            </div>
          ) : (
            submitted.map((txn) => (
              <div key={txn.id} className="rounded-xl border border-gray-700 bg-gray-800 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white text-sm font-semibold">{formatDate(txn.timestamp)}</p>
                    <p className="text-gray-400 text-xs">
                      TXN{String(txn.id).padStart(6, "0")} · {txn.payment_method}
                    </p>
                    {txn.etims_cu_invc_no && (
                      <p className="text-green-400 text-xs mt-0.5 font-mono">
                        CU Invoice #{txn.etims_cu_invc_no}
                      </p>
                    )}
                    {txn.etims_rcpt_sign && (
                      <p className="text-gray-500 text-xs font-mono truncate max-w-[160px]">
                        {txn.etims_rcpt_sign}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-bold text-sm">{formatPrice(txn.total)}</p>
                    <StatusBadge status="submitted" />
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Footer action bar (queue tab only) */}
      {tab === "queue" && queue.length > 0 && (
        <div className="shrink-0 bg-gray-800 border-t border-gray-700 px-4 py-3 space-y-2">
          {selected.size === 0 ? (
            <button
              onClick={selectAllPending}
              className="w-full py-3 rounded-xl border-2 border-gray-600 text-gray-300 font-bold text-sm hover:bg-gray-700 transition"
            >
              Select All ({queue.length})
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-400">{selected.size} selected</span>
                <span className="text-white font-bold">{formatPrice(selectedTotal)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSkip}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl border-2 border-gray-600 text-gray-400 font-bold text-sm hover:bg-gray-700 disabled:opacity-40 transition"
                >
                  Skip
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !backendOk}
                  className="flex-[2] py-3 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
                >
                  {submitting ? "Submitting…" : `Submit to KRA (${selected.size})`}
                </button>
              </div>
              <button onClick={clearSelection} className="w-full text-xs text-gray-500 py-1">
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
