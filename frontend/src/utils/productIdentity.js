/**
 * When are two products the same product?
 *
 * Nothing in this system used to answer that, and duplicates arrived from three
 * directions at once: importing a file twice, two staff each adding the same item
 * on their own till, and sync then pulling each device's copy onto the other. A
 * duplicated product splits its stock in two, so the reorder alert never fires
 * and the shop runs out of something the system says it has plenty of.
 *
 * One definition, used by the importer, by sync, by the add form and by the merge
 * tool, so they cannot disagree about it.
 */

/**
 * A name reduced to what a person would consider the same name.
 *
 * Case, padding and repeated spaces are noise: Aronium's export prefixes a space,
 * staff type inconsistently, and "SUGAR  1KG" and "Sugar 1kg" are the same tin on
 * the shelf.
 */
export function normaliseName(name) {
  return String(name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * The barcode, unless it was made up.
 *
 * The add form used to fall back to `String(Date.now())` when nobody typed a
 * barcode. That is 13 digits, the length of an EAN-13, so every unbarcoded
 * product got a unique fake indistinguishable from a real one - which is exactly
 * what stops two tills ever recognising the same product.
 *
 * Detecting them is a judgement, not a fact: a millisecond timestamp passed
 * 1.5 x 10^12 in 2017 and reaches 2 x 10^12 in 2033, so a 13-digit number in that
 * range is treated as fabricated. Real retail EAN-13s begin with a GS1 country
 * prefix - 616 for Kenya, 3-9 for most imports - so the overlap is small.
 *
 * Being wrong is survivable in one direction only, which is why sameProduct()
 * below never merges two products that both carry a barcode unless the barcodes
 * agree.
 */
export function realBarcode(product) {
  const barcode = String(product?.barcode ?? "").trim();
  if (!barcode) return null;
  if (/^1[5-9]\d{11}$/.test(barcode)) return null;   // 2017-2033 in ms
  return barcode;
}

/**
 * The question this module exists to answer.
 *
 * Two barcodes that disagree mean two different products, always - that is what a
 * barcode is for, and it is the guard that keeps a mistaken guess about a
 * fabricated barcode from merging two genuinely different items.
 *
 * Otherwise the name decides, because a catalogue with almost no barcodes - the
 * normal case for these shops - has nothing else to go on, and two items with
 * exactly the same name are one item entered twice.
 */
export function sameProduct(a, b) {
  const barcodeA = realBarcode(a);
  const barcodeB = realBarcode(b);
  if (barcodeA && barcodeB) return barcodeA === barcodeB;
  const nameA = normaliseName(a?.name);
  const nameB = normaliseName(b?.name);
  return Boolean(nameA) && nameA === nameB;
}

/**
 * Every key a product could be found under.
 *
 * Both, always: a product saved without a barcode is found by name, and the same
 * product arriving later with a barcode would never find it by barcode alone.
 * These narrow the search - sameProduct() decides.
 */
export function identityKeys(product) {
  const keys = [];
  const barcode = realBarcode(product);
  if (barcode) keys.push(`barcode:${barcode}`);
  const name = normaliseName(product?.name);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/** The single key a product is filed under when only one will do. */
export function identityKey(product) {
  return identityKeys(product)[0] ?? null;
}

/**
 * Index products by every key they can be found under.
 *
 * A key can lead to several products when a catalogue already holds duplicates,
 * so each key holds a list and the caller confirms with sameProduct().
 */
export function indexByIdentity(products) {
  const index = new Map();
  for (const product of products) {
    for (const key of identityKeys(product)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(product);
    }
  }
  return index;
}

/** The product in `index` that `candidate` duplicates, or null. */
export function findMatch(index, candidate) {
  for (const key of identityKeys(candidate)) {
    for (const hit of index.get(key) ?? []) {
      if (sameProduct(hit, candidate)) return hit;
    }
  }
  return null;
}

/**
 * Groups of products that are the same product.
 *
 * For the merge tool, which shows them to a person to confirm rather than merging
 * anything by itself - so it is right for this to be slightly generous. Built by
 * walking the list and joining each product to the first group it belongs to,
 * which handles a chain where A matches B by name and B matches C by barcode.
 */
export function findDuplicateGroups(products) {
  const groups = [];
  for (const product of products) {
    const group = groups.find((g) => g.products.some((p) => sameProduct(p, product)));
    if (group) group.products.push(product);
    else groups.push({ products: [product] });
  }
  return groups
    .filter((g) => g.products.length > 1)
    .map((g) => ({
      ...g,
      key: identityKey(g.products[0]),
      // What the duplicate cost the shop: stock spread across several rows, so
      // no single one of them ever looks low enough to trigger a reorder.
      totalStock: g.products.reduce((sum, p) => sum + (p.stock ?? 0), 0),
    }))
    .sort((a, b) => b.products.length - a.products.length || b.totalStock - a.totalStock);
}
