/**
 * Tests classifySmsMatch — the check that decides whether an M-Pesa/Pochi sale
 * counts as paid. A mistake here is money, so it gets its own test.
 *
 *   node scripts/verify-sms-match.mjs
 *
 * The function is pure, so this needs no browser, no IndexedDB and no backend.
 */
import { readFileSync } from "node:fs";

// sync.js imports browser-only modules at the top, so lift just the function
// under test rather than importing the module.
const src = readFileSync(new URL("../src/services/sync.js", import.meta.url), "utf8");
const start = src.indexOf("const SMS_STALE_MS");
const end = src.indexOf("async function _withSyncGuard");
const { classifySmsMatch } = await import(
  "data:text/javascript," + encodeURIComponent(src.slice(start, end))
);

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const fresh = { amount: 250, timestamp: now - HOUR };       // 1h old
const stale = { amount: 250, timestamp: now - 12 * HOUR };  // past the 6h grace

let failed = 0;
function check(label, actual, expected) {
  const ok = actual.action === expected.action && actual.reason === expected.reason;
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"}  ${label}\n` +
    (ok ? "" : `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

console.log("classifySmsMatch\n");

check("exact amount verifies",
  classifySmsMatch(fresh, { amount: 250 }, now), { action: "verify", reason: undefined });

check("sub-cent float drift still verifies",
  classifySmsMatch({ ...fresh, amount: 250.001 }, { amount: 250 }, now), { action: "verify", reason: undefined });

check("underpayment is flagged, not verified",
  classifySmsMatch(fresh, { amount: 50 }, now), { action: "flag", reason: "amount" });

check("overpayment is flagged for a human to look at",
  classifySmsMatch(fresh, { amount: 5000 }, now), { action: "flag", reason: "amount" });

check("the old bug: a KES 50 code must not clear a KES 5000 sale",
  classifySmsMatch({ amount: 5000, timestamp: now - HOUR }, { amount: 50 }, now),
  { action: "flag", reason: "amount" });

check("no SMS yet, inside the grace period → wait",
  classifySmsMatch(fresh, null, now), { action: "wait", reason: undefined });

check("no SMS after the grace period → flag",
  classifySmsMatch(stale, null, now), { action: "flag", reason: "not_found" });

check("legacy row with no amount falls back to code-only",
  classifySmsMatch({ timestamp: now - HOUR }, { amount: 250 }, now), { action: "verify", reason: undefined });

check("SMS parsed without an amount falls back to code-only",
  classifySmsMatch(fresh, { amount: null }, now), { action: "verify", reason: undefined });

console.log(failed === 0 ? "All SMS match cases pass." : `${failed} case(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
