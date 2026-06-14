import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const ss = (name) => page.screenshot({ path: `rbac_${name}.png` });

const errors = [];
const logs = [];
page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(e.toString()));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings','staff'],'readwrite');
  await req2p(tx.objectStore('settings').put({key:'setup_complete',value:'true'}));
  await req2p(tx.objectStore('settings').put({key:'shop_name',value:'Demo Shop'}));
  await req2p(tx.objectStore('staff').put({id:1,name:'Admin',pin,role:'admin',active:1,created_at:Date.now()}));
  await new Promise(res=>{tx.oncomplete=res;}); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

const adminBtn = await page.$('button:has-text("Admin")');
await adminBtn?.click();
await page.waitForTimeout(500);

for (const d of '1234') {
  const btn = await page.$(`button:has-text("${d}")`);
  if (btn) { await btn.click(); await page.waitForTimeout(100); }
}
await page.waitForTimeout(3000);
await ss('after_pin');

console.log('=== PAGE ERRORS ===');
errors.forEach(e => console.log(e));
console.log('=== CONSOLE LOGS ===');
logs.forEach(l => console.log(l));
console.log('=== BODY TEXT ===');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 300));
console.log('=== NAV HTML ===');
const navHtml = await page.evaluate(() => document.querySelector('nav')?.outerHTML ?? 'NO NAV');
console.log(navHtml.slice(0, 500));

await browser.close();
