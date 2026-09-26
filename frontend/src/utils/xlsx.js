/**
 * Read an .xlsx file without a library.
 *
 * An xlsx is a zip of XML, and the browser can already do both halves:
 * DecompressionStream inflates the entries and DOMParser reads them. A
 * spreadsheet parser is a few hundred lines; SheetJS is a few hundred kilobytes,
 * and this app is downloaded over Kenyan mobile data by shops that import a
 * product list once. So this module is small, lazy-loaded, and deliberately
 * narrow: enough of the format to read an exported product or stock list, and an
 * honest error for anything else.
 *
 * What it handles: shared strings, inline strings, numbers, stored and deflated
 * zip entries, and cells addressed out of order or missing entirely.
 *
 * What it does not: zip64 archives, encrypted workbooks, formulas (the cached
 * value is used), and date formatting (a date arrives as its serial number).
 * Each of those fails loudly rather than quietly returning something wrong.
 */

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

function findEndOfCentralDirectory(view) {
  // The record is at the end, but a zip comment can follow it, so scan back.
  const limit = Math.max(0, view.byteLength - 66_000);
  for (let i = view.byteLength - 22; i >= limit; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD) return i;
  }
  throw new Error("This file is not a valid .xlsx (no zip directory found).");
}

/** Every entry in the archive, as {name, offset, compression, size}. */
function readDirectory(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  if (pointer === 0xffffffff || count === 0xffff) {
    throw new Error("This .xlsx uses zip64, which this reader cannot open. Save it as CSV instead.");
  }

  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== ZIP_CENTRAL) break;
    const compression = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, pointer + 46, nameLength));
    entries.set(name, { localOffset, compression, compressedSize });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot open .xlsx files. Open the file in Excel and use " +
      "File > Save As > CSV, then import that.",
    );
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(buffer, entry) {
  const view = new DataView(buffer);
  // The local header repeats the name and extra fields, and its lengths are the
  // ones that locate the data - the central directory's can differ.
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const bytes = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.compression === 0) return bytes;          // stored
  if (entry.compression === 8) return inflate(bytes); // deflate
  throw new Error(`This .xlsx uses an unsupported compression method (${entry.compression}).`);
}

function parseXml(bytes) {
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This .xlsx contains a sheet this reader could not parse.");
  }
  return doc;
}

/** "BC12" -> 28 (zero-based column index). */
function columnIndex(ref) {
  let n = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;   // stop at the row digits
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/**
 * Read the first sheet of an .xlsx as rows of strings.
 *
 * The shape matches what the CSV path produces - an array of arrays - so
 * everything downstream stays the same whichever kind of file arrived.
 *
 * @param file  a File or Blob
 * @param maxRows  stop after this many rows; a runaway sheet should not hang a phone
 */
export async function readXlsx(file, { maxRows = 20_000 } = {}) {
  const buffer = await file.arrayBuffer();
  const entries = readDirectory(buffer);

  // Shared strings: most text in an xlsx lives here and cells reference it by
  // index. Absent in sheets that happen to hold only numbers.
  const strings = [];
  const sharedEntry = entries.get("xl/sharedStrings.xml");
  if (sharedEntry) {
    const doc = parseXml(await readEntry(buffer, sharedEntry));
    for (const si of doc.getElementsByTagName("si")) {
      // A string can be split across several <t> runs by formatting.
      let text = "";
      for (const t of si.getElementsByTagName("t")) text += t.textContent ?? "";
      strings.push(text);
    }
  }

  // Sheets are named in the workbook, but their order there is what matters and
  // sheet1.xml is not guaranteed to be the first one, so fall back to whichever
  // worksheet part exists.
  let sheetName = "xl/worksheets/sheet1.xml";
  if (!entries.has(sheetName)) {
    sheetName = [...entries.keys()].find((n) => n.startsWith("xl/worksheets/sheet")) ?? "";
    if (!sheetName) throw new Error("This .xlsx has no worksheets.");
  }

  const doc = parseXml(await readEntry(buffer, entries.get(sheetName)));
  const rows = [];

  for (const row of doc.getElementsByTagName("row")) {
    if (rows.length >= maxRows) break;
    const cells = [];
    for (const cell of row.getElementsByTagName("c")) {
      const ref = cell.getAttribute("r") ?? "";
      // Placed by its reference, never by its position in the XML. A row that
      // skips an empty cell would otherwise shift every value after it into the
      // wrong column - which is how an import silently puts prices in the stock
      // field.
      const index = ref ? columnIndex(ref) : cells.length;
      const type = cell.getAttribute("t");

      let value = "";
      if (type === "s") {
        const v = cell.getElementsByTagName("v")[0];
        const at = v ? Number(v.textContent) : NaN;
        value = Number.isInteger(at) && at >= 0 && at < strings.length ? strings[at] : "";
      } else if (type === "inlineStr") {
        for (const t of cell.getElementsByTagName("t")) value += t.textContent ?? "";
      } else {
        // Numbers, booleans, dates-as-serials and cached formula results.
        const v = cell.getElementsByTagName("v")[0];
        value = v?.textContent ?? "";
      }

      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }

  // Trailing blank rows are common in exports and mean nothing.
  while (rows.length && rows[rows.length - 1].every((c) => !String(c).trim())) rows.pop();
  return rows;
}

export function isXlsxFile(file) {
  return /\.xlsx$/i.test(file?.name ?? "");
}

export function isLegacyXlsFile(file) {
  return /\.xls$/i.test(file?.name ?? "");
}
