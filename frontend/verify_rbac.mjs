import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const ss = (name) => page.screenshot({ path: `rbac_${name}.png` });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1500);
await ss('00_start');
console.log('START:', (await page.evaluate(() => document.body.innerText)).slice(0, 100));

// Seed
await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings','staff'],'readwrite');
  await req2p(tx.objectStore('settings').put({key:'setup_complete',value:'true'}));
  await req2p(tx.objectStore('settings').put({key:'shop_name',value:'Demo Shop'}));
  await req2p(tx.objectStore('staff').put({id:1,name:'Admin',pin,role:'admin',active:1,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:2,name:'Jane',pin,role:'cashier',active:1,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:3,name:'Bob',pin,role:'stock_keeper',active:1,created_at:Date.now()}));
  await new Promise(res=>{tx.oncomplete=res;}); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1500);
await ss('01_after_reload');
console.log('AFTER RELOAD:', (await page.evaluate(() => document.body.innerText)).slice(0, 150));

// Click admin card
const adminBtn = await page.$('button:has-text("Admin")');
console.log('ADMIN BUTTON FOUND:', !!adminBtn);
if (adminBtn) await adminBtn.click();
await page.waitForTimeout(500);
await ss('02_after_click_admin');
console.log('AFTER CLICK ADMIN:', (await page.evaluate(() => document.body.innerText)).slice(0, 150));

// Enter PIN
const pinBtns = await page.$$('[data-digit], button');
for (const d of '1234') {
  const btn = await page.$(`button:has-text("${d}")`);
  if (btn) { await btn.click(); await page.waitForTimeout(120); }
}
await page.waitForTimeout(2000);
await ss('03_after_pin');
console.log('AFTER PIN:', (await page.evaluate(() => document.body.innerText)).slice(0, 200));
const navCount = await page.$$eval('nav button', bs => bs.length);
console.log('NAV BUTTONS:', navCount);

await browser.close();
