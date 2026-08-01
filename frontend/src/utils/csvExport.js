// Generic CSV export helpers — mirrors the column vocabulary CsvImport.jsx
// understands (see its ALIASES map) so an exported file round-trips cleanly
// back through Import.

function escapeCsvField(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function productsToCsv(products) {
  const headers = ["name", "barcode", "category", "price", "cost_price", "stock", "reorder_level", "active"];
  const lines = [headers.join(",")];

  for (const p of products) {
    lines.push([
      escapeCsvField(p.name),
      escapeCsvField(p.barcode),
      escapeCsvField(p.category),
      escapeCsvField(p.price ?? 0),
      escapeCsvField(p.cost_price ?? ""),
      escapeCsvField(p.stock ?? 0),
      escapeCsvField(p.reorder_level ?? ""),
      escapeCsvField(p.active === false ? "Discontinued" : "Active"),
    ].join(","));
  }

  return lines.join("\r\n");
}

// One row per sale (an "invoice"), not exploded to line items — an
// accountant needs revenue/VAT/payment-method per sale. Voided sales stay
// in the file (flagged, not dropped) so the export never silently hides data.
export function transactionsToCsv(transactions) {
  const headers = ["date", "time", "invoice_id", "staff", "customer", "payment_method", "mpesa_code", "subtotal", "vat", "total", "voided"];
  const lines = [headers.join(",")];

  for (const t of transactions) {
    const d = new Date(t.timestamp);
    lines.push([
      escapeCsvField(d.toLocaleDateString("en-KE")),
      escapeCsvField(d.toLocaleTimeString("en-KE")),
      escapeCsvField(t.id),
      escapeCsvField(t.staff_name),
      escapeCsvField(t.customer_name),
      escapeCsvField(t.payment_method),
      escapeCsvField(t.mpesa_code),
      escapeCsvField(t.subtotal.toFixed(2)),
      escapeCsvField(t.vat.toFixed(2)),
      escapeCsvField(t.total.toFixed(2)),
      escapeCsvField(t.voided ? "Yes" : "No"),
    ].join(","));
  }

  return lines.join("\r\n");
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
