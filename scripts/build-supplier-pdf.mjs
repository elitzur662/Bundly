// Build a printable PDF of the supplier agreement.
// Usage: node scripts/build-supplier-pdf.mjs
//
// Reads:  legal/supplier-agreement-he.md
// Writes: legal/supplier-agreement-he.pdf
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MD_PATH  = resolve(ROOT, "legal", "supplier-agreement-he.md");
const PDF_PATH = resolve(ROOT, "legal", "supplier-agreement-he.pdf");
const HTML_PATH = resolve(ROOT, "legal", "supplier-agreement-he.html");

if (!existsSync(MD_PATH)) {
  console.error(`Missing source: ${MD_PATH}`);
  process.exit(1);
}

const md = readFileSync(MD_PATH, "utf8");

// ── Minimal Markdown → HTML renderer (no deps) ──
// Supports: headings (# .. ####), tables, bullet lists, blockquotes,
// horizontal rule, bold (**text**), inline code (`code`), italic (*text*),
// and paragraphs.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderInline(s) {
  // Escape first
  let out = escapeHtml(s);
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Italics (simple, single-asterisk)
  out = out.replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

const lines = md.split(/\r?\n/);
const out = [];
let i = 0;

while (i < lines.length) {
  let ln = lines[i];

  // Horizontal rule
  if (/^-{3,}$/.test(ln.trim())) { out.push("<hr/>"); i++; continue; }

  // Headings
  const h = ln.match(/^(#{1,4})\s+(.+)$/);
  if (h) { const n = h[1].length; out.push(`<h${n}>${renderInline(h[2])}</h${n}>`); i++; continue; }

  // Blockquote
  if (/^>\s/.test(ln)) {
    const buf = [];
    while (i < lines.length && /^>/.test(lines[i])) {
      buf.push(lines[i].replace(/^>\s?/, ""));
      i++;
    }
    out.push(`<blockquote>${buf.map(b => renderInline(b)).join("<br/>")}</blockquote>`);
    continue;
  }

  // Table
  if (/^\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\|[\s|:\-]+\|/.test(lines[i + 1])) {
    const header = ln.split("|").slice(1, -1).map(c => renderInline(c.trim()));
    i += 2; // skip separator
    const rows = [];
    while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
      rows.push(lines[i].split("|").slice(1, -1).map(c => renderInline(c.trim())));
      i++;
    }
    out.push("<table><thead><tr>" +
      header.map(h => `<th>${h}</th>`).join("") +
      "</tr></thead><tbody>" +
      rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") +
      "</tbody></table>");
    continue;
  }

  // Bullet list
  if (/^\s*[-*]\s/.test(ln)) {
    const buf = [];
    while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
      buf.push(lines[i].replace(/^\s*[-*]\s/, ""));
      i++;
    }
    out.push("<ul>" + buf.map(b => `<li>${renderInline(b)}</li>`).join("") + "</ul>");
    continue;
  }

  // Blank line
  if (ln.trim() === "") { i++; continue; }

  // Paragraph (collect until blank)
  const p = [ln];
  i++;
  while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|>|-{3,}|\|.*\||\s*[-*]\s)/.test(lines[i])) {
    p.push(lines[i]); i++;
  }
  out.push(`<p>${renderInline(p.join(" "))}</p>`);
}

const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>הסכם ספק — Bundly</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Arial Hebrew", "David", Arial, sans-serif;
    font-size: 11pt; line-height: 1.55; color: #1f2937;
    direction: rtl; text-align: right;
    margin: 0; padding: 0;
  }
  h1 { font-size: 22pt; color: #4f46e5; border-bottom: 2px solid #6366f1; padding-bottom: 6px; margin-top: 0; }
  h2 { font-size: 14pt; color: #312e81; margin-top: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; }
  h3 { font-size: 12pt; color: #4338ca; margin-top: 18px; }
  h4 { font-size: 11pt; color: #4338ca; margin-top: 14px; }
  p  { margin: 8px 0; }
  ul { padding-right: 22px; padding-left: 0; }
  li { margin: 3px 0; }
  strong { color: #111827; font-weight: 700; }
  code { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 1px 5px; border-radius: 4px; font-family: Consolas, monospace; font-size: 10pt; }
  blockquote {
    border-right: 3px solid #6366f1; background: #eef2ff;
    padding: 10px 14px; margin: 10px 0; border-radius: 4px;
    font-size: 10.5pt; color: #3730a3;
  }
  hr { border: 0; border-top: 1px dashed #d1d5db; margin: 22px 0; }
  table {
    width: 100%; border-collapse: collapse; margin: 12px 0;
    font-size: 10.5pt; page-break-inside: avoid;
  }
  th { background: #eef2ff; color: #312e81; font-weight: 700; text-align: right; padding: 7px 10px; border: 1px solid #c7d2fe; }
  td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  h2, h3 { page-break-after: avoid; }
  table, blockquote { page-break-inside: avoid; }
  /* Brand header on first page */
  .brand-mark {
    display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
    padding-bottom: 10px; border-bottom: 3px solid #6366f1;
  }
  .brand-mark .logo {
    width: 38px; height: 38px; border-radius: 10px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6, #d946ef);
    color: white; font-weight: 900; font-size: 18pt;
    display: flex; align-items: center; justify-content: center;
  }
  .brand-mark .name { font-size: 16pt; font-weight: 800; color: #4f46e5; }
  .brand-mark .tag { font-size: 9pt; color: #6b7280; margin-right: auto; }
</style>
</head>
<body>
  <div class="brand-mark">
    <div class="logo">B</div>
    <div class="name">Bundly · בנדלי בע"מ</div>
    <div class="tag">פלטפורמת קבוצות רכישה · אפריל 2026</div>
  </div>
  ${out.join("\n  ")}
</body>
</html>`;

writeFileSync(HTML_PATH, html, "utf8");
console.log(`✓ HTML written: ${HTML_PATH}`);

// ── Locate Chrome / Edge on Windows ──
const candidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
];
const chromePath = candidates.find(p => p && existsSync(p));
if (!chromePath) {
  console.warn("⚠ Could not locate Chrome/Edge. HTML written; open manually and Print → Save as PDF.");
  process.exit(0);
}
console.log(`✓ Using browser: ${chromePath}`);

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
});
const page = await browser.newPage();
await page.goto("file:///" + HTML_PATH.replace(/\\/g, "/"), { waitUntil: "networkidle0" });
await page.pdf({
  path: PDF_PATH,
  format: "A4",
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  printBackground: true,
});
await browser.close();
console.log(`✓ PDF written: ${PDF_PATH}`);
