/**
 * Cross-device layout check.
 *
 * Seeds a shop into IndexedDB, logs in, then walks the main panels at four
 * viewports asserting the shell swaps correctly and nothing overflows
 * horizontally. Screenshots land in scripts/screenshots/.
 *
 *   npm run dev            # in one terminal
 *   node scripts/verify-responsive.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = "scripts/screenshots";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "phone",   width: 390,  height: 844,  rail: false },
  { name: "tablet",  width: 768,  height: 1024, rail: false },
  { name: "desktop", width: 1440, height: 900,  rail: true },
  { name: "wide",    width: 1920, height: 1080, rail: true },
];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });

async function seed(page) {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    const req2p = (r) =>
      new Promise((res, rej) => {
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const db = await req2p(indexedDB.open("DzelineShop"));
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234"));
    const pin = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const tx = db.transaction(["settings", "staff", "products"], "readwrite");
    const settings = tx.objectStore("settings");
    await req2p(settings.put({ key: "setup_complete", value: "true" }));
    await req2p(settings.put({ key: "shop_name", value: "Demo Shop" }));
    await req2p(
      tx.objectStore("staff").put({
        id: 1, name: "Admin", pin, role: "admin", active: 1, created_at: Date.now(),
      }),
    );
    const names = [
      "Maize Flour 2kg", "Sugar 1kg", "Milk 500ml", "Cooking Oil 1L", "Bread",
      "Rice 5kg", "Tea Leaves 250g", "Salt 1kg", "Soap Bar", "Matches",
      "Cocoa 400g", "Beans 1kg",
    ];
    const cats = ["Grains", "Sugar", "Dairy", "Oils", "Bakery"];
    const products = tx.objectStore("products");
    for (let i = 0; i < names.length; i++) {
      await req2p(
        products.put({
          id: i + 1,
          // Deliberately no barcode and no tags on half the rows — this is the
          // shape CSV import produces, which used to break search entirely.
          barcode: i % 2 === 0 ? String(6000000000000 + i) : null,
          name: names[i],
          price: 50 + i * 35,
          stock: i === 3 ? 0 : 5 + i * 3,
          category: cats[i % cats.length],
          reorder_level: 10,
          active: true,
          updated_at: Date.now(),
        }),
      );
    }
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1200);
}

/**
 * Poll until `predicate(value)` holds, or give up.
 *
 * Used instead of a fixed sleep after the wedge-scanner keystrokes: on the
 * first viewport the dev server is still compiling on demand, so a flat 500ms
 * wait made the suite fail intermittently on a cold start — which is worse
 * than no test, because it trains you to ignore the result.
 */
async function waitFor(read, predicate, timeoutMs = 10000, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
    value = await read();
  }
  return value;
}

// The cart is persisted by zustand, so this reads what the app actually holds
// rather than what happens to be painted.
async function cartItems(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("dzeline-cart-storage");
      return raw ? JSON.parse(raw).state.items : [];
    } catch {
      return [];
    }
  });
}

// Desktop tills get a physical keyboard; phones tap the on-screen pad. Each
// viewport exercises the input method someone would actually use there.
async function login(page, { keyboard }) {
  await page.click("text=Admin");
  await page.waitForTimeout(400);
  if (keyboard) {
    for (const d of "1234") {
      await page.keyboard.press(d);
      await page.waitForTimeout(90);
    }
  } else {
    for (const d of "1234") {
      await page.click(`button:has-text("${d}")`);
      await page.waitForTimeout(90);
    }
  }
  await page.waitForTimeout(900);
}

for (const vp of VIEWPORTS) {
  console.log(`\n── ${vp.name} (${vp.width}×${vp.height}) ──`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

  // Cut the app off from the network. On a cold start it fires a full sync,
  // and against an unreachable backend (CORS failure, or the service simply
  // suspended) that is dozens of retrying fetches competing with the
  // IndexedDB reads this suite is actually measuring — which made the
  // wedge-scanner check fail intermittently on the first viewport. These are
  // offline UI tests; the app is built to work with no backend at all, so
  // blocking is both realistic and deterministic.
  await ctx.route("**/*", (route) =>
    route.request().url().startsWith(BASE) ? route.continue() : route.abort(),
  );

  const page = await ctx.newPage();
  await seed(page);

  const shot = (n) => page.screenshot({ path: `${OUT}/${vp.name}-${n}.png`, fullPage: false });

  // Login portal, before anyone signs in
  await shot("login");
  check("recovery link is present", await page.isVisible("text=Recover access"));

  await login(page, { keyboard: vp.rail });
  check(
    vp.rail ? "PIN accepts the physical number row" : "PIN accepts taps on the pad",
    await page.isVisible("input[placeholder='Search products...']"),
  );
  await shot("products");

  // Shell: rail above lg, bottom tab bar below it — never both, never neither.
  const railVisible = await page.isVisible("nav:has-text('Point of Sale')");
  const bottomNav = await page
    .locator("nav.lg\\:hidden")
    .first()
    .isVisible()
    .catch(() => false);
  check("navigation rail matches breakpoint", railVisible === vp.rail, `rail=${railVisible}`);
  check("bottom tab bar matches breakpoint", bottomNav === !vp.rail, `bottomNav=${bottomNav}`);

  // No horizontal overflow at any width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("no horizontal overflow", overflow <= 1, `${overflow}px`);

  // Search must survive being typed into and cleared without losing focus.
  const search = page.locator("input[placeholder='Search products...']");
  await search.click();
  await search.fill("mai");
  await page.waitForTimeout(600);
  const hits = await page.locator("h3").count();
  check("live search returns results", hits > 0, `${hits} cards`);
  await search.fill("");
  await page.waitForTimeout(600);
  const stillFocused = await search.evaluate((el) => el === document.activeElement);
  check("search keeps focus after clearing", stillFocused);
  const afterClear = await page.locator("h3").count();
  check("grid repopulates after clearing", afterClear >= hits, `${afterClear} cards`);

  // Search a barcode — proves the null-barcode rows no longer reject the query.
  await search.fill("6000000000000");
  await page.waitForTimeout(600);
  check("barcode search works with null-barcode rows present", (await page.locator("h3").count()) > 0);
  await search.fill("");
  await page.waitForTimeout(400);

  await shot("search");

  // Keyboard-wedge scanner: a USB scanner types the code fast and hits Enter.
  const cartBefore = await cartItems(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.type("6000000000000", { delay: 6 });
  await page.keyboard.press("Enter");
  const afterWedge = await waitFor(
    () => cartItems(page),
    (items) => items.length > cartBefore.length,
  );
  check(
    "wedge scanner adds the scanned product to the cart",
    afterWedge.length > cartBefore.length,
    afterWedge.map((i) => i.name).join(", ") || "cart empty",
  );

  // ...but must stay out of the way while someone is typing in a field.
  await search.click();
  await page.keyboard.type("6000000000002", { delay: 6 });
  await page.keyboard.press("Enter");
  // Nothing should happen here, so there is no state change to wait on — a
  // fixed pause is correct for a negative assertion.
  await page.waitForTimeout(800);
  const afterTyping = await cartItems(page);
  check(
    "wedge scanner ignores keystrokes typed into a field",
    afterTyping.length === afterWedge.length,
    `${afterTyping.length} items`,
  );
  await search.fill("");
  await page.waitForTimeout(400);

  // Cart panel
  await page.locator("button:has-text('Add')").first().click();
  await page.waitForTimeout(400);
  await shot("cart");

  await ctx.close();
}

await browser.close();

console.log("\n" + (failures.length === 0
  ? "All layout checks passed."
  : `${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
