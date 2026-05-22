/**
 * Bundly — Zap image refresh.  Run with:  node scripts/fetch-zap-images.mjs
 *
 * מושך תמונות נכונות לכל מוצר בקטלוג ישירות מ-zap.co.il.
 * Fetches the OFFICIAL product image (and the full image gallery, when Zap
 * has more than one) for every product in product-db/<category>/products.json,
 * straight from the Zap model page — the same source the catalog was built
 * from, so the image is guaranteed to match the product.
 *
 * For each product it updates, on success:
 *   p.image     → primary Zap image URL  (server uses this first)
 *   p.imageUrl  → primary Zap image URL  (fallback field)
 *   p.imageUrls → array of ALL Zap gallery images for that model
 *   p.imagesMeta→ { source, modelid, ts }   (traceability)
 * On failure it leaves the product untouched (never wipes an existing image).
 *
 * It is fully RESUMABLE: progress is cached to scripts/.cache/zap-images.json
 * after every product, so you can stop it (Ctrl+C) and re-run it any time —
 * it picks up exactly where it left off. products.json is rewritten safely
 * (temp file + rename) and a one-time backup .pre-zap-images.bak is kept.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * USAGE
 *   node scripts/fetch-zap-images.mjs                       # all categories
 *   node scripts/fetch-zap-images.mjs --preset=launch       # key launch categories
 *   node scripts/fetch-zap-images.mjs --category=tvs        # one category only
 *   node scripts/fetch-zap-images.mjs --categories=tvs,phones,laptops
 *   node scripts/fetch-zap-images.mjs --limit=50            # first 50 (a test run)
 *   node scripts/fetch-zap-images.mjs --dry-run             # fetch, don't write
 *   node scripts/fetch-zap-images.mjs --force               # ignore the cache
 *   node scripts/fetch-zap-images.mjs --retry-failed        # retry only failures
 *   node scripts/fetch-zap-images.mjs --delay=900           # ms between requests
 *
 * PRESETS:  launch = tvs, fridges, washing-machines, phones, laptops
 *
 * TIP: the full catalog is ~29k products — a full run takes hours and Zap will
 *      throttle the connection. For launch, run --preset=launch (much smaller).
 * ──────────────────────────────────────────────────────────────────────────
 */
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, "..");
const PRODUCT_DB = path.join(ROOT, "product-db");
const CACHE_DIR  = path.join(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "zap-images.json");
const REPORT_FILE= path.join(CACHE_DIR, "zap-images-report.json");

const ZAP = "https://www.zap.co.il";

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg  = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const hasFlag = (k)     => args.includes(`--${k}`);

// Named category bundles. "launch" = the big-ticket categories that matter
// most for opening day (small enough to finish in ~1–2 runs).
const PRESETS = {
  launch: ["tvs", "fridges", "washing-machines", "phones", "laptops"],
};

// Resolve which categories to process: --preset > --categories > --category > all.
function resolveCategoryList() {
  const preset = getArg("preset", null);
  if (preset) {
    if (!PRESETS[preset]) {
      console.error(`❌ Unknown preset "${preset}". Available: ${Object.keys(PRESETS).join(", ")}`);
      process.exit(1);
    }
    return PRESETS[preset];
  }
  const many = getArg("categories", null);
  if (many) return many.split(",").map(s => s.trim()).filter(Boolean);
  const one = getArg("category", null);
  if (one) return [one];
  return null; // null = every category
}

const OPT = {
  categories:  resolveCategoryList(),
  limit:       parseInt(getArg("limit", "0"), 10) || 0,
  delay:       parseInt(getArg("delay", "1000"), 10) || 1000,
  dryRun:      hasFlag("dry-run"),
  force:       hasFlag("force"),
  retryFailed: hasFlag("retry-failed"),
};

// ── HTTP ────────────────────────────────────────────────────────────────────
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];
function headers() {
  return {
    "User-Agent":      UAS[Math.floor(Math.random() * UAS.length)],
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer":         "https://www.zap.co.il/",
    "Connection":      "keep-alive",
    "DNT":             "1",
  };
}
function isCfChallenge(html) {
  return !html
    || html.length < 1500
    || /Just a moment|cf-browser-verification|Checking your browser|Attention Required|Access denied/i.test(html);
}
/** GET a Zap URL. Throws Error("CF") if Cloudflare-challenged. */
async function getHtml(url) {
  const r = await axios.get(url, {
    timeout: 25000, headers: headers(), maxRedirects: 4,
    validateStatus: s => s < 500, decompress: true,
  });
  const html = typeof r.data === "string" ? r.data : "";
  if (r.status === 403 || r.status === 429 || isCfChallenge(html)) {
    const e = new Error("CF"); e.cf = true; throw e;
  }
  return html;
}

// ── Parsing ─────────────────────────────────────────────────────────────────
const decode = (s) => (s || "")
  .replace(/&amp;rlm;|&rlm;|&lrm;|&amp;lrm;/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#8362;|&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim();

/**
 * True for a real Zap product image. Zap uses two path shapes —
 *   /pics/7/8/0/3/93803087b.gif      (split-digit)
 *   /pics/new/235135041890c.gif      (newer)
 * — and serves store logos / site chrome under /pics/imgs/… which we reject.
 */
const isZapPic = (u) => {
  if (!u || !/img\.zap\.co\.il\/pics\//i.test(u)) return false;
  if (!/\.(?:gif|jpe?g|png|webp)(?:[?#]|$)/i.test(u)) return false;
  const tail = u.replace(/^.*\/pics\//i, "");
  return /^(?:new\/)?\d/.test(tail);
};

/**
 * Parse a Zap model.aspx page. Returns:
 *   null               → page didn't load as a model page (throttle → retry)
 *   { h1, noImage }     → real model page, but Zap has no product photo for it
 *   { h1, primary, gallery } → success
 */
function parseModelPage(html) {
  const h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1  = h1m ? decode(h1m[1]) : "";
  if (!h1) return null;   // not a real model page (or a throttle page)

  const ogm = html.match(/property="og:image"[^>]*content="([^"]+)"/i);
  const og  = ogm && isZapPic(ogm[1]) ? ogm[1] : "";

  // Gallery: the carousel-item <img data-index="N" src="..."> nodes (large c.gif).
  const gallery = [];
  for (const m of html.matchAll(/<img[^>]*\bdata-index="(\d+)"[^>]*\bsrc="([^"]+)"/gi)) {
    if (isZapPic(m[2])) gallery.push({ idx: parseInt(m[1], 10), url: m[2] });
  }
  gallery.sort((a, b) => a.idx - b.idx);

  // Primary first, then gallery; dedupe by numeric filename stem.
  const ordered = [og, ...gallery.map(g => g.url)].filter(Boolean);
  const seen = new Set(); const out = [];
  for (const u of ordered) {
    const stem = (u.match(/\/(\d+)[a-z]?\.(?:gif|jpe?g|png|webp)/i) || [])[1] || u;
    if (seen.has(stem)) continue;
    seen.add(stem); out.push(u);
  }
  if (!out.length) return { h1, noImage: true };
  return { h1, primary: out[0], gallery: out };
}

/**
 * Collect candidate { modelid, name } from a Zap results page, in page order.
 * Handles every layout Zap returns — search.aspx (ModelPic anchor cards) and
 * models.aspx (classic anchor listing + the newer card-v2 grid). search.aspx
 * 302-redirects to models.aspx whenever the query maps onto a category.
 * card-v2 cards expose only the id (no clean name) — the caller verifies those
 * against the model page's own <h1>.
 */
function parseSearchResults(html) {
  const out = []; const seen = new Set();
  // (a) Anchor cards — the product name is in the aria-label.
  for (const m of html.matchAll(/href="\/model\.aspx\?modelid=(\d+)"[^>]*?aria-label="([^"]{4,200})"/gi)) {
    if (seen.has(m[1])) continue;
    const name = decode(m[2].replace(/להשוואת מחירים/g, ""));
    if (!name) continue;
    seen.add(m[1]);
    out.push({ modelid: m[1], name });
  }
  // (b) card-v2 grid cards — only data-model-id is exposed.
  for (const m of html.matchAll(/data-model-id="(\d+)"/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ modelid: m[1], name: "" });
  }
  return out;
}

// ── Name matching (for products whose id is not a usable Zap modelid) ────────
function tokens(s) {
  return (s || "").toLowerCase()
    .replace(/[֐-׿]+/g, " ")          // drop Hebrew (category prefix words)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/).filter(t => t.length >= 2);
}
const codeTokens = (s) => tokens(s).filter(t => /\d/.test(t));

/** 0..1 similarity; demands every model-code token (e.g. "x50") be present. */
function matchScore(catalogName, candName) {
  const ct = tokens(catalogName);
  if (!ct.length) return 0;
  const cd = new Set(tokens(candName));
  const overlap = ct.filter(t => cd.has(t)).length / ct.length;
  const codesOk = codeTokens(catalogName).every(c => cd.has(c));
  return codesOk ? overlap : overlap * 0.3;
}
// ── Fetch wrapper: retries Cloudflare challenges AND transient network errors ─
let consecutiveCf = 0;     // consecutive Cloudflare challenges
let consecutiveErr = 0;    // consecutive products that failed with a network error
async function getHtmlResilient(url) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const html = await getHtml(url);
      consecutiveCf = 0;
      return html;
    } catch (e) {
      lastErr = e;
      if (e.cf) {
        // Cloudflare challenge — exponential backoff.
        consecutiveCf++;
        if (consecutiveCf >= 12) throw new Error("ABORT_CF");   // Zap hard-blocking us
        const wait = Math.min(30000 * 2 ** attempt, 600000);
        console.log(`   ⏳ Cloudflare challenge — backing off ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/5)…`);
        await sleep(wait);
      } else {
        // Transient network error (timeout / reset) — short backoff, retry a few times.
        if (attempt >= 2) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  throw lastErr || new Error("ABORT_CF");
}

/**
 * Resolve one product to { primary, gallery, modelid }.
 * Returns null  → genuinely not found on Zap (cache as "unmatched").
 * Throws "TRANSIENT" → network errors prevented a verdict (cache as "error",
 *                      auto-retried on the next run).
 * Throws "ABORT_CF"  → Zap is hard-blocking; the run must stop.
 */
async function resolveImages(product) {
  const id   = String(product.id || "").trim();
  const name = product.name || "";
  let hadError = false;

  // 1) Try the product's own id as a Zap modelid.
  if (/^\d{5,9}$/.test(id)) {
    try {
      const parsed = parseModelPage(await getHtmlResilient(`${ZAP}/model.aspx?modelid=${id}`));
      if (parsed && parsed.primary) return { ...parsed, modelid: id, via: "id" };
      // !parsed → page didn't load (soft-throttle) → retryable.
      // parsed.noImage → real page but Zap has no photo → fall through to search.
      if (!parsed) hadError = true;
    } catch (e) {
      if (e.message === "ABORT_CF") throw e;
      hadError = true;            // fall through to search
    }
  }

  // 2) Fall back to a Zap keyword search.
  // Search the latin part first (brand + model code — far more precise),
  // then the full Hebrew name as a backup.
  if (name) {
    const latin   = name.replace(/[֐-׿]+/g, " ").replace(/\s+/g, " ").trim();
    const queries = [];
    if (latin && tokens(latin).length >= 2) queries.push(latin);
    queries.push(name);

    // Collect candidate models from the first query that yields any.
    let candidates = [];
    for (const q of queries) {
      await sleep(OPT.delay);
      try {
        candidates = parseSearchResults(await getHtmlResilient(`${ZAP}/search.aspx?keyword=${encodeURIComponent(q)}`));
      } catch (e) {
        if (e.message === "ABORT_CF") throw e;
        hadError = true;
      }
      if (candidates.length) break;
    }

    // Rank: candidates whose name clearly matches go first; nameless card-v2
    // candidates follow and get verified against the model page <h1>. Cap at 6
    // model-page fetches so a bad search can't explode the request count.
    const ranked = candidates
      .map(c => ({ ...c, nameScore: c.name ? matchScore(name, c.name) : -1 }))
      .filter(c => c.nameScore === -1 || c.nameScore >= 0.6)
      .sort((a, b) => b.nameScore - a.nameScore)
      .slice(0, 6);

    for (const c of ranked) {
      try {
        await sleep(OPT.delay);
        const parsed = parseModelPage(await getHtmlResilient(`${ZAP}/model.aspx?modelid=${c.modelid}`));
        if (parsed && parsed.primary &&
            (c.nameScore >= 0.6 || matchScore(name, parsed.h1) >= 0.6)) {
          return { ...parsed, modelid: c.modelid, via: "search" };
        }
        if (!parsed) hadError = true;
      } catch (e) {
        if (e.message === "ABORT_CF") throw e;
        hadError = true;
      }
    }
  }

  // No image. If a network error got in the way, mark it retryable.
  if (hadError) throw new Error("TRANSIENT");
  return null;
}

// ── File helpers ─────────────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJsonAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// ── Cache (resumability) ─────────────────────────────────────────────────────
fs.mkdirSync(CACHE_DIR, { recursive: true });
const cache = OPT.force ? {} : readJson(CACHE_FILE, {});
let cacheDirty = false;
function saveCache() { if (cacheDirty) { writeJsonAtomic(CACHE_FILE, cache); cacheDirty = false; } }

// ── Main ─────────────────────────────────────────────────────────────────────
const stats = { ok: 0, gallery: 0, copied: 0, unmatched: 0, error: 0, skipped: 0, processed: 0 };
const unmatched = [];
let stopping = false;
process.on("SIGINT", () => { console.log("\n⏹  Stopping — flushing progress…"); stopping = true; });

async function processCategory(category) {
  const file = path.join(PRODUCT_DB, category, "products.json");
  if (!fs.existsSync(file)) return;

  const raw  = readJson(file, null);
  if (!raw) { console.log(`  ⚠️  ${category}: products.json unreadable — skipped`); return; }
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw.products) ? raw.products : null);
  if (!list || !list.length) { console.log(`  ·  ${category}: empty — skipped`); return; }

  // One-time safety backup before the first write to this category.
  const backup = path.join(PRODUCT_DB, category, "products.json.pre-zap-images.bak");
  if (!OPT.dryRun && !fs.existsSync(backup)) fs.copyFileSync(file, backup);

  console.log(`\n📂 ${category} — ${list.length} products`);
  let dirty = false, since = 0, done = 0;

  for (const product of list) {
    if (stopping) break;
    if (OPT.limit && stats.processed >= OPT.limit) break;

    const key    = `${category}/${product.id}`;
    const cached = cache[key];

    // Resume logic:
    //   ok        → re-apply the cached image, skip the network call
    //   error     → ALWAYS retry (transient failure last time)
    //   unmatched → skip, unless --retry-failed is given
    if (cached && !OPT.force) {
      if (cached.status === "ok") {
        if (product.image !== cached.primary) {
          product.image     = cached.primary;
          product.imageUrl  = cached.primary;
          product.imageUrls = cached.gallery;
          product.imagesMeta= { source: "zap", modelid: cached.modelid, ts: cached.ts };
          dirty = true;
        }
        stats.skipped++;
        continue;
      }
      if (cached.status === "unmatched" && !OPT.retryFailed) { stats.skipped++; continue; }
      // cached.status === "error"  →  fall through and retry
    }

    stats.processed++; done++;
    let res = null, transient = false;
    try {
      res = await resolveImages(product);
    } catch (e) {
      if (e.message === "ABORT_CF") {
        console.log("\n🛑 Cloudflare is blocking us repeatedly. Saving progress and exiting.");
        console.log("   Wait ~15–30 min, then re-run the same command — it resumes automatically.");
        if (!OPT.dryRun && dirty) writeJsonAtomic(file, raw);
        saveCache();
        finishReport();
        process.exit(2);
      }
      transient = true;   // "TRANSIENT" or any other error → retryable next run
    }

    if (res && res.primary) {
      product.image      = res.primary;
      product.imageUrl   = res.primary;
      product.imageUrls  = res.gallery;
      product.imagesMeta = { source: "zap", modelid: res.modelid, ts: Date.now() };
      cache[key] = { status: "ok", primary: res.primary, gallery: res.gallery, modelid: res.modelid, ts: Date.now() };
      stats.ok++;
      if (res.gallery.length > 1) stats.gallery++;
      dirty = true;
      const tag = res.gallery.length > 1 ? `🖼️×${res.gallery.length}` : "🖼️";
      process.stdout.write(`\r  ✓ ${done}/${list.length}  ${tag} ${product.name?.slice(0, 46) || ""}`.padEnd(78));
      consecutiveErr = 0;
    } else if (transient) {
      cache[key] = { status: "error", ts: Date.now() };
      stats.error++;
      consecutiveErr++;
      process.stdout.write(`\r  ⚠ ${done}/${list.length}  network error (will retry): ${product.name?.slice(0, 32) || ""}`.padEnd(78));
    } else {
      cache[key] = { status: "unmatched", ts: Date.now() };
      stats.unmatched++;
      unmatched.push({ category, id: product.id, name: product.name });
      // A "no match" means Zap *answered* us — that is NOT a throttle signal,
      // so it resets the network-error streak rather than adding to it.
      consecutiveErr = 0;
      process.stdout.write(`\r  ? ${done}/${list.length}  no Zap match: ${product.name?.slice(0, 40) || ""}`.padEnd(78));
    }
    cacheDirty = true;

    // Safety net: a long unbroken streak of *network errors* (not "no match")
    // means Zap is throttling/blocking this IP at the connection level. Stop
    // cleanly so the wrapper can cool down — rather than burning the whole
    // catalog marking everything as failed.
    if (consecutiveErr >= 40) {
      console.log("\n\n🛑 40 network errors in a row — Zap is throttling this IP.");
      console.log("   Progress is saved. Wait, then re-run — it resumes automatically.");
      if (!OPT.dryRun && dirty) writeJsonAtomic(file, raw);
      saveCache();
      finishReport();
      process.exit(2);
    }

    // Flush periodically so a crash never loses much.
    if (++since >= 20) {
      since = 0;
      if (!OPT.dryRun && dirty) { writeJsonAtomic(file, raw); dirty = false; }
      saveCache();
    }
    await sleep(OPT.delay + Math.floor(Math.random() * 250));
  }

  // ── Second pass: inherit-from-sibling ──────────────────────────────────────
  // The catalog has many duplicate rows of the same product (different ids,
  // identical name). If any one row resolved from Zap, every still-unresolved
  // row with the same name copies its image — no extra network calls, and it
  // cleans up exactly the duplicate-image pollution this script exists to fix.
  const normName = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const byName = new Map();
  for (const p of list) {
    const ce = cache[`${category}/${p.id}`];
    if (ce && ce.status === "ok" && ce.primary) {
      const nk = normName(p.name);
      if (nk && !byName.has(nk)) byName.set(nk, ce);
    }
  }
  for (const p of list) {
    const k  = `${category}/${p.id}`;
    const ce = cache[k];
    if (ce && ce.status === "ok") continue;          // already has an image
    const src = byName.get(normName(p.name));
    if (!src) continue;
    p.image      = src.primary;
    p.imageUrl   = src.primary;
    p.imageUrls  = src.gallery;
    p.imagesMeta = { source: "zap-sibling", modelid: src.modelid, ts: Date.now() };
    cache[k] = { status: "ok", primary: src.primary, gallery: src.gallery, modelid: src.modelid, ts: Date.now(), via: "sibling" };
    dirty = true; cacheDirty = true;
    stats.copied++;
    if (ce && ce.status === "error") stats.error = Math.max(0, stats.error - 1);
    else stats.unmatched = Math.max(0, stats.unmatched - 1);
    const ui = unmatched.findIndex(u => u.category === category && String(u.id) === String(p.id));
    if (ui >= 0) unmatched.splice(ui, 1);
  }

  if (!OPT.dryRun && dirty) writeJsonAtomic(file, raw);
  saveCache();
  process.stdout.write("\n");
}

function finishReport() {
  writeJsonAtomic(REPORT_FILE, {
    ranAt: new Date().toISOString(), options: OPT, stats, unmatched,
  });
}

async function main() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(" 🖼️  BUNDLY — משיכת תמונות מ-Zap לכל המוצרים");
  console.log("──────────────────────────────────────────────────────────");

  const allCategories = fs.readdirSync(PRODUCT_DB)
    .filter(d => fs.statSync(path.join(PRODUCT_DB, d)).isDirectory());
  let categories = allCategories;
  if (OPT.categories) {
    const want    = new Set(OPT.categories);
    const missing = OPT.categories.filter(c => !allCategories.includes(c));
    if (missing.length) {
      console.error(`❌ Unknown categor${missing.length > 1 ? "ies" : "y"}: ${missing.join(", ")}`);
      console.error("   Folders under product-db/:\n   " + allCategories.join(", "));
      process.exit(1);
    }
    categories = allCategories.filter(c => want.has(c));
  }

  const totalProducts = categories.reduce((n, c) => {
    const raw = readJson(path.join(PRODUCT_DB, c, "products.json"), []);
    const list = Array.isArray(raw) ? raw : raw.products || [];
    return n + list.length;
  }, 0);
  const estMin = Math.round((totalProducts * (OPT.delay + 800)) / 60000);
  const scope = OPT.categories ? categories.join(", ") : "all categories";
  console.log(`Scope: ${scope}`);
  console.log(`Categories: ${categories.length}  |  Products: ${totalProducts}`);
  console.log(`Mode: ${OPT.dryRun ? "DRY-RUN (no writes)" : "write"}${OPT.force ? " | force" : ""}${OPT.retryFailed ? " | retry-failed" : ""}`);
  console.log(`Delay: ${OPT.delay}ms  |  Rough estimate: ~${estMin} min for a full fresh run`);
  console.log("Resumable — press Ctrl+C any time, then re-run the same command.\n");

  const t0 = Date.now();
  for (const c of categories) {
    if (stopping) break;
    if (OPT.limit && stats.processed >= OPT.limit) break;
    await processCategory(c);
  }

  finishReport();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log("\n──────────────────────────────────────────────────────────");
  console.log(` Done in ${mins} min`);
  console.log(`   ✓ updated:        ${stats.ok}  (of which ${stats.gallery} got multiple images)`);
  console.log(`   ⎘ copied from a same-name twin: ${stats.copied}`);
  console.log(`   ? no Zap match:   ${stats.unmatched}`);
  console.log(`   ↷ skipped/cached: ${stats.skipped}`);
  console.log(`   ❌ errors:         ${stats.error}`);
  console.log(`   Report: ${path.relative(ROOT, REPORT_FILE)}`);
  console.log("──────────────────────────────────────────────────────────");
}

main().catch(e => { console.error("\n💥 Fatal:", e.message); saveCache(); finishReport(); process.exit(1); });
