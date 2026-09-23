/**
 * Tests the selling-price suggestion.
 *
 *   npm run verify:pricing
 *
 * Pure arithmetic, so it needs no browser. Worth its own test because the
 * VAT-inclusive shelf price makes the ordering of operations easy to get
 * backwards, and a systematic 16% error in pricing is not something a shop
 * would notice quickly.
 */
import { suggestSellingPrice, describePrice, roundPrice } from "../src/utils/pricing.js";

let failed = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = typeof expected === "number"
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `  (expected ${expected}, got ${actual})`}`);
}

console.log("\nsuggestSellingPrice — VAT-exclusive cost\n");

// cost 100, 25% margin -> net 133.33 -> +16% VAT = 154.67 -> round up to 155
let s = suggestSellingPrice({ cost: 100, targetMargin: 0.25, vatRate: 0.16 });
check("cost 100 @ 25% margin, 16% VAT -> 155", s.price, 155);
check("  net price of that shelf price", s.netPrice, 133.62);
check("  margin actually achieved is at least the target", s.margin >= 25, true);

s = suggestSellingPrice({ cost: 250, targetMargin: 0.30, vatRate: 0.16 });
check("cost 250 @ 30% margin -> 415", s.price, 415);

s = suggestSellingPrice({ cost: 100, targetMargin: 0.25, vatEnabled: false });
check("VAT disabled -> no tax added (135)", s.price, 135);

console.log("\nVAT-inclusive cost — the supplier invoice already has tax in it\n");

// cost 116 incl VAT == 100 net; same answer as the first case
s = suggestSellingPrice({ cost: 116, targetMargin: 0.25, vatRate: 0.16, costIncludesVat: true });
check("cost 116 incl. VAT @ 25% == cost 100 excl. VAT @ 25%", s.price, 155);
check("  net cost is stripped back to 100", s.netCost, 100);

// The trap: treating an inclusive cost as exclusive over-prices by ~16%
const wrong = suggestSellingPrice({ cost: 116, targetMargin: 0.25, vatRate: 0.16, costIncludesVat: false });
check("treating inclusive cost as exclusive prices higher (the trap)", wrong.price > s.price, true);

console.log("\ndescribePrice — what a typed price really means\n");

let d = describePrice({ price: 155, cost: 100, vatRate: 0.16 });
check("shelf 155 -> net 133.62", d.netPrice, 133.62);
check("shelf 155 -> VAT 21.38", d.vatAmount, 21.38);
check("shelf 155 on cost 100 -> ~25.2% margin", d.margin, 25.16, 0.1);

d = describePrice({ price: 100, cost: 100, vatRate: 0.16 });
check("selling at cost is a LOSS once VAT comes out", d.profit < 0, true);

d = describePrice({ price: 155, cost: 0, vatRate: 0.16 });
check("no cost known -> margin is null, not a fake 100%", d.margin, null);

console.log("\nedges\n");

check("zero cost -> no suggestion", suggestSellingPrice({ cost: 0 }), null);
check("negative cost -> no suggestion", suggestSellingPrice({ cost: -5 }), null);
check("non-numeric cost -> no suggestion", suggestSellingPrice({ cost: "abc" }), null);
check("margin clamped below 100% (no Infinity)", Number.isFinite(suggestSellingPrice({ cost: 100, targetMargin: 1 }).price), true);
check("rounding goes up, never down", roundPrice(151, 5), 155);
check("rounding disabled keeps 2dp", roundPrice(154.666, 0), 154.67);

console.log("\n" + (failed === 0 ? "All pricing cases pass." : `${failed} case(s) failed.`));
process.exit(failed === 0 ? 0 : 1);
