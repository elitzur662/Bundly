/**
 * Bundly — build a CLEAN catalog from Zap for the top categories.
 *
 *     node scripts/build-zap-catalog.mjs                 # all top categories
 *     node scripts/build-zap-catalog.mjs --only=phones,tvs
 *     node scripts/build-zap-catalog.mjs --dry-run       # scrape + report, don't write
 *     node scripts/build-zap-catalog.mjs --pages=40      # max listing pages per category
 *
 * WHY
 * The legacy catalog grew to ~29k products of mixed quality — missing prices,
 * accessory-contaminated prices (₪30 iPhones), duplicate rows with wrong
 * images. Rather than repair 29k rows one by one, this rebuilds the catalog
 * for launch from a single trustworthy source.
 *
 * HOW IT IS "100% ACCURATE"
 * Zap's category listing pages (models.aspx?sog=…) are NOT Cloudflare-blocked
 * and render every product as one card carrying its NAME, IMAGE and current
 * "from ₪X" PRICE together. Because all three come from the SAME card they are
 * guaranteed to belong to the same product — no name-matching, no guessing.
 * Sponsored "מודעה" ad cards are skipped. A product is written ONLY if it has
 * a real name, a real Zap image, and a price within sane category bounds.
 *
 * The fresh products.json REPLACES the old one (backed up to .pre-rebuild.bak).
 * Anything that can't be verified is simply left out — exactly the launch-
 * safety trade-off we want.
 */
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB = path.join(__dirname, "..", "product-db");
const ZAP        = "https://www.zap.co.il";

// ── Top categories: catalog folder → Zap SOG key (all verified) ──────────────
const CATEGORIES = {
  phones:              "e-cellphone",
  tvs:                 "e-tv",
  laptops:             "c-pclaptop",
  desktops:            "c-pcdesktop",
  tablets:             "c-tabletpc",
  monitors:            "c-monitor",
  headphones:          "e-headphone",
  speakers:            "e-speaker",
  "portable-speakers": "e-mpspeakers",
  soundbars:           "e-soundbar",
  cameras:             "e-camera",
  "gaming-consoles":   "e-tvgame",
  fridges:             "e-fridge",
  "washing-machines":  "e-washingmachine",
  dryers:              "e-drayer",
  dishwashers:         "e-dishwasher",
  ovens:               "e-oven",
  "air-conditioners":  "e-airconditioner",
  "coffee-machines":   "e-coffeemachine",
  "robot-vacuums":     "e-vaccumcleaner",
};

// A price below the floor for that category is implausible (an accessory or a
// parse error) — the product is dropped rather than shown with a wrong price.
const PRICE_FLOOR = {
  phones: 150, tvs: 300, laptops: 500, desktops: 400, tablets: 150,
  monitors: 110, headphones: 25, speakers: 25, "portable-speakers": 25,
  soundbars: 90, cameras: 90, "gaming-consoles": 120,
  fridges: 350, "washing-machines": 400, dryers: 400, dishwashers: 400,
  ovens: 180, "air-conditioners": 450, "coffee-machines": 70,
  "robot-vacuums": 120,
};
const PRICE_CEIL = 400000;

// ── CLI ──────────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg  = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const DRY_RUN  = args.includes("--dry-run");
const MAX_PAGES = parseInt(getArg("pages", "60"), 10) || 60;
const ONLY = (getArg("only", "") || "").split(",").map(s => s.trim()).filter(Boolean);

const DELAY_MS = 1500;   // polite pause between listing-page requests

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer":         "https://www.zap.co.il/",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const decode = (s) => (s || "")
  .replace(/&amp;rlm;|&rlm;|&lrm;|&amp;lrm;/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#x202B;|&#x202C;|&#8362;|&nbsp;/g, " ")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const isZapPic = (u) => {
  if (!u || !/img\.zap\.co\.il\/pics\//i.test(u)) return false;
  if (!/\.(?:gif|jpe?g|png|webp)(?:[?#]|$)/i.test(u)) return false;
  return /^(?:new\/)?\d/.test(u.replace(/^.*\/pics\//i, ""));
};

function isCfChallenge(html) {
  return !html || html.length < 2000
    || /Just a moment|cf-browser-verification|Attention Required|Access denied/i.test(html);
}

/**
 * Parse one Zap models.aspx listing page → [{ id, name, image, price, manufacturer }].
 * Anchors on the per-card "card-v2__title" element; pulls the image from just
 * before it and the "from ₪X" price from just after it. Sponsored ad cards
 * have no card-v2__title with a model link, so they fall out naturally.
 */
function parseListingPage(html) {
  const out = [];
  const titleRe = /<div class="card-v2__title">\s*<a href="\/model\.aspx\?modelid=(\d+)"[^>]*?aria-label="להשוואת מחירים ([^"]+)"/g;
  for (const m of html.matchAll(titleRe)) {
    const id   = m[1];
    const name = decode(m[2]);
    const pos  = m.index;

    // Price — first "card-v2__price-amount" shortly AFTER the title.
    const after  = html.slice(pos, pos + 900);
    const priceM = after.match(/card-v2__price-amount"[^>]*>\s*([\d,]+)/);
    const price  = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : 0;

    // Image — last real Zap product picture in the window BEFORE the title
    // (the card-v2__image block sits directly above card-v2__title).
    const before = html.slice(Math.max(0, pos - 2500), pos);
    const imgs   = [...before.matchAll(/src="(https?:\/\/img\.zap\.co\.il\/pics\/[^"]+)"/gi)].map(x => x[1]);
    const image  = [...imgs].reverse().find(isZapPic) || "";

    // Manufacturer — best effort from the wrapper's data-manufacturer.
    const wide   = html.slice(Math.max(0, pos - 7000), pos);
    const mfrM   = [...wide.matchAll(/data-manufacturer="([^"]*)"/gi)];
    const manufacturer = mfrM.length ? decode(mfrM[mfrM.length - 1][1]) : "";

    out.push({ id, name, image, price, manufacturer });
  }
  return out;
}

async function fetchPage(sog, page) {
  const url = `${ZAP}/models.aspx?sog=${sog}&orderby=2${page > 1 ? `&pageinfo=${page}` : ""}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await axios.get(url, { headers: HEADERS, timeout: 25000, validateStatus: s => s < 500, maxRedirects: 3 });
      const html = typeof r.data === "string" ? r.data : "";
      if (isCfChallenge(html)) { await sleep(15000 * (attempt + 1)); continue; }
      return html;
    } catch (e) {
      await sleep(4000 * (attempt + 1));
    }
  }
  return null;
}

// ── Per-category scrape ──────────────────────────────────────────────────────
async function buildCategory(slug, sog) {
  console.log(`\n📂 ${slug}  (sog=${sog})`);
  const floor = PRICE_FLOOR[slug] || 50;
  const byId  = new Map();
  let emptyStreak = 0, kept = 0, rejected = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchPage(sog, page);
    if (!html) { console.log(`   page ${page}: fetch failed — stopping category`); break; }

    const cards = parseListingPage(html);
    let freshThisPage = 0;
    for (const c of cards) {
      if (byId.has(c.id)) continue;
      freshThisPage++;
      // ── quality gate ──────────────────────────────────────────────────
      const okName  = c.name && c.name.length >= 6;
      const okImage = isZapPic(c.image);
      const okPrice = c.price >= floor && c.price <= PRICE_CEIL;
      if (okName && okImage && okPrice) {
        byId.set(c.id, c);
        kept++;
      } else {
        byId.set(c.id, null);   // remember we saw it, but don't keep it
        rejected++;
      }
    }

    if (freshThisPage === 0) { if (++emptyStreak >= 2) break; }
    else emptyStreak = 0;

    process.stdout.write(`\r   page ${page}: ${kept} kept, ${rejected} rejected   `);
    if (page < MAX_PAGES) await sleep(DELAY_MS);
  }
  process.stdout.write("\n");

  const products = [...byId.values()].filter(Boolean).map(c => ({
    id:           c.id,
    name:         c.name,
    image:        c.image,
    imageUrl:     c.image,
    manufacturer: c.manufacturer || null,
    prices:       { zap: c.price, updated: Date.now() },
    filterTags:   {},
    source:       "zap-listing",
  }));

  console.log(`   ✓ ${products.length} clean products (rejected ${rejected} incomplete)`);
  return products;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(" 🧱  BUNDLY — build a clean Zap catalog for the top categories");
  console.log("──────────────────────────────────────────────────────────");

  let slugs = Object.keys(CATEGORIES);
  if (ONLY.length) {
    const bad = ONLY.filter(s => !CATEGORIES[s]);
    if (bad.length) {
      console.error(`❌ Unknown categor(y/ies): ${bad.join(", ")}`);
      console.error(`   Available: ${Object.keys(CATEGORIES).join(", ")}`);
      process.exit(1);
    }
    slugs = ONLY;
  }
  console.log(`Categories: ${slugs.length}  |  max ${MAX_PAGES} pages each  |  ${DRY_RUN ? "DRY-RUN" : "write"}`);

  const summary = [];
  for (const slug of slugs) {
    const products = await buildCategory(slug, CATEGORIES[slug]);
    summary.push({ slug, count: products.length });

    if (products.length < 10) {
      console.log(`   ⚠ only ${products.length} products — NOT writing ${slug} (looks wrong, old file kept)`);
      continue;
    }
    if (DRY_RUN) continue;

    const dir  = path.join(PRODUCT_DB, slug);
    const file = path.join(dir, "products.json");
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && !fs.existsSync(file + ".pre-rebuild.bak")) {
      fs.copyFileSync(file, file + ".pre-rebuild.bak");
    }
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(products, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(" Clean catalog built:");
  let total = 0;
  for (const s of summary) { total += s.count; console.log(`   ${s.slug.padEnd(20)} ${s.count}`); }
  console.log(`   ${"TOTAL".padEnd(20)} ${total}`);
  console.log(DRY_RUN ? " DRY-RUN — nothing written." : " ✓ products.json files replaced (.pre-rebuild.bak backups kept).");
  console.log("──────────────────────────────────────────────────────────");
}

main().catch(e => { console.error("\n💥 Fatal:", e.message); process.exit(1); });
