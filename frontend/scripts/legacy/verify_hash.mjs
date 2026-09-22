import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// Inspect the stored pin vs computed hash
const result = await page.evaluate(async () => {
  function req2p(r) { return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  const db = await req2p(indexedDB.open('DzelineShop'));
  
  // Read all staff from DB
  const tx = db.transaction(['staff'],'readonly');
  const all = await req2p(tx.objectStore('staff').getAll());
  db.close();
  
  // Compute hash of '1234'
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'));
  const computedHash = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  
  return {
    staff: all.map(s => ({id:s.id, name:s.name, role:s.role, active:s.active, pinLen:s.pin?.length, pinStart:s.pin?.slice(0,8)})),
    computedHash: computedHash.slice(0,8) + '...',
    hashLen: computedHash.length,
  };
});
console.log('DB Staff:', JSON.stringify(result.staff, null, 2));
console.log('Computed hash prefix:', result.computedHash, 'len:', result.hashLen);

await browser.close();
