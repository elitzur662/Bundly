#!/usr/bin/env node
/**
 * scrape-empty-categories.mjs — populate product-db/ for empty ZAP categories.
 *
 * Some ZAP sogs are either:
 *   • Structurally empty (game titles aren't categorised on ZAP at all)
 *   • Brand-only stubs that fail the Quality Gate (bikes — out of scope)
 *   • Hit by CF blocks during pre-warm and never recovered
 *
 * For categories the audit flagged "no cache" or "zero usable", we scrape
 * KSP (which has a more reliable price+image feed for consumer electronics)
 * and write product-db/<slug>/products.json + meta.json. The server's
 * loadProductDbIntoCache() then folds these into ZAP_CAT_CACHE on startup
 * (or after a manual reload) so the matching sog renders real products.
 *
 * Usage:
 *   node scripts/scrape-empty-categories.mjs                # all targets
 *   node scripts/scrape-empty-categories.mjs --only=ps5-games,smartwatches
 *   node scripts/scrape-empty-categories.mjs --max-per=80   # default
 *   node scripts/scrape-empty-categories.mjs --refresh-existing  # overwrite
 *
 * After running, restart the server (or POST /api/admin/reload-product-db
 * if you've wired that up) to see the new categories live.
 */

import fs   from "node:fs";
import path from "node:path";
import url  from "node:url";
import { searchKsp } from "../ksp-scraper.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const DB_DIR    = path.join(process.env.DATA_DIR || ROOT, "product-db");

// CLI args
const argv = process.argv.slice(2);
const ONLY = (argv.find(a => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const MAX_PER = parseInt((argv.find(a => a.startsWith("--max-per=")) || "").replace("--max-per=", ""), 10) || 80;
const REFRESH = argv.includes("--refresh-existing");
const DRY     = argv.includes("--dry-run");

// ── Target list ─────────────────────────────────────────────────────────────
// Each entry maps a product-db slug (used by _PRODUCT_DB_SOG_MAP in server.js)
// to one or more KSP search queries. The first 2-3 queries that return hits
// are merged; duplicates by uin are dropped.
const TARGETS = [
  // ── Gaming (game titles — ZAP doesn't catalogue these) ────────────────────
  { slug: "ps5-games",        queries: ["משחקי PS5", "PlayStation 5 game", "FIFA PS5", "PS5 game"] },
  { slug: "nintendo-games",   queries: ["משחקי Nintendo Switch", "Nintendo Switch game", "Mario", "Zelda"] },

  // ── Smart home / security ─────────────────────────────────────────────────
  { slug: "smart-home",       queries: ["נורה חכמה", "שקע חכם", "Philips Hue", "פעמון דלת חכם"] },
  { slug: "security-cameras", queries: ["מצלמת אבטחה", "מצלמת רחוב", "Ring camera", "Eufy camera"] },

  // ── Kitchen extras ────────────────────────────────────────────────────────
  { slug: "toasters",         queries: ["טוסטר", "טוסטר אובן", "מכונת כריכים"] },
  { slug: "mixers",           queries: ["מיקסר", "מיקסר עומד", "KitchenAid"] },
  { slug: "food-processors",  queries: ["מעבד מזון", "Magimix"] },
  { slug: "juicers",          queries: ["מסחטת פירות", "מסחטה חשמלית"] },
  { slug: "kitchen-pots",     queries: ["סיר חשמלי", "מחבת חשמלית", "אינסטנט פוט", "Air Fryer"] },
  { slug: "hot-plates",       queries: ["פלטה חשמלית", "פלטת שבת"] },

  // ── Beauty ────────────────────────────────────────────────────────────────
  { slug: "hair-removers",    queries: ["IPL", "Philips Lumea", "אפילטור", "מסיר שיער"] },
  { slug: "shavers",          queries: ["מכונת גילוח", "Braun shaver", "Philips OneBlade"] },
  { slug: "lady-shavers",     queries: ["מכונת גילוח לנשים", "lady shaver"] },
  { slug: "beauty-machines",  queries: ["מסכת LED לפנים", "Foreo", "מכשיר ניקוי פנים", "RF face"] },
  { slug: "massagers",        queries: ["מכשיר עיסוי", "אקדח עיסוי", "Theragun", "massage gun"] },

  // ── Phones / wearables ───────────────────────────────────────────────────
  { slug: "smartwatches",     queries: ["שעון חכם", "Apple Watch", "Galaxy Watch", "Garmin"] },
  { slug: "phone-cases",      queries: ["כיסוי לאייפון", "מגן מסך", "כיסוי לסמסונג"] },
  { slug: "chargers",         queries: ["מטען לסלולר", "פאוורבנק", "מטען אלחוטי"] },

  // ── PC hardware ──────────────────────────────────────────────────────────
  { slug: "cpus",             queries: ["AMD Ryzen", "Intel Core i7", "Intel Core i9"] },
  { slug: "motherboards",     queries: ["לוח אם", "motherboard", "ASUS motherboard"] },
  { slug: "ram",              queries: ["DDR5 RAM", "DDR4 RAM", "Kingston RAM", "Corsair Vengeance"] },
  { slug: "ssds",             queries: ["SSD NVMe", "Samsung 990", "WD Black SSD"] },
  { slug: "pc-cases",         queries: ["מארז מחשב", "PC case", "Corsair case"] },
  { slug: "pc-cooling",       queries: ["מאוורר למחשב", "CPU cooler", "AIO water cooling"] },

  // ── Network / storage ────────────────────────────────────────────────────
  { slug: "routers",          queries: ["ראוטר WiFi 6", "Asus router", "TP-Link"] },
  { slug: "wifi-extenders",   queries: ["מגדיל טווח", "WiFi extender"] },
  { slug: "network-switches", queries: ["מתג רשת", "network switch"] },
  { slug: "flash-drives",     queries: ["דיסק און קי", "SanDisk USB"] },
  { slug: "sd-cards",         queries: ["כרטיס זיכרון", "Micro SD", "SanDisk SD"] },
  { slug: "nas-servers",      queries: ["NAS Synology", "QNAP NAS"] },

  // ── Peripherals ──────────────────────────────────────────────────────────
  { slug: "scanners",         queries: ["סורק מסמכים", "scanner Epson"] },

  // ── Mobility / sport ──────────────────────────────────────────────────────
  { slug: "electric-scooters", queries: ["קורקינט חשמלי", "Xiaomi scooter", "Segway"] },
  { slug: "exercise-bikes",   queries: ["אופניים נייחים", "spin bike"] },
  { slug: "ellipticals",      queries: ["אליפטיקל", "elliptical"] },

  // ── Health ───────────────────────────────────────────────────────────────
  { slug: "bp-monitors",      queries: ["מד לחץ דם", "Omron"] },
  { slug: "nebulizers",       queries: ["נבולייזר", "inhaler"] },
  { slug: "thermometers",     queries: ["מד חום דיגיטלי", "Braun thermometer"] },
  { slug: "tens-devices",     queries: ["TENS", "מכשיר חשמלי לכאב"] },
  { slug: "ems-belts",        queries: ["EMS חגורה", "EMS muscle"] },

  // ── Power tools ──────────────────────────────────────────────────────────
  { slug: "power-tools",      queries: ["מברגה חשמלית", "מקדחה חשמלית", "Makita", "Bosch drill"] },

  // ── AV ───────────────────────────────────────────────────────────────────
  { slug: "microphones",      queries: ["מיקרופון", "USB microphone", "Blue Yeti"] },
  { slug: "vr-headsets",      queries: ["משקפי VR", "Meta Quest", "Quest 3"] },

  // ── Car ──────────────────────────────────────────────────────────────────
  { slug: "dashcams",         queries: ["מצלמת דרך", "dash cam", "Garmin dashcam"] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractUin(link) {
  const m = (link || "").match(/\/web\/item\/(\d+)/);
  return m ? m[1] : "";
}

function toProductDbShape(p, now) {
  const uin = extractUin(p.link);
  if (!uin) return null;
  // Prefix the id with "ksp_" so it cannot collide with ZAP model IDs in
  // the merged ZAP_CAT_CACHE — ZAP IDs are numeric and may overlap with
  // KSP UINs by coincidence.
  return {
    id:           `ksp_${uin}`,
    name:         p.title || "",
    imageUrl:     p.image || "",
    manufacturer: "",
    prices: {
      zap:     0,
      updated: now,
      ksp:     p.price || 0,
      kspUrl:  p.link || "",
    },
    filterTags: null,
  };
}

async function scrapeTarget(target) {
  const all = new Map(); // uin → product
  for (const q of target.queries) {
    if (all.size >= MAX_PER) break;
    try {
      const results = await searchKsp(q, { limit: 30, timeout: 15000 });
      for (const r of results) {
        if (all.size >= MAX_PER) break;
        const uin = extractUin(r.link);
        if (!uin || all.has(uin)) continue;
        all.set(uin, r);
      }
      console.log(`  · "${q}" → ${results.length} (total unique so far: ${all.size})`);
    } catch (e) {
      console.warn(`  ! "${q}" failed: ${e.message}`);
    }
    // Polite gap between queries — KSP API is fine but no need to hammer.
    await new Promise(r => setTimeout(r, 350));
  }
  return [...all.values()];
}

function writeOutputs(slug, products) {
  const dir = path.join(DB_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const productsPath = path.join(dir, "products.json");
  const metaPath     = path.join(dir, "meta.json");
  const now = Date.now();
  const rows = products
    .map(p => toProductDbShape(p, now))
    .filter(Boolean);

  // If the slug already had a populated file, optionally MERGE rather than replace
  // so we don't blow away previously-enriched data from other sources.
  if (!REFRESH && fs.existsSync(productsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(productsPath, "utf8"));
      const byId = new Map(existing.map(r => [r.id, r]));
      for (const r of rows) byId.set(r.id, { ...byId.get(r.id), ...r });
      const merged = [...byId.values()];
      fs.writeFileSync(productsPath, JSON.stringify(merged, null, 2));
      fs.writeFileSync(metaPath, JSON.stringify({ pricesTs: now, catalogTs: now }, null, 2));
      return { wrote: merged.length, added: rows.filter(r => !byId.has(r.id)).length };
    } catch (_) { /* fall through to overwrite */ }
  }

  fs.writeFileSync(productsPath, JSON.stringify(rows, null, 2));
  fs.writeFileSync(metaPath, JSON.stringify({ pricesTs: now, catalogTs: now }, null, 2));
  return { wrote: rows.length, added: rows.length };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const selected = ONLY.length > 0
    ? TARGETS.filter(t => ONLY.includes(t.slug))
    : TARGETS;

  if (selected.length === 0) {
    console.error(`No targets matched --only=${ONLY.join(",")}`);
    console.error(`Available slugs: ${TARGETS.map(t => t.slug).join(", ")}`);
    process.exit(1);
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log(` 🛒 Scraping ${selected.length} target slug${selected.length === 1 ? "" : "s"} from KSP`);
  console.log(`    max products per slug: ${MAX_PER}`);
  console.log(`    refresh existing:      ${REFRESH ? "yes" : "no (merge)"}`);
  console.log(`    dry run:               ${DRY ? "yes" : "no"}`);
  console.log(`    output dir:            ${DB_DIR}`);
  console.log("──────────────────────────────────────────────────────────\n");

  const summary = [];
  for (let i = 0; i < selected.length; i++) {
    const t = selected[i];
    console.log(`[${i + 1}/${selected.length}] ${t.slug}`);
    try {
      const products = await scrapeTarget(t);
      if (products.length === 0) {
        console.log(`  ⚠️  no products — skipping write\n`);
        summary.push({ slug: t.slug, products: 0, status: "EMPTY" });
        continue;
      }
      if (DRY) {
        console.log(`  ✓ would write ${products.length} products (dry run)\n`);
        summary.push({ slug: t.slug, products: products.length, status: "DRY" });
        continue;
      }
      const r = writeOutputs(t.slug, products);
      console.log(`  ✓ wrote ${r.wrote} rows (${r.added} new) → product-db/${t.slug}/\n`);
      summary.push({ slug: t.slug, products: r.wrote, status: "OK" });
    } catch (e) {
      console.error(`  ✗ failed: ${e.message}\n`);
      summary.push({ slug: t.slug, products: 0, status: "ERROR: " + e.message.slice(0, 60) });
    }
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log(" SUMMARY");
  console.log("──────────────────────────────────────────────────────────");
  for (const s of summary) {
    const icon = s.status === "OK" ? "✓"
               : s.status === "EMPTY" ? "·"
               : s.status === "DRY" ? "~"
               : "✗";
    console.log(` ${icon} ${s.slug.padEnd(22)} ${String(s.products).padStart(4)}  ${s.status}`);
  }
  const ok = summary.filter(s => s.status === "OK").length;
  const empty = summary.filter(s => s.status === "EMPTY").length;
  const err = summary.filter(s => s.status.startsWith("ERROR")).length;
  console.log("──────────────────────────────────────────────────────────");
  console.log(` Done — ${ok} populated, ${empty} empty, ${err} errored`);
  console.log(" Restart the server to load the new product-db files into RAM.");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
