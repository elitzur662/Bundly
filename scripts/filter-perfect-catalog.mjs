/**
 * Bundly — keep only "perfect" products in the catalog.
 *
 *     node scripts/filter-perfect-catalog.mjs            # remove broken products
 *     node scripts/filter-perfect-catalog.mjs --dry-run  # just report
 *     node scripts/filter-perfect-catalog.mjs --strict   # also require a price
 *
 * A launch-grade catalog should never show a broken card. This removes any
 * product that fails the quality gate:
 *   • NAME  — must be a real product name (≥ 5 chars, not blank).
 *   • IMAGE — must have a usable picture: an http image URL (not an .svg
 *             placeholder/icon) OR a local product-db image file that
 *             actually exists on disk.
 *   • PRICE — with --strict, must also have a price > 0 in prices.{zap|ksp|
 *             ivory|bug}. Without --strict a priced-less product is kept
 *             (the UI shows "—", which is honest, not wrong).
 *
 * Each products.json is backed up once to .pre-filter.bak before editing.
 * NOTE: this cannot detect a *wrong* image (right file, wrong product) — only
 * the Zap rebuild (build-zap-catalog.mjs) guarantees image correctness.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB = path.join(__dirname, "..", "product-db");
const DRY_RUN = process.argv.includes("--dry-run");
const STRICT  = process.argv.includes("--strict");

const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const isSvg  = (u) => typeof u === "string" && /\.svg(?:[?#]|$)/i.test(u);

function hasUsableImage(p, dir) {
  // http image (most products) — accept unless it's an svg placeholder.
  if (isHttp(p.imageUrl) && !isSvg(p.imageUrl)) return true;
  if (isHttp(p.image)    && !isSvg(p.image))    return true;
  // local product-db file, e.g. "images/12345.gif" — must exist on disk.
  if (typeof p.image === "string" && p.image && !isHttp(p.image) && !isSvg(p.image)) {
    return fs.existsSync(path.join(dir, p.image));
  }
  return false;
}
function hasPrice(p) {
  const pr = p.prices || {};
  return ["zap", "ksp", "ivory", "bug"].some(k => (Number(pr[k]) || 0) > 0);
}

function main() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(` 🧽 Bundly — keep only perfect products${DRY_RUN ? "  (DRY-RUN)" : ""}${STRICT ? "  [strict: price required]" : ""}`);
  console.log("──────────────────────────────────────────────────────────");

  const cats = fs.readdirSync(PRODUCT_DB)
    .filter(d => fs.statSync(path.join(PRODUCT_DB, d)).isDirectory());

  let totalKept = 0, totalRemoved = 0, totalNoPrice = 0;
  const perCat = [];

  for (const cat of cats) {
    const dir  = path.join(PRODUCT_DB, cat);
    const file = path.join(dir, "products.json");
    if (!fs.existsSync(file)) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const list = Array.isArray(arr) ? arr : (Array.isArray(arr.products) ? arr.products : null);
    if (!list) continue;

    const kept = [];
    let badName = 0, badImage = 0, noPrice = 0;
    for (const p of list) {
      const okName  = typeof p.name === "string" && p.name.trim().length >= 5;
      const okImage = hasUsableImage(p, dir);
      const okPrice = hasPrice(p);
      if (!okPrice) noPrice++;
      if (!okName)  { badName++;  continue; }
      if (!okImage) { badImage++; continue; }
      if (STRICT && !okPrice) continue;
      kept.push(p);
    }

    const removed = list.length - kept.length;
    totalKept += kept.length;
    totalRemoved += removed;
    totalNoPrice += noPrice;

    if (removed > 0) {
      perCat.push({ cat, before: list.length, kept: kept.length, removed, badName, badImage, noPrice });
      if (!DRY_RUN) {
        const bak = file + ".pre-filter.bak";
        if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
        const out = Array.isArray(arr) ? kept : { ...arr, products: kept };
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(out, null, 2), "utf8");
        fs.renameSync(tmp, file);
      }
    }
  }

  perCat.sort((a, b) => b.removed - a.removed);
  for (const r of perCat) {
    console.log(`  ${r.cat.padEnd(22)} ${r.before} → ${r.kept}   (−${r.removed}: ${r.badName} bad name, ${r.badImage} bad image${STRICT ? `, incl. no-price` : ""})`);
  }
  console.log("\n──────────────────────────────────────────────────────────");
  console.log(` Kept ${totalKept}  ·  removed ${totalRemoved}`);
  if (!STRICT) console.log(` ${totalNoPrice} kept products have no price (shown as "—"). Re-run with --strict to drop those too.`);
  console.log(DRY_RUN ? " DRY-RUN — nothing written." : " ✓ Catalog filtered (.pre-filter.bak backups kept).");
  console.log("──────────────────────────────────────────────────────────");
}

main();
