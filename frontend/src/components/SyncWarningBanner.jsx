import { useEffect, useState } from "react";
import { syncService } from "../services/sync";

function howLong(ms) {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return days === 1 ? "a day" : `${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return hours === 1 ? "an hour" : `${hours} hours`;
  return "a few minutes";
}

/**
 * Says when this device's sales exist in only one place.
 *
 * The offline banner next to this one explains that sales are saved locally and
 * will sync on reconnect, which is true and reassuring and says nothing about
 * whether that ever happened. A phone that has been quietly failing to sync for
 * a week looks exactly like one that synced a minute ago.
 *
 * Nobody checks before losing a phone, so it has to be said unprompted — and
 * only when it is worth saying, or it becomes wallpaper.
 */
export default function SyncWarningBanner() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      syncService.getSyncFreshness()
        .then((f) => { if (alive) setState(f); })
        .catch(() => {});
    };
    read();
    // A minute is often enough: this crosses a threshold at most once a day.
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!state?.connected || !state.stale) return null;

  return (
    <div className="shrink-0 bg-red-600 text-white px-4 py-1.5 flex items-center gap-2 text-xs font-semibold">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <span>
        {state.neverSynced
          ? "Never backed up — everything on this device exists nowhere else"
          : `Not backed up for ${howLong(state.ageMs)} — take a backup from Settings`}
      </span>
    </div>
  );
}
