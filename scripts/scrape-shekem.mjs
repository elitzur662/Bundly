// Shekem Electric scraper — pulls products from Shekem's public Magento 2 REST
// API and saves them as Bundly-compatible product-db files.
//
// Each product is filtered to require name + price > 0 + image URL.
// Output: product-db-suppliers/shekem/<bundly-slug>.json
//
// Usage:
//   node scripts/scrape-shekem.mjs                 — all known categories
//   node scripts/scrape-shekem.mjs --cat tvs       — single Bundly slug
//   node scripts/scrape-shekem.mjs --list          — print Shekem category tree
//   node scripts/scrape-shekem.mjs --max 50        — cap per category
//
// After running:  node scripts/verify-products.mjs  to confirm coverage.

import axios from "axios";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const OUT_DIR   = join(ROOT, "product-db-suppliers", "shekem");

const BASE = "https://www.shekem-electric.co.il";
const REST = `${BASE}/rest/V1`;
const MEDIA_BASE = `${BASE}/media/catalog/product`;

const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
};

// ── Bundly slug → Shekem category ID(s) ──────────────────────────────────
// Discovered via /rest/V1/categories (run with --list to refresh tree).
// Each entry's `cat_ids` aggregates products across one or more LEAF categories;
// the parent IDs (290, 299, 300, 315, 344, etc.) are intentionally avoided
// because Magento's category_id filter only matches direct membership.
const CATEGORY_MAP = {
  // Major kitchen appliances
  fridges:           { cat_ids: [291, 292, 293, 294, 457, 295, 1438, 5294], label: "מקררים" },
  freezers:          { cat_ids: [297],                                        label: "מקפיאים" },
  dishwashers:       { cat_ids: [281],                                        label: "מדיחי כלים" },
  ovens:             { cat_ids: [239, 240, 5196],                             label: "תנורי אפייה" },
  hobs:              { cat_ids: [238],                                        label: "כיריים" },
  "range-hoods":     { cat_ids: [241],                                        label: "קולטי אדים" },
  microwaves:        { cat_ids: [247],                                        label: "מיקרוגלים" },
  toasters:          { cat_ids: [250, 392, 249],                              label: "טוסטרים" },
  blenders:          { cat_ids: [259],                                        label: "בלנדרים" },
  mixers:            { cat_ids: [258],                                        label: "מיקסרים" },
  // TVs / displays / projectors
  tvs:               { cat_ids: [219],                                        label: "מסכי טלוויזיה" },
  monitors:          { cat_ids: [323],                                        label: "מסכי מחשב" },
  projectors:        { cat_ids: [3145, 509],                                  label: "מקרני וידאו" },
  // Phones / tablets / wearables
  phones:            { cat_ids: [301],                                        label: "סמארטפונים" },
  tablets:           { cat_ids: [304],                                        label: "טאבלטים" },
  smartwatches:      { cat_ids: [303],                                        label: "שעונים חכמים" },
  // Audio
  headphones:        { cat_ids: [225],                                        label: "אוזניות" },
  speakers:          { cat_ids: [223, 329],                                   label: "רמקולים" },
  soundbars:         { cat_ids: [224],                                        label: "מקרני קול / סאונד בר" },
  "home-theater":    { cat_ids: [221, 226],                                   label: "קולנוע ביתי + סטריאו" },
  // Computers
  laptops:           { cat_ids: [317],                                        label: "מחשבים ניידים" },
  desktops:          { cat_ids: [318, 1820],                                  label: "מחשבים נייחים + All-in-One" },
  // Laundry / cleaning
  "washing-machines": { cat_ids: [286, 287],                                  label: "מכונות כביסה" },
  dryers:            { cat_ids: [288],                                        label: "מייבשי כביסה" },
  vacuum:            { cat_ids: [267, 4093, 4094],                            label: "שואבי אבק" },
  "robot-vacuums":   { cat_ids: [268],                                        label: "שואבים רובוטיים" },
  // Climate
  "ac-split":        { cat_ids: [348],                                        label: "מזגן עילי" },
  "ac-mini-central": { cat_ids: [349],                                        label: "מזגן מיני מרכזי" },
  heaters:           { cat_ids: [367, 368],                                   label: "מוצרי חימום" },
  // Beauty / grooming
  shavers:           { cat_ids: [340],                                        label: "מכונות גילוח" },
  "hair-clippers":   { cat_ids: [341],                                        label: "מכונת תספורת" },
  "hair-stylers":    { cat_ids: [342, 447],                                   label: "מחליקי + מעצבי שיער" },
  "hair-dryers":     { cat_ids: [360],                                        label: "מייבשי שיער" },
  "beauty-machines": { cat_ids: [343],                                        label: "מסירי שיער וטיפוח" },
  // Gaming
  "game-consoles":   { cat_ids: [319],                                        label: "קונסולות משחק" },
  "console-games":   { cat_ids: [321],                                        label: "משחקים לקונסולות" },
  // Outdoor cooking
  grills:            { cat_ids: [3350, 3351, 3352, 277],                      label: "גרילים" },
};

// ── HTTP helpers ─────────────────────────────────────────────────────────
async function getJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await axios.get(url, { headers: HEADERS, timeout: 20000, validateStatus: s => s < 500 });
      if (r.status === 200) return r.data;
      if (r.status === 404) return null;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

async function listCategoryTree() {
  const root = await getJson(`${REST}/categories`);
  if (!root) return [];
  const flat = [];
  const walk = (node, level = 0) => {
    flat.push({ id: node.id, name: node.name, level, count: node.product_count });
    for (const c of (node.children_data || [])) walk(c, level + 1);
  };
  walk(root);
  return flat;
}

// Fetch all products in a Magento category — paginated.
async function fetchCategoryProducts(catId, { maxItems = 2000, pageSize = 100 } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const url =
      `${REST}/products?` +
      `searchCriteria[filterGroups][0][filters][0][field]=category_id` +
      `&searchCriteria[filterGroups][0][filters][0][value]=${catId}` +
      `&searchCriteria[filterGroups][1][filters][0][field]=status` +
      `&searchCriteria[filterGroups][1][filters][0][value]=1` +
      `&searchCriteria[filterGroups][2][filters][0][field]=visibility` +
      `&searchCriteria[filterGroups][2][filters][0][value]=4` +
      `&searchCriteria[pageSize]=${pageSize}` +
      `&searchCriteria[currentPage]=${page}`;
    const data = await getJson(url);
    const items = data?.items || [];
    if (items.length === 0) break;
    out.push(...items);
    process.stdout.write(`\r    [Shekem] cat=${catId} page=${page} → ${out.length} products`);
    if (items.length < pageSize) break;
    if (out.length >= maxItems) break;
    await new Promise(r => setTimeout(r, 300));
  }
  process.stdout.write("\n");
  return out;
}

// Extract image URL from product's media gallery — prefer the first image-typed entry.
function extractImageUrl(prod) {
  const media = prod.media_gallery_entries || [];
  // Prefer entry whose types include 'image'
  let entry = media.find(m => Array.isArray(m.types) && m.types.includes("image"));
  if (!entry) entry = media.find(m => m.media_type === "image");
  if (!entry) {
    // Fall back to custom_attributes "image"
    const attr = (prod.custom_attributes || []).find(a => a.attribute_code === "image");
    if (attr?.value && attr.value.length > 3) {
      return MEDIA_BASE + (attr.value.startsWith("/") ? "" : "/") + attr.value;
    }
    return null;
  }
  return MEDIA_BASE + entry.file;
}

// Normalize one Magento product → Bundly product-db record.
function normalizeProduct(prod) {
  if (!prod || !prod.name) return null;
  const price = Number(prod.price);
  if (!(price > 0)) return null;
  const image = extractImageUrl(prod);
  if (!image) return null;
  return {
    id: `shekem_${prod.sku || prod.id}`,
    name: prod.name.trim(),
    imageUrl: image,
    prices: { shekem: price, updated: Date.now() },
    url: `${BASE}/catalog/product/view/id/${prod.id}`,
    sku: String(prod.sku || prod.id),
    supplier: "shekem",
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const arg  = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };

if (flag("list")) {
  console.log("Fetching Shekem category tree...");
  const flat = await listCategoryTree();
  console.log(`Total: ${flat.length} categories. Top-3 levels with >50 products:`);
  flat
    .filter(c => c.level <= 3 && c.count > 50)
    .forEach(c => console.log(`  ${"  ".repeat(c.level)}${c.name.padEnd(36)}  id=${c.id}  count=${c.count}`));
  process.exit(0);
}

const onlyCat = arg("cat");
const maxItems = Number(arg("max")) || 2000;

mkdirSync(OUT_DIR, { recursive: true });

const slugs = onlyCat ? [onlyCat] : Object.keys(CATEGORY_MAP);
let totalSaved = 0;

console.log(`📦 Shekem scraper starting — ${slugs.length} category mapping(s), max ${maxItems} per cat`);
console.log("");

for (const slug of slugs) {
  const conf = CATEGORY_MAP[slug];
  if (!conf) { console.warn(`⚠️  Unknown bundly slug "${slug}" — add to CATEGORY_MAP`); continue; }

  console.log(`── ${slug.padEnd(20)} ── (${conf.label}, cat_ids=[${conf.cat_ids.join(",")}])`);

  // Aggregate products from each Shekem cat_id
  const seen = new Set();
  const products = [];
  for (const catId of conf.cat_ids) {
    const items = await fetchCategoryProducts(catId, { maxItems });
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      products.push(it);
    }
  }
  console.log(`    raw products: ${products.length}`);

  // Optional name filter — narrows down to slug-relevant products
  let filtered = products;
  if (conf.filter) {
    filtered = products.filter(p => conf.filter.test(p.name || ""));
    console.log(`    after name-filter: ${filtered.length}`);
  }

  // Normalize + drop bad rows
  const normalized = filtered.map(normalizeProduct).filter(Boolean);
  console.log(`    with name+price+image: ${normalized.length}`);

  if (normalized.length === 0) { console.log("    (skipping — no valid products)\n"); continue; }

  const outPath = join(OUT_DIR, `${slug}.json`);
  writeFileSync(outPath, JSON.stringify(normalized, null, 0), "utf8");

  // Sample
  const sample = normalized[0];
  console.log(`    ✓ saved ${normalized.length} products → ${outPath.replace(ROOT + "\\", "")}`);
  console.log(`      sample: ${sample.name.slice(0, 60)} | ₪${sample.prices.shekem}`);
  console.log("");

  totalSaved += normalized.length;
}

console.log("─".repeat(60));
console.log(`✅ Done. Saved ${totalSaved} products across ${slugs.length} category mapping(s).`);
console.log(`   Output dir: ${OUT_DIR}`);
console.log(`\nNext: integrate by running merge into product-db (separate step) or read suppliers/ directly from server.`);
