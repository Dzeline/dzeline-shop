/**
 * Showing a product name on a phone without losing what it means.
 *
 * A shop's names are long and share a long prefix: GRACIES YOGHURT STRAWBERRY
 * 250ML and GRACIES YOGHURT STRAWBERRY 500ML differ in their last five
 * characters. A card two lines tall truncates the end, so both read "GRACIES
 * YOGHURT STRAWBERRY…" - identical, and the cashier has to fall back on the
 * barcode. When the product has no barcode, which is most of a small shop's
 * catalogue, there is nothing left to go on.
 *
 * So the size is pulled off the end and shown separately, where it is never
 * truncated. The name gets shorter at the same time, so more of what is left
 * fits.
 */

// A trailing size: 250ML, 2 KG, 1L, 500 g, 20PCS, x12, 6 PACK.
//
// Anchored to the end because that is where a size goes, and matching one in the
// middle of a name would cut the name in half. Written as one alternation rather
// than a loose \d+\w+ so that a name ending in a flavour or a year is left alone.
const TRAILING_SIZE = new RegExp(
  "[\\s,\\-–(]*" +
  "(" +
    "(?:x\\s*\\d+(?:\\.\\d+)?)" +                                  // x12
    "|" +
    "(?:\\d+(?:\\.\\d+)?\\s*(?:" +
      // Longest spelling of each unit first: the alternation stops at its first
      // match, so a bare "l" listed before "litres" would take the "l" and leave
      // "itres" behind - and "1L" needs that bare "l" to be there at all.
      "millilitres?|milliliters?|litres?|liters?|ltrs?|lts?|ml|cl|l" +
      "|kilograms?|kgs?|grams?|gms?|g" +
      "|pieces?|pcs?|packets?|pkts?|packs?|bottles?|sachets?|rolls?|tins?|bars?" +
      "|mm|cm" +
    "))" +
  ")" +
  "[\\s.)\\]]*$",
  "i",
);

/**
 * Split a name into the part that describes the product and the part that
 * distinguishes one size of it from another.
 *
 * Returns `{ base, variant }`; `variant` is null when the name has no size in it,
 * in which case `base` is the whole name.
 */
export function splitVariant(name) {
  const text = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { base: "", variant: null };

  const match = text.match(TRAILING_SIZE);
  if (!match) return { base: text, variant: null };

  const base = text.slice(0, match.index).replace(/[\s,\-–(]+$/, "").trim();
  // A name that is nothing but a size - "500ML" - keeps it as the name, because
  // removing it would leave nothing to show.
  if (!base) return { base: text, variant: null };

  return { base, variant: tidyVariant(match[1]) };
}

/**
 * The size, written the way a shelf label writes it: no space, upper case, so
 * "250 ml" and "250ML" look the same on the card and can be compared at a glance.
 */
function tidyVariant(variant) {
  return String(variant)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.$/, "")
    .toUpperCase();
}

/**
 * Both halves, ready to render.
 *
 * `title` is the full original name, for the element's tooltip and for anything
 * that can show it in full - a truncated name should still be readable by holding
 * or hovering it.
 */
export function displayName(name) {
  const { base, variant } = splitVariant(name);
  return { base, variant, title: String(name ?? "").trim() };
}
