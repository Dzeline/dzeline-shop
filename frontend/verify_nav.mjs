import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const ss = (name) => page.screenshot({ path: `verify_${name}.png` });

// ── Seed DB ──────────────────────────────────────────────────────────────
await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings', 'staff'], 'readwrite');
  await req2p(tx.objectStore('settings').put({ key: 'setup_complete', value: 'true' }));
  await req2p(tx.objectStore('settings').put({ key: 'shop_name', value: 'Demo Shop' }));
  await req2p(tx.objectStore('staff').put({ id: 1, name: 'Admin', pin, role: 'admin', active: 1, created_at: Date.now() }));
  await new Promise(res => { tx.oncomplete = res; }); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// ── Login ─────────────────────────────────────────────────────────────────
await page.click('text=Admin');
await page.waitForTimeout(400);
for (const d of '1234') { await page.click(`button:has-text("${d}")`); await page.waitForTimeout(80); }
await page.waitForTimeout(800);
await ss('01_products');

// ── 1. Verify bottom nav tabs ─────────────────────────────────────────────
const tabs = await page.$$eval('nav button', btns => btns.map(b => b.innerText.trim()));
console.log('TABS:', tabs);

// ── 2. Header shows panel title ────────────────────────────────────────────
const headerParts = (await page.$eval('header', h => h.innerText)).replace(/\n/g, ' ');
console.log('HEADER (products):', headerParts);

// ── 3. Stock tab → sub-tabs ───────────────────────────────────────────────
await page.click('nav >> text=Stock');
await page.waitForTimeout(600);
await ss('02_stock');
const stockSubs = await page.$$eval('button', btns =>
  btns.filter(b => ['Inventory','Receiving','Suppliers'].some(t => b.innerText.trim() === t))
      .map(b => b.innerText.trim())
);
console.log('STOCK SUB-TABS:', stockSubs);

// ── 4. Click Receiving sub-tab ────────────────────────────────────────────
await page.click('text=Receiving');
await page.waitForTimeout(500);
await ss('03_receiving');
console.log('RECEIVING TEXT:', (await page.evaluate(() => document.body.innerText)).slice(0, 100).replace(/\n/g,' '));

// ── 5. Reports tab → sub-tabs ─────────────────────────────────────────────
await page.click('nav >> text=Reports');
await page.waitForTimeout(600);
await ss('04_reports');
const headerReports = (await page.$eval('header', h => h.innerText)).replace(/\n/g, ' ');
console.log('HEADER (reports):', headerReports);
const reportsSubs = await page.$$eval('button', btns =>
  btns.filter(b => ['Summary','History'].some(t => b.innerText.trim() === t))
      .map(b => b.innerText.trim())
);
console.log('REPORTS SUB-TABS:', reportsSubs);

// ── 6. Settings tab → sub-tabs ───────────────────────────────────────────
await page.click('nav >> text=Settings');
await page.waitForTimeout(600);
await ss('05_settings');
const settingsSubs = await page.$$eval('button', btns =>
  btns.filter(b => ['Shop','Staff','eTIMS'].some(t => b.innerText.trim() === t))
      .map(b => b.innerText.trim())
);
console.log('SETTINGS SUB-TABS:', settingsSubs);

// ── 7. Cart tab shows empty cart ─────────────────────────────────────────
await page.click('nav >> text=Cart');
await page.waitForTimeout(500);
await ss('06_cart');
console.log('CART TEXT:', (await page.evaluate(() => document.body.innerText)).slice(0,80).replace(/\n/g,' '));

// ── 8. Staff sidebar (simplified) ────────────────────────────────────────
await page.click('nav >> text=Products');
await page.waitForTimeout(400);
const avatarBtn = page.locator('header button').first();
await avatarBtn.click();
await page.waitForTimeout(600);
await ss('07_staff_sidebar');
// Check sidebar has Sign Out but NOT navigation items like Stock, Inventory etc
const sidebarBtns = await page.$$eval('button', btns => btns.map(b => b.innerText.trim()));
const hasNavItems = sidebarBtns.some(t => ['Inventory','Stock Receiving','Suppliers','Daily Summary','Shop Settings','eTIMS / KRA'].includes(t));
const hasSignOut = sidebarBtns.some(t => t.includes('Sign Out'));
console.log('SIDEBAR has Sign Out:', hasSignOut);
console.log('SIDEBAR has old nav items:', hasNavItems, '(should be false)');

// Close sidebar
await page.press('Escape', { key: 'Escape' });
await page.click('text=Demo Shop'); // click outside - the bg overlay
await page.waitForTimeout(300);

console.log('\n=== DONE ===');
await browser.close();
