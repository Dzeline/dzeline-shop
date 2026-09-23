/**
 * Selling-price suggestion for stock activation.
 *
 * Shelf prices in this app are VAT-INCLUSIVE — the price on the shelf is what
 * the customer pays, and VAT is extracted from it for the receipt and KRA
 * (see docs/ARCHITECTURE.md, "VAT"). So a suggestion has to work outwards from
 * cost through the margin and then add VAT on top, in that order:
 *
 *   net price   = cost / (1 - margin)
 *   shelf price = net price * (1 + vatRate)
 *
 * Doing it the other way round — taking a margin on the VAT-inclusive price —
 * quietly hands the taxman's share to the margin and under-prices every item.
 */

// Kenyan retail prices are round. An exact 154.67 reads as a mistake.
const DEFAULT_ROUNDING = 5;

export const DEFAULT_TARGET_MARGIN = 0.25;

/** Round up to the nearest `step`, so rounding never eats into the margin. */
export function roundPrice(value, step = DEFAULT_ROUNDING) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || step <= 0) return Math.round(value * 100) / 100;
  return Math.ceil(value / step) * step;
}

/**
 * @param cost            unit cost as entered on the delivery
 * @param targetMargin    fraction, e.g. 0.25 for 25% — margin on the net price
 * @param vatRate         fraction, e.g. 0.16
 * @param vatEnabled      whether this shop charges VAT at all
 * @param costIncludesVat true when the supplier invoice figure already has VAT
 *                        in it (common for VAT-registered suppliers). The VAT
 *                        is stripped first so margin is calculated on the real
 *                        cost rather than on cost + tax.
 * @param rounding        round the shelf price up to this step (0 disables)
 * @returns { price, netPrice, netCost, vatAmount, profit } — all rounded to
 *          the actual suggested price, so callers can show the real outcome
 *          rather than the theoretical one.
 */
export function suggestSellingPrice({
  cost,
  targetMargin = DEFAULT_TARGET_MARGIN,
  vatRate = 0.16,
  vatEnabled = true,
  costIncludesVat = false,
  rounding = DEFAULT_ROUNDING,
}) {
  const rate = vatEnabled ? vatRate : 0;
  const rawCost = Number(cost);
  if (!Number.isFinite(rawCost) || rawCost <= 0) return null;

  // A margin of 1 (100%) would divide by zero, and anything above it is
  // nonsense — clamp rather than emit Infinity into a price field.
  const margin = Math.min(Math.max(Number(targetMargin) || 0, 0), 0.95);

  const netCost = costIncludesVat ? rawCost / (1 + rate) : rawCost;
  const netPrice = netCost / (1 - margin);
  const price = roundPrice(netPrice * (1 + rate), rounding);

  return {
    price,
    ...describePrice({ price, cost: rawCost, vatRate, vatEnabled, costIncludesVat }),
  };
}

/**
 * The inverse: what a price the manager actually typed really means.
 *
 * Shown live beside the input so a hand-entered price is as legible as a
 * suggested one — the point is to inform the decision, not to take it away.
 */
export function describePrice({
  price,
  cost,
  vatRate = 0.16,
  vatEnabled = true,
  costIncludesVat = false,
}) {
  const rate = vatEnabled ? vatRate : 0;
  const shelf = Number(price);
  const rawCost = Number(cost);
  if (!Number.isFinite(shelf) || shelf <= 0) return null;

  const netPrice = shelf / (1 + rate);
  const vatAmount = shelf - netPrice;
  const netCost =
    Number.isFinite(rawCost) && rawCost > 0
      ? (costIncludesVat ? rawCost / (1 + rate) : rawCost)
      : null;

  const profit = netCost === null ? null : netPrice - netCost;
  const margin = netCost === null || netPrice <= 0 ? null : (profit / netPrice) * 100;
  const markup = netCost === null || netCost <= 0 ? null : (profit / netCost) * 100;

  return { netPrice, vatAmount, netCost, profit, margin, markup };
}

/** Margin bands, matching the colour language already used in Finance. */
export function marginBand(pct) {
  if (pct === null || !Number.isFinite(pct)) return "unknown";
  if (pct < 0) return "loss";
  if (pct < 15) return "thin";
  if (pct < 30) return "ok";
  return "healthy";
}
