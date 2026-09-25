/**
 * Camera scanner: decode cost and the fast/thorough split.
 *
 *   npm run dev              # one terminal
 *   npm run verify:scanner   # another
 *
 * Measures what a failed decode costs at the settings the app actually uses,
 * because "scanning is slow" is a number, not an opinion — and a regression
 * here is invisible until someone is standing at a till with a queue.
 *
 * Runs the camera with Chromium's fake device, which proves the loop starts and
 * survives, but cannot prove a real barcode reads. That still needs a phone.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["camera"],
});
// Offline. The suspended backend's failed sync calls would otherwise land in
// the console-error capture below and be mistaken for scanner faults.
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);

// ── the pure tuning rules ──────────────────────────────────────────────────
console.log("\n── tuning rules ──");
const tuning = await page.evaluate(async () => {
  const m = await import("/src/utils/scanTuning.js");
  const r = m.cropRect(1920, 1080);
  return {
    crop: r,
    nullOnNoVideo: m.cropRect(0, 0),
    centredX: r.x === Math.round((1920 - r.width) / 2),
    centredY: r.y === Math.round((1080 - r.height) / 2),
    notHardEarly: m.shouldTryHard(500, 0, 0),
    // gaps expressed relative to the real limits, not hard-coded
    hardOnFirstNeed: m.shouldTryHard(m.TRY_HARD_AFTER_MS + 100, 0, 0),
    hardAfterGap: m.shouldTryHard(m.TRY_HARD_EVERY_MS + 1000, 0, 0),
    notHardTwiceQuickly: m.shouldTryHard(5000, 0, 5000 - m.TRY_HARD_EVERY_MS + 200),
    hardAgainLater: m.shouldTryHard(9000, 0, 9000 - m.TRY_HARD_EVERY_MS - 200),
    TRY_HARD_AFTER_MS: m.TRY_HARD_AFTER_MS,
    TRY_HARD_EVERY_MS: m.TRY_HARD_EVERY_MS,
  };
});

check("crop is a centred window, not the whole frame",
  tuning.crop.width < 1920 && tuning.crop.height < 1080,
  `${tuning.crop.width}x${tuning.crop.height} of 1920x1080`);
check("crop is centred horizontally", tuning.centredX);
check("crop is centred vertically", tuning.centredY);
check("no video yet -> no crop", tuning.nullOnNoVideo === null);
check("the fast path gets a clear run first", tuning.notHardEarly === false);
check("a thorough pass follows if nothing reads", tuning.hardAfterGap === true);
check("the first hard pass is not itself rate-limited away", tuning.hardOnFirstNeed === true);
check("thorough passes are rate-limited", tuning.notHardTwiceQuickly === false);
check("...but do recur", tuning.hardAgainLater === true);

// ── what a failed decode costs ─────────────────────────────────────────────
console.log("\n── decode cost (failed frame — the case that dominates) ──");
const perf = await page.evaluate(async () => {
  const { BrowserMultiFormatReader } = await import("/node_modules/@zxing/browser/esm/index.js");
  const { BarcodeFormat, DecodeHintType } = await import("/node_modules/@zxing/library/esm/index.js");
  const { cropRect } = await import("/src/utils/scanTuning.js");

  const FORMATS = [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
  ];

  function noisy(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = "#000";
    for (let x = 0; x < w; x += 11) ctx.fillRect(x, h * 0.4, 4, h * 0.2);
    return c;
  }

  function time(reader, canvas, runs) {
    for (let i = 0; i < 3; i++) { try { reader.decodeFromCanvas(canvas); } catch { /* expected */ } }
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) { try { reader.decodeFromCanvas(canvas); } catch { /* expected */ } }
    return (performance.now() - t0) / runs;
  }

  const fastHints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]);
  const hardHints = new Map(fastHints);
  hardHints.set(DecodeHintType.TRY_HARDER, true);

  const r = cropRect(1920, 1080);
  const full = noisy(1920, 1080);
  const crop = noisy(r.width, r.height);

  return {
    before: +time(new BrowserMultiFormatReader(hardHints), full, 10).toFixed(1),
    after: +time(new BrowserMultiFormatReader(fastHints), crop, 10).toFixed(1),
    fallback: +time(new BrowserMultiFormatReader(hardHints), crop, 10).toFixed(1),
  };
});

const fps = (ms) => (1000 / ms).toFixed(1);
console.log(`     was (full frame + TRY_HARDER every frame): ${perf.before} ms  (${fps(perf.before)} fps)`);
console.log(`     now (cropped, fast path):                  ${perf.after} ms  (${fps(perf.after)} fps)`);
console.log(`     thorough fallback pass:                    ${perf.fallback} ms  (${fps(perf.fallback)} fps)`);
console.log(`     speed-up on the common frame: ${(perf.before / perf.after).toFixed(1)}x\n`);

// A floor, not a target. The exact number moves with the machine, and a phone
// will be slower than this desktop — the ratio below is the honest measure.
check("the fast path clears 10 frames a second", 1000 / perf.after >= 10, `${fps(perf.after)} fps`);
check("the fast path is a big win over the old loop", perf.before / perf.after >= 4,
  `${(perf.before / perf.after).toFixed(1)}x`);
// Cropping barely helps the thorough pass — TRY_HARDER's cost is rotations and
// binarization attempts, not pixel area — so the fallback costs roughly what
// every frame used to. That is fine, and it is the point: it is now occasional
// instead of constant.
check("the thorough pass costs no more than the old per-frame cost",
  perf.fallback <= perf.before * 1.15,
  `${perf.fallback} vs ${perf.before} ms`);

// What actually changed: the average cost of a second of hunting for a barcode.
const THOROUGH_PER_SEC = 1000 / tuning.TRY_HARD_EVERY_MS; // the real rate limit
const oldPerSec = 1000 / perf.before;                       // every frame thorough
const newFastFrames = (1000 - THOROUGH_PER_SEC * perf.fallback) / perf.after;
console.log(
  `     in one second of hunting: was ~${oldPerSec.toFixed(1)} looks at the barcode, ` +
  `now ~${(newFastFrames + THOROUGH_PER_SEC).toFixed(1)}
`,
);
check("the thorough pass cannot dominate the loop",
  THOROUGH_PER_SEC * perf.fallback < 400,
  `${(THOROUGH_PER_SEC * perf.fallback).toFixed(0)}ms of every 1000ms`);
check("many more looks at the barcode per second",
  newFastFrames + THOROUGH_PER_SEC >= oldPerSec * 4,
  `${(newFastFrames + THOROUGH_PER_SEC).toFixed(1)} vs ${oldPerSec.toFixed(1)} per second`);

// ── the loop actually runs ─────────────────────────────────────────────────
console.log("\n── the scanner starts ──");
await page.evaluate(async () => {
  const r2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await r2p(indexedDB.open("DzelineShop"));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234"));
  const pin = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tx = db.transaction(["settings", "staff", "products"], "readwrite");
  const put = (s, v) => r2p(tx.objectStore(s).put(v));
  await put("settings", { key: "setup_complete", value: "true" });
  await put("settings", { key: "shop_name", value: "Demo Shop" });
  await put("staff", { id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now() });
  await put("products", {
    id: 1, barcode: "6000000000001", name: "Maize Flour 2kg", price: 195, cost_price: 150,
    stock: 20, category: "Grains", reorder_level: 10, active: true, updated_at: Date.now(),
  });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);
await page.click("text=Admin");
await page.waitForTimeout(400);
for (const d of "1234") { await page.keyboard.press(d); await page.waitForTimeout(90); }
await page.waitForTimeout(900);

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.click("button[title='Scan barcode']");
await page.waitForTimeout(3000);

check("the camera view opens", await page.isVisible("text=Keep scanning"));
const videoLive = await page.evaluate(() => {
  const v = document.querySelector("video");
  return !!v && v.readyState >= 2 && v.videoWidth > 0;
});
check("a live video stream is attached", videoLive);
check("the loop runs without throwing", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "scripts/screenshots/scanner.png" });

// Closing must release the camera — a stream left running drains the battery
// and holds the device busy for every other app.
await page.click("text=Done");
await page.waitForTimeout(800);
const released = await page.evaluate(() => !document.querySelector("video"));
check("closing releases the camera", released);

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All scanner checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
