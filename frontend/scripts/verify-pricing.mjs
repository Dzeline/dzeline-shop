/**
 * Tests the selling-price suggestion.
 *
 *   npm run verify:pricing
 *
 * Pure arithmetic, so it needs no browser. Worth its own test because the
 * margin here has to agree with the one the Finance tab reports for the same
 * sale — if the two screens ever quote different percentages for one product,
 * nobody trusts either.
 */
import { suggestSellingPrice, describePrice, roundPrice } from "../src/utils/pricing.js";

let failed = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok =
    typeof expected === "number"
      ? Math.abs(actual - expected) <= tolerance
      : actual === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `  (expected ${expected}, got ${actual})`}`,
  );
}

console.log("\nsuggestSellingPrice — margin on the cash outlay\n");

// The invoice says 152 (VAT included, as the shop reads it). A quarter of the
// shelf price: 152 / 0.75 = 202.67 -> rounds up to 205.
let s = suggestSellingPrice({ cost: 152, targetMargin: 0.25 });
check("cost 152 @ 25% -> 205", s.price, 205);
check("  margin achieved is at least the target", s.margin >= 25, true);
check("  profit is simply price minus what was paid", s.profit, 53);

s = suggestSellingPrice({ cost: 100, targetMargin: 0.25 });
check("cost 100 @ 25% -> 135", s.price, 135);

s = suggestSellingPrice({ cost: 700, targetMargin: 0.3 });
check("cost 700 @ 30% -> 1000", s.price, 1000);

s = suggestSellingPrice({ cost: 57, targetMargin: 0.25 });
check("cost 57 @ 25% -> 80", s.price, 80);

console.log("\nVAT is reported, never deducted from the margin\n");

const noVat = suggestSellingPrice({ cost: 152, targetMargin: 0.25, vatEnabled: false });
check("turning VAT off does not change the price", noVat.price, 205);

const withVat = suggestSellingPrice({ cost: 152, targetMargin: 0.25, vatEnabled: true });
check("the VAT inside that price is shown", withVat.vatAmount, 205 - 205 / 1.16);
check("both quote the same margin", withVat.margin, noVat.margin);

console.log("\nthis margin must equal the one Finance reports\n");

// Finance: profit = item.subtotal - qty * cost_price, margin = profit / revenue,
// both VAT-inclusive. Same arithmetic, so the two screens have to agree — this
// is the check that keeps them from drifting apart.
const price = 205;
const cost = 152;
const qty = 7;
const financeMargin = ((qty * price - qty * cost) / (qty * price)) * 100;
check(
  "receiving panel agrees with Finance",
  describePrice({ price, cost }).margin,
  financeMargin,
);

console.log("\ndescribePrice — what a typed price really means\n");

let d = describePrice({ price: 205, cost: 152, vatRate: 0.16 });
check("profit is price - cost", d.profit, 53);
check("margin is profit / price", d.margin, (53 / 205) * 100);
check("markup is profit / cost", d.markup, (53 / 152) * 100);
check("VAT inside a 205 price", d.vatAmount, 205 - 205 / 1.16);

d = describePrice({ price: 150, cost: 152 });
check("selling below cost is a loss", d.profit < 0, true);

d = describePrice({ price: 205, cost: 0 });
check("no cost known -> margin is null, not a fake 100%", d.margin, null);

console.log("\nedges\n");

check("zero cost -> no suggestion", suggestSellingPrice({ cost: 0 }), null);
check("negative cost -> no suggestion", suggestSellingPrice({ cost: -5 }), null);
check("non-numeric cost -> no suggestion", suggestSellingPrice({ cost: "abc" }), null);
check(
  "margin clamped below 100% (no Infinity)",
  Number.isFinite(suggestSellingPrice({ cost: 100, targetMargin: 1 }).price),
  true,
);
check("rounding goes up, never down", roundPrice(151, 5), 155);
check("rounding disabled keeps 2dp", roundPrice(202.666, 0), 202.67);
check("a price landing exactly on a step is not bumped up", roundPrice(1000, 5), 1000);
check("float drift just above a step is not bumped up", roundPrice(1000.0000000001, 5), 1000);
check("a genuine fraction above a step still rounds up", roundPrice(1000.4, 5), 1005);

console.log("\n" + (failed === 0 ? "All pricing cases pass." : `${failed} case(s) failed.`));
process.exit(failed === 0 ? 0 : 1);
