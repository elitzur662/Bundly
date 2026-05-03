/**
 * bug-scraper.js  —  Bug.co.il price scraper
 *
 * Bug is Israel's third-largest electronics chain.
 * They use a Magento-based system with JSON data embedded in search pages.
 *
 * Exported functions:
 *   searchBug(query)          → [{title, price, link, store, image}, ...]
 *   getBugCategory(sogKey)    → [{title, price, link, store, image}, ...]
 */

import axios from "axios";

const BUG_BASE   = "https://www.bug.co.il";
const STORE_NAME = "Bug";

const BUG_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
  "Referer":         "https://www.bug.co.il/",
};

// ── Category SOG map ──────────────────────────────────────────────────────────
// Bug.co.il uses Hebrew URL slugs for categories.
// Search terms are used as primary strategy since category URL structure varies.
export const BUG_CAT_MAP = {
  "c-pclaptop":      "מחשב נייד",
  "c-pcdesktop":     "מחשב נייח",
  "c-tabletpc":      "טאבלט",
  "c-monitor":       "מסך מחשב",
  "c-graphiccard":   "כרטיס מסך",
  "c-keyboard":      "מקלדת",
  "c-mouse":         "עכבר",
  "e-cellphone":     "סמארטפון",
  "e-tv":            "טלוויזיה",
  "e-headphone":     "אוזניות",
  "e-speaker":       "רמקול",
  "e-soundbar":      "סאונדבר",
  "e-mpspeakers":    "רמקול נייד",
  "e-camera":        "מצלמה",
  "e-tvgame":        "קונסולת משחקים",
  "e-hometheater":   "מערכת קולנוע",
  "e-slideprojector":"מקרן",
  "e-mediaplayer":   "נגן מדיה",
  "c-webcam":        "מצלמת רשת",
  "c-gamingchair":   "כיסא גיימינג",
  "e-vaccumcleaner": "שואב רובוטי",
};

// ── Core scraper ──────────────────────────────────────────────────────────────

/**
 * Fetch products for a category from Bug.
 * Uses Bug's search page with a category-specific query term.
 */
export async function getBugCategory(sogKey, { timeout = 15000 } = {}) {
  const searchTerm = BUG_CAT_MAP[sogKey];
  if (!searchTerm) return [];
  return searchBug(searchTerm, { timeout });
}

/**
 * Search Bug for products matching `query`.
 * Bug.co.il uses SSR — the search page at /search?q= has products in the raw HTML.
 * Confirmed working URL: https://www.bug.co.il/search?q={query}
 * HTML structure: <a class="tpurl" href="...">name</a>, <div class="price">...</div>
 */
export async function searchBug(query, { timeout = 12000 } = {}) {
  const qEnc = encodeURIComponent(query);

  // Primary: confirmed working URL (SSR, products in raw HTML)
  const primaryUrl = `${BUG_BASE}/search?q=${qEnc}`;
  // Fallbacks in case URL changes
  const fallbacks = [
    `${BUG_BASE}/search/?q=${qEnc}`,
    `${BUG_BASE}/catalogsearch/result/?q=${qEnc}`,
  ];

  for (const url of [primaryUrl, ...fallbacks]) {
    try {
      const resp = await axios.get(url, {
        timeout,
        headers: BUG_HEADERS,
        validateStatus: s => s < 500,
        maxRedirects: 5,
      });
      if (resp.status === 404) continue;
      const html = typeof resp.data === "string" ? resp.data : "";
      // Debug: log what we actually got
      const tpurlCount = (html.match(/tpurl/g) || []).length;
      console.log(`[Bug] ${url} → status=${resp.status} len=${html.length} tpurl=${tpurlCount}`);
      if (html.length > 200 && tpurlCount === 0) {
        console.log(`[Bug] Sample HTML (first 500): ${html.slice(0, 500).replace(/\n/g,' ')}`);
      }
      if (!html || html.length < 1000) continue;
      const results = _parseBugHtml(html);
      if (results.length > 0) {
        console.log(`[Bug] searchBug("${query}") → ${results.length} results`);
        return results;
      }
    } catch (err) {
      console.warn(`[Bug] ${url} — error: ${err.message}`);
      // network error — try next URL
    }
  }

  console.warn(`[Bug] searchBug("${query}") — no results`);
  return [];
}

// ── HTML parser ───────────────────────────────────────────────────────────────

function _parseBugHtml(html) {
  const products = [];

  // Strategy 1: JSON-LD Product schema
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "Product") {
        const p = _normalizeLdProduct(data);
        if (p) products.push(p);
      } else if (data["@type"] === "ItemList" && Array.isArray(data.itemListElement)) {
        for (const item of data.itemListElement) {
          const p = _normalizeLdProduct(item.item || item);
          if (p) products.push(p);
        }
      }
    } catch (_) {}
  }

  // Strategy 2: Magento JSON init data (window.productList or similar embedded JSON)
  const magentoRe = /"items"\s*:\s*(\[[\s\S]{10,500000}?\])\s*[,}]/;
  const magentoMatch = html.match(magentoRe);
  if (magentoMatch && products.length === 0) {
    try {
      const items = JSON.parse(magentoMatch[1]);
      for (const item of items) {
        const p = _normalizeMagentoItem(item);
        if (p) products.push(p);
      }
    } catch (_) {}
  }

  // Strategy 3: HTML product card patterns (last resort)
  if (products.length === 0) {
    const htmlProds = _parseHtmlCards(html);
    products.push(...htmlProds);
  }

  // Dedup by title
  const seen = new Set();
  return products.filter(p => {
    const k = p.title.replace(/\s+/g, "").toLowerCase().slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function _normalizeLdProduct(data) {
  if (!data) return null;
  const title = data.name || "";
  if (!title || title.length < 3) return null;

  let price = 0;
  if (data.offers) {
    const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
    price = parseFloat(offer?.price || offer?.lowPrice || 0) || 0;
  }

  const link  = data.url || BUG_BASE;
  const image = data.image?.url || data.image || "";

  return { title: title.trim(), price: Math.round(price), link, store: STORE_NAME, image, source: "bug" };
}

function _normalizeMagentoItem(item) {
  if (!item) return null;
  const title = item.name || item.title || "";
  if (!title || title.length < 3) return null;

  const rawPrice = item.price || item.final_price || item.price_info?.final_price || 0;
  const price = Math.round(parseFloat(String(rawPrice).replace(/[^\d.]/g, "")) || 0);

  const id    = item.id || item.entity_id || "";
  const link  = item.url || item.product_url || (id ? `${BUG_BASE}/catalog/product/view/id/${id}/` : BUG_BASE);
  const image = item.image || item.thumbnail || item.small_image || "";

  return {
    title: title.trim(),
    price,
    link:  link.startsWith("http") ? link : BUG_BASE + link,
    store: STORE_NAME,
    image: image.startsWith("http") ? image : (image ? BUG_BASE + image : ""),
    source: "bug",
  };
}

function _parseHtmlCards(html) {
  const results = [];

  // Bug.co.il confirmed HTML structure (SSR, verified 2026-03):
  //   <a class="tpurl" href="/brand/hp/...">Laptop 15-fd0034nj</a>
  //   <a class="image product-preview-image tp" href="..."><img src="..." /></a>
  //   <div class="price"><span>2,499 ₪</span></div>
  //   (sale: <div class="price"><del><span>3,519 ₪</span></del><span class="c2"><span>3,099 ₪</span></span></div>)

  // Bug.co.il SSR HTML structure (verified 2026-03):
  //   <a href="/brand/..." class="tpurl" alt="..." title="...">
  //   שם המוצר
  //   </a>
  // NOTE: href comes BEFORE class, text wrapped in whitespace/newlines
  const tpurlRe = /<a\s+href="([^"]+)"\s+class="tpurl"[^>]*>([\s\S]*?)<\/a>/g;
  const tpurlMatches = [...html.matchAll(tpurlRe)];

  // Extract ALL prices from the page — pair with products by order
  // Price structure: <div class="price"> <span> 2,160 ₪</span> </div>
  // Sale structure:  <div class="price"> <del>3,110 ₪</del><span> 2,924 ₪</span> </div>
  // Strip <del> blocks first so sale items show only the discounted price
  const htmlNoDel = html.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, "");
  // Add \s* before optional <span> to handle whitespace between > and <span>
  const priceRe   = /class="(?:c2|price)"[^>]*>\s*(?:<span[^>]*>)?\s*([\d,]+)\s*₪/g;
  // Bug repeats each price twice in HTML (once standalone, once inside the big card link)
  // Take every other match (stride 2) to get one price per product
  const allPrices = [...htmlNoDel.matchAll(priceRe)].map(m => parseInt(m[1].replace(/,/g, ""), 10)).filter(p => p > 50);
  const prices    = allPrices.filter((_, idx) => idx % 2 === 0);

  // Extract images — Bug uses href-first: <a href="..." class="image product-preview-image tpurl" ...>
  // Images use data-original (lazy-load): <img class="img-lazy-load" data-original="/images/..." ...>
  const imgRe = /<a\s+href="[^"]+"\s+class="image product-preview-image[^"]*"[\s\S]{0,300}?<img[^>]+(?:data-original|src)="([^"]{10,300})"/gi;
  const images = [...html.matchAll(imgRe)].map(m => {
    const src = m[1];
    return src.startsWith("http") ? src : BUG_BASE + src;
  });

  for (let i = 0; i < tpurlMatches.length; i++) {
    const [, href, rawName] = tpurlMatches[i];
    const title = rawName.trim();
    if (!title || title.length < 2) continue;
    const price = prices[i] || 0;
    if (!price) continue;
    const link  = href.startsWith("http") ? href : BUG_BASE + href;
    const image = images[i] || "";
    results.push({ title, price, link, store: STORE_NAME, image, source: "bug" });
  }

  // Fallback: legacy Magento-style selectors if tpurl not found
  if (results.length === 0) {
    const nameRe2  = /class="[^"]*product[^"]*name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]{3,120})</gi;
    const priceRe2 = /class="[^"]*price[^"]*"[^>]*>\s*(?:₪\s*)?([\d,]+(?:\.\d{2})?)/g;
    const names2   = [...html.matchAll(nameRe2)].map(m => ({ link: m[1], title: m[2].trim() }));
    const prices2  = [...html.matchAll(priceRe2)].map(m => parseInt(m[1].replace(/,/g, ""), 10));
    for (let i = 0; i < names2.length && i < prices2.length; i++) {
      if (!names2[i].title || !prices2[i]) continue;
      results.push({
        title: names2[i].title, price: prices2[i],
        link:  names2[i].link.startsWith("http") ? names2[i].link : BUG_BASE + names2[i].link,
        store: STORE_NAME, image: "", source: "bug",
      });
    }
  }

  return results;
}
