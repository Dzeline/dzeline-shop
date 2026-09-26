/**
 * Read a real .xlsx with the browser-side reader.
 *
 *   npm run dev            # one terminal
 *   npm run verify:xlsx    # another
 *
 * Runs against a fixture built to look like the export that prompted this - an
 * Aronium POS stock report - plus the shapes that break naive readers: a row
 * that skips a cell, cells written out of order, inline strings, and numbers
 * stored as numbers rather than shared strings.
 *
 * Point it at a real file to check that one instead:
 *
 *   node scripts/verify-xlsx.mjs "C:/path/to/Stock.xlsx"
 *
 * The reader runs in the page, not in Node, because the whole point is that it
 * uses the browser's own DecompressionStream and DOMParser.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "node:zlib";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const realFile = process.argv[2];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ── build a minimal xlsx by hand ────────────────────────────────────────────
// Writing the fixture rather than committing a binary keeps what is being tested
// visible, and lets each awkward case be described in words.
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const deflated = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const SHARED = [
  "#", "Code", "Product group", "Product", "Qty.", "UOM", "Cost price", "Total",
  " DOWNY FRESH SCENT 20 ML",      // note the leading space Aronium exports
  "(none)",
  "AJAB MAIZE MEAL 2KG",
  "6034000119022",                  // a product whose name is just its barcode
  "SKIPPED CELL ROW",
  "OUT OF ORDER ROW",
];

const sharedStringsXml =
  `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${SHARED.length}" uniqueCount="${SHARED.length}">` +
  SHARED.map((s) => `<si><t>${s}</t></si>`).join("") +
  `</sst>`;

const s = (i) => `t="s"><v>${i}</v>`;

const sheetXml = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1">
    <c r="A1" ${s(0)}</c><c r="B1" ${s(1)}</c><c r="C1" ${s(2)}</c><c r="D1" ${s(3)}</c>
    <c r="E1" ${s(4)}</c><c r="F1" ${s(5)}</c><c r="G1" ${s(6)}</c><c r="H1" ${s(7)}</c>
  </row>
  <row r="2">
    <c r="A2"><v>1</v></c><c r="B2" ${s(1)}</c><c r="C2" ${s(9)}</c><c r="D2" ${s(8)}</c>
    <c r="E2"><v>49</v></c><c r="G2"><v>0</v></c><c r="H2"><v>980</v></c>
  </row>
  <row r="3">
    <c r="A3"><v>2</v></c><c r="C3" ${s(9)}</c><c r="D3" ${s(10)}</c>
    <c r="E3"><v>18</v></c><c r="H3"><v>3420</v></c>
  </row>
  <row r="4">
    <c r="D4" ${s(11)}</c><c r="E4"><v>0</v></c><c r="H4"><v>0</v></c>
  </row>
  <row r="5">
    <c r="H5"><v>7</v></c><c r="D5" ${s(13)}</c><c r="A5"><v>4</v></c>
  </row>
  <row r="6">
    <c r="D6" t="inlineStr"><is><t>INLINE </t><t>STRING NAME</t></is></c><c r="E6"><v>3</v></c>
  </row>
  <row r="7"/>
</sheetData></worksheet>`;

const fixture = zip([
  ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`],
  ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Page1" sheetId="1"/></sheets></workbook>`],
  ["xl/sharedStrings.xml", sharedStringsXml],
  ["xl/worksheets/sheet1.xml", sheetXml],
]);

// ── drive the reader in the browser ─────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);

async function read(bytes, name) {
  return page.evaluate(async ({ b64, name }) => {
    const { readXlsx } = await import("/src/utils/xlsx.js");
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const file = new File([buf], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    try {
      return { rows: await readXlsx(file) };
    } catch (err) {
      return { error: err.message };
    }
  }, { b64: bytes.toString("base64"), name });
}

const out = await read(fixture, "fixture.xlsx");
if (out.error) {
  console.error("reader threw:", out.error);
  await browser.close();
  process.exit(1);
}
const rows = out.rows;

console.log("\n── it reads the sheet ──");
check("the trailing empty row is dropped", rows.length === 6, `${rows.length} rows`);
check("the header row comes through", rows[0][3] === "Product" && rows[0][7] === "Total",
  rows[0].join(" | "));
check("shared strings are resolved", rows[1][3] === " DOWNY FRESH SCENT 20 ML", rows[1][3]);
check("numbers come through as text", rows[1][4] === "49" && rows[1][7] === "980",
  `qty=${rows[1][4]} total=${rows[1][7]}`);

console.log("\n── the cases that corrupt a naive reader ──");
// Row 2 has no F (UOM). Placed by position instead of reference, Cost price
// would land in UOM and Total in Cost price.
check("a skipped cell does not shift the columns after it",
  rows[1][5] === "" && rows[1][6] === "0" && rows[1][7] === "980",
  `F="${rows[1][5]}" G=${rows[1][6]} H=${rows[1][7]}`);
check("a row missing two cells keeps its remaining values in place",
  rows[2][1] === "" && rows[2][3] === "AJAB MAIZE MEAL 2KG" && rows[2][4] === "18" && rows[2][7] === "3420",
  rows[2].map((c, i) => `${i}:${c}`).join(" "));
check("cells written out of order still land correctly",
  rows[4][0] === "4" && rows[4][3] === "OUT OF ORDER ROW" && rows[4][7] === "7",
  rows[4].map((c, i) => `${i}:${c}`).join(" "));
check("an inline string is read, including its runs",
  rows[5][3] === "INLINE STRING NAME", rows[5][3]);
check("a name that is only a barcode survives as text",
  rows[3][3] === "6034000119022", rows[3][3]);

console.log("\n── bad input fails clearly ──");
const notZip = await read(Buffer.from("this is not a spreadsheet at all"), "nope.xlsx");
check("a file that is not a zip is rejected with a readable message",
  Boolean(notZip.error) && /not a valid \.xlsx/i.test(notZip.error), notZip.error);

// ── the real file, if one was given ────────────────────────────────────────
if (realFile) {
  console.log(`\n── the real export (${realFile}) ──`);
  if (!existsSync(realFile)) {
    check("the file exists", false, realFile);
  } else {
    const live = await read(readFileSync(realFile), "Stock.xlsx");
    if (live.error) {
      check("it opens", false, live.error);
    } else {
      const r = live.rows;
      check("it opens and has rows", r.length > 1, `${r.length} rows`);
      const header = r[0].map((h) => String(h).trim());
      check("the header looks like an Aronium stock report",
        header.includes("Code") && header.includes("Product") && header.includes("Qty."),
        header.join(" | "));
      const qtyAt = header.indexOf("Qty.");
      const totalAt = header.lastIndexOf("Total");
      const priced = r.slice(1).filter((row) => Number(row[qtyAt]) > 0 && Number(row[totalAt]) > 0);
      check("some rows have a recoverable unit price", priced.length > 0,
        `${priced.length} of ${r.length - 1} rows`);
      const first = priced[0];
      console.log(`      e.g. ${String(first[header.indexOf("Product")]).trim()} — ` +
        `${first[qtyAt]} @ ${(Number(first[totalAt]) / Number(first[qtyAt])).toFixed(2)}`);
      check("every row has the same column count as the header",
        r.slice(1).every((row) => row.length <= header.length),
        `widest row ${Math.max(...r.map((x) => x.length))}, header ${header.length}`);
    }
  }
}

await browser.close();
console.log("\n" + (failures.length === 0
  ? "All xlsx reader checks passed."
  : `${failures.length} failed:\n  - ${failures.join("\n  - ")}`));
process.exit(failures.length === 0 ? 0 : 1);
