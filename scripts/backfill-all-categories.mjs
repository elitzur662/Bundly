#!/usr/bin/env node
/**
 * Full Bundly catalog backfill — populates ZAP_CAT_CACHE + product-db
 * for EVERY category, then backfills missing per-model prices.
 *
 * Pipeline per category:
 *   Phase 1 — trigger /api/search-products-stream?q=<hebrew>
 *             The server scrapes ZAP category pages (~1185 models for TVs),
 *             writes through to product-db/<slug>/products.json via
 *             persistCandidatesToProductDb, then fetches model pages
 *             for the top ZAP_MAX_MODELS=400 → saves prices to L1/L2 cache.
 *
 *   Phase 2 — call backfill-prices logic to fill prices for remaining
 *             products that didn't get a live ZAP model fetch (because
 *             they're beyond the top 400, or fell to CF block).
 *
 * Designed to run unattended for hours. Saves progress to
 * .backfill-all-progress.json so you can interrupt (Ctrl+C) and resume
 * by re-running — already-done categories are skipped.
 *
 * Requires the dev server running (`npm start`).
 *
 * USAGE
 *   node scripts/backfill-all-categories.mjs                # all
 *   node scripts/backfill-all-categories.mjs --skip-prices  # phase-1 only (faster)
 *   node scripts/backfill-all-categories.mjs --reset        # forget progress, restart
 *   node scripts/backfill-all-categories.mjs --only=tvs,phones    # filter
 *
 * ENV VARS
 *   API_BASE           override target (default: auto-detect)
 *   STREAM_TIMEOUT_MS  per-category SSE timeout (default 240000 = 4 min)
 *   PRICE_CONCURRENCY  per-model concurrency in phase 2 (default 3)
 *   PRICE_DELAY_MS     between phase-2 batches (default 800)
 *   COOLDOWN_MS        between categories (default 5000)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB = join(__dirname, "..", "product-db");
const PROGRESS_FILE = join(__dirname, "..", ".backfill-all-progress.json");

const STREAM_TIMEOUT_MS  = Number(process.env.STREAM_TIMEOUT_MS  || 240000);
const PRICE_CONCURRENCY  = Number(process.env.PRICE_CONCURRENCY  || 3);
const PRICE_DELAY_MS     = Number(process.env.PRICE_DELAY_MS     || 800);
const COOLDOWN_MS        = Number(process.env.COOLDOWN_MS        || 5000);

const args = process.argv.slice(2);
const skipPrices = args.includes("--skip-prices");
const resetFlag  = args.includes("--reset");
const onlyArg    = args.find(a => a.startsWith("--only="));
const onlyList   = onlyArg ? onlyArg.split("=")[1].split(",").map(s => s.trim()) : null;

// slug → preferred Hebrew query (recognised by ZAP_SOG_MAP).
// One representative per category — the server's SOG resolver does the rest.
const CATEGORY_QUERIES = {
  // electronics
  phones:              "סמארטפון",
  laptops:             "מחשב נייד",
  desktops:            "מחשב נייח",
  tablets:             "טאבלט",
  tvs:                 "טלוויזיה",
  monitors:            "מסך מחשב",
  "graphics-cards":    "כרטיס מסך",
  keyboards:           "מקלדת",
  mice:                "עכבר",
  webcams:             "מצלמת רשת",
  "gaming-chairs":     "כיסא גיימינג",
  printers:            "מדפסת",
  // audio
  headphones:          "אוזניות",
  speakers:            "רמקול",
  "portable-speakers": "רמקול נייד",
  soundbars:           "סאונד בר",
  "home-theater":      "קולנוע ביתי",
  projectors:          "מקרן",
  // cameras / consoles / media
  cameras:             "מצלמה",
  "gaming-consoles":   "קונסולת משחק",
  "media-players":     "סטרימר",
  "ps4-games":         "PS4",
  "ps5-games":         "PS5",
  "nintendo-games":    "Nintendo Switch",
  // big appliances
  fridges:             "מקרר",
  "washing-machines":  "מכונת כביסה",
  dryers:              "מייבש כביסה",
  dishwashers:         "מדיח כלים",
  ovens:               "תנור",
  "air-conditioners":  "מזגן",
  microwaves:          "מיקרוגל",
  "range-hoods":       "קולט אדים",
  "water-dispensers":  "מתקן מים",
  // small appliances
  "robot-vacuums":     "שואב אבק רובוט",
  "coffee-machines":   "מכונת קפה",
  "hair-dryers":       "מייבש שיער",
  "hair-stylers":      "מסלסל שיער",
  shavers:             "מכונת גילוח",
  "lady-shavers":      "מכונת גילוח לאישה",
  toasters:            "טוסטר",
  kettles:             "קומקום חשמלי",
  mixers:              "מיקסר",
  juicers:             "מסחטת פירות",
  irons:               "מגהץ",
  "steam-cleaners":    "מנקה אדים",
  // tools / outdoor
  "power-tools":       "כלי עבודה",
  "lawn-mowers":       "מכסחת דשא",
  // health / fitness
  massagers:           "מכשיר עיסוי",
  treadmills:          "הליכון",
  nebulizers:          "מכשיר אינהלציה",
  // home
  "smart-home":        "בית חכם",
  sofas:               "ספה",
};

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

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return { done: [], startedAt: new Date().toISOString() };
  try { return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")); }
  catch { return { done: [], startedAt: new Date().toISOString() }; }
}
function saveProgress(p) { writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); }

function countProductsForSlug(slug) {
  const file = join(PRODUCT_DB, slug, "products.json");
  if (!existsSync(file)) return { total: 0, priced: 0 };
  try {
    const products = JSON.parse(readFileSync(file, "utf8").replace(/\0+$/g, ""));
    if (!Array.isArray(products)) return { total: 0, priced: 0 };
    const priced = products.filter(p => p.prices && (p.prices.zap > 0 || p.prices.ksp > 0 || p.prices.ivory > 0 || p.prices.bug > 0)).length;
    return { total: products.length, priced };
  } catch { return { total: 0, priced: 0 }; }
}

// Phase 1 — drive the server's full category-browse pipeline via SSE
async function browseCategory(apiBase, hebQuery) {
  const url = `${apiBase}/api/search-products-stream?q=${encodeURIComponent(hebQuery)}`;
  let candidates = 0, batches = 0, gotDone = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), STREAM_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) { clearTimeout(timer); return { ok: false, status: res.status }; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.type === "candidates") candidates = msg.products?.length || 0;
          else if (msg.type === "batch") batches++;
          else if (msg.type === "done") { gotDone = true; ctrl.abort(); break; }
        } catch (_) {}
      }
      if (gotDone) break;
    }
    clearTimeout(timer);
    return { ok: true, candidates, batches, completed: gotDone };
  } catch (e) {
    if (e.name === "AbortError" && gotDone) return { ok: true, candidates, batches, completed: true };
    return { ok: false, error: e.message, candidates, batches };
  }
}

// Phase 2 — fill per-model prices for products that don't have them
async function fillPrices(apiBase, slug) {
  const file = join(PRODUCT_DB, slug, "products.json");
  if (!existsSync(file)) return { attempted: 0, updated: 0 };
  let products;
  try { products = JSON.parse(readFileSync(file, "utf8").replace(/\0+$/g, "")); }
  catch { return { attempted: 0, updated: 0 }; }
  if (!Array.isArray(products)) return { attempted: 0, updated: 0 };

  const missing = products.filter(p => {
    const pp = p.prices || {};
    return !((pp.zap || 0) > 0 || (pp.ksp || 0) > 0 || (pp.ivory || 0) > 0 || (pp.bug || 0) > 0);
  });
  if (missing.length === 0) return { attempted: 0, updated: 0 };
  if (!existsSync(file + ".bak")) copyFileSync(file, file + ".bak");

  let updated = 0, lastFlush = Date.now();
  for (let i = 0; i < missing.length; i += PRICE_CONCURRENCY) {
    const batch = missing.slice(i, i + PRICE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (p) => {
      const url = `${apiBase}/api/zap-model?modelId=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name || "")}`;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(18000) });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    }));
    for (let j = 0; j < batch.length; j++) {
      const p = batch[j], d = results[j];
      if (!d?.suppliers?.length) continue;
      const priced = d.suppliers.filter(s => s.price > 0);
      if (priced.length === 0) continue;
      const prices = { ...(p.prices || {}) };
      prices.zap = Math.min(...priced.map(s => s.price));
      prices.updated = Date.now();
      for (const s of priced) {
        const sn = (s.name || "").toLowerCase();
        if (sn.includes("ksp")   && !prices.ksp)   { prices.ksp   = s.price; prices.kspUrl   = s.link || ""; }
        if (sn.includes("ivory") && !prices.ivory) { prices.ivory = s.price; prices.ivoryUrl = s.link || ""; }
        if (sn.includes("bug")   && !prices.bug)   { prices.bug   = s.price; prices.bugUrl   = s.link || ""; }
      }
      p.prices = prices;
      if (!p.imageUrl && d.image) p.imageUrl = d.image;
      updated++;
    }
    if (Date.now() - lastFlush > 10000 || i + PRICE_CONCURRENCY >= missing.length) {
      writeFileSync(file, JSON.stringify(products, null, 2), "utf8");
      lastFlush = Date.now();
    }
    process.stdout.write(`    phase2: ${Math.min(i + PRICE_CONCURRENCY, missing.length)}/${missing.length} (✓${updated})\r`);
    if (PRICE_DELAY_MS > 0 && i + PRICE_CONCURRENCY < missing.length) await new Promise(r => setTimeout(r, PRICE_DELAY_MS));
  }
  process.stdout.write("\n");
  return { attempted: missing.length, updated };
}

async function processSlug(apiBase, slug, hebQuery) {
  const tStart = Date.now();
  const before = countProductsForSlug(slug);
  console.log(`\n=== ${slug.padEnd(22)} q="${hebQuery}" — before: ${before.total} total, ${before.priced} priced ===`);

  // Phase 1
  console.log(`  phase1: browsing category…`);
  const p1 = await browseCategory(apiBase, hebQuery);
  if (!p1.ok) {
    console.log(`  phase1: FAILED ${p1.status || p1.error}`);
  } else {
    console.log(`  phase1: ${p1.candidates} candidates, ${p1.batches} batches, ${p1.completed ? "DONE" : "partial"}`);
  }

  // Phase 2
  let p2 = { attempted: 0, updated: 0 };
  if (!skipPrices) {
    p2 = await fillPrices(apiBase, slug);
    console.log(`  phase2: ${p2.updated}/${p2.attempted} prices added`);
  }

  const after = countProductsForSlug(slug);
  const dt = Math.round((Date.now() - tStart) / 1000);
  console.log(`  RESULT: ${after.total} total (+${after.total - before.total}), ${after.priced} priced (+${after.priced - before.priced}) — ${dt}s`);
  return {
    slug, hebQuery, durationSec: dt,
    before, after, phase1: p1, phase2: p2,
  };
}

async function main() {
  if (resetFlag) {
    if (existsSync(PROGRESS_FILE)) writeFileSync(PROGRESS_FILE, JSON.stringify({ done: [], startedAt: new Date().toISOString() }, null, 2));
    console.log("Progress reset.\n");
  }
  const apiBase = await detectApiBase();
  console.log(`Backfill ALL categories via ${apiBase}`);
  console.log(`  streamTimeout=${STREAM_TIMEOUT_MS/1000}s priceConcurrency=${PRICE_CONCURRENCY} priceDelay=${PRICE_DELAY_MS}ms cooldown=${COOLDOWN_MS}ms`);
  if (skipPrices) console.log("  --skip-prices: phase-2 disabled");
  if (onlyList)   console.log(`  --only: ${onlyList.join(", ")}`);

  const progress = loadProgress();
  const allSlugs = Object.keys(CATEGORY_QUERIES);
  const queue = allSlugs.filter(s => {
    if (onlyList && !onlyList.includes(s)) return false;
    if (progress.done.includes(s)) return false;
    return true;
  });

  console.log(`\nQueue: ${queue.length} categories (${progress.done.length} already done, ${allSlugs.length - queue.length - progress.done.length} skipped by --only)\n`);
  if (queue.length === 0) { console.log("Nothing to do."); return; }

  const startedAt = Date.now();
  for (let i = 0; i < queue.length; i++) {
    const slug = queue[i];
    const heb  = CATEGORY_QUERIES[slug];
    const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
    console.log(`\n[${i + 1}/${queue.length}] elapsed ${elapsedMin}min`);
    try {
      const result = await processSlug(apiBase, slug, heb);
      progress.done.push(slug);
      progress.lastResult = result;
      saveProgress(progress);
    } catch (e) {
      console.warn(`  ⚠️  ${slug} threw: ${e.message} — continuing`);
    }
    if (i < queue.length - 1 && COOLDOWN_MS > 0) {
      await new Promise(r => setTimeout(r, COOLDOWN_MS));
    }
  }

  console.log(`\n✅ DONE — ${queue.length} categories processed in ${Math.round((Date.now() - startedAt) / 60000)} min`);
  console.log(`Progress file: ${PROGRESS_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
