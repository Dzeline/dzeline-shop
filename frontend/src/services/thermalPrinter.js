/**
 * Thermal printer service — Web Bluetooth ESC/POS with browser-print fallback.
 *
 * Primary:  BLE thermal printers (Rongta, POS-58, Sewoo, and generics).
 * Fallback: window.print() → works for USB and OS-paired Bluetooth printers.
 *
 * Chunk size is 20 bytes — the safe minimum BLE MTU across all cheap printers.
 */

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const POS = {
  INIT:         [ESC, 0x40],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_LEFT:   [ESC, 0x61, 0x00],
  BOLD_ON:      [ESC, 0x45, 0x01],
  BOLD_OFF:     [ESC, 0x45, 0x00],
  SIZE_2X:      [ESC, 0x21, 0x11],
  SIZE_NORMAL:  [ESC, 0x21, 0x00],
  // Double-height only (no width change) — bit4 of ESC ! per the standard
  // Epson command set every cheap clone copies. Unlike SIZE_2X this never
  // widens glyphs, so it's safe to use on full-width rows: CHARS_PER_LINE's
  // padding math is column-count based and stays correct either way.
  SIZE_TALL:    [ESC, 0x21, 0x10],
  FEED:         (n) => [ESC, 0x64, n],
  CUT:          [GS, 0x56, 0x42, 0x00],
};

// Known BLE service/characteristic pairs — tried in order on connect.
const BLE_PROFILES = [
  // Rongta / most generic 58mm BT printers
  { service: "000018f0-0000-1000-8000-00805f9b34fb", char: "00002af1-0000-1000-8000-00805f9b34fb" },
  // Sewoo / similar
  { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", char: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f" },
  // Microchip MLDP
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", char: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
];

const CHARS_PER_LINE = 32; // 58mm paper; change to 48 for 80mm rolls
const STORAGE_KEY = "dzeline_printer_name";

let _device = null;
let _char   = null;

export const thermalPrinter = {
  get isConnected() {
    return !!_device && _device.gatt.connected;
  },

  get savedDeviceName() {
    return localStorage.getItem(STORAGE_KEY);
  },

  get isBluetoothAvailable() {
    return !!navigator.bluetooth;
  },

  /**
   * Open the browser's BLE device picker and pair a printer.
   * Returns the device name on success.
   */
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.\nUse Chrome on Android or Edge on Windows.");
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PROFILES.map((p) => p.service),
    });

    const server = await device.gatt.connect();

    let foundChar = null;
    for (const profile of BLE_PROFILES) {
      try {
        const svc = await server.getPrimaryService(profile.service);
        foundChar  = await svc.getCharacteristic(profile.char);
        break;
      } catch { /* try next profile */ }
    }

    if (!foundChar) {
      device.gatt.disconnect();
      throw new Error(
        "Printer paired but no compatible write channel found.\n" +
        "Make sure it's a BLE ESC/POS receipt printer."
      );
    }

    _device = device;
    _char   = foundChar;
    localStorage.setItem(STORAGE_KEY, device.name ?? "Bluetooth Printer");

    device.addEventListener("gattserverdisconnected", () => {
      _device = null;
      _char   = null;
    });

    return device.name ?? "Bluetooth Printer";
  },

  async disconnect() {
    if (_device?.gatt.connected) _device.gatt.disconnect();
    _device = null;
    _char   = null;
    localStorage.removeItem(STORAGE_KEY);
  },

  /** Print receipt via BLE ESC/POS. Throws if no printer connected. */
  async printBluetooth(sale, settings) {
    if (!this.isConnected) throw new Error("No printer connected");
    const bytes = _buildEscPos(sale, settings);
    await _writeChunked(_char, bytes);
  },

  /**
   * Print via the browser's print dialog.
   * Works for USB-connected printers and printers paired at OS level.
   * Opens a minimal 58mm HTML page and calls window.print().
   */
  printBrowser(sale, settings) {
    const html = _buildReceiptHtml(sale, settings);
    const win  = window.open("", "_blank", "width=420,height=700,menubar=no,toolbar=no");
    if (!win) {
      // Pop-up blocked — fall back to printing from current window via hidden iframe
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      document.body.appendChild(iframe);
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  },
};

// ── ESC/POS builder ───────────────────────────────────────────────────────────

function _enc(str) { return Array.from(new TextEncoder().encode(str)); }
function _line(str = "") { return [..._enc(str), LF]; }

function _row(label, value) {
  const gap = CHARS_PER_LINE - label.length - value.length;
  return _line(label + " ".repeat(Math.max(1, gap)) + value);
}

function _buildEscPos(sale, settings) {
  const { shopName = "Shop", kraPin, kraRegistered, vatRate = 0, currency = "KSH" } = settings;
  const fmt     = (n) => `${currency} ${Number(n).toFixed(2)}`;
  const dashes  = "-".repeat(CHARS_PER_LINE);
  const isMpesa = sale.method === "MPESA";
  const isPochi = sale.method === "POCHI";
  const date    = new Date(sale.timestamp).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const b = [
    ...POS.INIT,
    ...POS.ALIGN_CENTER,
    ...POS.BOLD_ON,
    ...POS.SIZE_2X,
    ..._line(shopName.toUpperCase().slice(0, 14)),
    ...POS.SIZE_NORMAL,
    // Bold stays on for the rest of the receipt — testing showed plain
    // single-weight text prints too faint to read on cheap thermal print
    // heads, while bold prints reliably dark. SIZE_TALL (double-height,
    // same width) makes body text bigger without breaking CHARS_PER_LINE's
    // column math; dropped back to SIZE_NORMAL only around the dashed
    // separators so they don't render as an oversized solid bar.
  ];

  if (kraRegistered && kraPin) b.push(..._line(`KRA PIN: ${kraPin}`));

  b.push(
    ...POS.SIZE_TALL,
    ..._line(`Receipt #${String(sale.id).padStart(6, "0")}`),
    ..._line(date),
    ..._line(`Cashier: ${sale.staff_name ?? "—"}`),
    ...POS.ALIGN_LEFT,
    ...POS.SIZE_NORMAL,
    ..._line(dashes),
    ...POS.SIZE_TALL,
  );

  for (const item of sale.items) {
    const name   = item.name.slice(0, 22);
    const total  = fmt(item.price * item.quantity);
    const gap    = CHARS_PER_LINE - name.length - total.length;
    b.push(..._line(name + " ".repeat(Math.max(1, gap)) + total));
    b.push(..._line(`  ${item.quantity} x ${fmt(item.price)}`));
  }

  b.push(...POS.SIZE_NORMAL, ..._line(dashes), ...POS.SIZE_TALL);
  b.push(..._row("Subtotal", fmt(sale.subtotal)));
  if (vatRate > 0) b.push(..._row(`VAT ${Math.round(vatRate * 100)}%`, fmt(sale.vat)));
  b.push(..._row("TOTAL", fmt(sale.total)));
  b.push(...POS.SIZE_NORMAL, ..._line(dashes), ...POS.SIZE_TALL);

  if (isMpesa) {
    b.push(..._row("M-Pesa", ""), ..._row("Code", sale.mpesaCode ?? "—"));
  } else if (isPochi) {
    b.push(..._row("Pochi", ""), ..._row("Code", sale.pochiCode ?? "—"));
  } else {
    b.push(..._row("Cash Paid", fmt(sale.amount)), ..._row("Change", fmt(sale.change)));
  }

  b.push(
    ...POS.SIZE_NORMAL,
    ..._line(dashes),
    ...POS.ALIGN_CENTER,
    ..._line("Thank you for shopping!"),
    ..._line(shopName),
    ...POS.FEED(5),
    ...POS.CUT,
  );

  return new Uint8Array(b);
}

async function _writeChunked(char, bytes) {
  const CHUNK = 20;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await char.writeValue(bytes.slice(i, i + CHUNK));
  }
}

// ── Browser-print HTML builder ────────────────────────────────────────────────

function _buildReceiptHtml(sale, settings) {
  const { shopName = "Shop", kraPin, kraRegistered, vatRate = 0, currency = "KSH" } = settings;
  const fmt     = (n) => `${currency} ${Number(n).toFixed(2)}`;
  const isMpesa = sale.method === "MPESA";
  const isPochi = sale.method === "POCHI";
  const date    = new Date(sale.timestamp).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const itemRows = sale.items.map((item) => `
    <tr>
      <td class="name">${_esc(item.name)}</td>
      <td class="qty">${item.quantity} × ${fmt(item.price)}</td>
      <td class="amt"><b>${fmt(item.price * item.quantity)}</b></td>
    </tr>`).join("");

  const payRows = isMpesa
    ? `<tr><td colspan="2">M-Pesa Code</td><td class="amt"><b>${_esc(sale.mpesaCode ?? "—")}</b></td></tr>`
    : isPochi
    ? `<tr><td colspan="2">Pochi Code</td><td class="amt"><b>${_esc(sale.pochiCode ?? "—")}</b></td></tr>`
    : `<tr><td colspan="2">Cash Paid</td><td class="amt">${fmt(sale.amount)}</td></tr>
       <tr><td colspan="2"><b>Change</b></td><td class="amt"><b>${fmt(sale.change)}</b></td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:monospace;font-size:13px;font-weight:600;color:#000;width:58mm;padding:4px 3px}
h1{font-size:15px;text-align:center;margin-bottom:2px}
.c{text-align:center}.s{font-size:12px;color:#000}
hr{border:none;border-top:1px dashed #000;margin:3px 0}
table{width:100%;border-collapse:collapse}
td{padding:2px 0;vertical-align:top}
.qty{color:#000;font-size:12px}
.amt{text-align:right;white-space:nowrap}
.name{max-width:28mm;word-break:break-word}
.tot td{font-size:15px;font-weight:800;border-top:1px dashed #000;padding-top:3px}
@media print{@page{margin:0;size:58mm auto}}
</style></head><body>
<h1>${_esc(shopName)}</h1>
${kraRegistered && kraPin ? `<p class="c s">KRA PIN: ${_esc(kraPin)}</p>` : ""}
<p class="c s">Receipt #${String(sale.id).padStart(6, "0")}</p>
<p class="c s">${date}</p>
<p class="c s">Cashier: ${_esc(sale.staff_name ?? "—")}</p>
<hr>
<table>
  ${itemRows}
  <tr><td colspan="3"><hr></td></tr>
  <tr><td colspan="2">Subtotal</td><td class="amt">${fmt(sale.subtotal)}</td></tr>
  ${vatRate > 0 ? `<tr><td colspan="2">VAT ${Math.round(vatRate * 100)}%</td><td class="amt">${fmt(sale.vat)}</td></tr>` : ""}
  <tr class="tot"><td colspan="2">TOTAL</td><td class="amt">${fmt(sale.total)}</td></tr>
  <tr><td colspan="3"><hr></td></tr>
  ${payRows}
</table>
<hr>
<p class="c s" style="margin-top:5px">Thank you for shopping at</p>
<p class="c s"><b>${_esc(shopName)}</b></p>
</body></html>`;
}

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
