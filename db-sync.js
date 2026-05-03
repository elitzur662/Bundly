/**
 * db-sync.js — Product database builder & price updater
 *
 * Builds a local product database under product-db/ organized by category.
 * ZAP is the master catalog (canonical product IDs). Prices from KSP, Bug, Ivory.
 * Downloads product images locally.
 *
 * Usage:
 *   node db-sync.js                     — sync stale categories only
 *   node db-sync.js --force             — force full refresh
 *   node db-sync.js --prices-only       — update prices only, skip catalog rebuild
 *   node db-sync.js --cat phones        — single category
 *   node db-sync.js --no-images         — skip image download
 */

import axios from "axios";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { getKspCategoryAll, KSP_CAT_TAG_MAP } from "./ksp-scraper.js";
import { getBugCategory } from "./bug-scraper.js";

// WiseBuy uses a certificate that some Node.js installs can't verify.
// Using a dedicated agent with rejectUnauthorized:false is safe here
// since WiseBuy is a public price-comparison site (no auth credentials).
const WB_HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dir, "product-db");

// ── Category map ─────────────────────────────────────────────────────────────
// slug → { label, zapSog, ivoryUrl, kspTag, bugCat }
export const CATEGORIES = {
  phones: {
    label: "סמארטפונים",
    zapSog: "e-cellphone",
    ivoryUrl: "cellphones.html",
    kspTag: "31635",   // KSP tag for phones category
    bugCat: "סלולרי",
  },
  laptops: {
    label: "מחשבים ניידים",
    zapSog: "c-pclaptop",
    ivoryUrl: "מחשבים_ניידים.html",
    kspTag: "61655",
    bugCat: "מחשבים",
  },
  desktops: {
    label: "מחשבים נייחים",
    zapSog: "c-pcdesktop",
    ivoryUrl: "מחשבים-נייחים.html",
    kspTag: null,
    bugCat: null,
    // ZAP's desktop category groups products by CPU model (e.g. "14700F", "7800X3D")
    // instead of by PC system name — unusable for price matching.
    // Use KSP as catalog source: its products have real names ("HP ProDesk 400 G9", etc.)
    catalogSource: "ksp",
  },
  tablets: {
    label: "טאבלטים",
    zapSog: "c-tabletpc",
    ivoryUrl: "tablets.html",
    kspTag: null,
    bugCat: null,
  },
  tvs: {
    label: "טלוויזיות",
    zapSog: "e-tv",
    ivoryUrl: "tv.html",
    kspTag: null,
    bugCat: null,
  },
  headphones: {
    label: "אוזניות",
    zapSog: "e-headphone",
    ivoryUrl: "headphone.html",
    kspTag: null,
    bugCat: null,
  },
  speakers: {
    label: "רמקולים",
    zapSog: "e-speaker",
    ivoryUrl: "speakers.html",
    kspTag: null,
    bugCat: null,
  },
  "portable-speakers": {
    label: "רמקולים ניידים",
    zapSog: "e-mpspeakers",
    ivoryUrl: "bluetooth-speakers.html",
    kspTag: null,
    bugCat: null,
  },
  soundbars: {
    label: "סאונד בר",
    zapSog: "e-soundbar",
    ivoryUrl: "sound-bars.html",
    kspTag: null,
    bugCat: null,
  },
  "home-theater": {
    label: "קולנוע ביתי",
    zapSog: "e-hometheater",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    // ZAP's home theater category is mostly brand navigation (Marantz, Klipsch, etc.)
    // with only 2 named products — unusable. Use KSP as catalog source.
    catalogSource: "ksp",
  },
  projectors: {
    label: "מקרנים",
    zapSog: "e-slideprojector",
    ivoryUrl: "projector.html",
    kspTag: null,
    bugCat: null,
  },
  cameras: {
    label: "מצלמות",
    zapSog: "e-camera",
    ivoryUrl: "digital_camera.html",
    kspTag: null,
    bugCat: null,
  },
  "media-players": {
    label: "נגני מדיה",
    zapSog: "e-mediaplayer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "gaming-consoles": {
    label: "קונסולות משחק",
    zapSog: "e-tvgame",
    ivoryUrl: "gaming-consoles.html",
    kspTag: null,
    bugCat: null,
  },
  "ps5-games": {
    label: "משחקי PS5",
    zapSog: "e-ps5game",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  "ps4-games": {
    label: "משחקי PS4",
    zapSog: "e-ps4game",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  "nintendo-games": {
    label: "משחקי Nintendo",
    zapSog: "e-nintendogame",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  "gaming-accessories": {
    label: "ג'ויסטיקים ואביזרי משחק",
    zapSog: "e-gameaccessory",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  monitors: {
    label: "מסכי מחשב",
    zapSog: "c-monitor",
    ivoryUrl: "monitors.html",
    kspTag: null,
    bugCat: null,
  },
  "graphics-cards": {
    label: "כרטיסי מסך",
    zapSog: "c-graphiccard",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  keyboards: {
    label: "מקלדות",
    zapSog: "c-keyboard",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "gaming-chairs": {
    label: "כסאות גיימינג",
    zapSog: "c-gamingchair",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  webcams: {
    label: "מצלמות רשת",
    zapSog: "c-webcam",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "washing-machines": {
    label: "מכונות כביסה",
    zapSog: "e-washingmachine",
    ivoryUrl: "washing-machines.html",
    kspTag: null,
    bugCat: null,
  },
  dryers: {
    label: "מייבשי כביסה",
    zapSog: "e-drayer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "robot-vacuums": {
    label: "שואבי אבק רובוטיים",
    zapSog: "e-vaccumcleaner",
    ivoryUrl: "robot-vacuum-cleaners.html",
    kspTag: null,
    bugCat: null,
  },
  fridges: {
    label: "מקררים",
    zapSog: "e-fridge",
    ivoryUrl: "refrigerator.html",
    kspTag: null,
    bugCat: null,
  },
  dishwashers: {
    label: "מדיחי כלים",
    zapSog: "e-dishwasher",
    ivoryUrl: "dishwashers.html",
    kspTag: null,
    bugCat: null,
  },
  "coffee-machines": {
    label: "מכונות קפה",
    zapSog: "e-coffeemachine",
    ivoryUrl: "coffee-machines.html",
    kspTag: null,
    bugCat: null,
  },
  ovens: {
    label: "תנורים",
    zapSog: "e-oven",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "air-conditioners": {
    label: "מזגנים",
    zapSog: "e-airconditioner",
    ivoryUrl: "air-conditioners.html",
    kspTag: null,
    bugCat: null,
  },
  freezers: {
    label: "מקפיאים",
    zapSog: "e-freezer",
    ivoryUrl: "freezers.html",
    kspTag: null,
    bugCat: null,
  },
  "range-hoods": {
    label: "קולטי אדים",
    zapSog: "e-hoods",
    ivoryUrl: "range-hoods.html",
    kspTag: null,
    bugCat: null,
  },
  hobs: {
    label: "כיריים",
    zapSog: "e-hobs",
    ivoryUrl: "hobs.html",
    kspTag: null,
    bugCat: null,
  },
  microwaves: {
    label: "מיקרוגלים",
    zapSog: "e-microwaveoven",
    ivoryUrl: "microwave.html",
    kspTag: null,
    bugCat: null,
  },
  toasters: {
    label: "טוסטרים",
    zapSog: "e-toasteroven",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  blenders: {
    label: "בלנדרים",
    zapSog: "e-blender",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  mixers: {
    label: "מיקסרים",
    zapSog: "e-mixer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "food-processors": {
    label: "מעבדי מזון",
    zapSog: "e-foodprocessor",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  kettles: {
    label: "קומקומים ומיחמים",
    zapSog: "e-kettle",
    ivoryUrl: "kettle.html",
    kspTag: null,
    bugCat: null,
  },
  juicers: {
    label: "מסחטות",
    zapSog: "e-squeezer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "water-dispensers": {
    label: "מתקני מים",
    zapSog: "h-water",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "cooking-pots": {
    label: "סירי בישול וטיגון",
    zapSog: "e-cookingpot",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  "electric-hotplates": {
    label: "פלטות חשמליות",
    zapSog: "e-hotplate",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
    catalogSource: "ksp",
  },
  // ── טיפוח שיער ──────────────────────────────────────────────────────────
  "hair-dryers": {
    label: "מייבשי שיער",
    zapSog: "e-hairdrayer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "hair-stylers": {
    label: "מכשירי עיצוב שיער",
    zapSog: "e-hairdesigner",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "hair-accessories": {
    label: "אביזרים לשיער",
    zapSog: "b-hairaccessories",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── ציוד מחשב נוסף ──────────────────────────────────────────────────────
  printers: {
    label: "מדפסות",
    zapSog: "c-printer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  mice: {
    label: "עכברים",
    zapSog: "c-mouse",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── חשמל ביתי ────────────────────────────────────────────────────────────
  irons: {
    label: "מגהצים",
    zapSog: "e-iron",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  fans: {
    label: "מאווררים",
    zapSog: "e-fan",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  heaters: {
    label: "מפזרי חום",
    zapSog: "e-airheater",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "air-purifiers": {
    label: "מטהרי אוויר",
    zapSog: "b-airrefresher",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "steam-cleaners": {
    label: "ערכות ניקוי בקיטור",
    zapSog: "e-steam",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── אופניים וקורקינטים ────────────────────────────────────────────────────
  bicycles: {
    label: "אופניים",
    zapSog: "s-bycicle",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "electric-scooters": {
    label: "קורקינטים חשמליים",
    zapSog: "g-korkinet",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── טיפוח ויופי ──────────────────────────────────────────────────────────
  shavers: {
    label: "מכשירי גילוח לגברים",
    zapSog: "e-shavingmachine",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "lady-shavers": {
    label: "מכשירי גילוח לנשים",
    zapSog: "e-hairremover",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "beauty-machines": {
    label: "מכשירי טיפוח פנים",
    zapSog: "e-haircuter",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  massagers: {
    label: "מכשירי עיסוי",
    zapSog: "e-massage",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── ספורט וכושר ──────────────────────────────────────────────────────────
  treadmills: {
    label: "הליכונים חשמליים",
    zapSog: "s-treadmill",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "exercise-bikes": {
    label: "אופניים נייחים",
    zapSog: "s-stationarybicycle",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "cross-trainers": {
    label: "אליפטיקל",
    zapSog: "s-crosstrainer",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── בריאות ───────────────────────────────────────────────────────────────
  "blood-pressure-monitors": {
    label: "מדי לחץ דם",
    zapSog: "b-bloodpressure",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  nebulizers: {
    label: "נבולייזרים",
    zapSog: "b-cough",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── כלי עבודה וגינון ─────────────────────────────────────────────────────
  "power-tools": {
    label: "כלי עבודה חשמליים",
    zapSog: "h-drill",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  "lawn-mowers": {
    label: "מכסחות עשב וכלי גינון",
    zapSog: "h-lowmmowers",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── בית חכם ──────────────────────────────────────────────────────────────
  "smart-home": {
    label: "בית חכם",
    zapSog: "e-smarthouse",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  // ── ריהוט ────────────────────────────────────────────────────────────────
  sofas: {
    label: "ספות",
    zapSog: "h-livingroomset",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
  beds: {
    label: "מיטות",
    zapSog: "h-bed",
    ivoryUrl: null,
    kspTag: null,
    bugCat: null,
  },
};

// ── Config ────────────────────────────────────────────────────────────────────
const CATALOG_FRESH_HOURS = 24;   // rebuild catalog if older than 24h
const PRICES_FRESH_HOURS  = 4;    // refresh prices if older than 4h
const ZAP_PAGE_DELAY      = 1400; // ms between ZAP page requests
const IVORY_PAGE_DELAY    = 1000; // ms between Ivory page requests
const IMAGE_CONCURRENCY   = 5;    // parallel image downloads
const MAX_ZAP_PAGES       = 60;
const MAX_IVORY_PAGES     = 30;

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function catDir(slug)      { return path.join(DB_DIR, slug); }
function productsFile(slug){ return path.join(DB_DIR, slug, "products.json"); }
function imageDir(slug)    { return path.join(DB_DIR, slug, "images"); }
function metaFile(slug)    { return path.join(DB_DIR, slug, "meta.json"); }

function loadProducts(slug) {
  try {
    const f = productsFile(slug);
    if (!fs.existsSync(f)) return [];
    const products = JSON.parse(fs.readFileSync(f, "utf8"));
    // Migration: decode any HTML entities that were stored before htmlDecode was applied.
    // Safe to run on every load — htmlDecode is idempotent on already-clean strings.
    let dirty = false;
    for (const p of products) {
      if (p.name && /&(?:amp|lt|gt|quot|rlm|lrm|nbsp|#\d+);/i.test(p.name)) {
        p.name = htmlDecode(p.name);
        dirty = true;
      }
    }
    if (dirty) saveProducts(slug, products); // persist the cleaned-up data
    return products;
  } catch(e) {}
  return [];
}

function saveProducts(slug, products) {
  const target = productsFile(slug);
  const tmp    = target + ".tmp";
  const data   = JSON.stringify(products, null, 2);
  const buf    = Buffer.from(data, "utf8");

  // Write to temp file using a file descriptor so we can fsync before closing.
  // fsync ensures data is physically on the underlying filesystem (important for
  // 9P/virtio mounts where OS-level buffers may not flush on writeFileSync alone).
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, buf);
    try { fs.fsyncSync(fd); } catch(_) {} // best-effort flush
    fs.closeSync(fd);
    fd = undefined;
  } catch(e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch(_) {}
    console.error(`  [DB] ⚠️  Write failed for ${slug}: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch(_) {}
    return;
  }

  // Verify the temp file is valid JSON and matches expected size before replacing.
  try {
    const written = fs.readFileSync(tmp, "utf8");
    if (written.length !== data.length) throw new Error(`Size mismatch: ${written.length} vs ${data.length}`);
    JSON.parse(written);
  } catch(e) {
    console.error(`  [DB] ⚠️  JSON verification failed for ${slug} — aborting save: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch(_) {}
    return;
  }

  // Windows-safe atomic replace:
  // fs.renameSync over an existing file fails on Windows — delete target first.
  if (fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch(_) {}
  }
  try {
    fs.renameSync(tmp, target);
  } catch(e) {
    // Last resort if rename still fails (e.g. cross-device): direct overwrite
    fs.writeFileSync(target, data, "utf8");
    try { fs.unlinkSync(tmp); } catch(_) {}
  }
}

function loadMeta(slug) {
  try {
    const f = metaFile(slug);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch(e) {}
  return {};
}

function saveMeta(slug, meta) {
  const f = metaFile(slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(meta, null, 2), "utf8");
}

/** Normalize product name for fuzzy matching.
 *  Strips Israeli-specific noise so ZAP ↔ KSP ↔ Ivory names compare cleanly:
 *  "טלפון סלולרי Samsung Galaxy S25 FE SM-S731B/DS 256GB 8GB RAM"
 *   → "samsung galaxy s25 fe 256gb"
 */
const HEB_CAT_RE = /(?:טלפון סלולרי|מחשב נייד|מחשב נייח|טאבלט|מסך מחשב|שואב אבק רובוטי|שואב אבק|מכונת כביסה|מייבש כביסה|מקרר|מדיח כלים|מכונת קפה|מכונת אספרסו|מזגן\s+(?:עילי|נייד|מיני|רצפתי|מסויים|גמד|קסטה|ינואר|דוקטי|אינוורטר|מרכזי|תעשייתי)|מזגן|קונסולת משחקים?|קולנוע ביתי|נגן מדיה|מצלמת רשת|כיסא גיימינג|מכשיר ipl|מחליק שיער|מייבש שיער|אוזניות|רמקול\s+(?:יחיד|שמאל|ימין|סאב|לגינה|שקוע|לתליה|מדפים?|עמוד)|רמקול|מקרן|מערכת קולנוע|סאב וופר|זוג רמקולים)/gi;

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    // Convert model-variant "+" suffix to "plus" so tier-word guard can catch it
    // S25+ → s25 plus,  Note10+ → note10 plus
    .replace(/(\w)\+/g, "$1 plus")
    // Strip Hebrew category descriptors from anywhere in name (ZAP often prepends them;
    // sometimes they appear mid-name for brands like "LG מכונת כביסה F4WR7012A2W")
    .replace(HEB_CAT_RE, "")
    // Strip Samsung/LG/Motorola internal model codes (SM-S731B/DS, XT-2341, etc.)
    .replace(/\bsm-[a-z0-9]+(?:\/[a-z0-9]+)?\b/gi, "")
    .replace(/\bxt-[a-z0-9]+-[a-z0-9]+\b/gi, "")
    // Strip Sony PlayStation model codes (CFI-2000, CFI-2016, CFI-2016A/DS, etc.)
    .replace(/\bcfi-[a-z0-9]+(?:\/[a-z0-9]+)?\b/gi, "")
    // ── SKU/part-code stripping — all patterns REQUIRE digits to avoid false-stripping ──────
    // Apple standard part codes — require at least one digit in the middle to avoid matching
    // real words like "macbook", "ideapad", "samsung" (which are all-letter).
    //   Pattern A: 2 letters + 2-4 pure digits + 2 letters  (MW123HB, MDE64HB)
    .replace(/\b[a-z]{2}\d{2,4}[a-z]{2}(?:\/[a-z])?\b/gi, "")
    //   Pattern B: 2 letters + digit+letter+digit + 2 letters  (MC7U4HB, MW0Y3HB)
    .replace(/\b[a-z]{2}\d[a-z]\d[a-z]{2}(?:\/[a-z])?\b/gi, "")
    //   Pattern C: 3 letters + 2 digits + 2 letters  (MGN63HB, MRX13HB)
    .replace(/\b[a-z]{3}\d{2}[a-z]{2}(?:\/[a-z])?\b/gi, "")
    // Apple BTO codes (9 chars): Z1KL000JP, Z1KH000JQ, Z1KM000GM
    .replace(/\b[a-z]\d[a-z]{2}\d{3}[a-z]{2}\b/gi, "")
    // HP model suffix codes: FA2011NJ, AH0013NJ (2 letters + 3-5 digits + 2 letters)
    .replace(/\b[a-z]{2}\d{3,5}[a-z]{2}\b/gi, "")
    // Strip Hebrew color phrases (no word-boundary with Hebrew chars, so no \b)
    .replace(/בצבע\s+\S+(?:\s+\S+)?/gi, "")
    // Strip Hebrew appliance form-factor descriptors: these describe form (wide, integrated, etc.)
    // but do NOT appear in store product names and just add noise to matching.
    .replace(/(?:רחב|צר|משולב|גוויל|מגירה|תת שיש|תת-שיש|פסל|בנוי|חופשי עמידה|אמריקאי|side by side)/gi, "")
    // Strip appliance power/capacity units that don't help matching:
    // כ"ס / כ״ס (horsepower for ACs), קוט"ש (BTU equivalent), BTU, kW
    .replace(/\d+(?:\.\d+)?\s*(?:כ"ס|כ״ס|קוט"ש|btu|kwh?)\b/gi, "")
    // Strip standalone Hebrew power units left after number removal
    .replace(/(?:כ"ס|כ״ס|קוט"ש)/g, "")
    // Strip NG suffix (natural gas variant indicator) for appliances
    .replace(/\bng\b/gi, "")
    // Strip standalone decimal fractions like "1.0", "1.25", "2.5" (AC capacity in HP)
    // but NOT model numbers like "R32" or "5G" which have letters
    .replace(/\b\d+\.\d+(?!\s*[a-z])\b/gi, "")
    // Strip Dell compound codes BEFORE dash splitting: VM-RD33-15112, LT-RD33-16488
    .replace(/\b[a-z]{2}-[a-z]{2}\d{2}-\d{4,6}\b/gi, "")
    // Strip Lenovo FRU/SKU codes: 83GU006HIV, 83K100KPIV, 82YU0044IV (start with 2 digits)
    .replace(/\b\d{2}[a-z]\w{4,}\b/gi, "")
    // Strip Lenovo chassis codes: 15IRH10, 15IRH8, 15IAH8, 16IAX8 (2 digits + 3-4 letters + 1-2 digits)
    .replace(/\b\d{2}[a-z]{3,4}\d{1,2}\b/gi, "")
    // Strip HP/Dell part codes: C93FLEA, C2PY3EA, AD2M0ET (1-2 letters + 1-2 digits + 2-3 letters + 1-2 digits + 2 letters)
    .replace(/\b[a-z]{1,2}\d{1,2}[a-z]{2,3}\d{1,2}[a-z]{2}\b/gi, "")
    // Strip generic manufacturer model codes: 2-4 uppercase letters + hyphen + digits
    .replace(/\b[a-z]{2,4}-\d{3,6}[a-z0-9]*\b/gi, "")
    // Strip RAM specs ("8GB RAM", "16GB RAM") — must come before generic storage stripping
    .replace(/\b\d+\s*gb\s+ram\b/gi, "")
    // Strip standalone storage/memory sizes — these bloat laptop/desktop names without
    // uniquely identifying the model (model number already does that).
    // Keep sizes that appear in names like "PlayStation 5 Slim 1TB" — those ARE distinguishing,
    // but for laptop/TV/appliance names with model codes, sizes just add noise.
    // We strip them AFTER model codes, so the model number remains to uniquely identify.
    .replace(/\b\d+\s*(?:gb|tb)\b/gi, "")
    // Strip screen size specs ("16\"", "15.6\"", "65 אינץ") — model number is more specific
    .replace(/\b\d+(?:\.\d+)?"\b/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:inch|אינץ|אינץ'|אינץ׳)\b/gi, "")
    // Normalize console variant tokens into single compound words so they survive the
    // w.length > 1 filter and are treated as MODEL_TIER_WORDS for exact matching:
    //   Xbox Series X / Series S  →  "seriesx" / "seriess"  (prevents X↔S cross-match)
    //   Nintendo Switch 2          →  "switch2"              (prevents Switch 2↔OLED cross-match)
    .replace(/\bseries\s+x\b/gi, "seriesx")
    .replace(/\bseries\s+s\b/gi, "seriess")
    .replace(/\bswitch\s+2\b/gi, "switch2")
    // Strip "blu-ray" from Xbox names BEFORE general blu-ray→disc conversion:
    // Xbox Series X always has a disc drive (not a variant discriminator like PS5 disc vs digital).
    // Stripping it prevents "disc" tier word from appearing in Xbox haystacks and blocking
    // Bug products that simply write "Xbox Series X" without the "Blu-ray Edition" suffix.
    .replace(/\bxbox\b.{0,60}\bblu-?ray\b/gi, m => m.replace(/\bblu-?ray\b/gi, ""))
    // Normalize console media type: "blu-ray"/"bluray" → "disc" so PS5 Disc and PS5 Blu-ray match
    // (ZAP uses "Blu-ray Edition", KSP uses "Disc" — both mean the same physical drive variant)
    // By this point Xbox blu-ray is already stripped, so only PlayStation names get "disc".
    .replace(/\bblu-?ray\b/gi, "disc")
    // Strip connectivity/technology descriptors that appear in BOTH ZAP and KSP names
    // as noise — they don't help discriminate between models:
    //   "True Wireless" (earbuds technology) — every TWS product has it
    //   "Bluetooth" / "BT" — connectivity type, not model discriminator
    //   "אלחוטיות" / "חוטיות" (wireless/wired adjective in Hebrew headphone names)
    //   Note: \b doesn't work with Hebrew chars — use raw Hebrew patterns without \b
    .replace(/\btrue\s+wireless\b/gi, "")
    .replace(/\bbluetooth\b/gi, "")
    .replace(/אלחוטיות?/g, "")
    .replace(/חוטיות?/g, "")
    // Strip edition/version keywords that bloat the name without helping matching
    .replace(/\b(?:edition|version|special|limited|standard|bundle)\b/gi, "")
    .replace(/['"״׳]/g, "")
    .replace(/[-_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Model-tier words: if BOTH sides have at least one tier word and they differ, products don't match.
// This is an explicit-conflict guard — if one side has no tier words, it's assumed to be a generic
// listing (e.g. Bug often lists "PlayStation 5 Slim" without specifying disc/digital), and a match
// is allowed. Only blocks when e.g. needle has "disc" AND haystack has "digital" (clear conflict).
// Includes standalone screen-size numbers (13, 14, 15, 16, 17) as discriminators so that
// a 13" MacBook Air doesn't falsely match a 15" MacBook Air.
// Also includes phone generation numbers (11, 12, 13, 14, 15) for iPhone disambiguation.
const MODEL_TIER_WORDS = new Set([
  "pro", "max", "ultra", "plus", "lite", "fe", "air", "mini",
  "fold", "flip", "edge", "note", "go", "neo", "se",
  // Screen sizes / generation numbers as discriminators
  "11", "12", "13", "14", "15", "16", "17",
  // Console edition discriminators: "digital" (no disc drive) vs "disc" (physical drive)
  // Prevents PS5 Digital Edition from matching PS5 Disc/Blu-ray Edition price
  "digital", "disc",
  // Xbox Series compound tokens (normalized from "Series X" → "seriesx" in normalizeName)
  // Prevents Xbox Series X from matching Xbox Series S
  "seriesx", "seriess",
  // Nintendo Switch 2 token (normalized from "Switch 2" → "switch2" in normalizeName)
  // Prevents Switch 2 from matching Switch OLED, Switch Lite, etc.
  "switch2",
]);

/** Score: fraction of needleWords found in haystack (0..1).
 *  Returns 0 immediately if a model-tier word appears in one name but not the other
 *  (prevents "iPhone 17" matching "iPhone 17 Pro", "S25" matching "S25 FE", etc.) */
function matchScore(needle, haystack) {
  const nNorm  = normalizeName(needle);
  const hNorm  = normalizeName(haystack);
  const nWords = nNorm.split(" ").filter(w => w.length > 1);
  const hWords = hNorm.split(" ").filter(w => w.length > 1);
  if (!nWords.length) return 0;

  // Tier-word guard — two-level check:
  // Level 1 (always): every tier word in the NEEDLE must appear in the haystack.
  //   → "PS5 Slim Digital" needle must NOT match "PS5 Slim Disc" haystack (digital∉{disc}).
  //   → "Xbox Series X" needle (seriesx) must NOT match "Xbox Series S" haystack (seriess∉{seriesx}).
  // Level 2 (only when needle has tiers): every tier word in the HAYSTACK must appear in needle.
  //   → When needle IS specific (has tiers), haystack must not have extra tiers.
  //   → When needle has NO tiers (generic listing like "PlayStation 5 Slim"), skip this check —
  //     allow matching haystacks that have tier words (disc, digital, etc.).
  const nTiers = new Set(nWords.filter(w => MODEL_TIER_WORDS.has(w)));
  const hTiers = new Set(hWords.filter(w => MODEL_TIER_WORDS.has(w)));
  for (const t of nTiers) { if (!hTiers.has(t)) return 0; }       // Level 1: always
  if (nTiers.size > 0) {
    for (const t of hTiers) { if (!nTiers.has(t)) return 0; }     // Level 2: needle is specific
  }

  // Use exact word-set matching to avoid "s25" matching "s25+" or "s25+" matching "s25".
  // normalizeName already lowercases and splits on whitespace, so each token is an atomic word.
  const hWordSet = new Set(hWords);
  const matched = nWords.filter(w => hWordSet.has(w)).length;
  return matched / nWords.length;
}

/** Find best product match in products array */
function findBestMatch(name, products, threshold = 0.6) {
  // Require at least 2 meaningful words in the product name before attempting a match.
  // Single-word names like "14700KF" or "Samsung" are not specific enough to match reliably
  // and lead to false positives (e.g. CPU model numbers matching desktop PC entries).
  const normNeedle = normalizeName(name);
  const needleWords = normNeedle.split(" ").filter(w => w.length > 1);
  if (needleWords.length < 2) return null;

  let best = null, bestScore = 0;
  for (const p of products) {
    const s = matchScore(name, p.name);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return bestScore >= threshold ? best : null;
}

/** Decode HTML entities from ZAP attribute values, strip directional marks */
function htmlDecode(str) {
  return (str || "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&rlm;/g,  "")   // RTL mark
    .replace(/&lrm;/g,  "")   // LTR mark
    .replace(/&#8207;/g,"")   // RTL mark (decimal)
    .replace(/&#8206;/g,"")   // LTR mark (decimal)
    .replace(/&#160;/g, " ")  // non-breaking space
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g,    " ")
    .trim();
}

// ── ZAP catalog scraper ───────────────────────────────────────────────────────

function isZapBlocked(html) {
  return !html || html.length < 2000 ||
    html.includes("Just a moment") || html.includes("cf-browser-verification");
}

function extractZapProducts(html) {
  const seen = new Set();
  const products = [];

  // Pass 1: collect model IDs from OUTER product-row divs only.
  // ZAP 2025 template: outer rows carry data-is-with-model; inner elements (store rows,
  // price-alert buttons) also have data-model-id but no accessible name.  Including them
  // inflates the list with ~12 nameless ghost IDs per page → 97% junk removal after sync.
  // Strategy: use data-is-with-model as an anchor to identify the outer row only.
  //   If the page has any data-is-with-model attributes → new template, collect only those.
  //   Otherwise (old template) → fall back to collecting every data-model-id as before.
  // Collect IDs from elements that carry class="model-row-v2" — this is only placed on the
  // outer product-row div. Inner elements (store rows, price-alert buttons, comparison
  // toggles) reuse data-model-id but NEVER have this class, so they are excluded.
  // Also catches marketplace single-store rows (no data-is-with-model, but same outer div).
  const outerRowIds = new Set();
  // Strategy: multiple class patterns for outer product rows across ZAP templates.
  // model-row-v2: main 2025 template; ModelBox/ProductBox: older template variants;
  // card-v2: card-style layout used for some categories.
  const OUTER_CLASSES_RE = /class="[^"]*(?:model-row-v2|ModelBox|ProductBox|card-v2(?:__item)?|product-card|model-card)[^"]*"/;
  // Both attribute orderings: class before data-model-id and vice versa
  for (const m of html.matchAll(new RegExp(OUTER_CLASSES_RE.source + '[^>]{0,600}data-model-id="(\\d+)"', 'g'))) {
    outerRowIds.add(m[1]);
  }
  for (const m of html.matchAll(new RegExp('data-model-id="(\\d+)"[^>]{0,600}' + OUTER_CLASSES_RE.source, 'g'))) {
    outerRowIds.add(m[1]);
  }
  // Also try data-is-with-model (another ZAP outer-row marker)
  for (const m of html.matchAll(/data-is-with-model[^>]{0,200}data-model-id="(\d+)"/g)) {
    outerRowIds.add(m[1]);
  }
  for (const m of html.matchAll(/data-model-id="(\d+)"[^>]{0,200}data-is-with-model/g)) {
    outerRowIds.add(m[1]);
  }
  // Anchor-based: href to model.aspx links are only on product-level elements, not inner store rows
  for (const m of html.matchAll(/href="\/model\.aspx\?modelid=(\d+)"/g)) {
    outerRowIds.add(m[1]);
  }

  const idsToCollect = outerRowIds.size > 0
    ? outerRowIds                                                    // identified outer rows
    : new Set([...html.matchAll(/data-model-id="(\d+)"/g)].map(m => m[1])); // last-resort fallback

  // Extract data-manufacturer from outer row divs (only the outer div has both attributes)
  const mfrMap = new Map();
  for (const m of html.matchAll(/data-model-id="(\d+)"[^>]{1,400}data-manufacturer="([^"]{1,80})"/g)) {
    mfrMap.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/data-manufacturer="([^"]{1,80})"[^>]{1,400}data-model-id="(\d+)"/g)) {
    if (!mfrMap.has(m[2])) mfrMap.set(m[2], m[1]);
  }

  for (const id of idsToCollect) {
    if (!seen.has(id)) { seen.add(id); products.push({ id, name: "", price: 0, image: "", manufacturer: mfrMap.get(id) || "" }); }
  }

  // Pass 2a: aria-label on (or near) the modelid href — try both orderings.
  // ZAP 2025 format: href="/model.aspx?modelid=NNN" \n aria-label="להשוואת מחירים PRODUCT_NAME"
  // Note: [^>] fails here because ZAP formats attributes on separate lines (newlines between).
  //       Use [\s\S]{0,200}? (lazy) to cross line boundaries without over-matching.
  const ARIA_PREFIXES_RE = /(?:להשוואת מחירים|לפרטים נוספים|לרכישה|השוואת מחירים)\s+/;
  const UI_LABEL_RE   = /^(?:לחץ|הוסף|אפשרויות|מיין|למפרט|חזרה|זאפ|חשמל|הוספה|שמור|ראה|סגור|פתח|עבור|ניווט|תפריט|פילטר|נקה|אפס|החל|אישור|ביטול|השוואת דגמים|חיפוש|לרשימת|הצגת|עוד |[\d]+\s)/;
  function isUiLabel(s) { return !s || s.length < 8 || UI_LABEL_RE.test(s); }

  // href first, aria-label after (ZAP 2025 — attributes on separate lines)
  for (const m of html.matchAll(/href="\/model\.aspx\?modelid=(\d+)"[\s\S]{0,200}?aria-label="([^"]{5,200})"/g)) {
    const p = products.find(x => x.id === m[1]);
    if (!p || p.name) continue;
    const raw  = htmlDecode(m[2]);
    const name = raw.replace(ARIA_PREFIXES_RE, "").trim();  // strip legacy prefix if present
    if (!isUiLabel(name)) p.name = name;
  }
  // aria-label first, href after (reversed attribute order)
  for (const m of html.matchAll(/aria-label="([^"]{5,200})"[\s\S]{0,200}?href="\/model\.aspx\?modelid=(\d+)"/g)) {
    const p = products.find(x => x.id === m[2]);
    if (!p || p.name) continue;
    const raw  = htmlDecode(m[1]);
    const name = raw.replace(ARIA_PREFIXES_RE, "").trim();
    if (!isUiLabel(name)) p.name = name;
  }
  // data-model-name / data-name attribute on the product row element
  for (const m of html.matchAll(/data-model-id="(\d+)"[^>]{0,500}data-(?:model-)?name="([^"]{3,120})"/g)) {
    const p = products.find(x => x.id === m[1]);
    if (p && !p.name) p.name = htmlDecode(m[2]);
  }
  for (const m of html.matchAll(/data-(?:model-)?name="([^"]{3,120})"[^>]{0,500}data-model-id="(\d+)"/g)) {
    const p = products.find(x => x.id === m[2]);
    if (p && !p.name) p.name = htmlDecode(m[1]);
  }

  // Enrich price + name + image (one block per unique product)
  const idPositions = [...html.matchAll(/data-model-id="(\d+)"/g)];
  const seenEnrich = new Set();

  for (let i = 0; i < idPositions.length; i++) {
    const id = idPositions[i][1];
    if (seenEnrich.has(id)) continue;
    seenEnrich.add(id);

    let nextStart = null;
    for (let j = i + 1; j < idPositions.length; j++) {
      if (!seenEnrich.has(idPositions[j][1])) { nextStart = idPositions[j].index; break; }
    }
    const block = html.slice(idPositions[i].index, nextStart ? Math.min(nextStart, idPositions[i].index + 10000) : idPositions[i].index + 10000);

    const p = products.find(x => x.id === id);
    if (!p) continue;

    // Name extraction — multiple patterns, different ZAP category templates use different HTML
    if (!p.name) {
      const nm =
        // Template A (phones/laptops): aria-label with "להשוואת מחירים"
        block.match(/aria-label="להשוואת מחירים\s+([^"]{5,120})"/) ||
        // Template A2: reversed attr order (aria-label before href)
        block.match(/aria-label="(?:לפרטים נוספים|להשוואת מחירים|לרכישה|השוואת מחירים)\s+([^"]{5,120})"/) ||
        // Template B (TVs/appliances): aria-label with "לפרטים נוספים" or general label
        block.match(/aria-label="לפרטים נוספים\s+([^"]{5,120})"/) ||
        block.match(/aria-label="לרכישה\s+([^"]{5,120})"/) ||
        // Template B2: data-name / data-model-name / data-item-name attributes
        block.match(/data-(?:model-name|item-name|product-name|name)="([^"]{5,120})"/) ||
        // Template C: title attribute on the product link
        block.match(/href="[^"]*modelid=\d+[^"]*"\s+title="([^"]{5,120})"/) ||
        block.match(/title="([^"]{5,120})"\s+href="[^"]*modelid=/) ||
        // Template D: class-based heading (model_title, product-title, etc.)
        block.match(/class="[^"]*(?:model[_-]title|product[_-]?(?:title|name)|item[_-]?name)[^"]*"[^>]*>\s*([^<]{5,120})\s*</) ||
        // Template E: any <h3> or <h4> in the block with reasonable content
        block.match(/<h[34][^>]*>\s*([\S][^<]{4,120})\s*<\/h[34]>/) ||
        // Template F: alt text on product image (last resort — usually has model name)
        block.match(/alt="([A-Za-z\u0590-\u05FF][^"]{4,120})"(?=[^>]*(?:class="[^"]*(?:item|product|model)[^"]*"|src="[^"]*img\.zap))/);
      if (nm) p.name = htmlDecode(nm[1]);
    }

    // Price: multiple ZAP templates
    const priceM =
      // Template A: bidPrice class (ads) — "6,448 ₪"
      block.match(/class="[^"]*[Pp]rice[^"]*"[^>]*>\s*([\d,]{3,7})\s*(?:₪|&#8362;)/) ||
      // Template B: card-v2 price-amount — "<span class="card-v2__price-amount">3,369</span>"
      block.match(/class="card-v2__price-amount"[^>]*>\s*([\d,]{3,7})\s*</) ||
      // Template C: Hebrew "מ-" prefix — "החל מ- 3,369 ₪"
      block.match(/מ[^0-9<]{0,8}([\d,]{3,7})\s*(?:₪|&#8362;)/) ||
      // Template D: general price with ₪
      block.match(/>\s*([\d,]{3,7})\s*₪/);
    if (priceM) {
      const v = parseInt(priceM[1].replace(/,/g, ""), 10);
      if (v >= 50 && v <= 500000) p.price = v;
    }

    // Image: ZAP CDN product images are under /pics/ — never pick up /imgs/svg/ icons
    const imgM =
      block.match(/src="(https?:\/\/img\.zap\.co\.il\/pics\/[^"]{3,200})"/i) ||
      block.match(/src="(https?:\/\/[^"]{10,200}\.(?:jpe?g|png|webp|gif)[^"]*)"/i);
    if (imgM) p.imageUrl = imgM[1];
  }

  // Filter out ghost entries: inner elements (store rows, price-alert buttons, compare
  // toggles) that carry data-model-id but have no actual product data around them.
  // Only keep products where at least name or price was extracted.
  const enriched = products.filter(p => p.id && (p.name || p.price > 0));
  if (products.length !== enriched.length) {
    const ghosts = products.length - enriched.length;
    console.log(`    [extractZap] ${products.length} raw IDs → ${enriched.length} with data (${ghosts} ghost entries dropped)`);
  }
  return enriched;
}

async function scrapeZapCategory(sog) {
  const allProducts = [];
  const seenIds = new Set();
  let cfBlocked = false;

  for (let page = 1; page <= MAX_ZAP_PAGES; page++) {
    const url = `https://www.zap.co.il/models.aspx?sog=${sog}&orderby=2${page > 1 ? `&pageinfo=${page}` : ""}`;
    try {
      const resp = await axios.get(url, { headers: { ...HEADERS, Referer: "https://www.zap.co.il/" }, timeout: 18000, decompress: true, validateStatus: s => s < 500 });
      const html = typeof resp.data === "string" ? resp.data : "";

      if (isZapBlocked(html) || resp.status === 403) {
        if (page === 1) { console.warn(`  [ZAP] ${sog} — blocked on p1`); cfBlocked = true; }
        break;
      }

      // Debug: save first page HTML for inspection
      if (page === 1 && process.env.DEBUG_HTML) {
        const dbgPath = path.join(DATA_DIR, `debug_zap_${sog}_p1.html`);
        fs.writeFileSync(dbgPath, html, "utf8");
        console.log(`  [DEBUG] Saved ${(html.length/1024).toFixed(0)}KB → ${dbgPath}`);
      }

      const prods = extractZapProducts(html).filter(p => !seenIds.has(p.id));
      if (prods.length === 0) break;
      prods.forEach(p => { seenIds.add(p.id); allProducts.push(p); });
      process.stdout.write(`\r  [ZAP] ${sog}: ${allProducts.length} products (p${page})   `);
    } catch(e) {
      if (page === 1) { console.warn(`\n  [ZAP] ${sog} p${page} error: ${e.message}`); break; }
      // timeout on later pages → continue
    }
    await sleep(ZAP_PAGE_DELAY);
  }
  process.stdout.write("\n");
  return { products: allProducts, cfBlocked };
}

// ── WiseBuy name enrichment ───────────────────────────────────────────────────
// WiseBuy.co.il aggregates ZAP products and uses the SAME ZAP model IDs (id="box_{id}").
// Its product names from class="ProdInfoTitle" are usually cleaner than ZAP's SSR HTML.
// We use WiseBuy ONLY to fill in missing names — it does NOT replace ZAP catalog.

async function enrichNamesFromWiseBuy(products, sog) {
  const unnamed = products.filter(p => !p.name);
  if (unnamed.length === 0) return 0;

  const WB_HEADERS = {
    ...HEADERS,
    Referer: "https://www.wisebuy.co.il/",
  };
  const unnamedIds = new Set(unnamed.map(p => p.id));
  let enriched = 0;
  let page = 1;

  while (page <= MAX_ZAP_PAGES) {
    const url = `https://www.wisebuy.co.il/products.aspx?category=${sog}${page > 1 ? `&pageinfo=${page}` : ""}`;
    try {
      const resp = await axios.get(url, { headers: WB_HEADERS, timeout: 18000, decompress: true, validateStatus: s => s < 500, httpsAgent: WB_HTTPS_AGENT });
      const html = typeof resp.data === "string" ? resp.data : "";
      if (!html || html.length < 1000 || html.includes("403") || html.includes("Access Denied")) break;

      // Extract product blocks: id="box_{zapModelId}"
      const boxMatches = [...html.matchAll(/id="box_(\d+)"/g)];
      if (boxMatches.length === 0) break;

      let foundOnPage = 0;
      for (let i = 0; i < boxMatches.length; i++) {
        const id = boxMatches[i][1];
        if (!unnamedIds.has(id)) continue;

        const blockStart = boxMatches[i].index;
        const nextStart  = boxMatches[i + 1]?.index;
        const block = html.slice(blockStart, nextStart ? Math.min(nextStart, blockStart + 3000) : blockStart + 3000);

        const nameM =
          block.match(/class="ProdInfoTitleLink"[^>]*>\s*([^<]{3,150})\s*<\/a>/) ||
          block.match(/class="ProdInfoTitle(?:Link)?"[^>]*>\s*([^<]{3,150})</) ||
          block.match(/class="[^"]*ProdInfoTitle[^"]*"[^>]*>(?:<[^>]+>)*\s*([^<]{3,150})/);
        if (!nameM) continue;

        const name = htmlDecode(nameM[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim());
        if (!name || name.length < 3) continue;

        const p = products.find(x => x.id === id);
        if (p && !p.name) {
          p.name = name;
          unnamedIds.delete(id);
          enriched++;
          foundOnPage++;
        }
      }

      // Stop if no more unnamed products to find, or page returns 0 known products
      if (unnamedIds.size === 0) break;
      // Check if we've gone past the last page (no more boxes at all)
      const nextPageUrl = `https://www.wisebuy.co.il/products.aspx?category=${sog}&pageinfo=${page + 1}`;
      if (boxMatches.length < 5) break; // sparse page → likely the last

      page++;
    } catch(e) {
      if (page === 1) console.warn(`  [WiseBuy] ${sog} error: ${e.message}`);
      break;
    }
    await sleep(1000);
  }

  if (enriched > 0) console.log(`  [WiseBuy] enriched ${enriched} names for ${sog}`);
  return enriched;
}

// ── Ivory scraper ─────────────────────────────────────────────────────────────

function extractIvoryProducts(html) {
  // ── Strategy 1: schema.org ItemList JSON-LD (phones, tablets, monitors, etc.) ─
  const ldTags = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (ldTags) {
    for (const tag of ldTags) {
      try {
        const inner = tag.replace(/<\/?script[^>]*>/gi, "").trim();
        const data = JSON.parse(inner);
        const items = data["@type"] === "ItemList" ? data.itemListElement : null;
        if (!items?.length) continue;
        const prods = items.map(it => ({
          sku:    it.item?.sku   || "",
          name:   it.item?.name  || "",
          price:  it.item?.offers?.price || 0,
          image:  Array.isArray(it.item?.image) ? it.item.image[0] : it.item?.image || "",
          url:    it.item?.url   || "",
          brand:  it.item?.brand?.name || "",
        })).filter(p => p.name && p.price > 0);
        if (prods.length > 0) return prods;
      } catch(e) {}
    }
  }

  // ── Strategy 2: HTML product card fallback (TVs, appliances, etc.) ───────────
  // Ivory catalog pages embed product data in data-* attributes or link+price blocks.
  // Pattern A: data attributes on anchor/div  <a data-name="..." data-price="..." data-sku="...">
  {
    const results = [];
    const seenSkus = new Set();
    const dataRe = /<(?:a|div)[^>]+data-(?:product-)?(?:id|sku)="(\d+)"[^>]*data-(?:product-)?name="([^"]{3,120})"[^>]*data-(?:product-)?price="([^"]+)"/gi;
    let m;
    while ((m = dataRe.exec(html)) !== null) {
      const sku = m[1], name = htmlDecode(m[2]), priceStr = m[3];
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);
      const price = parseFloat(priceStr.replace(/[^\d.]/g, "")) || 0;
      if (name && price > 0) results.push({ sku, name, price, image: "", url: `https://www.ivory.co.il/catalog.php?act=prod&id=${sku}`, brand: "" });
    }
    if (results.length > 0) return results;
  }

  // Pattern B: product link + title + nearby price block
  {
    const results = [];
    const seenSkus = new Set();
    // Split HTML into blocks around each product link
    const linkRe = /href="[^"]*catalog\.php\?act=prod(?:&amp;|&)(?:prodId|id)=(\d+)[^"]*"([^>]*)>([\s\S]{0,300})/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const sku = m[1];
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);
      const attrStr  = m[2];
      const bodyText = m[3];

      // Name: from title="..." attribute, or from first non-empty text node
      let name = "";
      const titleM = attrStr.match(/title="([^"]{3,120})"/);
      if (titleM) name = htmlDecode(titleM[1]);
      if (!name) {
        const textM = bodyText.replace(/<[^>]+>/g, " ").match(/([A-Za-z\u0590-\u05FF][^\n\r<]{3,120})/);
        if (textM) name = textM[1].trim();
      }

      // Price: look ahead ~600 chars for a ₪ pattern
      const ahead = html.slice(m.index, m.index + 600);
      const priceM = ahead.match(/(?:₪\s*|class="[^"]*price[^"]*"[^>]*>)[^\d]*?([\d,]+(?:\.\d+)?)/i)
                  || ahead.match(/([\d,]{3,7})\s*(?:₪|ש"ח)/);
      const price = priceM ? parseFloat(priceM[1].replace(/,/g, "")) : 0;

      if (name && price > 0 && price < 150000)
        results.push({ sku, name, price, image: "", url: `https://www.ivory.co.il/catalog.php?act=prod&id=${sku}`, brand: "" });
    }
    if (results.length > 0) return results;
  }

  return [];
}

function getIvoryMaxPage(html) {
  // Ivory pagination: ?pg=N (0-indexed). pg=1 → page 2, pg=2 → page 3, etc.
  const nums = [...html.matchAll(/[?&]pg=(\d+)/g)].map(m => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) + 1 : 1; // +1 because pg is 0-indexed
}

function getIvoryCatalogBase(html) {
  // Extract catalog.php?act=cat&id=XXXX from pagination links in the HTML
  const m = html.match(/catalog\.php\?act=cat&(?:amp;)?id=(\d+)/);
  return m ? `https://www.ivory.co.il/catalog.php?act=cat&id=${m[1]}` : null;
}

async function scrapeIvoryCategory(ivoryUrl) {
  if (!ivoryUrl) return [];
  const allProducts = [];
  const seenSkus = new Set();
  let maxPage = null;
  let catalogBase = null;

  for (let page = 1; page <= MAX_IVORY_PAGES; page++) {
    if (maxPage !== null && page > maxPage) break;

    let url;
    if (page === 1) {
      url = `https://www.ivory.co.il/${ivoryUrl}`; // follows redirect to catalog.php
    } else {
      if (!catalogBase) break; // can't paginate without base URL
      url = `${catalogBase}&pg=${page - 1}`; // 0-indexed: page 2 → pg=1, page 3 → pg=2
    }

    try {
      const resp = await axios.get(url, { headers: { ...HEADERS, Referer: "https://www.ivory.co.il/" }, timeout: 15000, decompress: true, validateStatus: s => s < 500 });
      const html = typeof resp.data === "string" ? resp.data : "";
      if (resp.status === 404 || html.length < 1000) break;

      if (page === 1) {
        // Discover catalog base URL from pagination links (or from the redirect final URL)
        catalogBase = getIvoryCatalogBase(html);
        if (!catalogBase) {
          // Try to recover from the final URL after redirect (follow-redirects exposes it)
          const finalUrl = resp.request?.res?.responseUrl
            || resp.request?._redirectable?._currentUrl
            || "";
          const m2 = finalUrl.match(/catalog\.php\?act=cat&id=(\d+)/);
          if (m2) catalogBase = `https://www.ivory.co.il/catalog.php?act=cat&id=${m2[1]}`;
        }
        maxPage = getIvoryMaxPage(html);
        console.log(`  [Ivory] ${ivoryUrl} → base=${catalogBase ?? "?"}, maxPage=${maxPage}`);
      }

      const prods = extractIvoryProducts(html).filter(p => !seenSkus.has(p.sku || p.name));
      // On page 1: zero results might mean the HTML-fallback will work on paginated URLs,
      // or the category truly has no products.  Only break if page > 1 returns nothing.
      if (prods.length === 0) {
        if (page > 1) break;           // subsequent pages empty → done
        // page 1: log and continue (try pagination if catalogBase was found)
        if (!catalogBase) break;       // no way to paginate → give up
        // else fall through to paginate — maybe page 2+ has data
      } else {
        prods.forEach(p => { seenSkus.add(p.sku || p.name); allProducts.push(p); });
        process.stdout.write(`\r  [Ivory] ${ivoryUrl}: ${allProducts.length} products (p${page}/${maxPage ?? "?"})   `);
      }
    } catch(e) {
      if (page === 1) console.warn(`\n  [Ivory] ${ivoryUrl} error: ${e.message}`);
      break;
    }
    await sleep(IVORY_PAGE_DELAY);
  }
  process.stdout.write("\n");
  return allProducts;
}

// ── KSP scraper — delegates to ksp-scraper.js (correct tag format + pagination) ──

async function scrapeKspCategory(zapSog) {
  if (!zapSog) return [];
  // getKspCategoryAll handles both tag-based (KSP_CAT_TAG_MAP) and search-term fallback (KSP_SEARCH_MAP)
  // Don't bail out early — let the function use its search fallback for categories without a tag
  try {
    const results = await getKspCategoryAll(zapSog, { timeout: 20000, maxPages: 200 });
    // Normalise to the shape mergePrices expects: { name, price, url }
    return results.map(r => ({
      kspId: r._kspId || r.id || "",
      name:  r.title || r.name || "",   // ksp-scraper normalizer returns .title
      price: r.price || 0,
      image: r.image || "",
      url:   r.link  || r.url || "",
      brand: r.brand || "",
    }));
  } catch(e) {
    console.warn(`  [KSP] sog="${zapSog}" error: ${e.message}`);
    return [];
  }
}

// ── Bug.co.il scraper ─────────────────────────────────────────────────────────

async function scrapeBugCategory(zapSog) {
  try {
    const results = await getBugCategory(zapSog, { timeout: 15000 });
    if (!results?.length) return [];
    // Normalise to { name, price, url } shape that mergePrices expects
    return results.map(r => ({
      name:  r.title || r.name || "",
      price: r.price || 0,
      url:   r.link  || "",
      image: r.image || "",
    })).filter(r => r.name && r.price > 0);
  } catch(e) {
    console.warn(`  [Bug] sog="${zapSog}" error: ${e.message}`);
    return [];
  }
}

// ── Image downloader ──────────────────────────────────────────────────────────

async function downloadImage(url, destPath) {
  if (!url || fs.existsSync(destPath)) return true; // already downloaded
  try {
    const resp = await axios.get(url, { responseType: "stream", timeout: 15000, headers: HEADERS, validateStatus: s => s === 200 });
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(destPath);
      resp.data.pipe(stream);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });
    return true;
  } catch(e) {
    return false;
  }
}

// ZAP placeholder URLs — products without a real photo get one of these.
// Downloading them is pointless and wastes space; treat them as "no image".
// Matches ZAP's placeholder SVG icons AND any other .svg image URL (which are always
// vector icons/logos, never actual product photos).
const ZAP_PLACEHOLDER_RE = /\/imgs\/svg\/list_black\.svg|\/imgs\/svg\/no_img|placeholder|\.svg(?:\?|$)/i;

async function downloadImages(slug, products, concurrency = IMAGE_CONCURRENCY) {
  const imgDir = imageDir(slug);
  fs.mkdirSync(imgDir, { recursive: true });
  let done = 0, failed = 0;

  // Skip products whose imageUrl is ZAP's placeholder SVG — clear it so the app
  // shows its own "no image" fallback instead of ZAP's generic document icon.
  for (const p of products) {
    if (p.imageUrl && ZAP_PLACEHOLDER_RE.test(p.imageUrl)) {
      delete p.imageUrl;
      delete p.image;   // clear any previously-downloaded placeholder
    }
  }

  const queue = products.filter(p => p.imageUrl);
  const chunks = [];
  for (let i = 0; i < queue.length; i += concurrency) chunks.push(queue.slice(i, i + concurrency));

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async p => {
      const ext = (p.imageUrl.match(/\.(\w{2,4})(?:\?|$)/) || ["", "jpg"])[1];
      const dest = path.join(imgDir, `${p.id}.${ext}`);
      const ok = await downloadImage(p.imageUrl, dest);
      if (ok) { p.image = `images/${p.id}.${ext}`; done++; }
      else { p.image = p.imageUrl; failed++; } // keep URL as fallback
    }));
    process.stdout.write(`\r  [img] ${slug}: ${done}/${queue.length} downloaded (${failed} failed)   `);
  }
  process.stdout.write("\n");
}

// ── Price merger ──────────────────────────────────────────────────────────────

function mergePrices(products, ivoryProds, kspProds, bugProds = []) {
  // Only update store prices when we actually got data from that store.
  // If a store returned 0 results (e.g. 403 rate-limit), preserve the
  // previously-saved prices so a failed sync doesn't wipe good data.
  const hasIvory = ivoryProds.length > 0;
  const hasKsp   = kspProds.length > 0;
  const hasBug   = bugProds.length > 0;

  for (const p of products) {
    // Snapshot existing per-store prices BEFORE resetting
    const prevIvory    = p.prices?.ivory    || 0;
    const prevIvoryUrl = p.prices?.ivoryUrl || "";
    const prevKsp      = p.prices?.ksp      || 0;
    const prevKspUrl   = p.prices?.kspUrl   || "";
    const prevBug      = p.prices?.bug      || 0;
    const prevBugUrl   = p.prices?.bugUrl   || "";

    p.prices = { zap: p.price || 0, updated: Date.now() };

    // Ivory
    if (hasIvory) {
      const ivMatch = findBestMatch(p.name, ivoryProds, 0.70);
      if (ivMatch) { p.prices.ivory = ivMatch.price; p.prices.ivoryUrl = ivMatch.url; }
    } else if (prevIvory > 0) {
      // Store returned no data (403/timeout) — carry over last known price
      p.prices.ivory = prevIvory;
      if (prevIvoryUrl) p.prices.ivoryUrl = prevIvoryUrl;
    }

    // KSP — threshold 0.70 to reduce false positives (was 0.55).
    // Brand-only matches like "NRX485 Pure Acoustics" ↔ "IC-150 Pure Acoustics" score
    // 0.667 (2/3 words: "pure" + "acoustics"), correctly rejected at 0.70.
    // Valid specific-model matches score ≥ 0.75 (3+ unique model words all in haystack).
    if (hasKsp) {
      const kspMatch = findBestMatch(p.name, kspProds, 0.70);
      if (kspMatch) { p.prices.ksp = kspMatch.price; p.prices.kspUrl = kspMatch.url; }
    } else if (prevKsp > 0) {
      p.prices.ksp = prevKsp;
      if (prevKspUrl) p.prices.kspUrl = prevKspUrl;
    }

    // Bug.co.il
    if (hasBug) {
      const bugMatch = findBestMatch(p.name, bugProds, 0.70);
      if (bugMatch) { p.prices.bug = bugMatch.price; p.prices.bugUrl = bugMatch.url; }
    } else if (prevBug > 0) {
      p.prices.bug = prevBug;
      if (prevBugUrl) p.prices.bugUrl = prevBugUrl;
    }

    // Clean up raw price field (kept in prices.zap)
    delete p.price;
  }
  return products;
}

// ── Category sync ─────────────────────────────────────────────────────────────

export async function syncCategory(slug, opts = {}) {
  const cat = CATEGORIES[slug];
  if (!cat) { console.warn(`Unknown category: ${slug}`); return; }

  const meta = loadMeta(slug);
  const now  = Date.now();
  const catalogAge = meta.catalogTs ? (now - meta.catalogTs) / 3_600_000 : Infinity;
  const pricesAge  = meta.pricesTs  ? (now - meta.pricesTs)  / 3_600_000 : Infinity;

  const needCatalog = opts.force || opts.catalogOnly || catalogAge > CATALOG_FRESH_HOURS;
  const needPrices  = opts.force || opts.pricesOnly  || pricesAge  > PRICES_FRESH_HOURS;

  if (!needCatalog && !needPrices) {
    console.log(`[DB] ↷ ${slug} — catalog ${catalogAge.toFixed(1)}h, prices ${pricesAge.toFixed(1)}h — fresh, skipping`);
    return;
  }

  console.log(`\n[DB] ══ ${slug} (${cat.label}) ══`);
  let products = loadProducts(slug);

  // ── Step 1: Build/update catalog ──────────────────────────────────────────
  // For most categories: ZAP is the master catalog.
  // For categories with catalogSource:"ksp": ZAP gives useless names (e.g. CPU model numbers
  // for desktops), so KSP is used as catalog source instead — its products have real names.
  if (needCatalog && !opts.pricesOnly && cat.catalogSource === "ksp") {
    console.log(`  Building catalog from KSP (catalogSource=ksp, sog=${cat.zapSog})...`);
    const kspCatalogProds = await scrapeKspCategory(cat.zapSog);
    if (kspCatalogProds.length > 0) {
      // Build catalog from KSP: use KSP product name as canonical name, KSP URL as reference.
      // Deduplicate by normalized name to avoid near-duplicates.
      const seen = new Set();
      const newProds = [];
      for (const kp of kspCatalogProds) {
        const normKey = normalizeName(kp.name).replace(/\s+/g, "");
        if (!kp.name || normKey.length < 4 || seen.has(normKey)) continue;
        seen.add(normKey);
        newProds.push({
          // KSP-sourced catalog uses kspId as product ID (prefixed to avoid collisions with ZAP IDs)
          id:       `ksp_${kp.kspId || normKey.slice(0, 20)}`,
          name:     kp.name,
          imageUrl: kp.image || "",
          // Pre-fill KSP price since we got it for free during catalog fetch
          prices: { ksp: kp.price, kspUrl: kp.url, zap: 0, updated: Date.now() },
        });
      }
      // Replace catalog: KSP is the sole source of truth for these categories.
      // Drop any old products (e.g. stale ZAP data from before catalogSource was set).
      products = newProds;
      console.log(`  KSP catalog: ${kspCatalogProds.length} raw → ${newProds.length} deduped → ${products.length} total`);
      meta.catalogTs = now;
      saveProducts(slug, products);
      saveMeta(slug, meta);
    } else {
      console.warn(`  KSP catalog: no products returned (rate-limited?). Keeping existing ${products.length} products.`);
    }
  } else if (needCatalog && !opts.pricesOnly) {
    console.log(`  Building catalog from ZAP (sog=${cat.zapSog})...`);
    const { products: zapProds, cfBlocked } = await scrapeZapCategory(cat.zapSog);

    if (zapProds.length > 0) {
      // Merge: keep existing products, add new ones, update names
      const existingIds = new Map(products.map(p => [p.id, p]));
      for (const zp of zapProds) {
        if (existingIds.has(zp.id)) {
          // Update name + imageUrl if better
          const existing = existingIds.get(zp.id);
          if (zp.name && !existing.name) existing.name = zp.name;
          if (zp.imageUrl) existing.imageUrl = zp.imageUrl;
          if (zp.manufacturer && !existing.manufacturer) existing.manufacturer = zp.manufacturer;
        } else {
          products.push(zp);
          existingIds.set(zp.id, zp);
        }
      }
      console.log(`  ZAP: ${zapProds.length} found, ${products.length} total in catalog`);
      meta.catalogTs = now;
    } else {
      console.warn(`  ZAP: no products — ${cfBlocked ? "CF blocked" : "empty response"}`);
    }

    // Enrich missing names from WiseBuy (same ZAP product IDs, cleaner names)
    const namelessCount = products.filter(p => !p.name).length;
    if (namelessCount > 0) {
      await enrichNamesFromWiseBuy(products, cat.zapSog);
    }

    // ── Junk-product filter ────────────────────────────────────────────────────
    // Remove:
    //  (a) products with no name
    //  (b) ZAP navigation links (e.g. "קטגוריות משלימות", "הצג הכל")
    //  (c) WiseBuy/ZAP article titles scraped as products
    //      (e.g. "כך תבחרו מקלדת", "המדריך המלא לקניית מצלמות", "5 טיפים ...")
    //  (d) products with SVG imageUrls — these are always icons/nav items, never real products
    const JUNK_EXACT  = /^(?:קטגוריות משלימות|הצג הכל|כל הקטגוריות|ראה הכל|מוצרים נוספים)$/;
    const JUNK_PREFIX = /^(?:כך |איך |מדריך |המדריך המלא|[\d]+ טיפים)/;
    const beforeJunk = products.length;
    products = products.filter(p => {
      const name     = (p.name     || "").trim();
      const imageUrl = (p.imageUrl || "");
      if (!name)                    return false; // (a) empty name
      if (JUNK_EXACT.test(name))    return false; // (b) nav links
      if (JUNK_PREFIX.test(name))   return false; // (c) article titles
      if (/\.svg(?:\?|$)/i.test(imageUrl)) return false; // (d) SVG-icon items
      return true;
    });
    const junked = beforeJunk - products.length;
    if (junked > 0) console.log(`  Junk filter: removed ${junked} empty/nav/article products`);

    // Download images
    if (!opts.noImages) {
      console.log(`  Downloading images...`);
      await downloadImages(slug, products);
    }

    saveProducts(slug, products);
    saveMeta(slug, meta);
  }

  // ── Step 2: Fetch prices from Ivory + KSP ─────────────────────────────────
  if (needPrices && products.length > 0) {
    console.log(`  Fetching prices...`);

    // Fetch from stores sequentially (not parallel) to reduce rate-limit risk.
    // Each store gets a chance to respond without simultaneous hits from other scrapers.
    const ivoryProds = cat.ivoryUrl ? await scrapeIvoryCategory(cat.ivoryUrl) : [];
    await sleep(1200);
    // For KSP-catalog categories, KSP prices were already filled during catalog build.
    // Still fetch KSP during --prices-only runs so prices stay fresh.
    const kspProds = await scrapeKspCategory(cat.zapSog);
    await sleep(1500);
    const bugProds   = await scrapeBugCategory(cat.zapSog);

    console.log(`  Ivory: ${ivoryProds.length}, KSP: ${kspProds.length}, Bug: ${bugProds.length}`);
    mergePrices(products, ivoryProds, kspProds, bugProds);
    meta.pricesTs = now;

    saveProducts(slug, products);
    saveMeta(slug, meta);
  }

  // Summary
  // Count products with at least one REAL store price (excludes the `updated` timestamp field)
  const PRICE_KEYS = ["zap", "ivory", "ksp", "bug"];
  const priced = products.filter(p => PRICE_KEYS.some(k => (p.prices?.[k] || 0) > 0)).length;
  const imaged = products.filter(p => p.image).length;
  const ivoryPriced = products.filter(p => (p.prices?.ivory || 0) > 0).length;
  const kspPriced   = products.filter(p => (p.prices?.ksp   || 0) > 0).length;
  const bugPriced   = products.filter(p => (p.prices?.bug   || 0) > 0).length;
  const parts = [`ivory=${ivoryPriced}`, `ksp=${kspPriced}`, bugPriced > 0 ? `bug=${bugPriced}` : null].filter(Boolean);
  console.log(`  ✓ ${products.length} products — ${priced} with price (${parts.join(", ")}), ${imaged} with image`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args       = process.argv.slice(2);
  const force      = args.includes("--force");
  const pricesOnly = args.includes("--prices-only");
  const noImages   = args.includes("--no-images");
  const debugHtml  = args.includes("--debug-html");
  const catArg     = args.find(a => a.startsWith("--cat="))?.split("=")[1]
                  || (args.indexOf("--cat") >= 0 ? args[args.indexOf("--cat") + 1] : null);

  const slugs = catArg ? catArg.split(",").map(s => s.trim()).filter(Boolean) : Object.keys(CATEGORIES);
  const opts  = { force, pricesOnly, noImages, debugHtml };

  console.log(`\n[DB] ═══ DB Sync start: ${slugs.length} categories (force=${force}, pricesOnly=${pricesOnly}) ═══\n`);
  const t0 = Date.now();

  for (const slug of slugs) {
    await syncCategory(slug, opts);
    await sleep(1500);
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n[DB] ═══ Done in ${Math.floor(elapsed/60)}m${elapsed%60}s ═══\n`);
}

// Only run when invoked directly (not imported)
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("db-sync.js");
if (isMain) main().catch(e => { console.error(e); process.exit(1); });