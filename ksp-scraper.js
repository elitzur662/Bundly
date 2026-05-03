/**
 * ksp-scraper.js  —  KSP.co.il price scraper (updated for new m_action API)
 *
 * KSP migrated from /web/api/ to /m_action/api/ (mobile-app API).
 *
 * Confirmed working endpoints (no auth required):
 *   GET /m_action/api/category/?search={query}&pageSize=12  → search all
 *   GET /m_action/api/category/{tagIds}?page=0&pageSize=12  → category page 0
 *   GET /m_action/api/category/{tagIds}?page={next}&tt={tt} → subsequent pages
 *   GET /m_action/api/item/{uin}                            → single product
 *   GET /m_action/api/bms/{uin1},{uin2},...                 → batch products
 *
 * Response shape (items array):
 *   { uin, name, price, img, brandName, uinsql, addToCart, ... }
 *
 * Typical call flow in server.js:
 *   const kspResults = await searchKsp(query);
 *   const kspCategory = await getKspCategoryAll(sogKey);
 */

import axios from "axios";

const KSP_BASE   = "https://ksp.co.il";
export const KSP_API = "https://ksp.co.il/m_action/api";
const STORE_NAME = "KSP";

export const KSP_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
  "Referer":         "https://ksp.co.il/web/",
  "Origin":          "https://ksp.co.il",
};

// ── KSP category tag IDs (dot-separated tag ANDs) ────────────────────────────
// Found by navigating KSP's category tree: /web/cat/{tag1}..{tag2}
// Tag 31635 = "מחשבים וסלולר" (Computers & Mobile) — parent for all PC cats
export const KSP_CAT_TAG_MAP = {
  "c-pclaptop":       "31635..61630",   // מחשבים ניידים ואביזרים
  "c-pcdesktop":      "31635..61655",   // מחשבים נייחים ו- AiO
  "c-tabletpc":       "31635..61845",   // טאבלטים ואביזרים
  "c-monitor":        "31635..65419",   // מסכי מחשב
  "c-graphiccard":    "31635..61615",   // רכיבי חומרה ותוכנות (includes GPUs)
  "c-keyboard":       "31635..62251",   // מקלדות עכברים ופדים
  "c-mouse":          "31635..62251",   // same tag, filter by search
  "e-cellphone":      "31635..61633",   // סמארטפונים ואביזרים
  "e-headphone":      "31635..61616",   // אוזניות ומיקרופונים
  "e-tv":             "3156..3158..61687", // טלוויזיות
};

// ── Category SOG map: kept for backward compat (maps ZAP sog → KSP tag path) ─
export const KSP_CAT_MAP = KSP_CAT_TAG_MAP;

// ── Search-term fallback map ──────────────────────────────────────────────────
// Used when category tag fetch fails or category has no tag mapping.
// Each entry is an ARRAY of terms tried in order; first with results wins.
export const KSP_SEARCH_MAP = {
  "c-pclaptop":       ["מחשב נייד",      "laptop"],
  "c-pcdesktop":      ["מחשב שולחני",    "מחשב נייח", "desktop", "mini pc"],
  "c-tabletpc":       ["טאבלט",          "tablet"],
  "c-monitor":        ["מסך מחשב",       "monitor"],
  "c-graphiccard":    ["כרטיס מסך",      "GPU", "graphics card"],
  "c-keyboard":       ["מקלדת",          "keyboard"],
  "c-mouse":          ["עכבר מחשב",      "mouse"],
  "c-printer":        ["מדפסת",          "printer"],
  "c-webcam":         ["מצלמת רשת",      "webcam"],
  "e-cellphone":      ["סמארטפון",       "smartphone"],
  "e-tv":             ["טלוויזיה",       "smart tv"],
  "e-headphone":      ["אוזניות",        "headphones"],
  "e-speaker":        ["רמקול מדפים",    "bookshelf speaker", "רמקול פסיבי", "speaker", "רמקול"],
  "e-soundbar":       ["סאונדבר",        "soundbar"],
  "e-camera":         ["מצלמה",          "camera"],
  "e-tvgame":         ["קונסולת משחקים", "gaming console", "playstation", "xbox", "nintendo switch"],
  "e-ps5game":        ["משחק PS5", "PS5 game", "משחקי פלייסטיישן 5"],
  "e-ps4game":        ["משחק PS4", "PS4 game", "משחקי פלייסטיישן 4"],
  "e-nintendogame":   ["משחק Nintendo Switch", "Nintendo Switch game", "משחקי נינטנדו"],
  "e-gameaccessory":  ["ג'ויסטיק", "joystick", "gamepad", "בקר משחק", "שלט PS5", "שלט Xbox"],
  "e-fridge":         ["מקרר",           "refrigerator"],
  "e-freezer":        ["מקפיא",          "freezer"],
  "e-washingmachine": ["מכונת כביסה",    "washing machine"],
  "e-airconditioner": ["מזגן",           "air conditioner"],
  "e-oven":           ["תנור",           "oven"],
  "e-coffeemachine":  ["מכונת קפה",      "coffee machine"],
  "e-mpspeakers":     ["רמקול נייד",     "bluetooth speaker", "portable speaker"],
  "e-hometheater":    ["מערכת קולנוע ביתי", "מערכת קולנוע", "home theater system", "surround sound", "מערכת סראונד"],
  "e-slideprojector": ["מקרן",           "projector"],
  "e-mediaplayer":    ["נגן מדיה",       "media player", "streaming"],
  "c-gamingchair":    ["כיסא גיימינג",   "gaming chair"],
  "e-drayer":         ["מייבש כביסה",    "clothes dryer"],
  "e-vaccumcleaner":  ["שואב רובוטי",    "robot vacuum", "iRobot", "Roomba"],
  "e-dishwasher":     ["מדיח כלים",      "dishwasher"],
  "e-freezer":        ["מקפיא",          "freezer"],
  "e-rangehood":      ["קולט אדים",      "range hood", "מנדף"],
  "e-hobs":           ["כיריים",         "hobs", "cooktop", "כיריי גז", "כיריי אינדוקציה"],
  "e-microwave":      ["מיקרוגל",        "microwave"],
  "e-toasteroven":    ["טוסטר",          "toaster oven"],
  "e-blender":        ["בלנדר",          "blender"],
  "e-mixer":          ["מיקסר",          "mixer", "מיקסר ידני"],
  "e-foodprocessor":  ["מעבד מזון",      "food processor"],
  "e-waterheater":    ["קומקום",         "קומקום חשמלי", "מיחם", "kettle"],
  "e-juicer":         ["מסחטה",          "juicer"],
  "e-waterdispenser": ["מתקן מים",       "water dispenser", "מכונת מים"],
  "e-cookingpot":     ["סיר חשמלי",      "סיר לחץ חשמלי", "multicooker"],
  "e-hotplate":       ["פלטה חשמלית",    "induction cooker", "כיריה חשמלית"],
  "e-hairdrayer":     ["מייבש שיער",     "hair dryer", "פן"],
  "e-hairdesigner":   ["מחליק שיער",     "מסלסל שיער", "תלתלן", "מברשת מסלסלת", "hair straightener", "curling iron"],
  "b-hairaccessories":["אביזרי שיער",    "hair accessories"],
  // ── ציוד מחשב נוסף ───────────────────────────────────────────────────────
  "c-printer":        ["מדפסת",          "printer"],
  "c-mouse":          ["עכבר מחשב",      "mouse", "עכבר אלחוטי"],
  // ── חשמל ביתי ────────────────────────────────────────────────────────────
  "e-iron":           ["מגהץ",           "iron", "מגהץ קיטור"],
  "e-fan":            ["מאוורר",         "fan", "מאוורר עמוד", "מאוורר תקרה"],
  "e-airheater":      ["מפזר חום",       "תנור חשמלי", "heater"],
  "b-airrefresher":   ["מטהר אוויר",     "air purifier"],
  "e-steam":          ["מנקה קיטור",     "steam cleaner"],
  // ── אופניים וקורקינטים ────────────────────────────────────────────────────
  "s-bycicle":        ["אופניים",        "bicycle"],
  "s-electricbike":   ["אופניים חשמליים", "electric bike", "e-bike"],
  "s-bicycleaccessories": ["אביזרי אופניים", "קסדת אופניים", "מנעול אופניים"],
  "s-electricscooter":["קורקינט חשמלי",  "electric scooter", "קלנועית"],
  // ── טיפוח ויופי ──────────────────────────────────────────────────────────
  "e-shaver":         ["מכונת גילוח",    "shaver", "מגזם זקן", "trimmer"],
  "e-ladyshaver":     ["מסיר שיער",      "epilator", "ipl", "lady shaver"],
  "e-beautymachine":  ["מכשיר טיפוח פנים", "ניקוי פנים", "RF פנים"],
  "e-massager":       ["אקדח עיסוי",     "massage gun", "מכשיר עיסוי"],
  // ── ספורט וכושר ──────────────────────────────────────────────────────────
  "s-treadmill":      ["הליכון",         "treadmill"],
  "s-exercisebike":   ["אופניים נייחים",  "exercise bike", "spin bike"],
  "s-crosstrainer":   ["אליפטיקל",       "elliptical", "מכשיר חתירה"],
  // ── בריאות ───────────────────────────────────────────────────────────────
  "e-bloodpressure":  ["מד לחץ דם",      "blood pressure monitor"],
  "e-nebulizer":      ["נבולייזר",       "nebulizer", "אינהלציה"],
  // ── כלי עבודה וגינון ─────────────────────────────────────────────────────
  "b-powertools":     ["מברגה",          "מקדחה", "drill", "screwdriver"],
  "b-lawnmower":      ["מכסחת דשא",      "lawn mower"],
  "b-gardentool":     ["גזם",            "מפוח עלים", "leaf blower"],
  // ── בית חכם וריהוט ───────────────────────────────────────────────────────
  "b-smarthome":      ["בית חכם",        "smart home", "נורת LED חכמה", "שקע חכם"],
  "h-livingroomset":  ["ספה",            "sofa"],
  "h-bed":            ["מיטה",           "bed", "מזרן"],
  // ── תיקון sog שגויים בסנכרון הקודם ─────────────────────────────────────
  "e-microwaveoven":  ["מיקרוגל",        "microwave"],
  "e-kettle":         ["קומקום",         "kettle", "מיחם"],
  "e-squeezer":       ["מסחטה",          "juicer"],
  "h-water":          ["מתקן מים",       "water dispenser", "מכונת מים", "מקרר מים"],
  "e-hoods":          ["קולט אדים",      "range hood", "מנדף"],
};

// ── Core search ───────────────────────────────────────────────────────────────

/**
 * Search KSP for a product by name.
 * Uses /m_action/api/category/?search=<query>&pageSize=12
 * Returns normalised listings sorted by price asc.
 */
export async function searchKsp(query, { limit = 12, timeout = 12000 } = {}) {
  try {
    const url = `${KSP_API}/category/?search=${encodeURIComponent(query)}&pageSize=${limit}&page=0`;
    const resp = await axios.get(url, { timeout, headers: KSP_HEADERS });
    const items = resp.data?.result?.items;
    if (!Array.isArray(items)) return [];
    return items.map(normaliseKspProduct).filter(Boolean);
  } catch (err) {
    console.warn(`[KSP] searchKsp("${query}") failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch products from a KSP category (single page, fast).
 * `sogKey` is a ZAP sog key (e.g. "c-pclaptop").
 */
export async function getKspCategory(sogKey, { limit = 12, timeout = 15000 } = {}) {
  const tagPath = KSP_CAT_TAG_MAP[sogKey];
  if (!tagPath) return searchKsp((KSP_SEARCH_MAP[sogKey] || [])[0] || sogKey, { limit, timeout });
  try {
    const url = `${KSP_API}/category/${tagPath}?page=0&pageSize=12`;
    const resp = await axios.get(url, { timeout, headers: KSP_HEADERS });
    const items = resp.data?.result?.items;
    return Array.isArray(items) ? items.map(normaliseKspProduct).filter(Boolean) : [];
  } catch (err) {
    console.warn(`[KSP] getKspCategory("${sogKey}") failed: ${err.message}`);
    return [];
  }
}

/**
 * Paginated category fetch — returns up to maxPages × 12 products.
 *
 * Strategy:
 *   1. Tag-based sequential pagination (12/page, cursor-based with tt token)
 *   2. If tag unknown or returns 0, fall back to paginated search by term
 *
 * Note: KSP's new API caps pageSize at 12 per request.
 * The `next` and `tt` fields from each response drive the next page URL.
 */
export async function getKspCategoryAll(sogKey, { maxPages = 10, timeout = 25000 } = {}) {
  const seenIds  = new Set();
  const allProds = [];

  const _add = (items) => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      const norm = normaliseKspProduct(raw);
      if (!norm) continue;
      const dedup = String(raw.uin || norm.title.slice(0, 40).toLowerCase().replace(/\s+/g, ""));
      if (seenIds.has(dedup)) continue;
      seenIds.add(dedup);
      allProds.push({ ...norm, _kspId: String(raw.uin || "") });
    }
  };

  // ── Strategy 1: tag-based sequential pagination ───────────────────────────
  const tagPath = KSP_CAT_TAG_MAP[sogKey];
  if (tagPath) {
    try {
      // Page 0 — no tt needed
      const url0 = `${KSP_API}/category/${tagPath}?page=0&pageSize=12`;
      const resp0 = await axios.get(url0, { timeout, headers: KSP_HEADERS });
      const result0 = resp0.data?.result;
      _add(result0?.items);

      let nextPage = result0?.next;
      let tt       = result0?.tt;
      let fetched  = 1;

      // Subsequent pages: sequential because each page depends on tt token
      while (nextPage && tt && fetched < maxPages) {
        try {
          const url = `${KSP_API}/category/${tagPath}?page=${nextPage}&tt=${tt}&pageSize=12`;
          const resp = await axios.get(url, { timeout, headers: KSP_HEADERS });
          const result = resp.data?.result;
          _add(result?.items);
          nextPage = result?.next;
          tt       = result?.tt;
          fetched++;
        } catch (e) {
          console.warn(`[KSP] category page ${nextPage} error: ${e.message}`);
          break;
        }
      }

      if (allProds.length > 0) {
        console.log(`[KSP] category "${sogKey}" (${tagPath}): ${allProds.length} products from ${fetched} pages`);
        allProds.sort((a, b) => (a.price || 0) - (b.price || 0));
        return allProds;
      }
    } catch (e) {
      console.warn(`[KSP] category tag fetch failed for "${sogKey}": ${e.message}`);
    }
  }

  // ── Strategy 2: search-term fallback ─────────────────────────────────────
  // ALL terms are tried and results combined (deduplicated by product ID).
  // This is important for categories like gaming consoles where a single term
  // ("קונסולת משחקים") may cover PS5+Xbox but not Nintendo Switch, while
  // other terms ("Nintendo Switch") cover the remainder.
  if (KSP_SEARCH_MAP[sogKey]) {
    const termList = Array.isArray(KSP_SEARCH_MAP[sogKey])
      ? KSP_SEARCH_MAP[sogKey] : [KSP_SEARCH_MAP[sogKey]];

    const beforeSearch = allProds.length;
    for (const term of termList) {
      console.log(`[KSP] search fallback for "${sogKey}" → term="${term}"`);
      const beforeTerm = allProds.length;
      try {
        // Page 0
        const url0 = `${KSP_API}/category/?search=${encodeURIComponent(term)}&page=0&pageSize=12`;
        const resp0 = await axios.get(url0, { timeout, headers: KSP_HEADERS });
        const result0 = resp0.data?.result;
        _add(result0?.items);

        let nextPage = result0?.next;
        let tt       = result0?.tt;
        let fetched  = 1;

        while (nextPage && tt && fetched < maxPages) {
          try {
            const url = `${KSP_API}/category/?search=${encodeURIComponent(term)}&page=${nextPage}&tt=${tt}&pageSize=12`;
            const resp = await axios.get(url, { timeout, headers: KSP_HEADERS });
            const result = resp.data?.result;
            _add(result?.items);
            nextPage = result?.next;
            tt       = result?.tt;
            fetched++;
          } catch (e) {
            break;
          }
        }

        const added = allProds.length - beforeTerm;
        if (added > 0)
          console.log(`[KSP] search("${term}") → +${added} new products (total ${allProds.length})`);
      } catch (e) {
        console.warn(`[KSP] search("${term}") error: ${e.message}`);
      }
    }
    if (allProds.length > beforeSearch)
      console.log(`[KSP] "${sogKey}" search fallback total: ${allProds.length} products`);
  }

  allProds.sort((a, b) => (a.price || 0) - (b.price || 0));
  return allProds;
}

// ── Product normaliser ────────────────────────────────────────────────────────

function normaliseKspProduct(p) {
  if (!p) return null;

  // New API fields: uin, name, price, img, brandName, uinsql
  const title = p.name || p.title || p.NameHe || "";
  if (!title || title.length < 3) return null;

  const rawPrice = p.price ?? p.Price ?? p.price_new ?? 0;
  const price = typeof rawPrice === "string"
    ? parseInt(rawPrice.replace(/[^\d]/g, ""), 10)
    : Math.round(Number(rawPrice));
  if (!price || price < 10) return null;

  const uin  = p.uin || p.id || p.sku || "";
  const link = uin
    ? `${KSP_BASE}/web/item/${uin}`
    : `${KSP_BASE}/web/cat/`;

  // img field in new API is already a full URL
  const image = p.img || p.image || p.img_url || p.imageUrl
    || (uin ? `https://ksp.co.il/shop/items/${uin}.jpg` : "");

  return {
    title:  title.trim(),
    price,
    link,
    store:  STORE_NAME,
    image:  image.startsWith("http") ? image : (image ? KSP_BASE + image : ""),
    source: "ksp",
  };
}

// ── Health check ─────────────────────────────────────────────────────────────

export async function testKspConnection() {
  try {
    const url = `${KSP_API}/category/?search=מחשב+נייד&page=0&pageSize=5`;
    const resp = await axios.get(url, { timeout: 8000, headers: KSP_HEADERS });
    const items = resp.data?.result?.items || [];
    const results = items.map(normaliseKspProduct).filter(Boolean);
    return { ok: results.length > 0, count: results.length, sample: results[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
