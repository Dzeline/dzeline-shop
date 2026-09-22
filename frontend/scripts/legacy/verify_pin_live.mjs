import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const logs = [], errors = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => errors.push(e.toString()));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const pin = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tx = db.transaction(['settings','staff'],'readwrite');
  await req2p(tx.objectStore('staff').clear());
  await req2p(tx.objectStore('settings').put({key:'setup_complete',value:'true'}));
  await req2p(tx.objectStore('settings').put({key:'shop_name',value:'Demo'}));
  await req2p(tx.objectStore('staff').put({id:1,name:'Admin',pin,role:'admin',active:true,created_at:Date.now()}));
  await req2p(tx.objectStore('staff').put({id:2,name:'Jane',pin,role:'cashier',active:true,created_at:Date.now()}));
  await new Promise(res=>{tx.oncomplete=res;}); db.close();
});
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1200);

// Inject a console.log wrapper on getStaffByPin via page.addScriptTag
// Instead, intercept by patching window 
await page.evaluate(() => {
  // Patch crypto.subtle.digest to log when it's called during PIN check
  const origDigest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = async (...args) => {
    const result = await origDigest(...args);
    const hex = [...new Uint8Array(result)].map(b=>b.toString(16).padStart(2,'0')).join('');
    console.log('hashPin computed:', hex.slice(0,16)+'...');
    return result;
  };
});

// Click Jane's card
const janeBtn = await page.$('button:has-text("Jane")');
await janeBtn.click();
await page.waitForTimeout(500);

// Enter PIN
for (const d of '1234') {
  const k = await page.$(`button:has-text("${d}")`);
  if (k) { await k.click(); await page.waitForTimeout(150); }
}
await page.waitForTimeout(2000);

console.log('=== CONSOLE LOGS ===');
logs.filter(l=>l.includes('hash')||l.includes('error')||l.includes('Error')||l.includes('staff')).forEach(l=>console.log(l));
console.log('=== ERRORS ===');
errors.forEach(e=>console.log(e));
console.log('=== BODY ===');
console.log((await page.evaluate(()=>document.body.innerText)).slice(0,150));

await browser.close();
