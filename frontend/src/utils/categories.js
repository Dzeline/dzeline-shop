// Product category picker source — merges the default starter list with
// whatever categories already exist in the catalogue (including custom ones
// typed by the shop owner), so a category typed once is selectable again
// instead of being retyped and drifting into a near-duplicate.

export const DEFAULT_CATEGORIES = [
  "Grains", "Sugar", "Dairy", "Oils", "Bakery",
  "Beverages", "Spices", "Household", "Produce", "Other",
];

export function mergeCategories(existingCategories = []) {
  const seen = new Map(); // lowercase key -> canonical display string
  for (const c of DEFAULT_CATEGORIES) seen.set(c.toLowerCase(), c);
  for (const raw of existingCategories) {
    const trimmed = (raw || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }

  const all = [...seen.values()];
  const other = all.filter((c) => c.toLowerCase() === "other");
  const rest = all
    .filter((c) => c.toLowerCase() !== "other")
    .sort((a, b) => a.localeCompare(b));
  return [...rest, ...other];
}
