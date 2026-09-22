import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:5200';
const OUT  = 'verify-screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// Seed + login as admin
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const { dbHelpers } = await import('/src/services/db.js');
  await dbHelpers.saveShopSettings({ shop_name:'Test Shop', town:'Nairobi', phone:'0712345678', kra_pin:'NOT_REGISTERED', vat_enabled:'true', vat_rate:'0.16', mpesa_till:'', pochi_number:'', currency:'KES', setup_complete:'true' });
  await dbHelpers.addStaff('Admin', '1234', 'admin');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('button', { hasText: 'Admin' }).click();
await page.waitForTimeout(300);
for (const k of ['1','2','3','4']) {
  await page.locator('button').filter({ hasText: new RegExp(`^${k}$`) }).click();
  await page.waitForTimeout(60);
}
await page.waitForTimeout(800);

// Click the + add product button (icon only, title="Add new product")
const addBtn = page.locator('button[title="Add new product"]');
await addBtn.waitFor({ state: 'visible', timeout: 5000 });
await addBtn.click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/07-product-add-modal.png` });
console.log('✓ verify-screenshots/07-product-add-modal.png');

const cameraVisible  = await page.locator('text=Take Photo').isVisible();
const galleryVisible = await page.locator('text=Gallery').isVisible();
console.log(`Photo buttons: Take Photo=${cameraVisible}  Gallery=${galleryVisible}`);

// Verify camera input has capture="environment" attribute
const cameraInput = page.locator('input[type="file"][capture="environment"]');
const hasCapture = await cameraInput.count() > 0;
console.log(`Camera input with capture="environment": ${hasCapture}`);

// Gallery input has NO capture attribute
const galleryInput = page.locator('input[type="file"]:not([capture])');
const galleryNoCapture = await galleryInput.count() > 0;
console.log(`Gallery input without capture: ${galleryNoCapture}`);

await browser.close();
console.log('DONE');
