/**
 * Selling-price suggestion for stock activation.
 *
 * Margin is taken on the CASH OUTLAY — the unit cost exactly as it appears on
 * the supplier's invoice, VAT and all — against the VAT-inclusive shelf price.
 * That is the shopkeeper's own model ("I paid 152, I want a quarter on it"),
 * and it is the same basis the Finance tab already reports on:
 *
 *   getFinancialSummary: profit = item.subtotal - qty * cost_price
 *                        margin = profit / revenue      (both VAT-inclusive)
 *
 * Netting the price down before comparing would make this screen quote a
 * different margin than Finance quotes for the very same sale.
 *
 *   shelf price = cost / (1 - target_margin)     rounded UP to the nearest 5
 *
 * VAT is still extracted for the receipt and KRA, so the VAT inside a price is
 * shown alongside it — but it is not part of the margin calculation, and no
 * "does this cost include VAT?" question needs asking: whatever was paid is
 * the cost.
 */

// Kenyan retail prices are round. An exact 202.67 reads as a mistake.
const DEFAULT_ROUNDING = 5;

export const DEFAULT_TARGET_MARGIN = 0.25;

/**
 * Round up to the nearest `step`, so rounding never eats into the margin.
 *
 * The epsilon is not decoration: 700 / (1 - 0.3) is 1000.0000000000001 in
 * binary floating point, and a bare Math.ceil turns that into a whole extra
 * step (1005). Prices that land exactly on a step must stay on it.
 */
const EPSILON = 1e-9;

export function roundPrice(value, step = DEFAULT_ROUNDING) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || step <= 0) return Math.round(value * 100) / 100;
  return Math.ceil(value / step - EPSILON) * step;
}

/**
 * @param cost         unit cost as entered from the invoice (VAT included)
 * @param targetMargin fraction, e.g. 0.25 for 25%
 * @param vatRate      fraction — used only to report the VAT inside the price
 * @param vatEnabled   whether this shop charges VAT at all
 * @param rounding     round the shelf price up to this step (0 disables)
 */
export function suggestSellingPrice({
  cost,
  targetMargin = DEFAULT_TARGET_MARGIN,
  vatRate = 0.16,
  vatEnabled = true,
  rounding = DEFAULT_ROUNDING,
}) {
  const rawCost = Number(cost);
  if (!Number.isFinite(rawCost) || rawCost <= 0) return null;

  // A margin of 1 (100%) would divide by zero, and anything above it is
  // nonsense — clamp rather than emit Infinity into a price field.
  const margin = Math.min(Math.max(Number(targetMargin) || 0, 0), 0.95);
  const price = roundPrice(rawCost / (1 - margin), rounding);

  return { price, ...describePrice({ price, cost: rawCost, vatRate, vatEnabled }) };
}

/**
 * What a price the manager actually typed really means.
 *
 * Shown live beside the input so a hand-entered price is as legible as a
 * suggested one — the point is to inform the decision, not to take it away.
 */
export function describePrice({ price, cost, vatRate = 0.16, vatEnabled = true }) {
  const rate = vatEnabled ? vatRate : 0;
  const shelf = Number(price);
  const rawCost = Number(cost);
  if (!Number.isFinite(shelf) || shelf <= 0) return null;

  const netPrice = shelf / (1 + rate);
  const vatAmount = shelf - netPrice;

  const hasCost = Number.isFinite(rawCost) && rawCost > 0;
  const profit = hasCost ? shelf - rawCost : null;
  const margin = hasCost ? (profit / shelf) * 100 : null;
  const markup = hasCost ? (profit / rawCost) * 100 : null;

  return { netPrice, vatAmount, netCost: hasCost ? rawCost : null, profit, margin, markup };
}

/** Margin bands, matching the colour language already used in Finance. */
export function marginBand(pct) {
  if (pct === null || !Number.isFinite(pct)) return "unknown";
  if (pct < 0) return "loss";
  if (pct < 15) return "thin";
  if (pct < 30) return "ok";
  return "healthy";
}
