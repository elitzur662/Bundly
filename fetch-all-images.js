/**
 * Fetch 3-5 product images for ALL products in product-db.
 * Uses DataForSEO Google Images API.
 *
 * Downloads images to product-db/<category>/multi-img/<productId>/
 * and builds product-images-cache.json for the server.
 *
 * Designed to run for hours — saves progress after every product,
 * so you can stop and resume any time (already-fetched products are skipped).
 *
 * Usage:
 *   node fetch-all-images.js                    # all categories
 *   node fetch-all-images.js phones laptops     # specific categories only
 *   node fetch-all-images.js --resume           # resume from where it stopped
 */
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DFS_LOGIN = process.env.DATAFORSEO_LOGIN;
const DFS_PASS  = process.env.DATAFORSEO_PASSWORD;
if (!DFS_LOGIN || !DFS_PASS) {
  console.error("❌ Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env");
  process.exit(1);
}

const PRODUCT_DB = path.join(__dirname, "product-db");
const CACHE_FILE = path.join(__dirname, "product-images-cache.json");

// Load existing cache (progress is saved here — resume-safe)
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}

const JUNK_WORDS = [
  "case","cover","כיסוי","מגן","screen protector","charger","מטען",
  "accessories","אביזר","stand","holder","bag","sleeve","cable","glass",
  "tempered","skin","wrap","bumper","wallet","pouch","strap","band",
  "mount","dock","hub","adapter","replacement","repair","parts","battery",
  "sticker","decal","film","folio","booklet","manual","instruction",
];

function cleanProductName(rawName) {
  // Remove Hebrew prefix like "טלפון סלולרי" / "מחשב נייד" / "שואב אבק רובוטי" etc.
  // Keep the brand + exact model name for precise search
  return rawName
    .replace(/^(טלפון סלולרי|מחשב נייד|מסך מחשב|אוזניות אלחוטיות|אוזניות|שואב אבק רובוטי|שואב אבק|מקרר|מקפיא|מזגן|מדיח כלים|תנור בנוי|תנור אפייה|כיריים|מכונת כביסה|מייבש כביסה|מדפסת|טלוויזיה|מסך|מצלמה|רמקול|מקרן)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchKeywords(name) {
  return name.toLowerCase()
    .split(/[\s\-\/\(\),\.\"\']+/)
    .filter(t => t.length >= 2)
    .filter(t => !["the","and","or","for","with","של","עם","על","את"].includes(t));
}

async function fetchImagesForProduct(productName, category) {
  const cacheKey = productName.trim().toLowerCase();

  // Already fetched — skip
  if (cache[cacheKey]?.length >= 3) return { status: "cached", count: cache[cacheKey].length };

  const cleanName = cleanProductName(productName);
  if (cleanName.length < 5) return { status: "skip", count: 0 };

  const payload = [{
    keyword: `${cleanName} product`,
    location_code: 2840,
    language_code: "en",
    device: "desktop",
    depth: 40,
  }];

  const { data } = await axios.post(
    "https://api.dataforseo.com/v3/serp/google/images/live/advanced",
    payload,
    { auth: { username: DFS_LOGIN, password: DFS_PASS }, timeout: 15000 }
  );

  const items = data?.tasks?.[0]?.result?.[0]?.items || [];
  const keywords = extractSearchKeywords(cleanName);

  // Filter: relevant + non-junk
  const cleaned = items.filter(img => {
    const meta = [img.title || "", img.alt || "", img.source_url || ""].join(" ").toLowerCase();
    if (JUNK_WORDS.some(j => meta.includes(j))) return false;
    const hits = keywords.filter(kw => meta.includes(kw));
    return hits.length >= Math.min(2, Math.ceil(keywords.length * 0.4));
  });

  const extractUrl = (img) => {
    const src = img.source_url || "";
    if (src && /\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(src)) return src;
    return img.image_url || img.thumbnail_url || img.encoded_url || img.url || "";
  };

  const seen = new Set();
  const images = [];
  for (const img of cleaned) {
    const url = extractUrl(img);
    if (!url || url.endsWith("/") || url.includes("?q=tbn")) continue;
    if (url.includes("64x") || url.includes("128x") || url.includes("thumbnail")) continue;
    const base = url.split("?")[0];
    if (seen.has(base)) continue;
    seen.add(base);
    images.push(url);
    if (images.length >= 5) break;
  }

  // Download images to disk
  const slug = cleanName.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase().slice(0, 80);
  const imgDir = path.join(PRODUCT_DB, category, "multi-img", slug);
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const localPaths = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const extMatch = images[i].match(/\.(jpg|jpeg|png|webp|gif)/i);
      const ext = extMatch ? "." + extMatch[1].toLowerCase() : ".jpg";
      const filename = `${i + 1}${ext}`;
      const filepath = path.join(imgDir, filename);

      if (fs.existsSync(filepath)) {
        localPaths.push(`/product-db/${category}/multi-img/${slug}/${filename}`);
        continue;
      }

      const response = await axios.get(images[i], {
        responseType: "arraybuffer",
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        maxContentLength: 10 * 1024 * 1024, // 10MB max
      });

      // Verify it's actually an image (check magic bytes)
      const buf = Buffer.from(response.data);
      const isImage = (
        (buf[0] === 0xFF && buf[1] === 0xD8) || // JPEG
        (buf[0] === 0x89 && buf[1] === 0x50) || // PNG
        (buf[0] === 0x47 && buf[1] === 0x49) || // GIF
        (buf[0] === 0x52 && buf[1] === 0x49)    // WEBP (RIFF)
      );
      if (!isImage || buf.length < 5000) continue; // skip tiny/non-image files

      fs.writeFileSync(filepath, buf);
      localPaths.push(`/product-db/${category}/multi-img/${slug}/${filename}`);
    } catch {
      // Skip failed downloads silently
    }
  }

  if (localPaths.length > 0) {
    cache[cacheKey] = localPaths;
  }

  return { status: "fetched", count: localPaths.length, total: items.length, clean: cleaned.length };
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith("--"));

  // Get all categories or specific ones
  const allCats = fs.readdirSync(PRODUCT_DB)
    .filter(d => fs.statSync(path.join(PRODUCT_DB, d)).isDirectory())
    .filter(d => {
      try { fs.readFileSync(path.join(PRODUCT_DB, d, "products.json")); return true; } catch { return false; }
    });

  const categories = args.length > 0 ? args.filter(a => allCats.includes(a)) : allCats;

  if (categories.length === 0) {
    console.log("No valid categories found. Available:", allCats.join(", "));
    process.exit(1);
  }

  // Count total products
  let totalProducts = 0;
  const catProducts = {};
  for (const cat of categories) {
    try {
      const products = JSON.parse(fs.readFileSync(path.join(PRODUCT_DB, cat, "products.json"), "utf8"));
      catProducts[cat] = products;
      totalProducts += products.length;
    } catch { catProducts[cat] = []; }
  }

  const alreadyCached = Object.keys(cache).length;
  console.log(`\n🖼️  Product Image Fetcher`);
  console.log(`   Categories: ${categories.length}`);
  console.log(`   Total products: ${totalProducts}`);
  console.log(`   Already cached: ${alreadyCached}`);
  console.log(`   Estimated time: ~${Math.ceil((totalProducts - alreadyCached) * 2.5 / 60)} minutes`);
  console.log(`   Progress saves after every product — safe to stop & resume\n`);

  let processed = 0;
  let fetched = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (const cat of categories) {
    const products = catProducts[cat];
    console.log(`\n══ ${cat} (${products.length} products) ══`);

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const name = p.name || "";
      if (!name) continue;

      processed++;
      const pct = ((processed / totalProducts) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);

      try {
        const result = await fetchImagesForProduct(name, cat);

        if (result.status === "cached") {
          skipped++;
          // Don't log every skip — too noisy
          if (i % 50 === 0) process.stdout.write(`  [${pct}%] ${i}/${products.length} (${skipped} cached)\r`);
        } else if (result.status === "skip") {
          skipped++;
        } else {
          fetched++;
          console.log(`  ✅ [${pct}%] ${name.slice(0, 55)} → ${result.count} imgs (${result.clean}/${result.total} matched)`);

          // Save cache every 10 fetches
          if (fetched % 10 === 0) saveCache();

          // Rate limit: 2s between API calls
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (e) {
        errors++;
        console.log(`  ❌ [${pct}%] ${name.slice(0, 40)}: ${e.message?.slice(0, 60)}`);
        // On rate limit, wait longer
        if (e.response?.status === 429) {
          console.log("  ⏳ Rate limited — waiting 30s...");
          await new Promise(r => setTimeout(r, 30000));
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  // Final save
  saveCache();

  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ Done in ${totalTime} minutes!`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Fetched: ${fetched} (new images downloaded)`);
  console.log(`   Skipped: ${skipped} (already cached)`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total cached: ${Object.keys(cache).length} products`);
  console.log(`   Total images: ${Object.values(cache).reduce((s, a) => s + a.length, 0)}`);
}

main().catch(e => { console.error("Fatal:", e); saveCache(); process.exit(1); });
