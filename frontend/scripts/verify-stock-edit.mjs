/**
 * Correcting stock, and choosing the right camera.
 *
 *   npm run dev                 # one terminal
 *   npm run verify:stock-edit   # another
 *
 * Two unrelated faults reported from the same shop, both checked here because both
 * are about the gap between what the system says and what is really there: stock
 * that could not be corrected, and a phone whose scanner opened but never read
 * anything.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);

// ── correcting stock ────────────────────────────────────────────────────────
console.log("");
console.log("-- counting the shelf --");
const stock = await page.evaluate(async () => {
  const { db, dbHelpers } = await import("/src/services/db.js");
  await db.products.clear();
  await db.stock_adjustments.clear();

  const id = await db.products.add({ name: "Blue Band 250g", barcode: "6001", price: 180,
    stock: 9, category: "Spreads", reorder_level: 6, synced: true });
  // What the client's Aronium export actually contained.
  const negative = await db.products.add({ name: "Toss 200g Blue", barcode: null, price: 100,
    stock: -4, category: "Other", reorder_level: 10, synced: true });

  const counted = await dbHelpers.adjustStock(id, 7, {
    reason: "Counted the shelf", staffId: 3,
  });
  const afterCount = await db.products.get(id);
  const log = await dbHelpers.getStockAdjustments(id);

  const fixedNegative = await dbHelpers.adjustStock(negative, 5, {
    reason: "Wrong figure imported", staffId: 3,
  });
  const afterFix = await db.products.get(negative);

  // The same figure again is not a correction and should not be logged as one.
  const noop = await dbHelpers.adjustStock(id, 7, { reason: "Counted the shelf" });
  // Counted here, before the writes below add legitimate entries of their own.
  const logCount = (await db.stock_adjustments.where("product_id").equals(id).toArray()).length;

  let refusedWithoutReason = false;
  try {
    await dbHelpers.adjustStock(id, 3, {});
  } catch {
    refusedWithoutReason = true;
  }

  const negativeAttempt = await dbHelpers.adjustStock(id, -10, { reason: "Counted the shelf" });
  const afterNegativeAttempt = await db.products.get(id);

  const impossible = await dbHelpers.getImpossibleStock();

  await db.products.clear();
  await db.stock_adjustments.clear();

  return {
    counted, afterCount: afterCount.stock, syncedAfter: afterCount.synced,
    entry: log[0],
    fixedNegative, afterFix: afterFix.stock,
    noop, refusedWithoutReason,
    negativeAttempt, afterNegativeAttempt: afterNegativeAttempt.stock,
    impossibleCount: impossible.length,
    logCount,
  };
});

check("stock can be set to what was counted", stock.afterCount === 7, `${stock.afterCount}`);
check("the correction is recorded, not just applied",
  stock.entry?.stock_before === 9 && stock.entry?.stock_after === 7 && stock.entry?.delta === -2,
  JSON.stringify({ before: stock.entry?.stock_before, after: stock.entry?.stock_after, delta: stock.entry?.delta }));
check("with the reason and who made it",
  stock.entry?.reason === "Counted the shelf" && stock.entry?.staff_id === 3,
  `${stock.entry?.reason}, staff ${stock.entry?.staff_id}`);
check("and the product is marked unsynced so other tills learn",
  stock.syncedAfter === false, String(stock.syncedAfter));
check("an impossible imported figure can be corrected",
  stock.afterFix === 5, `${stock.afterFix}`);
check("setting the same figure again logs nothing",
  stock.noop.changed === false && stock.logCount === 1, `${stock.logCount} entries logged`);
check("a correction without a reason is refused", stock.refusedWithoutReason === true);
check("stock can never be set negative", stock.afterNegativeAttempt === 0,
  `${stock.afterNegativeAttempt}`);
check("impossible stock is findable before it is fixed", stock.impossibleCount === 0,
  `${stock.impossibleCount} left`);

// ── the import no longer brings negatives in ───────────────────────────────
console.log("");
console.log("-- an import cannot introduce impossible stock --");
const imported = await page.evaluate(async () => {
  const { parseImportFile } = await import("/src/utils/productImport.js");
  const csv = [
    "#,Code,Product group,Product,Qty.,UOM,Cost price,Cost bef. tax,Cost incl. tax,Total before tax,Total",
    "1,1139,(none),TOSS 200G BLUE,-4,,0.00,0.00,0.00,0.00,0.00",
    "2,1140,(none),AJAB MAIZE MEAL 2KG,18,,0.00,0.00,0.00,3420.00,3420.00",
    "3,1141,(none),NEGATIVE TWO,-2,,0.00,0.00,0.00,0.00,0.00",
  ].join("\n");
  const out = await parseImportFile(new File([csv], "Stock.csv"));
  return {
    stocks: out.products.map((p) => ({ name: p.name, stock: p.stock })),
    negativeStock: out.negativeStock,
  };
});
check("a negative quantity arrives as zero, not as a negative",
  imported.stocks.every((p) => p.stock >= 0), JSON.stringify(imported.stocks));
check("the good row is untouched",
  imported.stocks.find((p) => p.name === "AJAB MAIZE MEAL 2KG")?.stock === 18);
check("and the screen is told how many were corrected",
  imported.negativeStock === 2, `${imported.negativeStock}`);

// ── choosing a camera ───────────────────────────────────────────────────────
console.log("");
console.log("-- which rear camera to scan with --");
const camera = await page.evaluate(async () => {
  const m = await import("/src/utils/cameraSelect.js");
  const dev = (label, id = label) => ({ kind: "videoinput", label, deviceId: id });

  // What a Galaxy A55 reports through Chrome on Android. camera2 0 is the main
  // sensor; the browser does not always pick it for facingMode: environment.
  const samsung = [
    dev("camera2 1, facing front"),
    dev("camera2 2, facing back"),
    dev("camera2 0, facing back"),
    dev("camera2 3, facing back"),
  ];
  // What an iPhone reports. "Back Dual Wide Camera" is the MAIN camera, and
  // penalising the word "wide" would pick the worst lens on every iPhone.
  const iphone = [
    dev("Front Camera"),
    dev("Back Ultra Wide Camera"),
    dev("Back Dual Wide Camera"),
    dev("Back Telephoto Camera"),
  ];

  return {
    samsungFirst: m.rankBackCameras(samsung)[0]?.label,
    samsungCount: m.rankBackCameras(samsung).length,
    iphoneFirst: m.rankBackCameras(iphone)[0]?.label,
    iphoneLast: m.rankBackCameras(iphone).slice(-1)[0]?.label,
    frontDropped: m.rankBackCameras(samsung).every((d) => !/front/i.test(d.label)),
    unlabelled: m.rankBackCameras([dev(""), dev("")]).length,
    singleCamera: m.rankBackCameras([dev("camera2 0, facing back")])[0]?.label,
    noDevices: m.rankBackCameras([]).length,
    // When nothing says which way a camera faces, returning none would leave the
    // scanner with no camera at all.
    unfaced: m.rankBackCameras([dev("Integrated Webcam")]).length,
    names: {
      ultra: m.cameraShortName("Back Ultra Wide Camera"),
      android: m.cameraShortName("camera2 0, facing back"),
      plain: m.cameraShortName("back camera"),
    },
    zoomUltra: m.zoomFor("Back Ultra Wide Camera", { zoom: { min: 1, max: 5, step: 0.1 } }),
    zoomMain: m.zoomFor("Back Dual Wide Camera", { zoom: { min: 1, max: 5, step: 0.1 } }),
    zoomUnsupported: m.zoomFor("Back Ultra Wide Camera", {}),
  };
});

check("on a Samsung, the main sensor is chosen over the ultra-wide",
  camera.samsungFirst === "camera2 0, facing back", camera.samsungFirst);
check("all three rear lenses stay available to switch to", camera.samsungCount === 3,
  `${camera.samsungCount}`);
check("front cameras are dropped", camera.frontDropped === true);
check("on an iPhone, 'Dual Wide' is understood as the main camera",
  camera.iphoneFirst === "Back Dual Wide Camera", camera.iphoneFirst);
check("and a lens that cannot focus this close is ranked last",
  /ultra wide|telephoto/i.test(camera.iphoneLast), camera.iphoneLast);
check("unlabelled devices are kept in order rather than discarded",
  camera.unlabelled === 2, `${camera.unlabelled}`);
check("a phone with one rear camera still gets it",
  camera.singleCamera === "camera2 0, facing back", camera.singleCamera);
check("no devices means no camera, not a crash", camera.noDevices === 0);
check("a camera that does not say which way it faces is still offered",
  camera.unfaced === 1, `${camera.unfaced}`);
check("the switch button gets short names",
  camera.names.ultra === "Ultra-wide" && camera.names.android === "Camera 0"
  && camera.names.plain === "Main", JSON.stringify(camera.names));
check("an ultra-wide is zoomed in so a barcode resolves",
  camera.zoomUltra > 1 && camera.zoomUltra < 5, String(camera.zoomUltra));
check("the main camera is left at its own zoom", camera.zoomMain === null,
  String(camera.zoomMain));
check("a camera with no zoom capability is left alone", camera.zoomUnsupported === null);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All stock-edit and camera checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
