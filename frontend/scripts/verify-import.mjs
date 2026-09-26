/**
 * Importing a spreadsheet from another POS.
 *
 *   npm run dev              # one terminal
 *   npm run verify:import    # another
 *
 * Runs the real parsing and the real cart guard, then checks the two things that
 * decide whether a migrated shop can trade: does every product arrive, and is
 * every price either right or visibly absent.
 *
 * Give it a real export to check that instead of the fixture:
 *
 *   node scripts/verify-import.mjs "C:/path/to/Stock.xlsx"
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const realFile = process.argv[2];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ── an Aronium stock report, as CSV (same detection path as the xlsx) ───────
const ARONIUM_CSV = [
  "#,Code,Product group,Product,Qty.,UOM,Cost price,Cost bef. tax,Cost incl. tax,Total before tax,Total",
  // 49 @ 20 — a normal priced row, with the leading space Aronium puts on names
  '1,1287,(none)," DOWNY FRESH SCENT SUNRISE FRESH 20 ML",49,,0.00,0.00,0.00,980.00,980.00',
  // 18 @ 190
  "2,1265,(none),AJAB MAIZE MEAL 2KG,18,,0.00,0.00,0.00,3420.00,3420.00",
  // zero stock, so no price can be known
  "3,1312,(none),MINUTE MAID TROPICAL FRUIT DRINK 400ML,0,,0.00,0.00,0.00,0.00,0.00",
  // the name is a barcode: a product never given one
  "4,1314,(none),6034000119022,0,,0.00,0.00,0.00,0.00,0.00",
  // a cost that IS recorded, and a category
  "5,1400,Grains,PEMBE MAIZE MEAL 2KG,10,,150.00,150.00,152.00,1900.00,1900.00",
  // a price that does not divide evenly: 3 @ 33.333...
  "6,1401,(none),ODD DIVISION ITEM,3,,0.00,0.00,0.00,100.00,100.00",
  // no name at all — must be skipped, not imported blank
  "7,1402,(none),,5,,0.00,0.00,0.00,250.00,250.00",
].join("\n");

// A generic export, to prove the Aronium path did not break the normal one.
const GENERIC_CSV = [
  "name,barcode,price,cost,stock,category",
  "Sugar 1kg,6001234567890,175,140,25,Sugar",
  "Cooking Oil 1L,6009876543210,320,260,12,Oils",
].join("\n");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);

// The same function the import screen calls - read the file, detect the layout,
// map the rows - so what is tested here is what runs in the app.
async function parse(bytes, name) {
  return page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const file = new File([buf], name);

    const { parseImportFile } = await import("/src/utils/productImport.js");
    return parseImportFile(file);
  }, { b64: Buffer.from(bytes).toString("base64"), name });
}

// ── the Aronium layout ──────────────────────────────────────────────────────
const aronium = await parse(ARONIUM_CSV, "Stock.csv");
if (aronium.error) {
  console.error("parse failed:", aronium.error);
  await browser.close();
  process.exit(1);
}

console.log("\n── it recognises where the file came from ──");
check("the layout is detected as an Aronium stock report", aronium.layout === "aronium",
  aronium.layout);
check("six products import and the nameless row is skipped",
  aronium.products.length === 6 && aronium.skipped === 1,
  `${aronium.products.length} products, ${aronium.skipped} skipped`);

const by = (name) => aronium.products.find((p) => p.name === name);

console.log("\n── the price is derived from the stock value ──");
check("49 units worth 980 means 20 each",
  by("DOWNY FRESH SCENT SUNRISE FRESH 20 ML")?.price === 20,
  String(by("DOWNY FRESH SCENT SUNRISE FRESH 20 ML")?.price));
check("18 units worth 3420 means 190 each",
  by("AJAB MAIZE MEAL 2KG")?.price === 190, String(by("AJAB MAIZE MEAL 2KG")?.price));
check("a price that does not divide evenly is rounded to the cent",
  by("ODD DIVISION ITEM")?.price === 33.33, String(by("ODD DIVISION ITEM")?.price));
check("the leading space Aronium adds to names is trimmed",
  Boolean(by("DOWNY FRESH SCENT SUNRISE FRESH 20 ML")));

console.log("\n── what it refuses to invent ──");
check("a zero-stock row gets no price rather than a made-up one",
  by("MINUTE MAID TROPICAL FRUIT DRINK 400ML")?.price === 0,
  String(by("MINUTE MAID TROPICAL FRUIT DRINK 400ML")?.price));
check("and is counted as needing one", aronium.unpriced === 2, `${aronium.unpriced}`);
check("a cost of zero is stored as no cost, not as free",
  by("AJAB MAIZE MEAL 2KG")?.cost_price === null,
  String(by("AJAB MAIZE MEAL 2KG")?.cost_price));
check("a cost that IS recorded comes through, tax included",
  by("PEMBE MAIZE MEAL 2KG")?.cost_price === 152,
  String(by("PEMBE MAIZE MEAL 2KG")?.cost_price));

console.log("\n── the Code column is not a barcode ──");
check("no product takes its barcode from Aronium's row numbering",
  aronium.products.every((p) => !["1287", "1265", "1312", "1314", "1400", "1401"].includes(p.barcode)),
  aronium.products.map((p) => p.barcode).join(", "));
check("a name that IS a barcode becomes the barcode",
  by("6034000119022")?.barcode === "6034000119022", String(by("6034000119022")?.barcode));
check("a normal name leaves the barcode empty",
  by("AJAB MAIZE MEAL 2KG")?.barcode === null, String(by("AJAB MAIZE MEAL 2KG")?.barcode));

console.log("\n── categories ──");
check("(none) becomes Other rather than a category called '(none)'",
  by("AJAB MAIZE MEAL 2KG")?.category === "Other", by("AJAB MAIZE MEAL 2KG")?.category);
check("a real product group is kept", by("PEMBE MAIZE MEAL 2KG")?.category === "Grains",
  by("PEMBE MAIZE MEAL 2KG")?.category);

// ── the ordinary layout still works ─────────────────────────────────────────
const generic = await parse(GENERIC_CSV, "products.csv");
console.log("\n── the generic mapping is untouched ──");
check("a normal export is not mistaken for an Aronium one", generic.layout === "generic",
  generic.layout);
check("its columns still map", generic.products.length === 2
  && generic.products[0].price === 175 && generic.products[0].barcode === "6001234567890",
  JSON.stringify(generic.products[0]));

// ── the guard that stops a zero-price sale ──────────────────────────────────
console.log("\n── the till refuses to sell an unpriced product ──");
const guard = await page.evaluate(async () => {
  const { useCartStore } = await import("/src/store/cartStore.js");
  const store = useCartStore.getState();
  store.clearCart?.();
  const priced = store.addItem({ id: 9001, name: "Priced", price: 20, stock: 5 });
  const afterPriced = useCartStore.getState().items.length;
  const unpriced = store.addItem({ id: 9002, name: "Unpriced", price: 0, stock: 5 });
  const afterUnpriced = useCartStore.getState().items.length;
  const missing = store.addItem({ id: 9003, name: "No price field", stock: 5 });
  useCartStore.getState().clearCart?.();
  return { priced, afterPriced, unpriced, afterUnpriced, missing };
});
check("a priced product goes in", guard.priced?.ok === true && guard.afterPriced === 1,
  JSON.stringify(guard.priced));
check("a zero-priced product is refused, with a reason",
  guard.unpriced?.ok === false && guard.unpriced?.reason === "no-price",
  JSON.stringify(guard.unpriced));
check("and does not reach the cart", guard.afterUnpriced === 1, `${guard.afterUnpriced} items`);
check("a product with no price field at all is refused too",
  guard.missing?.ok === false, JSON.stringify(guard.missing));

// ── the real file ───────────────────────────────────────────────────────────
if (realFile) {
  console.log(`\n── the real export (${realFile}) ──`);
  if (!existsSync(realFile)) {
    check("the file exists", false, realFile);
  } else {
    const live = await parse(readFileSync(realFile), "Stock.xlsx");
    if (live.error) {
      check("it parses", false, live.error);
    } else {
      check("it is read as an Aronium stock report", live.layout === "aronium", live.layout);
      check("every row with a name becomes a product", live.products.length > 1000,
        `${live.products.length} products, ${live.skipped} skipped`);
      const priced = live.products.filter((p) => p.price > 0);
      check("the priced ones are the ones that had stock",
        priced.length > 0 && priced.every((p) => p.stock > 0),
        `${priced.length} priced, ${live.unpriced} not`);
      check("no price is negative or absurd",
        live.products.every((p) => p.price >= 0 && p.price < 1_000_000));
      check("no barcode is one of Aronium's short internal codes",
        live.products.every((p) => !p.barcode || /^\d{8,14}$/.test(p.barcode)),
        live.products.filter((p) => p.barcode).slice(0, 3).map((p) => p.barcode).join(", "));
      const total = priced.reduce((sum, p) => sum + p.price * p.stock, 0);
      console.log(`      stock value implied by the imported prices: KES ${total.toLocaleString()}`);
      console.log(`      e.g. ${priced[0].name} — ${priced[0].stock} @ ${priced[0].price}`);
    }
  }
}

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All import checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
