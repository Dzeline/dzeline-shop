import { useState, useEffect, useCallback } from "react";
import { shifts, MOVEMENT, SHIFT_STATUS } from "../services/shifts";
import { useStaffStore } from "../store/staffStore";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";
import { useEscapeKey } from "../hooks/useEscapeKey";

function shortDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-KE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function Row({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${strong ? "font-semibold text-gray-700" : "text-gray-500"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${strong ? "font-bold" : ""} ${tone ?? "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}

/** Money in or out of the drawer, with a reason — a float top-up, a supplier paid in cash. */
function MovementModal({ shift, staffId, onClose, onSaved }) {
  useEscapeKey(onClose);
  const [type, setType] = useState(MOVEMENT.OUT);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const value = parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0 && reason.trim().length > 0;

  async function save() {
    setBusy(true);
    try {
      await shifts.recordMovement({ shift_id: shift.id, type, amount: value, reason, staff_id: staffId });
      showToast(`${type === MOVEMENT.IN ? "Cash in" : "Cash out"} recorded`);
      onSaved();
    } catch (err) {
      showToast(err.message || "Couldn't record it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-70 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800">Cash in / out</h3>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {[
            { id: MOVEMENT.OUT, label: "Cash out" },
            { id: MOVEMENT.IN, label: "Cash in" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                type === t.id ? "bg-white text-primary shadow-sm" : "text-gray-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Amount (KSH)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-lg font-bold text-right focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Reason</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={type === MOVEMENT.OUT ? "e.g. paid Mwangi for milk" : "e.g. float top-up"}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-gray-400 mt-1">
            Every movement needs a reason — this is what the count is checked against.
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || busy}
            className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Counting the drawer at close.
 *
 * The expected figure is deliberately hidden until a count has been entered.
 * Showing it first turns counting into confirming, and a cashier who is short
 * would simply type the expected number.
 */
function CloseShiftModal({ shift, summary, onClose, onClosed }) {
  useEscapeKey(onClose);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const value = parseFloat(counted);
  const valid = Number.isFinite(value) && value >= 0;
  const difference = valid ? value - summary.expectedCash : null;
  const over = difference > 0.5;
  const short = difference < -0.5;

  async function save() {
    setBusy(true);
    try {
      await shifts.close({ shift_id: shift.id, counted_cash: value, note });
      showToast("Shift closed");
      onClosed();
    } catch (err) {
      showToast(err.message || "Couldn't close the shift");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-70 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h3 className="font-bold text-gray-800">Close shift</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Count the drawer and enter the total.
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cash counted (KSH)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            autoFocus
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-2xl font-bold text-right focus:outline-none focus:border-primary"
          />
        </div>

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            disabled={!valid}
            className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold disabled:opacity-50"
          >
            Check against expected
          </button>
        ) : (
          <div className="bg-gray-50 rounded-xl p-3">
            <Row label="Expected in drawer" value={formatPrice(summary.expectedCash)} />
            <Row label="Counted" value={formatPrice(value)} />
            <div className="border-t border-gray-200 mt-1 pt-1">
              <Row
                label={short ? "Short by" : over ? "Over by" : "Difference"}
                value={formatPrice(Math.abs(difference))}
                strong
                tone={short ? "text-red-600" : over ? "text-amber-600" : "text-green-700"}
              />
            </div>
            {(short || over) && (
              <p className="text-xs text-gray-500 mt-2">
                {short
                  ? "Less cash than the sales account for. Check for an unrecorded cash-out or a missed sale before closing."
                  : "More cash than the sales account for. Usually a float top-up that was not recorded."}
              </p>
            )}
          </div>
        )}

        {revealed && (short || over) && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain the difference"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || !revealed || busy}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {busy ? "Closing…" : "Close shift"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The shift: open with a counted float, track the drawer, close against a count.
 *
 * This is the answer to "did the money match?" — the question the app could not
 * previously ask. Per user per day, so it follows the person across whatever
 * devices they use.
 */
export default function ShiftScreen() {
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const [shift, setShift] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [stale, setStale] = useState([]);
  const [loading, setLoading] = useState(true);
  const [float, setFloat] = useState("");
  const [opening, setOpening] = useState(false);
  const [movement, setMovement] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const open = await shifts.getOpenShift(currentStaff?.id);
      setShift(open);
      setSummary(open ? await shifts.summarise(open) : null);
      // Only closed shifts are history; an open one is the card above.
      const past = await shifts.getHistory(20);
      setHistory(past.filter((h) => h.status === SHIFT_STATUS.CLOSED));
      setStale(await shifts.getStaleOpenShifts());
    } finally {
      setLoading(false);
    }
  }, [currentStaff?.id]);

  useEffect(() => { load(); }, [load]);

  async function openShift() {
    setOpening(true);
    try {
      await shifts.open({
        staff_id: currentStaff.id,
        staff_name: currentStaff.name,
        opening_float: parseFloat(float) || 0,
      });
      showToast("Shift started");
      setFloat("");
      await load();
    } catch (err) {
      showToast(err.message || "Couldn't start the shift");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Shift</h2>
          <p className="text-xs text-gray-400">Your drawer, and whether it balances</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 transition disabled:opacity-40"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <div className="h-32 bg-gray-800 rounded-2xl animate-pulse" />}

        {/* A shift nobody closed is a reconciliation nobody did */}
        {!loading && stale.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="font-semibold text-amber-800 text-sm">
              {stale.length} shift{stale.length !== 1 ? "s" : ""} left open from an earlier day
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {stale.map((s) => `${s.staff_name ?? "Staff"} · ${s.business_date}`).join(", ")}
            </p>
            <p className="text-xs text-amber-600 mt-1">
              A shift that was never closed was never counted. Close them to keep the record honest.
            </p>
          </div>
        )}

        {/* No shift yet — start one */}
        {!loading && !shift && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="font-bold text-gray-800">Start your shift</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Count the cash in the drawer now. Everything sold today is checked against this
              starting figure when you close.
            </p>
            <label className="text-xs text-gray-500 mb-1 block">Opening float (KSH)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-xl font-bold text-right focus:outline-none focus:border-primary"
            />
            <button
              onClick={openShift}
              disabled={opening}
              className="w-full mt-3 py-3 rounded-xl bg-primary text-white font-bold text-sm hover:bg-blue-600 active:scale-95 transition disabled:opacity-50"
            >
              {opening ? "Starting…" : "Start shift"}
            </button>
          </div>
        )}

        {/* Open shift */}
        {!loading && shift && summary && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="font-bold text-gray-800 text-sm">Open since {shortDate(shift.opened_at)}</p>
                <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">
                  Open
                </span>
              </div>

              <Row label="Opening float" value={formatPrice(summary.openingFloat)} />
              <Row label={`Cash sales (${summary.transactionCount} sale${summary.transactionCount !== 1 ? "s" : ""})`}
                   value={formatPrice(summary.salesByMethod.CASH)} />
              {summary.cashIn > 0 && <Row label="Cash in" value={formatPrice(summary.cashIn)} />}
              {summary.cashOut > 0 && <Row label="Cash out" value={`− ${formatPrice(summary.cashOut)}`} tone="text-red-600" />}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <Row label="Should be in drawer" value={formatPrice(summary.expectedCash)} strong />
              </div>

              {/* Not cash — money the shop took without anything entering the till */}
              {(summary.salesByMethod.MPESA > 0 || summary.salesByMethod.POCHI > 0) && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                    Not in the drawer
                  </p>
                  {summary.salesByMethod.MPESA > 0 && <Row label="M-Pesa" value={formatPrice(summary.salesByMethod.MPESA)} />}
                  {summary.salesByMethod.POCHI > 0 && <Row label="Pochi" value={formatPrice(summary.salesByMethod.POCHI)} />}
                </div>
              )}

              {summary.voidedCount > 0 && (
                <p className="text-xs text-amber-600 mt-2 pt-2 border-t border-gray-100">
                  {summary.voidedCount} voided sale{summary.voidedCount !== 1 ? "s" : ""} ({formatPrice(summary.voidedTotal)}) — excluded
                </p>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setMovement(true)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 transition"
                >
                  Cash in / out
                </button>
                <button
                  onClick={() => setClosing(true)}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition"
                >
                  Close shift
                </button>
              </div>
            </div>

            {summary.movements.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Cash movements</p>
                <div className="divide-y divide-gray-50">
                  {summary.movements.map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 truncate">{m.reason}</p>
                        <p className="text-xs text-gray-400">{shortDate(m.created_at)}</p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ml-2 ${m.type === MOVEMENT.IN ? "text-green-700" : "text-red-600"}`}>
                        {m.type === MOVEMENT.IN ? "+" : "−"} {formatPrice(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Past shifts */}
        {!loading && history.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Past shifts</p>
            <div className="divide-y divide-gray-50">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {h.staff_name ?? "Staff"} · {h.business_date}
                    </p>
                    <p className="text-xs text-gray-400">
                      counted {formatPrice(h.counted_cash ?? 0)} of {formatPrice(h.expected_cash ?? 0)}
                      {h.note ? ` · ${h.note}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 ml-2 text-[11px] font-bold px-2 py-1 rounded-full ${
                      h.balanced
                        ? "bg-green-100 text-green-700"
                        : (h.difference ?? 0) < 0
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {h.balanced
                      ? "Balanced"
                      : `${(h.difference ?? 0) < 0 ? "Short" : "Over"} ${formatPrice(Math.abs(h.difference ?? 0))}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {movement && shift && (
        <MovementModal
          shift={shift}
          staffId={currentStaff?.id}
          onClose={() => setMovement(false)}
          onSaved={() => { setMovement(false); load(); }}
        />
      )}

      {closing && shift && summary && (
        <CloseShiftModal
          shift={shift}
          summary={summary}
          onClose={() => setClosing(false)}
          onClosed={() => { setClosing(false); load(); }}
        />
      )}
    </div>
  );
}
