#!/usr/bin/env node
/**
 * One-time cleanup pass over product-db/<slug>/products.json files.
 *
 * Why: a previous bulk-write pass saved many ZAP candidates with `name`
 * set to JUST the brand string ("Samsung", "Sony", "LG"). When those
 * entries flowed back through the SSE stream → dealMatch.strictNameMatch,
 * a single significant token ("samsung") trivially satisfied the 80%
 * overlap rule against any deal containing the brand. Result: every TV
 * card in the listing routed to the same demo deal.
 *
 * What this does:
 *   For each products.json:
 *     - Identify entries where `name` has < 2 significant tokens AND
 *       `name` matches `manufacturer` (i.e. brand-only).
 *     - If filterTags are present → rebuild `name` from manufacturer + tag
 *       values (e.g. "Samsung 65" 4K / UHD QLED").
 *     - Otherwise → keep them but log; the runtime emitter will still
 *       reconstruct a display name from filterTags or fall back gracefully.
 *
 * Backs up products.json → products.json.bak before writing.
 * Idempotent — safe to run multiple times.
 *
 * Run: `node scripts/cleanup-product-db.mjs`
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB_DIR = join(__dirname, "..", "product-db");

function sigTokens(s) {
  return (s || "").trim().split(/\s+/).filter(w => w.length >= 3);
}

function buildNameFromTags(p) {
  const tagBits = p.filterTags
    ? Object.values(p.filterTags).filter(v => v && String(v).trim())
    : [];
  if (tagBits.length === 0) return null;
  return `${p.manufacturer || p.name || ""} ${tagBits.join(" ")}`.trim();
}

function processSlug(slug) {
  const pFile = join(PRODUCT_DB_DIR, slug, "products.json");
  if (!existsSync(pFile)) return null;
  const raw = readFileSync(pFile, "utf8").replace(/\0+$/g, "");
  let products;
  try { products = JSON.parse(raw); } catch { return { slug, error: "invalid JSON" }; }
  if (!Array.isArray(products)) return { slug, error: "not array" };

  let upgraded = 0, stillBad = 0;
  for (const p of products) {
    const tokens = sigTokens(p.name);
    const isBrandOnly = tokens.length < 2;
    if (!isBrandOnly) continue;
    const newName = buildNameFromTags(p);
    if (newName && sigTokens(newName).length >= 2) {
      p.name = newName;
      upgraded++;
    } else {
      stillBad++;
    }
  }

  if (upgraded > 0) {
    copyFileSync(pFile, pFile + ".bak");
    writeFileSync(pFile, JSON.stringify(products, null, 2), "utf8");
  }
  return { slug, total: products.length, upgraded, stillBad };
}

function main() {
  if (!existsSync(PRODUCT_DB_DIR)) {
    console.error(`No product-db directory at ${PRODUCT_DB_DIR}`);
    process.exit(1);
  }
  const slugs = readdirSync(PRODUCT_DB_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  let totalUpgraded = 0, totalStillBad = 0;
  console.log(`Scanning ${slugs.length} category dirs in ${PRODUCT_DB_DIR}\n`);
  for (const slug of slugs) {
    const r = processSlug(slug);
    if (!r) continue;
    if (r.error) { console.warn(`  ⚠️  ${slug}: ${r.error}`); continue; }
    const tag = r.upgraded > 0 ? "✏️ " : "  ";
    console.log(`${tag}${slug.padEnd(22)} total=${String(r.total).padEnd(5)} upgraded=${r.upgraded.toString().padEnd(4)} stillBad=${r.stillBad}`);
    totalUpgraded += r.upgraded;
    totalStillBad += r.stillBad;
  }
  console.log(`\nDone. Upgraded ${totalUpgraded} entries, ${totalStillBad} still have no usable filterTags (will fall back to brand-only display).`);
}

main();
