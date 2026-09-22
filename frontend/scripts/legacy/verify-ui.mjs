import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:5200';
const OUT  = 'verify-screenshots';
mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  console.log(`✓ ${p}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// 1. Load app
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot(page, '01-initial');

// 2. Seed DB and reload to PIN login
await page.evaluate(async () => {
  const { dbHelpers } = await import('/src/services/db.js');
  await dbHelpers.saveShopSettings({
    shop_name: 'Test Shop', town: 'Nairobi', phone: '0712345678',
    kra_pin: 'NOT_REGISTERED', vat_enabled: 'true', vat_rate: '0.16',
    mpesa_till: '', pochi_number: '', currency: 'KES', setup_complete: 'true',
  });
  await dbHelpers.addStaff('Admin', '1234', 'admin');
  await dbHelpers.addStaff('Jane', '5678', 'cashier');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, '02-pin-login');

// 3. Login as Admin
await page.locator('button', { hasText: 'Admin' }).click();
await page.waitForTimeout(300);
for (const k of ['1','2','3','4']) {
  await page.locator(`button`).filter({ hasText: new RegExp(`^${k}$`) }).click();
  await page.waitForTimeout(60);
}
await page.waitForTimeout(700);
await shot(page, '03-main-navbar-products-active');

// 4. Cart tab active — pill moves
await page.locator('nav button').filter({ hasText: /^Cart$/ }).click();
await page.waitForTimeout(300);
await shot(page, '04-nav-cart-active');
await page.locator('nav button').filter({ hasText: /^Products$/ }).click();
await page.waitForTimeout(200);

// 5. Sidebar open
const menuBtn = page.locator('header button').filter({ hasText: 'Admin' });
await menuBtn.click();
await page.waitForTimeout(500);
await shot(page, '05-sidebar-open');
const hasSales = await page.locator('text=SALES').isVisible();
const hasOps   = await page.locator('text=OPERATIONS').isVisible();
const hasSetup = await page.locator('text=SETUP').isVisible();
const hasSignOut = await page.locator('button:has-text("Sign Out")').isVisible();
console.log(`Sections: SALES=${hasSales} OPERATIONS=${hasOps} SETUP=${hasSetup} SignOut=${hasSignOut}`);

// 6. Close via overlay
await page.locator('.fixed.inset-0').first().click({ position:{ x:30, y:400 } });
await page.waitForTimeout(400);
await shot(page, '06-sidebar-closed');

// 7. Add Product modal — camera/gallery buttons
const addBtn = page.locator('button').filter({ hasText: /^\+|Add Product/ }).first();
if (await addBtn.isVisible()) {
  await addBtn.click();
  await page.waitForTimeout(500);
  await shot(page, '07-product-add-photo-section');
  const cameraVisible  = await page.locator('text=Take Photo').isVisible();
  const galleryVisible = await page.locator('text=Gallery').isVisible();
  console.log(`Photo buttons: camera=${cameraVisible} gallery=${galleryVisible}`);
  await page.locator('button').filter({ hasText: '×' }).first().click();
}

// 8. Setup wizard btn-press class
await page.evaluate(async () => {
  const { db } = await import('/src/services/db.js');
  await db.settings.put({ key:'setup_complete', value:'false' });
  await db.staff.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, '08-setup-wizard');
const contBtn = page.locator('button:has-text("Continue")').first();
const cls = await contBtn.getAttribute('class') ?? '';
console.log(`btn-press present: ${cls.includes('btn-press')} | class snippet: ${cls.slice(0,80)}`);

await browser.close();
console.log('ALL DONE');
