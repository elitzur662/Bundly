#!/usr/bin/env node
/**
 * Backfill missing prices into product-db/<slug>/products.json
 *
 * For each product where prices.zap/ksp/ivory/bug are all 0, fire a request
 * to /api/zap-model on the running server. That endpoint already does:
 *   ZAP_PRICES_CACHE hit → SQLite hit → live ZAP fetch → product-db fallback
 * and persists fresh prices into ZAP_PRICES_CACHE + SQLite. This script
 * additionally writes the prices back into product-db/<slug>/products.json
 * so they survive a fresh sync and show up immediately in cached emissions.
 *
 * Requires the dev server to be running (`npm start`). The script auto-
 * detects whether to hit :3001 (standalone) or :3002 (BEHIND_VITE).
 *
 * USAGE
 *   node scripts/backfill-prices.mjs                # all categories
 *   node scripts/backfill-prices.mjs tvs            # one category
 *   node scripts/backfill-prices.mjs tvs 50         # one category, first 50 missing
 *   node scripts/backfill-prices.mjs --dry-run      # report what would be fetched, no requests
 *
 * ENV VARS
 *   API_BASE      override target (default: auto-detect localhost:3001 / :3002)
 *   CONCURRENCY   parallel requests per batch (default 3 — ZAP CF-bans aggressive bursts)
 *   DELAY_MS      pause between batches (default 800)
 *   TIMEOUT_MS    per-request timeout (default 18000)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB = join(__dirname, "..", "product-db");

const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const DELAY_MS    = Number(process.env.DELAY_MS    || 800);
const TIMEOUT_MS  = Number(process.env.TIMEOUT_MS  || 18000);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter(a => !a.startsWith("--"));
const slugFilter = positional[0] || null;
const limit      = positional[1] ? parseInt(positional[1], 10) : null;

async function detectApiBase() {
  if (process.env.API_BASE) return process.env.API_BASE;
  for (const port of [3002, 3001]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return `http://localhost:${port}`;
    } catch (_) {}
  }
  throw new Error("Cannot reach the dev server on :3001 or :3002 — start it with `npm start` first");
}

function hasNoPrice(p) {
  const pp = p.prices || {};
  return !((pp.zap || 0) > 0 || (pp.ksp || 0) > 0 || (pp.ivory || 0) > 0 || (pp.bug || 0) > 0);
}

async function fetchOne(apiBase, modelId, name) {
  const url = `${apiBase}/api/zap-model?modelId=${encodeURIComponent(modelId)}&name=${encodeURIComponent(name || "")}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (!data.suppliers || data.suppliers.length === 0) return { ok: false, status: 200, empty: true };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

function applyPricesToProduct(p, data) {
  const prices = { ...(p.prices || {}) };
  const priced = (data.suppliers || []).filter(s => s.price > 0);
  if (priced.length === 0) return false;
  prices.zap = Math.min(...priced.map(s => s.price));
  prices.updated = Date.now();
  for (const s of priced) {
    const sn = (s.name || "").toLowerCase();
    if (sn.includes("ksp")    && !prices.ksp)    { prices.ksp    = s.price; prices.kspUrl    = s.link || ""; }
    if (sn.includes("ivory")  && !prices.ivory)  { prices.ivory  = s.price; prices.ivoryUrl  = s.link || ""; }
    if (sn.includes("bug")    && !prices.bug)    { prices.bug    = s.price; prices.bugUrl    = s.link || ""; }
  }
  p.prices = prices;
  if (!p.imageUrl && data.image) p.imageUrl = data.image;
  return true;
}

async function processSlug(apiBase, slug) {
  const file = join(PRODUCT_DB, slug, "products.json");
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8").replace(/\0+$/g, "");
  let products;
  try { products = JSON.parse(raw); } catch { console.warn(`  ${slug}: invalid JSON, skipping`); return null; }
  if (!Array.isArray(products)) return null;

  let missing = products.filter(hasNoPrice);
  const totalMissing = missing.length;
  if (limit && missing.length > limit) missing = missing.slice(0, limit);

  console.log(`\n[${slug}] ${products.length} total, ${totalMissing} missing prices, processing ${missing.length}`);
  if (dryRun) {
    console.log(`  (dry-run) first 5: ${missing.slice(0,5).map(p => p.id).join(", ")}`);
    return { slug, total: products.length, missing: totalMissing, attempted: 0, updated: 0, failed: 0 };
  }

  // backup once
  if (!existsSync(file + ".bak")) copyFileSync(file, file + ".bak");

  let updated = 0, failed = 0, lastFlush = Date.now();
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => fetchOne(apiBase, p.id, p.name)));
    for (let j = 0; j < batch.length; j++) {
      const p = batch[j], r = results[j];
      if (r.ok && applyPricesToProduct(p, r.data)) updated++;
      else failed++;
    }
    // Flush every 10s OR every batch — whichever's smaller, so progress is durable
    if (Date.now() - lastFlush > 10000 || i + batch.length >= missing.length) {
      writeFileSync(file, JSON.stringify(products, null, 2), "utf8");
      lastFlush = Date.now();
    }
    const done = Math.min(i + CONCURRENCY, missing.length);
    process.stdout.write(`  ${done}/${missing.length} (✓${updated} ✗${failed})\r`);
    if (DELAY_MS > 0 && i + CONCURRENCY < missing.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }
  console.log(`\n[${slug}] done — ${updated} prices added, ${failed} no-result`);
  return { slug, total: products.length, missing: totalMissing, attempted: missing.length, updated, failed };
}

async function main() {
  if (!existsSync(PRODUCT_DB)) {
    console.error(`No product-db directory at ${PRODUCT_DB}`);
    process.exit(1);
  }
  const apiBase = await detectApiBase();
  console.log(`Backfill prices via ${apiBase}`);
  console.log(`  concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms, timeout=${TIMEOUT_MS}ms`);
  if (slugFilter) console.log(`  category filter: ${slugFilter}${limit ? ` (limit ${limit})` : ""}`);
  if (dryRun)     console.log(`  DRY RUN — no requests will be sent`);

  const allSlugs = readdirSync(PRODUCT_DB, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  const slugs = slugFilter ? [slugFilter] : allSlugs;

  if (slugFilter && !allSlugs.includes(slugFilter)) {
    console.error(`Unknown category "${slugFilter}". Available: ${allSlugs.join(", ")}`);
    process.exit(1);
  }

  const results = [];
  for (const slug of slugs) {
    const r = await processSlug(apiBase, slug);
    if (r) results.push(r);
  }

  console.log("\n=== Summary ===");
  let totMissing = 0, totUpdated = 0, totFailed = 0;
  for (const r of results) {
    totMissing += r.missing; totUpdated += r.updated; totFailed += r.failed;
    console.log(`  ${r.slug.padEnd(22)} updated=${r.updated.toString().padEnd(5)} failed=${r.failed.toString().padEnd(5)} stillMissing=${r.missing - r.updated}`);
  }
  console.log(`\nTotal: ${totUpdated} prices added across ${results.length} categories.`);
  if (totFailed > 0) console.log(`${totFailed} fetches returned no prices — try again later (ZAP CF cooldown).`);
}

main().catch(e => { console.error(e); process.exit(1); });
