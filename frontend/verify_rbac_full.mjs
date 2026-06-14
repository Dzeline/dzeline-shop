import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const ss = (name) => page.screenshot({ path: `rbac_${name}.png` });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings','staff'],'readwrite');
  await req2p(tx.objectStore('settings').put({key:'setup_complete',value:'true'}));
  await req2p(tx.objectStore('staff').put({id:1,name:'Admin',pin,role:'admin',active:1,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:2,name:'Jane',pin,role:'cashier',active:1,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:3,name:'Bob',pin,role:'stock_keeper',active:1,created_at:Date.now()}));
  await new Promise(res=>{tx.oncomplete=res;}); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1200);

async function loginAs(name) {
  // logout if logged in
  const nav = await page.$('nav');
  if (nav) {
    const staffBtn = await page.$('.sticky-header button');
    if (staffBtn) {
      await staffBtn.click();
      await page.waitForTimeout(400);
      const signOut = await page.$('button:has-text("Sign Out")');
      if (signOut) { await signOut.click(); await page.waitForTimeout(800); }
    }
  }
  const btn = await page.$(`button:has-text("${name}")`);
  if (!btn) { console.log(`SKIP: ${name} not found`); return false; }
  await btn.click();
  await page.waitForTimeout(400);
  for (const d of '1234') {
    const k = await page.$(`button:has-text("${d}")`);
    if (k) { await k.click(); await page.waitForTimeout(80); }
  }
  await page.waitForTimeout(1500);
  return true;
}

async function getNavTabs() {
  return page.$$eval('nav button', bs => bs.map(b => b.textContent.trim()));
}

// ── Admin ────────────────────────────────
console.log('\n=== ADMIN ===');
await loginAs('Admin');
await ss('admin_logged_in');
const adminTabs = await getNavTabs();
console.log('Admin tabs:', adminTabs);

// Sub-tabs: Settings > Staff
await page.click('nav >> text=Settings');
await page.waitForTimeout(500);
await ss('admin_settings');
const settingsSubs = await page.$$eval('div.bg-gray-800.p-1.rounded-xl button', bs => bs.map(b => b.textContent.trim()));
console.log('Settings sub-tabs:', settingsSubs);

await page.click('nav >> text=Stock');
await page.waitForTimeout(300);
const stockSubs = await page.$$eval('div.bg-gray-800.p-1.rounded-xl button', bs => bs.map(b => b.textContent.trim()));
console.log('Stock sub-tabs:', stockSubs);

await page.click('nav >> text=Reports');
await page.waitForTimeout(300);
const reportsSubs = await page.$$eval('div.bg-gray-800.p-1.rounded-xl button', bs => bs.map(b => b.textContent.trim()));
console.log('Reports sub-tabs:', reportsSubs);

// ── Cashier (Jane) ───────────────────────
console.log('\n=== CASHIER (Jane) ===');
await loginAs('Jane');
await ss('cashier_logged_in');
const cashierTabs = await getNavTabs();
console.log('Cashier tabs:', cashierTabs);
const cashierHasStock = cashierTabs.some(t => t.includes('Stock'));
const cashierHasSettings = cashierTabs.some(t => t.includes('Settings'));
console.log('Has Stock (should be false):', cashierHasStock);
console.log('Has Settings (should be false):', cashierHasSettings);

// ── Stock Keeper (Bob) ───────────────────
console.log('\n=== STOCK KEEPER (Bob) ===');
await loginAs('Bob');
await ss('stockkeeper_logged_in');
const bobTabs = await getNavTabs();
console.log('Stock Keeper tabs:', bobTabs);
const bobHasStock = bobTabs.some(t => t.includes('Stock'));
const bobHasSettings = bobTabs.some(t => t.includes('Settings'));
console.log('Has Stock (should be true):', bobHasStock);
console.log('Has Settings (should be false):', bobHasSettings);

await browser.close();
console.log('\nDone.');
