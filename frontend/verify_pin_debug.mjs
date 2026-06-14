import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// Seed
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

// After reload: check DB contents via Dexie & PIN matching
const debug = await page.evaluate(async () => {
  // Use Dexie from the app's context isn't directly accessible, so use raw IDB
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  const tx = db.transaction(['staff'],'readonly');
  const all = await req2p(tx.objectStore('staff').getAll());
  db.close();

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const hash1234 = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  
  return {
    staffCount: all.length,
    staff: all.map(s=>({ id: s.id, name: s.name, role: s.role, active: s.active, pinLen: s.pin?.length, pinMatches1234: s.pin === hash1234, pinFirst8: s.pin?.slice(0,8) })),
    hash1234First8: hash1234.slice(0,8),
  };
});
console.log('DB debug after reload:', JSON.stringify(debug, null, 2));

await browser.close();
