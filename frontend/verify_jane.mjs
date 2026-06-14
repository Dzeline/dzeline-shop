import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const ss = (name) => page.screenshot({ path: `jane_${name}.png` });

const errors = [];
page.on('pageerror', e => errors.push(e.toString()));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// Fresh seed — delete all staff first
await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings','staff'],'readwrite');
  // Clear staff first
  await req2p(tx.objectStore('staff').clear());
  await req2p(tx.objectStore('settings').put({key:'setup_complete',value:'true'}));
  await req2p(tx.objectStore('settings').put({key:'shop_name',value:'Demo'}));
  await req2p(tx.objectStore('staff').put({id:1,name:'Admin',pin,role:'admin',active:true,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:2,name:'Jane',pin,role:'cashier',active:true,created_at:Date.now()}));
  await new Promise(res=>{tx.oncomplete=res;}); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1200);
await ss('00_login_screen');
console.log('Login screen:', (await page.evaluate(() => document.body.innerText)).slice(0,100));

// Log in as Jane directly (not Admin)
const janeBtn = await page.$('button:has-text("Jane")');
console.log('Jane found:', !!janeBtn);
await janeBtn.click();
await page.waitForTimeout(500);
await ss('01_jane_pin_entry');
console.log('After Jane click:', (await page.evaluate(() => document.body.innerText)).slice(0,100));

for (const d of '1234') {
  const k = await page.$(`button:has-text("${d}")`);
  console.log(`  digit ${d} button found:`, !!k);
  if (k) { await k.click(); await page.waitForTimeout(100); }
}
await page.waitForTimeout(2000);
await ss('02_after_pin');
console.log('After PIN body:', (await page.evaluate(() => document.body.innerText)).slice(0,200));

const navCount = await page.$$eval('nav button', bs => bs.length).catch(() => 0);
const navTexts = await page.$$eval('nav button', bs => bs.map(b=>b.textContent.trim())).catch(() => []);
console.log('Nav button count:', navCount);
console.log('Nav button texts:', navTexts);
console.log('Page errors:', errors);

await browser.close();
