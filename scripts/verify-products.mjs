// Comprehensive coverage audit for product-db/.
// Verifies that every product across every category has both:
//   - a non-empty image (image / imageUrl / local path)
//   - at least one usable price (ivory, ksp, bug, zap)
//
// Usage:
//   node scripts/verify-products.mjs              — full report to stdout
//   node scripts/verify-products.mjs --json       — JSON report only
//   node scripts/verify-products.mjs --bad        — list ONLY products missing data
//   node scripts/verify-products.mjs --csv > x.csv — CSV report
//   node scripts/verify-products.mjs --cat phones — limit to one slug

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const DB_DIR    = join(ROOT, "product-db");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const arg  = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const onlyCat = arg("cat");
const asJson  = flag("json");
const asCsv   = flag("csv");
const onlyBad = flag("bad");

if (!existsSync(DB_DIR)) {
  console.error(`product-db/ not found at ${DB_DIR}`);
  process.exit(1);
}

const slugs = readdirSync(DB_DIR)
  .filter(name => statSync(join(DB_DIR, name)).isDirectory())
  .filter(name => existsSync(join(DB_DIR, name, "products.json")))
  .filter(name => !onlyCat || name === onlyCat);

if (slugs.length === 0) {
  console.error(onlyCat ? `No category "${onlyCat}".` : "No categories under product-db/.");
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function hasUsableImage(p) {
  // Accept: imageUrl, image (with content), or any local file under images/
  const candidates = [p.imageUrl, p.image, p.thumbnail].filter(Boolean);
  for (const c of candidates) {
    const s = String(c).trim();
    if (!s) continue;
    if (/\.svg(\?|$)/i.test(s)) continue;       // SVG nav icons aren't product photos
    if (s.length < 8) continue;                  // empty / "null" strings
    return s;
  }
  return null;
}

function hasUsablePrice(p) {
  const px = p.prices || {};
  // Recognise any non-zero price source
  for (const k of ["ivory", "ksp", "bug", "zap", "shopping", "merchant"]) {
    if (Number(px[k]) > 0) return { source: k, price: Number(px[k]) };
  }
  return null;
}

// ── Load + analyse ─────────────────────────────────────────────────────────
const report = [];

for (const slug of slugs) {
  let products;
  try {
    const raw = readFileSync(join(DB_DIR, slug, "products.json"), "utf8").replace(/\0+$/g, "");
    products = JSON.parse(raw);
  } catch (e) {
    report.push({ slug, error: `Failed to parse products.json: ${e.message}` });
    continue;
  }
  if (!Array.isArray(products)) {
    report.push({ slug, error: "products.json is not an array" });
    continue;
  }

  let total = 0, withImage = 0, withPrice = 0, withBoth = 0;
  const missingImage = [];
  const missingPrice = [];
  const missingBoth  = [];

  for (const p of products) {
    if (!p || !p.id) continue;
    total++;
    const img = hasUsableImage(p);
    const prc = hasUsablePrice(p);
    if (img) withImage++;
    if (prc) withPrice++;
    if (img && prc) withBoth++;
    if (!img && !prc) missingBoth.push({ id: p.id, name: p.name || "(unnamed)" });
    else {
      if (!img) missingImage.push({ id: p.id, name: p.name || "(unnamed)" });
      if (!prc) missingPrice.push({ id: p.id, name: p.name || "(unnamed)" });
    }
  }

  report.push({
    slug,
    total,
    withImage, withPrice, withBoth,
    missingImage, missingPrice, missingBoth,
    coveragePct: total ? Math.round((withBoth / total) * 1000) / 10 : 0,
  });
}

// ── Output ─────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (asCsv) {
  console.log("slug,total,withImage,withPrice,withBoth,missingImage,missingPrice,missingBoth,coveragePct");
  for (const r of report) {
    if (r.error) continue;
    console.log(`${r.slug},${r.total},${r.withImage},${r.withPrice},${r.withBoth},${r.missingImage.length},${r.missingPrice.length},${r.missingBoth.length},${r.coveragePct}`);
  }
  process.exit(0);
}

// Pretty stdout report
let grandTotal = 0, grandImg = 0, grandPrice = 0, grandBoth = 0;

console.log("\n📦 Product DB coverage audit");
console.log("──────────────────────────────────────────────────────────────");
console.log("slug                     total   img%   price%  both%  missing");
console.log("──────────────────────────────────────────────────────────────");

for (const r of report.sort((a, b) => a.coveragePct - b.coveragePct)) {
  if (r.error) {
    console.log(`${r.slug.padEnd(24)} ❌ ${r.error}`);
    continue;
  }
  grandTotal += r.total;
  grandImg   += r.withImage;
  grandPrice += r.withPrice;
  grandBoth  += r.withBoth;
  const imgPct  = r.total ? Math.round((r.withImage / r.total) * 100) : 0;
  const prPct   = r.total ? Math.round((r.withPrice / r.total) * 100) : 0;
  const bothPct = r.coveragePct;
  const missing = (r.missingImage.length + r.missingPrice.length + r.missingBoth.length);
  const flag = bothPct === 100 ? "✅" : bothPct >= 95 ? "🟡" : "🔴";
  console.log(`${flag} ${r.slug.padEnd(22)} ${String(r.total).padStart(5)}  ${String(imgPct).padStart(4)}%  ${String(prPct).padStart(5)}%  ${String(bothPct).padStart(4)}%  ${missing}`);

  if (onlyBad) {
    if (r.missingBoth.length) {
      console.log(`     ❌ no image AND no price (${r.missingBoth.length}):`);
      for (const m of r.missingBoth.slice(0, 5)) console.log(`        · ${m.id}  ${m.name?.slice(0, 70) || ""}`);
      if (r.missingBoth.length > 5) console.log(`        ... +${r.missingBoth.length - 5} more`);
    }
    if (r.missingImage.length) {
      console.log(`     🖼  no image (${r.missingImage.length}):`);
      for (const m of r.missingImage.slice(0, 5)) console.log(`        · ${m.id}  ${m.name?.slice(0, 70) || ""}`);
      if (r.missingImage.length > 5) console.log(`        ... +${r.missingImage.length - 5} more`);
    }
    if (r.missingPrice.length) {
      console.log(`     💰 no price (${r.missingPrice.length}):`);
      for (const m of r.missingPrice.slice(0, 5)) console.log(`        · ${m.id}  ${m.name?.slice(0, 70) || ""}`);
      if (r.missingPrice.length > 5) console.log(`        ... +${r.missingPrice.length - 5} more`);
    }
  }
}

console.log("──────────────────────────────────────────────────────────────");
const gImgPct  = grandTotal ? Math.round((grandImg / grandTotal) * 100) : 0;
const gPrPct   = grandTotal ? Math.round((grandPrice / grandTotal) * 100) : 0;
const gBothPct = grandTotal ? Math.round((grandBoth / grandTotal) * 1000) / 10 : 0;
console.log(`TOTAL                  ${String(grandTotal).padStart(7)}  ${String(gImgPct).padStart(4)}%  ${String(gPrPct).padStart(5)}%  ${String(gBothPct).padStart(4)}%`);
console.log("──────────────────────────────────────────────────────────────");

const fullyCovered = grandTotal === grandBoth;
const worstSlugs = report.filter(r => !r.error && r.coveragePct < 100).sort((a, b) => a.coveragePct - b.coveragePct).slice(0, 5);

if (fullyCovered) {
  console.log("\n✅ All products have both image and price — coverage 100%");
} else {
  console.log(`\n⚠️  ${grandTotal - grandBoth} products missing image OR price.`);
  console.log("Worst categories:");
  for (const r of worstSlugs) {
    console.log(`  · ${r.slug} (${r.coveragePct}% — ${r.total - r.withBoth} of ${r.total} bad)`);
  }
  console.log("\nNext steps:");
  console.log("  · run again with --bad to see which specific products are bad");
  console.log("  · re-sync the worst categories:  node db-sync.js --cat <slug> --force");
}

process.exit(fullyCovered ? 0 : 1);
