#!/usr/bin/env node
/**
 * Seed the persistent product-db directory from the repo's committed JSON catalog.
 *
 * Runs as `prestart` so Render's persistent disk (DATA_DIR/product-db) gets
 * populated on every deploy. Per-slug logic:
 *   1. If DATA_DIR/product-db/<slug>/products.json does NOT exist → copy
 *      the repo version verbatim.
 *   2. If it DOES exist but the repo version has MORE priced entries
 *      → overwrite (the repo represents the latest local backfill state).
 *   3. Otherwise → leave alone (the disk version is fresher).
 *
 * Skips entirely when DATA_DIR is unset (dev — repo IS the source of truth).
 * Safe to run multiple times.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PRODUCT_DB = join(__dirname, "..", "product-db");
const DATA_DIR = process.env.DATA_DIR;

function countPriced(products) {
  if (!Array.isArray(products)) return 0;
  return products.filter(p => {
    const pp = p.prices || {};
    return (pp.zap || 0) > 0 || (pp.ksp || 0) > 0 || (pp.ivory || 0) > 0 || (pp.bug || 0) > 0;
  }).length;
}

function tryParse(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/\0+$/g, ""));
  } catch {
    return null;
  }
}

function main() {
  if (!DATA_DIR) {
    console.log("[seed-product-db] DATA_DIR not set — dev environment, repo is source of truth. Skipping.");
    return;
  }
  if (!existsSync(REPO_PRODUCT_DB)) {
    console.log(`[seed-product-db] No repo product-db at ${REPO_PRODUCT_DB} — nothing to seed.`);
    return;
  }
  const targetRoot = join(DATA_DIR, "product-db");
  if (!existsSync(targetRoot)) mkdirSync(targetRoot, { recursive: true });

  const slugs = readdirSync(REPO_PRODUCT_DB, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  let seeded = 0, upgraded = 0, kept = 0;
  for (const slug of slugs) {
    const srcDir = join(REPO_PRODUCT_DB, slug);
    const dstDir = join(targetRoot, slug);
    const srcFile = join(srcDir, "products.json");
    const dstFile = join(dstDir, "products.json");
    if (!existsSync(srcFile)) continue;

    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

    const srcProducts = tryParse(srcFile);
    const dstProducts = tryParse(dstFile);

    if (!dstProducts) {
      copyFileSync(srcFile, dstFile);
      const srcMeta = join(srcDir, "meta.json");
      if (existsSync(srcMeta)) copyFileSync(srcMeta, join(dstDir, "meta.json"));
      seeded++;
      console.log(`[seed-product-db] seeded ${slug} (${(srcProducts || []).length} products, ${countPriced(srcProducts)} priced)`);
      continue;
    }

    const srcPriced = countPriced(srcProducts);
    const dstPriced = countPriced(dstProducts);
    if (srcPriced > dstPriced) {
      copyFileSync(srcFile, dstFile);
      const srcMeta = join(srcDir, "meta.json");
      if (existsSync(srcMeta)) copyFileSync(srcMeta, join(dstDir, "meta.json"));
      upgraded++;
      console.log(`[seed-product-db] upgraded ${slug}: ${dstPriced} → ${srcPriced} priced`);
    } else {
      kept++;
    }
  }
  console.log(`[seed-product-db] done — seeded=${seeded} upgraded=${upgraded} kept=${kept}`);
}

main();
