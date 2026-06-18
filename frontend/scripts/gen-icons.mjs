/**
 * Generates PNG icons for the PWA and TWA from the source SVG.
 * Run once from the frontend/ directory: npm run generate-icons
 *
 * Requires: npm install -D sharp  (already in package.json devDependencies)
 */
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC   = join(__dirname, "..", "public");
const SRC_SVG  = join(PUBLIC, "favicon.svg");
const OUT_DIR  = join(PUBLIC, "icons");

mkdirSync(OUT_DIR, { recursive: true });

const svg = readFileSync(SRC_SVG);

// Standard Android launcher icon sizes
const SIZES = [48, 72, 96, 144, 192, 256, 512];

for (const size of SIZES) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(OUT_DIR, `icon-${size}.png`));
  console.log(`✓  icon-${size}.png`);
}

// Maskable icon: icon sits inside the "safe zone" (72 % of canvas) with
// the brand blue background filling the outer padding.
const CANVAS    = 512;
const SAFE_ZONE = Math.round(CANVAS * 0.72); // 369 px content area
const PADDING   = Math.round((CANVAS - SAFE_ZONE) / 2); // ~71 px each side

await sharp(svg)
  .resize(SAFE_ZONE, SAFE_ZONE)
  .extend({
    top: PADDING, bottom: PADDING,
    left: PADDING, right: PADDING,
    background: "#2563eb",
  })
  .resize(CANVAS, CANVAS)
  .png()
  .toFile(join(OUT_DIR, "icon-512-maskable.png"));
console.log("✓  icon-512-maskable.png");

console.log(`\nAll icons written to frontend/public/icons/`);
