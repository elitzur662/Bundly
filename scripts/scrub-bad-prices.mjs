/**
 * Bundly — scrub contaminated store prices from the catalog.
 *
 *     node scripts/scrub-bad-prices.mjs            # fix the files
 *     node scripts/scrub-bad-prices.mjs --dry-run  # just report
 *
 * WHY THIS EXISTS
 * The price sync (db-sync.js) matched catalog products to KSP/Ivory/Bug store
 * listings by name overlap. A *case* or *screen-protector* "כיסוי ל-iPhone 14
 * Pro Max" contains every word of the real product name, so a real iPhone got
 * matched to a ₪30 accessory — and ₪30 became the phone's displayed price.
 *
 * db-sync.js is now fixed (it rejects accessory listings), but the bad prices
 * are already baked into product-db/<cat>/products.json. This script removes
 * them: a store price (ksp / ivory / bug / zap) is dropped when it is
 *   • below a sane floor for a big-ticket category, OR
 *   • less than 35% of the highest price known for the same product.
 * A dropped price becomes 0 (the product simply shows no price) — far better
 * than showing an obviously-wrong ₪30 for an iPhone.
 *
 * Each products.json is backed up once to .pre-scrub.bak before editing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DB = path.join(__dirname, "..", "product-db");
const DRY_RUN    = process.argv.includes("--dry-run");

// Big-ticket categories: any price below the floor is impossible for a real
// product in that category, so it must be an accessory mis-match.
const FLOORS = {
  phones: 200, laptops: 600, tablets: 200, desktops: 500,
  tvs: 350, monitors: 130,
  fridges: 500, freezers: 450, "washing-machines": 500, dryers: 500,
  dishwashers: 500, ovens: 250, "air-conditioners": 600, "range-hoods": 150,
  microwaves: 130, "coffee-machines": 130, "robot-vacuums": 200,
  "graphics-cards": 200, "gaming-consoles": 250,
  treadmills: 400, "cross-trainers": 350, "exercise-bikes": 300,
  cameras: 250, projectors: 250, "electric-scooters": 300, bicycles: 350,
  "water-dispensers": 150, "lawn-mowers": 130, "power-tools": 60,
};

const STORE_KEYS = ["zap", "ksp", "ivory", "bug"];
const URL_OF = { zap: "zapUrl", ksp: "kspUrl", ivory: "ivoryUrl", bug: "bugUrl" };

function scrubProduct(p, floor) {
  const pr = p.prices;
  if (!pr || typeof pr !== "object") return [];
  const dropped = [];
  const vals = STORE_KEYS.map(k => Number(pr[k]) || 0);
  const max  = Math.max(...vals);

  for (const k of STORE_KEYS) {
    const v = Number(pr[k]) || 0;
    if (v <= 0) continue;
    // (a) below the category floor  → impossible price
    const belowFloor = floor > 0 && v < floor;
    // (b) a tiny fraction of the product's highest known price → mis-match
    //     (zap is the master reference; we don't drop zap by the ratio rule)
    const tinyVsMax  = k !== "zap" && max > 0 && v < max * 0.35;
    if (belowFloor || tinyVsMax) {
      dropped.push({ store: k, was: v, reason: belowFloor ? "below-floor" : "tiny-vs-max" });
      pr[k] = 0;
      if (URL_OF[k] && pr[URL_OF[k]] !== undefined) delete pr[URL_OF[k]];
    }
  }
  return dropped;
}

function main() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(` 🧹 Bundly — scrub bad store prices${DRY_RUN ? "  (DRY-RUN)" : ""}`);
  console.log("──────────────────────────────────────────────────────────");

  const cats = fs.readdirSync(PRODUCT_DB)
    .filter(d => fs.statSync(path.join(PRODUCT_DB, d)).isDirectory());

  let totalDropped = 0, totalProducts = 0, nowPriceless = 0;
  const perCat = [];

  for (const cat of cats) {
    const file = path.join(PRODUCT_DB, cat, "products.json");
    if (!fs.existsSync(file)) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const list = Array.isArray(arr) ? arr : (Array.isArray(arr.products) ? arr.products : null);
    if (!list) continue;

    const floor = FLOORS[cat] || 0;
    let catDropped = 0, catPriceless = 0;
    const samples = [];

    for (const p of list) {
      totalProducts++;
      const dropped = scrubProduct(p, floor);
      if (dropped.length) {
        catDropped += dropped.length;
        if (samples.length < 3) {
          samples.push(`${p.name?.slice(0, 42)} — dropped ${dropped.map(d => `${d.store}=${d.was}`).join(", ")}`);
        }
        const pr = p.prices || {};
        if (!STORE_KEYS.some(k => (Number(pr[k]) || 0) > 0)) catPriceless++;
      }
    }

    if (catDropped > 0) {
      if (!DRY_RUN) {
        const bak = file + ".pre-scrub.bak";
        if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf8");
        fs.renameSync(tmp, file);
      }
      totalDropped += catDropped;
      nowPriceless += catPriceless;
      perCat.push({ cat, catDropped, catPriceless, samples });
    }
  }

  perCat.sort((a, b) => b.catDropped - a.catDropped);
  for (const r of perCat) {
    console.log(`\n📂 ${r.cat} — dropped ${r.catDropped} bad price(s)${r.catPriceless ? `, ${r.catPriceless} product(s) now show no price` : ""}`);
    r.samples.forEach(s => console.log(`   · ${s}`));
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(` Scanned ${totalProducts} products across ${cats.length} categories`);
  console.log(` Dropped ${totalDropped} contaminated price(s)`);
  console.log(` ${nowPriceless} product(s) now have no price (was a wrong price)`);
  console.log(DRY_RUN ? " DRY-RUN — nothing was written." : " ✓ Catalog files updated (.pre-scrub.bak backups kept).");
  console.log("──────────────────────────────────────────────────────────");
}

main();
