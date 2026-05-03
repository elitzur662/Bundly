/**
 * zap-bulk-scraper.js — Proactive ZAP category bulk scraper
 *
 * Scrapes all relevant ZAP categories and stores results in zap-categories.json.
 * ZAP category listing pages (models.aspx?sog=...) are NOT Cloudflare-blocked —
 * only individual model pages are. This gives us: model ID, name, min price, image.
 *
 * Usage:
 *   node zap-bulk-scraper.js           — scrape stale categories only
 *   node zap-bulk-scraper.js --force   — force-refresh all categories
 *   node zap-bulk-scraper.js --sog c-pclaptop  — single category
 *
 * Also exported for use by server.js cron.
 */

import axios from "axios";
import { saveCategoryToDB, getCategoryFromDB } from "./zap-db.js";

const ZAP_BASE = "https://www.zap.co.il";

// ── All SOG keys relevant to the app ────────────────────────────────────────
export const ALL_SOGS = [
  // ── Phones & Wearables
  "e-cellphone",      // סמארטפונים
  // ── TV & Audio
  "e-tv",             // טלוויזיות
  "e-headphone",      // אוזניות
  "e-speaker",        // רמקולים
  "e-mpspeakers",     // רמקולים ניידים
  "e-soundbar",       // סאונד בר
  "e-hometheater",    // קולנוע ביתי
  "e-slideprojector", // מקרנים
  // ── Cameras & Media
  "e-camera",         // מצלמות
  "e-mediaplayer",    // נגני מדיה / סטרימרים
  // ── Gaming
  "e-tvgame",         // קונסולות משחק
  // ── Computers
  "c-pclaptop",       // מחשבים ניידים
  "c-pcdesktop",      // מחשבים נייחים
  "c-tabletpc",       // טאבלטים
  "c-monitor",        // מסכי מחשב
  "c-graphiccard",    // כרטיסי מסך
  "c-keyboard",       // מקלדות
  "c-gamingchair",    // כסאות גיימינג
  "c-webcam",         // מצלמות רשת
  // ── Home Appliances
  "e-washingmachine", // מכונות כביסה
  "e-drayer",         // מייבשי כביסה
  "e-vaccumcleaner",  // שואבי אבק
  "e-fridge",         // מקררים
  "e-dishwasher",     // מדיחי כלים
  "e-coffeemachine",  // מכונות קפה
  "e-oven",           // תנורים
  "e-airconditioner", // מזגנים
];

// ── Config ───────────────────────────────────────────────────────────────────
const MAX_PAGES_PER_CAT = 60;   // 60 pages × 30 products/page = up to 1,800 products
const DELAY_BETWEEN_PAGES = 1500;  // ms between page requests (polite scraping)
const DELAY_BETWEEN_CATS  = 2000;  // ms between categories
const CACHE_FRESH_HOURS   = 5;     // skip category if cached within this many hours
const PAGE_TIMEOUT        = 18000; // ms per request

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
  "Referer":         "https://www.zap.co.il/",
  "DNT":             "1",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function makeListingUrl(sog, page) {
  return `${ZAP_BASE}/models.aspx?sog=${sog}&orderby=2${page > 1 ? `&pageinfo=${page}` : ""}`;
}

// ── HTML Parser ───────────────────────────────────────────────────────────────

/**
 * Extract product candidates from a ZAP models.aspx listing page.
 * Returns [{id, name, price, image}]
 */
function extractCandidatesFromHtml(html) {
  const seenIds = new Set();
  const candidates = [];

  // ── 1. Primary: href + aria-label (includes full product name) ──────────
  for (const m of html.matchAll(
    /href="\/model\.aspx\?modelid=(\d+)"[^>]{0,800}aria-label="להשוואת מחירים\s+([^"]{5,120})"/g
  )) {
    if (!seenIds.has(m[1])) {
      seenIds.add(m[1]);
      candidates.push({ id: m[1], name: m[2].trim() });
    }
  }

  // ── 2. data-model-id (ZAP's current HTML format) ────────────────────────
  for (const m of html.matchAll(/data-model-id="(\d+)"[^>]{0,400}/g)) {
    const id = m[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const mfr = m[0].match(/data-manufacturer="([^"]{2,80})"/i);
    candidates.push({ id, name: mfr ? mfr[1].trim() : "" });
  }

  // ── 3. Fallback: any model page link ────────────────────────────────────
  for (const m of html.matchAll(/href="[^"]*\/model\.aspx\?modelid=(\d+)[^"]*"/gi)) {
    if (!seenIds.has(m[1])) {
      seenIds.add(m[1]);
      candidates.push({ id: m[1], name: "" });
    }
  }

  // ── 4. Enrich with min price + image from same HTML block ────────────────
  // Use ONLY data-model-id="..." anchors (one per product card) so each block
  // spans the full product card. Using href modelid= as anchors caused blocks
  // of only ~100 chars (since modelid appears 6–10× per card), too small to
  // contain the bidPrice div which may be hundreds of chars after the first modelid.
  const allIdMatches = [...html.matchAll(/data-model-id="(\d+)"/gi)];
  const seenEnrich = new Set(); // skip duplicate data-model-id occurrences

  for (let i = 0; i < allIdMatches.length; i++) {
    const id = allIdMatches[i][1];
    if (!id || seenEnrich.has(id)) continue;
    seenEnrich.add(id);

    // Find where the next UNIQUE product card starts
    let nextStart = null;
    for (let j = i + 1; j < allIdMatches.length; j++) {
      if (!seenEnrich.has(allIdMatches[j][1])) {
        nextStart = allIdMatches[j].index;
        break;
      }
    }

    const blockStart = allIdMatches[i].index;
    const blockEnd   = nextStart != null
      ? Math.min(nextStart, blockStart + 10000)
      : Math.min(blockStart + 10000, html.length);
    const block = html.slice(blockStart, blockEnd);

    // Price: ZAP currently uses class="bidPrice" (capital P).
    // Pattern 1: any *Price* CSS class (case-insensitive) — covers bidPrice, minPrice, etc.
    // Pattern 2: "מ-X,XXX ₪" prefix format used on some pages.
    // Pattern 3: JSON price field.
    // Pattern 4: any >whitespace digits ₪ (broadest fallback, case-insensitive).
    const priceMatch =
      block.match(/class="[^"]*[Pp]rice[^"]*"[^>]*>\s*([\d,]{3,7})\s*(?:₪|&#8362;)/) ||
      block.match(/מ[^0-9<]{0,8}([\d,]{3,7})\s*(?:₪|&#8362;|&rlm;)/) ||
      block.match(/"price"\s*:\s*"?([\d]{3,7})"?/) ||
      block.match(/>\s*([\d,]{3,7})\s*₪/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : 0;

    // Image: ZAP serves .gif thumbnails from img.zap.co.il CDN (e.g. 97500491b.gif).
    // Added gif to extension list; also allow no-extension CDN URLs.
    const imgMatch =
      block.match(/src="(https?:\/\/img\.zap\.co\.il[^"]{5,200})"/i) ||
      block.match(/src="(https?:\/\/[^"]{10,200}\.(?:jpe?g|png|webp|gif)[^"]*)"/i) ||
      block.match(/src="(\/[^"]{5,120}\.(?:jpe?g|png|webp|gif)[^"]*)"/i);
    const rawImg = imgMatch?.[1] || "";
    const image  = rawImg.startsWith("http") ? rawImg
      : rawImg ? `${ZAP_BASE}${rawImg}` : "";

    // Apply to matching candidate
    const c = candidates.find(c => c.id === id);
    if (c) {
      if (price >= 50 && price <= 500000) c.price = price;
      if (image) c.image = image;
    }
  }

  return candidates;
}

/**
 * Detect if ZAP returned a Cloudflare challenge page.
 */
function isCfChallenge(html) {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("Checking your browser") ||
    html.includes("DDoS protection by Cloudflare") ||
    html.length < 2000
  );
}

// ── Per-category scraper ──────────────────────────────────────────────────────

async function scrapeCategory(sog) {
  const allCandidates = [];
  const seenIds       = new Set();
  let   emptyStreak   = 0;
  let   cfBlocked     = false;

  for (let page = 1; page <= MAX_PAGES_PER_CAT; page++) {
    const url = makeListingUrl(sog, page);
    try {
      const resp = await axios.get(url, {
        timeout:        PAGE_TIMEOUT,
        headers:        HEADERS,
        validateStatus: s => s < 500,
        maxRedirects:   3,
        decompress:     true,
      });

      const html = typeof resp.data === "string" ? resp.data : "";

      // Cloudflare or empty page
      if (!html || isCfChallenge(html)) {
        console.warn(`[ZapBulk]   ${sog} p${page} — CF challenge or empty (status=${resp.status})`);
        cfBlocked = true;
        break;
      }

      const candidates = extractCandidatesFromHtml(html);
      const fresh = candidates.filter(c => !seenIds.has(c.id));

      if (fresh.length === 0) {
        emptyStreak++;
        if (emptyStreak >= 2) break; // end of category
      } else {
        emptyStreak = 0;
        fresh.forEach(c => { seenIds.add(c.id); allCandidates.push(c); });
        process.stdout.write(`\r[ZapBulk]   ${sog}: ${allCandidates.length} products (p${page})   `);
      }
    } catch (e) {
      console.warn(`\n[ZapBulk]   ${sog} p${page} — error: ${e.message}`);
      emptyStreak++;
      if (emptyStreak >= 3) break;
    }

    if (page < MAX_PAGES_PER_CAT) await sleep(DELAY_BETWEEN_PAGES);
  }

  process.stdout.write("\n");

  const priced = allCandidates.filter(c => c.price > 0).length;
  const imaged = allCandidates.filter(c => c.image).length;
  console.log(
    `[ZapBulk] ✓ ${sog} — ${allCandidates.length} products` +
    ` (${priced} priced, ${imaged} with images)` +
    (cfBlocked ? " ⚠️ CF blocked mid-scrape" : "")
  );

  return allCandidates;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scrape all (or specified) ZAP categories.
 * @param {object} opts
 * @param {string[]} opts.sogs      — which SOGs to scrape (default: ALL_SOGS)
 * @param {boolean}  opts.force     — ignore cache freshness
 * @returns {number} total products saved
 */
export async function scrapeAll({ sogs = ALL_SOGS, force = false } = {}) {
  const startTime = Date.now();
  let totalSaved  = 0;
  let skipped     = 0;

  console.log(`[ZapBulk] ═══ Starting bulk scrape: ${sogs.length} categories (force=${force}) ═══`);

  for (const sog of sogs) {
    try {
      // Skip fresh cache entries unless force=true
      if (!force) {
        const cached  = getCategoryFromDB(sog);
        const ageHrs  = cached?.ts ? (Date.now() - cached.ts) / 3_600_000 : Infinity;
        const hasProd = (cached?.candidates?.length || 0) > 0;
        if (hasProd && ageHrs < CACHE_FRESH_HOURS) {
          console.log(`[ZapBulk] ↷ ${sog} — fresh (${ageHrs.toFixed(1)}h old, ${cached.candidates.length} products)`);
          skipped++;
          continue;
        }
      }

      const candidates = await scrapeCategory(sog);

      if (candidates.length > 0) {
        saveCategoryToDB(sog, candidates);
        totalSaved += candidates.length;
      } else {
        console.warn(`[ZapBulk] ✗ ${sog} — no products found, cache unchanged`);
      }
    } catch (e) {
      console.error(`[ZapBulk] ✗ ${sog} — fatal: ${e.message}`);
    }

    await sleep(DELAY_BETWEEN_CATS);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;
  console.log(
    `[ZapBulk] ═══ Done! ${totalSaved} products saved` +
    ` (${skipped} categories skipped as fresh) in ${mins}m${secs}s ═══`
  );

  return totalSaved;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("zap-bulk-scraper.js");
if (isMain) {
  const force  = process.argv.includes("--force");
  const sogArg = process.argv.find(a => a.startsWith("--sog="))?.split("=")[1]
              || (process.argv.indexOf("--sog") >= 0 ? process.argv[process.argv.indexOf("--sog") + 1] : null);
  const sogs   = sogArg ? [sogArg] : ALL_SOGS;

  scrapeAll({ sogs, force }).then(count => {
    console.log(`[ZapBulk] Total: ${count} products.`);
    process.exit(0);
  }).catch(e => {
    console.error("[ZapBulk] Fatal:", e.message);
    process.exit(1);
  });
}
