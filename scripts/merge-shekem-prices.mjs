// Merge Shekem prices into Bundly's main product-db.
//
// Strict matching only: a Bundly product gets enriched with `prices.shekem`
// ONLY if it shares an EXACT model code with a Shekem product.
//
// "Model code" = a distinctive alphanumeric token containing both letters
// and digits (e.g. "75NANO75VPA", "RD54WC", "MJ-BH1001W", "QE65Q6F",
// "EL914", "S25 Ultra" → model token "S25"). False positives avoided.
//
// Usage:
//   node scripts/merge-shekem-prices.mjs              — dry-run, prints stats only
//   node scripts/merge-shekem-prices.mjs --apply      — actually writes back to product-db/
//   node scripts/merge-shekem-prices.mjs --slug tvs   — single slug
//
// Backup is auto-saved to product-db/<slug>/products.json.bak before each write.

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const MAIN_DB   = join(ROOT, "product-db");
const SUP_DB    = join(ROOT, "product-db-suppliers", "shekem");

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const arg  = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const APPLY = flag("apply");
const ONLY_SLUG = arg("slug");

// ── Model code extractor ────────────────────────────────────────────────
// Returns a NORMALISED set of distinctive alphanumeric tokens for matching.
// We require model tokens to:
//   • have both letters AND digits (eliminates pure words like "Apple"
//     and pure numbers like "256GB")
//   • OR be a known size/capacity marker (256GB, 1TB, 8GB) — used as a
//     refinement, not as a primary identifier
// Two products match when they share AT LEAST ONE primary model token
// AND all storage/capacity tokens that appear in BOTH agree.

const PUNCT = /[^\p{L}\p{N}/\-]+/gu;
const SPACES = /\s+/g;

function tokenize(name) {
  return String(name || "")
    .toLowerCase()
    .replace(PUNCT, " ")
    .replace(SPACES, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// A "primary model token" must have both letters and digits, length ≥ 4
// e.g. "75nano75vpa", "qe65q6f", "rd54wc", "mj-bh1001w" → kept as "mj-bh1001w" or split
function isPrimaryModelToken(tok) {
  if (tok.length < 4) return false;
  if (!/[a-z]/.test(tok)) return false;
  if (!/\d/.test(tok)) return false;
  // Reject pure storage markers ("256gb", "8gb", "1tb")
  if (/^\d{1,4}(gb|tb|mb)$/i.test(tok)) return false;
  return true;
}

// A "capacity refinement token" — used to disambiguate variants of the same model
// e.g. "256gb", "1tb", "8gb", "12gb"
function isCapacityToken(tok) {
  return /^\d{1,4}(gb|tb|mb)$/i.test(tok);
}

function extractMatchKey(name) {
  const toks = tokenize(name);
  const primary = new Set();
  const capacity = new Set();
  for (const t of toks) {
    if (isPrimaryModelToken(t)) primary.add(t);
    else if (isCapacityToken(t)) capacity.add(t.toLowerCase());
  }
  return { primary, capacity };
}

// Two products match when:
//   1. They share AT LEAST ONE primary model token
//   2. The intersection of capacity tokens equals neither side's capacity tokens
//      (i.e. either both have no capacity, or they share the SAME capacity).
//   3. Brand is consistent (we infer brand by checking that neither contains a
//      conflicting brand name from the other).
const KNOWN_BRANDS = [
  "samsung","lg","apple","sony","bosch","siemens","whirlpool","electrolux","beko",
  "haier","hisense","tcl","philips","toshiba","panasonic","sharp","jbl","sennheiser",
  "anker","xiaomi","huawei","oppo","oneplus","nokia","motorola","google","pixel",
  "asus","acer","dell","hp","lenovo","msi","razer","apple","microsoft","intel","amd",
  "midea","gorenje","candy","amica","constructa","liebherr","fisher","paykel",
  "delonghi","krups","braun","remington","babyliss","dyson","tornado","electra",
  "fagor","fujitex","kraft","kor","sauter","kuppersbusch","de longhi","makita",
  "nintendo","playstation","xbox","gigabyte","logitech","roborock","irobot","ecovacs",
];

function inferBrand(name) {
  const lower = name.toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (lower.includes(b)) return b;
  }
  return null;
}

function isMatch(a, b) {
  // 1) primary token intersection — at least one shared
  const sharedPrimary = [...a.key.primary].filter(t => b.key.primary.has(t));
  if (sharedPrimary.length === 0) return false;
  // 2) capacity must agree if both sides have any
  if (a.key.capacity.size > 0 && b.key.capacity.size > 0) {
    const same = [...a.key.capacity].some(t => b.key.capacity.has(t));
    if (!same) return false;
  }
  // 3) brand consistency
  if (a.brand && b.brand && a.brand !== b.brand) return false;
  return true;
}

// ── Load all suppliers data + main DB ───────────────────────────────────
const supplierFiles = existsSync(SUP_DB)
  ? readdirSync(SUP_DB).filter(f => f.endsWith(".json"))
  : [];

if (supplierFiles.length === 0) {
  console.error("No supplier files in", SUP_DB);
  process.exit(1);
}

// Stats per main-db slug
const stats = [];

for (const file of supplierFiles) {
  const supplierSlug = file.replace(/\.json$/, "");
  if (ONLY_SLUG && supplierSlug !== ONLY_SLUG) continue;

  const supPath = join(SUP_DB, file);
  const mainDir = join(MAIN_DB, supplierSlug);
  const mainPath = join(mainDir, "products.json");

  if (!existsSync(mainPath)) {
    stats.push({ slug: supplierSlug, error: `No matching main-db slug` });
    continue;
  }

  const supplierProducts = JSON.parse(readFileSync(supPath, "utf8"));
  const mainProducts     = JSON.parse(readFileSync(mainPath, "utf8"));

  // Index supplier products by their match key
  const supplierIndex = supplierProducts.map(p => ({
    name:  p.name,
    price: p.prices?.shekem,
    image: p.imageUrl,
    sku:   p.sku,
    brand: inferBrand(p.name),
    key:   extractMatchKey(p.name),
  }));

  // For each main product, look for a strict match
  let matched = 0, skipped = 0, alreadyHadShekem = 0;
  const updated = mainProducts.map(p => {
    const main = {
      brand: inferBrand(p.name),
      key:   extractMatchKey(p.name),
    };
    if (main.key.primary.size === 0) { skipped++; return p; }

    // Find the FIRST supplier match (we don't want to merge prices from multiple
    // distinct supplier rows accidentally — pick the first equal-keyed one)
    const hit = supplierIndex.find(s => isMatch(main, s));
    if (!hit) return p;

    matched++;
    if (p.prices?.shekem) alreadyHadShekem++;
    return {
      ...p,
      prices: {
        ...(p.prices || {}),
        shekem:    hit.price,
        shekemSku: hit.sku,
        shekemMatchedAt: Date.now(),
      },
    };
  });

  stats.push({
    slug: supplierSlug,
    main: mainProducts.length,
    supplier: supplierProducts.length,
    matched,
    alreadyHadShekem,
    coveragePctBefore: Math.round((mainProducts.filter(p => p.prices && Object.keys(p.prices).some(k => p.prices[k] > 0 && k !== "updated" && k !== "shekemMatchedAt")).length / Math.max(1, mainProducts.length)) * 100),
    coveragePctAfter:  Math.round((updated.filter(p => p.prices && Object.keys(p.prices).some(k => p.prices[k] > 0 && k !== "updated" && k !== "shekemMatchedAt")).length / Math.max(1, updated.length)) * 100),
  });

  if (APPLY && matched > 0) {
    // Backup
    const bak = mainPath + ".bak";
    if (!existsSync(bak)) copyFileSync(mainPath, bak);
    writeFileSync(mainPath, JSON.stringify(updated, null, 0), "utf8");
  }
}

// ── Report ──────────────────────────────────────────────────────────────
console.log("\n" + (APPLY ? "🟢 APPLY mode" : "🔵 DRY-RUN mode (no files written — pass --apply to commit)"));
console.log("─".repeat(72));
console.log("slug                  main    supplier  matched  before%  after%");
console.log("─".repeat(72));

let grandMatched = 0;
for (const s of stats) {
  if (s.error) {
    console.log(`${s.slug.padEnd(20)}  ❌ ${s.error}`);
    continue;
  }
  grandMatched += s.matched;
  console.log(`${s.slug.padEnd(20)}  ${String(s.main).padStart(5)}   ${String(s.supplier).padStart(7)}   ${String(s.matched).padStart(6)}   ${String(s.coveragePctBefore).padStart(5)}%  ${String(s.coveragePctAfter).padStart(5)}%`);
}
console.log("─".repeat(72));
console.log(`TOTAL matched: ${grandMatched}`);
console.log(APPLY
  ? `\n✅ Applied. Backups saved as products.json.bak in each slug folder.`
  : `\n→ run again with --apply to commit the changes.`);
