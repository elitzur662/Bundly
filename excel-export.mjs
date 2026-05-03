/**
 * excel-export.mjs — Bundly Product Excel Exporter
 *
 * Multi-agent pipeline:
 *   Image Agent  → loads product images from disk (parallel, configurable concurrency)
 *   Price Agent  → normalises & ranks prices per product
 *   Excel Agent  → builds .xlsx files with embedded images + Hebrew RTL
 *   Orchestrator → runs category groups in parallel, then writes files
 *
 * Usage:
 *   node excel-export.mjs                    — export all 27 categories
 *   node excel-export.mjs --cat phones       — single category
 *   node excel-export.mjs --no-images        — skip image embedding (much faster)
 *   node excel-export.mjs --master-only      — one file with all sheets
 */

import ExcelJS from "exceljs";
import fs      from "fs";
import path    from "path";
import { fileURLToPath } from "url";
import { CATEGORIES } from "./db-sync.js";

const __dir     = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = path.join(__dir, "product-db");
const OUT_DIR   = path.join(__dir, "excel-export");
const IMG_CONCURRENCY   = 10;   // parallel image reads per category
const CAT_CONCURRENCY   = 3;    // parallel categories processed at once
const IMG_CELL_SIZE     = 80;   // px — image width & height in Excel
const ROW_HEIGHT_PX     = 85;   // px
const ROW_HEIGHT_PT     = Math.round(ROW_HEIGHT_PX * 0.75);  // Excel uses pt (1pt ≈ 1.33px)

// ── CLI flags ─────────────────────────────────────────────────────────────────
const ARGS        = process.argv.slice(2);
const NO_IMAGES   = ARGS.includes("--no-images");
const MASTER_ONLY = ARGS.includes("--master-only");
const SINGLE_CAT  = ARGS.find(a => a.startsWith("--cat="))?.split("=")[1]
                 || (ARGS.includes("--cat") ? ARGS[ARGS.indexOf("--cat") + 1] : null);

// ── Colour palette ────────────────────────────────────────────────────────────
const CLR = {
  headerBg:   "FF1E3A5F",   // dark navy
  headerFg:   "FFFFFFFF",
  rowAlt:     "FFF0F4FA",   // light blue-grey
  bestBg:     "FFE8F5E9",   // pale green
  bestFg:     "FF1B5E20",   // dark green
  zapBg:      "FFFFF8E1",   // pale amber
  borderClr:  "FFD0D7E3",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract manufacturer from product.manufacturer field or fallback from name */
function extractManufacturer(product) {
  if (product.manufacturer) return product.manufacturer;
  const name = product.name || "";
  // Strip common Hebrew category prefixes
  const cleaned = name.replace(/^(?:טלפון סלולרי|מחשב נייד|מחשב שולחני|טאבלט|אוזניות|רמקול ניידי?|סאונד\s*בר|מסך|מקרן|מצלמה דיגיטלית?|מדפסת|שואב אבק|מקרר|מכונת כביסה|מייבש כביסה|תנור|מיקרוגל|מזגן)\s+/i, "");
  // First English/Latin brand word (most brands are Latin)
  const eng = cleaned.match(/^([A-Z][A-Za-z0-9\-\.]+)/);
  if (eng) return eng[1];
  // First Hebrew word (for local brands)
  const heb = cleaned.match(/^([\u05D0-\u05EA]+)/);
  if (heb) return heb[1];
  return "";
}

/** Sort products: manufacturer A→Z, then name A→Z */
function sortProducts(products) {
  return [...products].sort((a, b) => {
    const mA = extractManufacturer(a).toLowerCase();
    const mB = extractManufacturer(b).toLowerCase();
    if (mA < mB) return -1;
    if (mA > mB) return 1;
    return (a.name || "").localeCompare(b.name || "", "he");
  });
}

function log(tag, msg) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`[${time}] [${tag.padEnd(18)}] ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Run async tasks with a max-concurrency pool */
async function pool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function loadProducts(slug) {
  try {
    const f = path.join(DB_DIR, slug, "products.json");
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch { return []; }
}

const EXTS = [".gif", ".jpg", ".jpeg", ".png", ".webp"];

function findImagePath(slug, productId) {
  const dir = path.join(DB_DIR, slug, "images");
  for (const ext of EXTS) {
    const p = path.join(dir, productId + ext);
    if (fs.existsSync(p)) return p;
  }
  // Try without extension prefix — some files stored as "12345" (no ext)
  try {
    const files = fs.readdirSync(dir);
    const match = files.find(f => path.parse(f).name === String(productId));
    if (match) return path.join(dir, match);
  } catch { /* dir may not exist */ }
  return null;
}

function extToExcelType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".png")  return "png";
  if (ext === ".gif")  return "gif";
  return "jpeg"; // fallback
}

// ── Image Agent ───────────────────────────────────────────────────────────────
// Loads image buffers in parallel for a category's products.
// Returns Map<productId, { buffer, type }>

async function imageAgent(slug, products) {
  if (NO_IMAGES) return new Map();
  log("ImageAgent", `${slug}: loading ${products.length} images (concurrency=${IMG_CONCURRENCY})`);

  const map = new Map();
  await pool(products, IMG_CONCURRENCY, async (product) => {
    const imgPath = findImagePath(slug, product.id);
    if (!imgPath) return;
    try {
      const buffer = fs.readFileSync(imgPath);
      if (buffer.length < 100) return; // corrupt/empty
      map.set(product.id, { buffer, type: extToExcelType(imgPath) });
    } catch { /* skip */ }
  });

  log("ImageAgent", `${slug}: loaded ${map.size}/${products.length} images`);
  return map;
}

// ── Price Agent ───────────────────────────────────────────────────────────────
// Normalises prices and computes best price for each product.

function priceAgent(product) {
  const p = product.prices || {};

  const zap   = p.zap   > 0 ? p.zap   : null;
  const ksp   = p.ksp   > 0 ? p.ksp   : null;
  const ivory = p.ivory > 0 ? p.ivory : null;
  const bug   = p.bug   > 0 ? p.bug   : null;

  const all   = [zap, ksp, ivory, bug].filter(Boolean);
  const best  = all.length ? Math.min(...all) : null;
  const bestSource = best === zap   ? "זאפ"
                   : best === ksp   ? "KSP"
                   : best === ivory ? "Ivory"
                   : best === bug   ? "Bug"
                   : null;

  return { zap, ksp, ivory, bug, best, bestSource };
}

// ── Excel Agent ───────────────────────────────────────────────────────────────
// Builds one worksheet in the given workbook for a category.

async function excelAgent(workbook, slug, catLabel, products, images) {
  // Sort: manufacturer A→Z, then product name A→Z
  const sorted = sortProducts(products);
  log("ExcelAgent", `${slug}: building sheet "${catLabel}" (${sorted.length} products)`);

  const ws = workbook.addWorksheet(catLabel, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: ROW_HEIGHT_PT },
  });

  // ── Columns ──────────────────────────────────────────────────────────────
  ws.columns = [
    { key: "num",    header: "#",                width: 5  },
    { key: "img",    header: "תמונה",            width: NO_IMAGES ? 0 : 13 },
    { key: "brand",  header: "יצרן",             width: 14 },
    { key: "name",   header: "שם המוצר",         width: 46 },
    { key: "zap",    header: "זאפ ₪",            width: 13 },
    { key: "ksp",    header: "KSP ₪",            width: 13 },
    { key: "ivory",  header: "Ivory ₪",          width: 13 },
    { key: "bug",    header: "Bug ₪",            width: 13 },
    { key: "best",   header: "מחיר הטוב ביותר",  width: 18 },
    { key: "src",    header: "מקור",             width: 10 },
    { key: "id",     header: "מזהה זאפ",         width: 12 },
  ];

  // ── Header row ────────────────────────────────────────────────────────────
  const hRow = ws.getRow(1);
  hRow.height = 22;
  ws.columns.forEach((col, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value      = col.header;
    cell.font       = { bold: true, size: 11, color: { argb: CLR.headerFg } };
    cell.fill       = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.headerBg } };
    cell.alignment  = { vertical: "middle", horizontal: "center" };
    cell.border     = { bottom: { style: "medium", color: { argb: CLR.borderClr } } };
  });

  // Auto-filter on all columns (A–K)
  ws.autoFilter = { from: "A1", to: "K1" };

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (let idx = 0; idx < sorted.length; idx++) {
    const product  = sorted[idx];
    const prices   = priceAgent(product);
    const rowNum   = idx + 2;  // 1=header, data starts at 2
    const isAlt    = idx % 2 === 1;
    const brand    = extractManufacturer(product);

    const row = ws.getRow(rowNum);
    row.height = NO_IMAGES ? 18 : ROW_HEIGHT_PT;

    const baseFill = isAlt
      ? { type: "pattern", pattern: "solid", fgColor: { argb: CLR.rowAlt } }
      : undefined;

    // A=# B=img C=יצרן D=שם E=זאפ F=KSP G=Ivory H=Bug I=מחיר הטוב J=מקור K=מזהה
    const cells = {
      A: idx + 1,
      B: "",            // image placeholder
      C: brand,
      D: product.name,
      E: prices.zap,
      F: prices.ksp,
      G: prices.ivory,
      H: prices.bug,
      I: prices.best,
      J: prices.bestSource || "",
      K: product.id,
    };

    Object.entries(cells).forEach(([col, val]) => {
      const cell = row.getCell(col);
      cell.value = val;
      if (baseFill) cell.fill = baseFill;
    });

    // Number formatting for price columns E–I
    for (const col of ["E", "F", "G", "H", "I"]) {
      const cell = row.getCell(col);
      if (typeof cell.value === "number") {
        cell.numFmt    = '#,##0 "₪"';
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else {
        cell.value     = "";
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
    }

    // Best price highlight (col I)
    if (typeof prices.best === "number") {
      const bestCell = row.getCell("I");
      bestCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.bestBg } };
      bestCell.font  = { bold: true, color: { argb: CLR.bestFg } };
    }

    // Zap price highlight (col E, amber)
    if (typeof prices.zap === "number") {
      row.getCell("E").fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.zapBg } };
    }

    // Alignment
    row.getCell("D").alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    row.getCell("A").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("C").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("J").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("K").alignment = { vertical: "middle", horizontal: "center" };

    // ── Embed image ──────────────────────────────────────────────────────
    if (!NO_IMAGES) {
      const img = images.get(product.id);
      if (img) {
        try {
          const imageId = workbook.addImage({ buffer: img.buffer, extension: img.type });
          ws.addImage(imageId, {
            tl:     { col: 1, row: rowNum - 1 },   // col B (0-indexed=1), row 0-indexed
            ext:    { width: IMG_CELL_SIZE, height: IMG_CELL_SIZE },
            editAs: "oneCell",
          });
        } catch { /* skip broken image */ }
      }
    }
  }

  log("ExcelAgent", `${slug}: sheet complete — ${sorted.length} rows`);
  return sorted.length;
}

// ── Category pipeline (Scraper + Image + Excel agents chained) ────────────────

async function processCategory(workbook, slug, catInfo) {
  const products = loadProducts(slug);
  if (!products.length) {
    log("Orchestrator", `${slug}: no products in product-db — run db-sync.js first`);
    return { slug, count: 0 };
  }

  // Run image agent & excel agent (image loading is the slow part)
  const images = await imageAgent(slug, products);
  const count  = await excelAgent(workbook, slug, catInfo.label, products, images);
  return { slug, count };
}

// ── Per-category file writer ──────────────────────────────────────────────────

async function exportSingleCategory(slug, catInfo) {
  log("Orchestrator", `Exporting category: ${slug} (${catInfo.label})`);
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Bundly";
  wb.created  = new Date();
  wb.modified = new Date();

  const { count } = await processCategory(wb, slug, catInfo);
  if (!count) return;

  const fname = `${slug}_${catInfo.label}_bundly.xlsx`;
  const fpath = path.join(OUT_DIR, fname);
  await wb.xlsx.writeFile(fpath);
  log("Orchestrator", `✓ Saved: ${fname}  (${count} products)`);
}

// ── Master file (all categories as sheets) ────────────────────────────────────

async function exportMaster(categories) {
  log("Orchestrator", "Building master workbook (all categories)…");
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Bundly";
  wb.created  = new Date();
  wb.modified = new Date();

  const slugs  = Object.keys(categories);
  let total    = 0;

  // Process CAT_CONCURRENCY categories in parallel (image loading is I/O bound)
  await pool(slugs, CAT_CONCURRENCY, async (slug) => {
    const catInfo = categories[slug];
    const { count } = await processCategory(wb, slug, catInfo);
    total += count;
  });

  const date  = new Date().toISOString().slice(0, 10);
  const fname = `bundly_all_products_${date}.xlsx`;
  const fpath = path.join(OUT_DIR, fname);

  log("Orchestrator", `Writing master file… (${total} total products, this may take a moment)`);
  await wb.xlsx.writeFile(fpath);
  log("Orchestrator", `✅ Master saved: ${fname}`);
  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   Bundly Excel Export — Multi-Agent  ║");
  console.log("╚══════════════════════════════════════╝\n");

  if (!fs.existsSync(DB_DIR)) {
    console.error(`✗ product-db/ not found at ${DB_DIR}`);
    console.error("  Run: node db-sync.js --force   to build the database first");
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`  Source : ${DB_DIR}`);
  console.log(`  Output : ${OUT_DIR}`);
  console.log(`  Images : ${NO_IMAGES ? "disabled (--no-images)" : "enabled"}`);
  console.log(`  Mode   : ${SINGLE_CAT ? `single category (${SINGLE_CAT})` : MASTER_ONLY ? "master only" : "all categories + master"}`);
  console.log();

  // ── Single category mode ──────────────────────────────────────────────────
  if (SINGLE_CAT) {
    const catInfo = CATEGORIES[SINGLE_CAT];
    if (!catInfo) {
      console.error(`✗ Unknown category: "${SINGLE_CAT}"`);
      console.error("  Available: " + Object.keys(CATEGORIES).join(", "));
      process.exit(1);
    }
    await exportSingleCategory(SINGLE_CAT, catInfo);
    return;
  }

  // ── All categories mode ───────────────────────────────────────────────────
  const t0 = Date.now();

  if (!MASTER_ONLY) {
    // Export individual per-category files in parallel groups
    log("Orchestrator", `Exporting ${Object.keys(CATEGORIES).length} category files (concurrency=${CAT_CONCURRENCY})…`);
    await pool(Object.entries(CATEGORIES), CAT_CONCURRENCY, async ([slug, catInfo]) => {
      await exportSingleCategory(slug, catInfo);
    });
    console.log();
  }

  // Build master file
  const total = await exportMaster(CATEGORIES);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s — ${total} products exported to ${OUT_DIR}\n`);
}

main().catch(err => {
  console.error("\n✗ Export failed:", err.message);
  process.exit(1);
});
