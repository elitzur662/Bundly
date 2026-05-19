/**
 * Bundly — Invoice Service
 *
 * Generates legal Israeli tax invoices for completed orders.
 * Outputs:
 *   - JSON at /invoices/{invoiceNumber}.json (for API / data)
 *   - HTML at /invoices/{invoiceNumber}.html (printable, emailable)
 *
 * When ready for real PDFs:
 *   npm install pdfkit
 *   Uncomment the pdfkit block at the bottom + replace writeHtmlInvoice call
 *
 * Atomic counter: uses write-then-rename pattern to prevent duplicate numbers
 * under concurrent requests. For absolute correctness at scale, migrate to
 * an auto-increment column in a real database.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync } from "node:fs";

// SECURITY (audit M-NEW-1): every user-controlled string interpolated into
// the invoice HTML below MUST go through this helper. Supplier business
// names, customer names, item descriptions are stored as-typed; without
// escaping, a supplier registering with a businessName containing `<script>`
// or `<a href="evil.tld">` would get that link embedded in every invoice
// HTML on disk (served at /invoices/:filename under our origin).
function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Invoices are tax records — they MUST persist across deploys. On Render the
// persistent disk is mounted at DATA_DIR; locally we fall back to project dir.
const INVOICE_DIR  = (process.env.DATA_DIR || process.cwd()) + "/invoices";
const COUNTER_FILE = INVOICE_DIR + "/_counter.json";
const LOCK_FILE    = INVOICE_DIR + "/_counter.lock";

if (!existsSync(INVOICE_DIR)) mkdirSync(INVOICE_DIR, { recursive: true });

// ── Atomic counter ─────────────────────────────────────────────
// Uses O_EXCL lock file to serialize concurrent invoice generation.
// Retries up to 30 times with 50ms backoff.
function _acquireLock() {
  const start = Date.now();
  while (Date.now() - start < 1500) {
    try {
      const fd = openSync(LOCK_FILE, "wx"); // wx = exclusive create, fails if exists
      closeSync(fd);
      return true;
    } catch {
      // Lock held by another process — wait and retry
      const until = Date.now() + 50;
      while (Date.now() < until) { /* spin */ }
    }
  }
  return false;
}
function _releaseLock() {
  // BUG FIX: was `require("node:fs").unlinkSync(LOCK_FILE)` — `require` does not
  // exist in ESM, so this threw synchronously every call, the catch swallowed it,
  // and the lock file NEVER got removed. The next caller's _acquireLock spun for
  // 1.5s, _bailed silently (its bool return was ignored), and the counter was
  // mutated from STALE counter.json — two concurrent invoices could end up with
  // the same number (tax-law violation). Now uses the proper ESM import.
  try { unlinkSync(LOCK_FILE); } catch {}
}

function _nextInvoiceNumber() {
  // _acquireLock returns false on timeout — refuse to issue a number rather
  // than racing the counter. Caller surfaces the 503 to the operator.
  if (!_acquireLock()) {
    throw new Error("Invoice counter locked — try again in a moment");
  }
  try {
    let counter;
    try { counter = JSON.parse(readFileSync(COUNTER_FILE, "utf8")); }
    catch { counter = { lastNumber: 0, year: new Date().getFullYear() }; }
    counter.lastNumber += 1;
    counter.year = new Date().getFullYear();
    // Atomic write: write to temp then rename
    const tmpFile = COUNTER_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(counter, null, 2));
    renameSync(tmpFile, COUNTER_FILE);
    return `${counter.year}-${String(counter.lastNumber).padStart(6, "0")}`;
  } finally {
    _releaseLock();
  }
}

const VAT_RATE = 0.17;

function _fmt(n) { return (Math.round(n * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function _buildHtmlInvoice(inv) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he"><head>
<meta charset="UTF-8" /><title>חשבונית מס ${inv.invoiceNumber}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 780px; margin: 0 auto; padding: 30px; color: #333; }
  .header { display: flex; justify-content: space-between; border-bottom: 3px solid #4F46E5; padding-bottom: 20px; margin-bottom: 20px; }
  .header h1 { color: #4F46E5; font-size: 28px; margin: 0; }
  .header .meta { text-align: left; color: #666; font-size: 13px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin: 20px 0; }
  .block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .block h3 { margin: 0 0 10px; color: #4F46E5; font-size: 14px; }
  .block p { margin: 3px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th { background: #4F46E5; color: white; padding: 12px; text-align: right; font-size: 13px; }
  td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  .totals { max-width: 320px; margin-right: auto; margin-top: 20px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
  .totals .row.total { font-weight: 900; font-size: 16px; color: #4F46E5; border-top: 2px solid #4F46E5; border-bottom: none; padding-top: 12px; margin-top: 6px; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 11px; text-align: center; }
  @media print { body { padding: 15px; } .header { break-inside: avoid; } }
</style>
</head><body>
  <div class="header">
    <div>
      <h1>🧾 חשבונית מס</h1>
      <p style="color:#6b7280;margin:4px 0 0">מספר: <strong>${_esc(inv.invoiceNumber)}</strong></p>
    </div>
    <div class="meta">
      <p><strong>תאריך:</strong> ${new Date(inv.issuedAt).toLocaleDateString("he-IL")}</p>
      <p><strong>הזמנה:</strong> #${_esc(inv.orderId)}</p>
    </div>
  </div>

  <div class="two-col">
    <div class="block">
      <h3>מוכר</h3>
      <p><strong>${_esc(inv.seller.businessName)}</strong></p>
      <p>ח.פ / ע.מ: ${_esc(inv.seller.businessNumber || "—")}</p>
      <p>${_esc(inv.seller.address || "")}</p>
      <p>${_esc(inv.seller.email || "")}</p>
    </div>
    <div class="block">
      <h3>קונה</h3>
      <p><strong>${_esc(inv.buyer.name)}</strong></p>
      <p>${_esc(inv.buyer.phone || "")}</p>
      <p>${_esc(inv.buyer.email || "")}</p>
      ${inv.buyer.address ? `<p>${_esc(inv.buyer.address.street || "")} ${_esc(inv.buyer.address.building || "")}, ${_esc(inv.buyer.address.city || "")}</p>` : ""}
    </div>
  </div>

  <table>
    <thead><tr><th>תיאור</th><th>כמות</th><th>מחיר יחידה (כולל מע"מ)</th><th>סה"כ</th></tr></thead>
    <tbody>
      ${inv.items.map(it => `
        <tr><td>${_esc(it.description)}</td><td>${Number(it.quantity) || 0}</td><td>₪${_fmt(it.unitPrice)}</td><td>₪${_fmt(it.total)}</td></tr>
      `).join("")}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>סכום לפני מע"מ</span><span>₪${_fmt(inv.amounts.subtotal)}</span></div>
    <div class="row"><span>מע"מ (${Math.round(inv.amounts.vatRate * 100)}%)</span><span>₪${_fmt(inv.amounts.vat)}</span></div>
    <div class="row total"><span>סה"כ לתשלום</span><span>₪${_fmt(inv.amounts.total)}</span></div>
  </div>

  <div class="footer">
    <p>חשבונית זו הופקה אוטומטית על ידי Bundly · bundly.co.il</p>
    <p>סטטוס תשלום: ${inv.paymentStatus === "paid" ? "שולם ✓" : "ממתין לתשלום"}</p>
  </div>
</body></html>`;
}

export function generateInvoice({ order, user, supplier }) {
  const invoiceNumber = _nextInvoiceNumber();
  const totalInclVat = Number(order.totalAmount) || 0;
  const totalExclVat = totalInclVat / (1 + VAT_RATE);
  const vatAmount    = totalInclVat - totalExclVat;

  const invoice = {
    invoiceNumber,
    issuedAt:   new Date().toISOString(),
    orderId:    order.id,
    buyer: {
      name:    user?.name || user?.firstName || "לקוח",
      phone:   user?.phone || "",
      email:   user?.email || "",
      address: order.shippingAddress || null,
    },
    seller: {
      businessName:   supplier?.businessName || "ספק לא ידוע",
      businessNumber: supplier?.businessNumber || "",
      address:        supplier?.address || "",
      email:          supplier?.email || "",
    },
    items: [{
      description: order.productName,
      quantity:    order.quantity || 1,
      unitPrice:   Number(order.price) || 0,
      total:       totalInclVat,
    }],
    amounts: {
      subtotal: Math.round(totalExclVat * 100) / 100,
      vat:      Math.round(vatAmount * 100) / 100,
      vatRate:  VAT_RATE,
      total:    Math.round(totalInclVat * 100) / 100,
      currency: "ILS",
    },
    paymentMethod: order.paymentMethod || "stub",
    paymentStatus: order.paymentStatus || "pending",
  };

  const jsonPath = `${INVOICE_DIR}/${invoiceNumber}.json`;
  const htmlPath = `${INVOICE_DIR}/${invoiceNumber}.html`;
  writeFileSync(jsonPath, JSON.stringify(invoice, null, 2), "utf8");
  writeFileSync(htmlPath, _buildHtmlInvoice(invoice), "utf8");
  console.log(`[invoice] Generated ${invoiceNumber} for order ${order.id} (JSON + HTML)`);

  return { ...invoice, path: `/invoices/${invoiceNumber}.html`, jsonPath: `/invoices/${invoiceNumber}.json` };
}

export function getInvoice(invoiceNumber) {
  try {
    return JSON.parse(readFileSync(`${INVOICE_DIR}/${invoiceNumber}.json`, "utf8"));
  } catch {
    return null;
  }
}
