/**
 * wisebuy-scraper.js — WiseBuy.co.il bulk scraper
 *
 * WiseBuy aggregates ZAP products and prices without Cloudflare protection.
 * Uses the SAME SOG category codes as ZAP. Product IDs match ZAP model IDs
 * (element id="box_{zapModelId}"). Images come from ZAP's CDN directly.
 *
 * This replaces zap-bulk-scraper.js for bulk data collection.
 * Saves results to zap-categories.json via the same DB API.
 *
 * Usage:
 *   node wisebuy-scraper.js              — scrape stale categories only
 *   node wisebuy-scraper.js --force      — force-refresh all categories
 *   node wisebuy-scraper.js --sog c-pclaptop  — single category
 *
 * Also exported for use by server.js cron.
 */

import axios from "axios";
import { saveCategoryToDB, getCategoryFromDB } from "./zap-db.js";

const WB_BASE = "https://www.wisebuy.co.il";

// ── All SOG keys relevant to the app ─────────────────────────────────────────
// WiseBuy uses the same category codes as ZAP.
export const ALL_SOGS = [
  // Phones & Wearables
  "e-cellphone",      // סמארטפונים
  // TV & Audio
  "e-tv",             // טלוויזיות
  "e-headphone",      // אוזניות
  "e-speaker",        // רמקולים
  "e-mpspeakers",     // רמקולים ניידים
  "e-soundbar",       // סאונד בר
  "e-hometheater",    // קולנוע ביתי
  "e-slideprojector", // מקרנים
  // Cameras & Media
  "e-camera",         // מצלמות
  "e-mediaplayer",    // נגני מדיה / סטרימרים
  // Gaming
  "e-tvgame",         // קונסולות משחק
  // Computers
  "c-pclaptop",       // מחשבים ניידים
  "c-pcdesktop",      // מחשבים נייחים
  "c-tabletpc",       // טאבלטים
  "c-monitor",        // מסכי מחשב
  "c-graphiccard",    // כרטיסי מסך
  "c-keyboard",       // מקלדות
  "c-gamingchair",    // כסאות גיימינג
  "c-webcam",         // מצלמות רשת
  // Home Appliances
  "e-washingmachine", // מכונות כביסה
  "e-drayer",         // מייבשי כביסה
  "e-vaccumcleaner",  // שואבי אבק
  "e-fridge",         // מקררים
  "e-dishwasher",     // מדיחי כלים
  "e-coffeemachine",  // מכונות קפה
  "e-oven",           // תנורים
  "e-airconditioner", // מזגנים
];

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_PAGES_PER_CAT  = 60;    // WiseBuy rarely exceeds 20 pages (~600 products)
const DELAY_BETWEEN_PAGES = 1200; // ms between page requests
const DELAY_BETWEEN_CATS  = 1500; // ms between categories
const CACHE_FRESH_HOURS   = 5;    // skip category if cached within this many hours
const PAGE_TIMEOUT        = 18000;

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
  "Referer":         "https://www.wisebuy.co.il/",
  "DNT":             "1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function makeListingUrl(sog, page) {
  const pageParam = page > 1 ? `&pageinfo=${page}` : "";
  return `${WB_BASE}/products.aspx?category=${sog}${pageParam}`;
}

function isBlocked(html) {
  return (
    !html ||
    html.length < 1000 ||
    html.includes("Connection blocked") ||
    html.includes("Access Denied") ||
    html.includes("403 Forbidden") ||
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification")
  );
}

// ── HTML Parser ───────────────────────────────────────────────────────────────

/**
 * Extract product candidates from a WiseBuy products.aspx listing page.
 *
 * HTML structure (verified in browser 2026-03):
 *   <div id="box_{zapModelId}" ...>
 *     <img src="https://img.zap.co.il/..." />
 *     <div class="ProdInfoTitle">Product Name</div>
 *     <div class="pricesTxt">מחיר סופי: 3,550 ₪</div>
 *     <div class="numOfStores">ב-StoreName</div>
 *   </div>
 *
 * Returns [{id, name, price, image}] where id = ZAP model ID.
 */
function extractProducts(html) {
  const seenIds  = new Set();
  const products = [];

  // Find all product box IDs
  const boxMatches = [...html.matchAll(/id="box_(\d+)"/g)];
  if (boxMatches.length === 0) return products;

  for (let i = 0; i < boxMatches.length; i++) {
    const id = boxMatches[i][1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Slice HTML block for this product (from this box to the next)
    const blockStart = boxMatches[i].index;
    const nextStart  = boxMatches[i + 1]?.index;
    const blockEnd   = nextStart != null
      ? Math.min(nextStart, blockStart + 5000)
      : Math.min(blockStart + 5000, html.length);
    const block = html.slice(blockStart, blockEnd);

    // ── Name: class="ProdInfoTitle" ──────────────────────────────────────────
    // Variations: ProdInfoTitle, ProdInfoTitleLink
    const nameMatch =
      block.match(/class="ProdInfoTitleLink"[^>]*>\s*([^<]{3,150})\s*<\/a>/) ||
      block.match(/class="ProdInfoTitle(?:Link)?"[^>]*>\s*([^<]{3,150})</) ||
      block.match(/class="[^"]*ProdInfoTitle[^"]*"[^>]*>\s*<(?:a|span)[^>]*>\s*([^<]{3,150})/) ||
      block.match(/class="[^"]*ProdInfoTitle[^"]*"[^>]*>([^<]{3,150})</);
    const name = nameMatch ? nameMatch[1].replace(/&amp;/g,"&").replace(/&#39;/g,"'").trim() : "";

    // ── Price: class="pricesTxt" or class="PriceUpdate" ─────────────────────
    // Formats: "מחיר סופי: 3,550 ₪" / "3,550 ₪" / "מ-3,550 ₪"
    const priceBlock = block.match(/class="(?:pricesTxt|PriceUpdate|price)[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/)?.[1] || "";
    const priceMatch =
      priceBlock.match(/([\d,]{3,7})\s*₪/) ||
      block.match(/class="(?:pricesTxt|PriceUpdate|price)[^"]*"[^>]*>[^<]*?([\d,]{3,7})\s*₪/);
    const price = priceMatch
      ? parseInt(priceMatch[1].replace(/,/g, ""), 10)
      : 0;

    // ── Image: first img in block ────────────────────────────────────────────
    // WiseBuy uses ZAP CDN: img.zap.co.il
    const imgMatch =
      block.match(/src="(https?:\/\/img\.zap\.co\.il[^"]{5,200})"/) ||
      block.match(/src="(https?:\/\/[^"]{10,200}\.(?:jpe?g|png|webp|gif)[^"]*)"/i) ||
      block.match(/src="(\/[^"]{5,120}\.(?:jpe?g|png|webp|gif)[^"]*)"/i);
    const rawImg = imgMatch?.[1] || "";
    const image  = rawImg.startsWith("http") ? rawImg
      : rawImg ? `${WB_BASE}${rawImg}` : "";

    products.push({ id, name, price, image });
  }

  return products;
}

/**
 * Parse the max page number from #PageNumbers div.
 * WiseBuy renders numbered page links; we take the highest number.
 */
function getMaxPage(html) {
  // Find PageNumbers section
  const pagerMatch = html.match(/id="PageNumbers"[\s\S]{0,3000}/);
  if (!pagerMatch) return 1;
  const pager = pagerMatch[0].slice(0, 3000);

  // Extract all numeric page link texts
  const nums = [...pager.matchAll(/pageinfo=(\d+)/g)].map(m => parseInt(m[1], 10));
  if (nums.length === 0) return 1;
  return Math.max(...nums);
}

// ── Per-category scraper ──────────────────────────────────────────────────────

async function scrapeCategory(sog) {
  const allProducts = [];
  const seenIds     = new Set();
  let   blocked     = false;
  let   maxPage     = null; // discovered from page 1

  for (let page = 1; page <= MAX_PAGES_PER_CAT; page++) {
    if (maxPage !== null && page > maxPage) break;

    const url = makeListingUrl(sog, page);
    try {
      const resp = await axios.get(url, {
        timeout:        PAGE_TIMEOUT,
        headers:        HEADERS,
        validateStatus: s => s < 500,
        maxRedirects:   5,
        decompress:     true,
      });

      const html = typeof resp.data === "string" ? resp.data : "";

      if (isBlocked(html) || resp.status === 403) {
        console.warn(`[WiseBuy]   ${sog} p${page} — blocked (status=${resp.status}, len=${html.length})`);
        blocked = true;
        break;
      }

      // Discover total pages from first page
      if (page === 1) {
        maxPage = getMaxPage(html);
        console.log(`[WiseBuy]   ${sog} — ${maxPage} page(s) total`);
      }

      const products = extractProducts(html);
      const fresh    = products.filter(p => !seenIds.has(p.id));

      if (fresh.length === 0) {
        // If page 1 has nothing, bail
        if (page === 1) {
          console.warn(`[WiseBuy]   ${sog} p1 — no products found`);
          break;
        }
        // Otherwise end of results
        break;
      }

      fresh.forEach(p => { seenIds.add(p.id); allProducts.push(p); });
      process.stdout.write(`\r[WiseBuy]   ${sog}: ${allProducts.length} products (p${page}/${maxPage})   `);

    } catch (e) {
      console.warn(`\n[WiseBuy]   ${sog} p${page} — error: ${e.message}`);
      break;
    }

    if (page < (maxPage ?? MAX_PAGES_PER_CAT)) await sleep(DELAY_BETWEEN_PAGES);
  }

  process.stdout.write("\n");

  const priced = allProducts.filter(p => p.price > 0).length;
  const imaged = allProducts.filter(p => p.image).length;
  const named  = allProducts.filter(p => p.name).length;
  console.log(
    `[WiseBuy] ✓ ${sog} — ${allProducts.length} products` +
    ` (${named} named, ${priced} priced, ${imaged} with images)` +
    (blocked ? " ⚠️ blocked mid-scrape" : "")
  );

  return allProducts;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scrape all (or specified) WiseBuy categories.
 * Saves results to zap-categories.json via saveCategoryToDB.
 * Compatible with the existing DB format — same ZAP model IDs.
 *
 * @param {object} opts
 * @param {string[]} opts.sogs   — which SOGs to scrape (default: ALL_SOGS)
 * @param {boolean}  opts.force  — ignore cache freshness
 * @returns {number} total products saved
 */
export async function scrapeAll({ sogs = ALL_SOGS, force = false } = {}) {
  const startTime = Date.now();
  let totalSaved  = 0;
  let skipped     = 0;

  console.log(`[WiseBuy] ═══ Starting bulk scrape: ${sogs.length} categories (force=${force}) ═══`);

  for (const sog of sogs) {
    try {
      // Skip fresh cache entries unless force=true
      if (!force) {
        const cached  = getCategoryFromDB(sog);
        const ageHrs  = cached?.ts ? (Date.now() - cached.ts) / 3_600_000 : Infinity;
        const hasProd = (cached?.candidates?.length || 0) > 0;
        if (hasProd && ageHrs < CACHE_FRESH_HOURS) {
          console.log(`[WiseBuy] ↷ ${sog} — fresh (${ageHrs.toFixed(1)}h, ${cached.candidates.length} products)`);
          skipped++;
          continue;
        }
      }

      const products = await scrapeCategory(sog);

      if (products.length > 0) {
        saveCategoryToDB(sog, products);
        totalSaved += products.length;
      } else {
        console.warn(`[WiseBuy] ✗ ${sog} — no products found, cache unchanged`);
      }

    } catch (e) {
      console.error(`[WiseBuy] ✗ ${sog} — fatal: ${e.message}`);
    }

    await sleep(DELAY_BETWEEN_CATS);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;
  console.log(
    `[WiseBuy] ═══ Done! ${totalSaved} products saved` +
    ` (${skipped} categories skipped as fresh) in ${mins}m${secs}s ═══`
  );

  return totalSaved;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("wisebuy-scraper.js");
if (isMain) {
  const force  = process.argv.includes("--force");
  const sogArg = process.argv.find(a => a.startsWith("--sog="))?.split("=")[1]
              || (process.argv.indexOf("--sog") >= 0 ? process.argv[process.argv.indexOf("--sog") + 1] : null);
  const sogs   = sogArg ? [sogArg] : ALL_SOGS;

  scrapeAll({ sogs, force }).then(count => {
    console.log(`[WiseBuy] Total: ${count} products.`);
    process.exit(0);
  }).catch(e => {
    console.error("[WiseBuy] Fatal:", e.message);
    process.exit(1);
  });
}
