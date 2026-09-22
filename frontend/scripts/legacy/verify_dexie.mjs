import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

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
await page.waitForTimeout(1500);

// After reload: use app's dbHelpers module to call getStaffByPin
// We can access it via window if it's exposed, or we need another way.
// Let's check via console.log interception by exposing dbHelpers on window
const result = await page.evaluate(async () => {
  // Access the app's Dexie db via module system isn't easy.
  // Let's read the IDB directly to see what's there after reload:
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  
  // Open WITH a specific version to check
  const openReq = indexedDB.open('DzelineShop');
  const db = await req2p(openReq);
  const version = db.version;
  const storeNames = [...db.objectStoreNames];
  const tx = db.transaction(['staff'],'readonly');
  const all = await req2p(tx.objectStore('staff').getAll());
  db.close();
  
  // Hash '1234'
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const hash = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  
  const matches = all.filter(s => s.pin === hash && s.active);
  
  return { version, storeNames, total: all.length, matches: matches.map(s=>({id:s.id,name:s.name,active:s.active})) };
});
console.log('Dexie DB state after reload:', JSON.stringify(result, null, 2));

await browser.close();
