/**
 * Fetch 3-5 product images for each deal product using DataForSEO.
 * Saves to product-images-cache.json (server reads this on startup).
 * Also downloads actual image files to product-img/ folder for offline use.
 *
 * Usage: node fetch-product-images.js
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

const CACHE_FILE = path.join(__dirname, "product-images-cache.json");
const IMG_DIR    = path.join(__dirname, "product-img");

// Load existing cache
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}

// Ensure download directory exists
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

// All deal products
const PRODUCTS = [
  'Samsung 65" Neo QLED 4K',
  'MacBook Pro 14" M3',
  'iPhone 16 Pro 256GB',
  'Bosch 9kg Washing Machine',
  'Mitsubishi 1.5HP Inverter AC',
  'Trek e5 Electric Bike',
  'Sony PlayStation 5 Slim',
  'Sony Alpha A7 IV Full Frame',
  'iRobot Roomba j9+ Robot Vacuum',
  'Sony Bravia 55" OLED XR A80L',
  "De'Longhi Dinamica Plus Coffee Machine",
  'Samsung Galaxy S25 Ultra 256GB',
  'Sony WH-1000XM5 Wireless Headphones',
  'DJI Mini 4 Pro Drone',
  'ASUS ROG Zephyrus G16 Gaming Laptop',
  'Dyson V15 Detect Cordless Vacuum',
  'Apple AirPods Pro 2 USB-C',
];

const JUNK = ["case","cover","כיסוי","מגן","screen protector","charger","מטען",
  "accessories","אביזר","stand","holder","bag","sleeve","cable","glass","tempered",
  "skin","wrap","bumper","wallet","pouch","strap","band","mount","dock","hub","adapter"];

const MANUF_DOMAINS = [
  "apple.com","samsung.com","lg.com","sony.com","microsoft.com","dell.com",
  "lenovo.com","hp.com","asus.com","acer.com","dyson.com","philips.com",
  "bosch.com","irobot.com","dji.com","canon.com","nikon.com","panasonic.com",
  "bose.com","trek.com","delonghi.com","nintendo.com","playstation.com",
];

function slug(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}

async function fetchImages(productName) {
  const cacheKey = productName.trim().toLowerCase();
  if (cache[cacheKey]?.length >= 3) {
    console.log(`  ✅ ${productName} — already cached (${cache[cacheKey].length} images)`);
    return cache[cacheKey];
  }

  console.log(`  🔍 Fetching images for: ${productName}`);

  const payload = [{
    keyword: `${productName} product photo official`,
    location_code: 2840, // US for better English results
    language_code: "en",
    device: "desktop",
    depth: 60,
  }];

  const { data } = await axios.post(
    "https://api.dataforseo.com/v3/serp/google/images/live/advanced",
    payload,
    { auth: { username: DFS_LOGIN, password: DFS_PASS }, timeout: 15000 }
  );

  const items = data?.tasks?.[0]?.result?.[0]?.items || [];
  console.log(`    Raw results: ${items.length}`);

  // Extract keywords from product name for relevance check
  const keywords = productName.toLowerCase()
    .split(/[\s\-\/\(\),\.\"]+/)
    .filter(t => t.length >= 2)
    .filter(t => !["the","and","or","for","with","pro","max","ultra"].includes(t));

  // Filter relevant + non-junk
  const cleaned = items.filter(img => {
    const meta = [img.title || "", img.alt || "", img.source_url || ""].join(" ").toLowerCase();
    if (JUNK.some(j => meta.includes(j))) return false;
    const hits = keywords.filter(kw => meta.includes(kw));
    return hits.length >= Math.min(2, keywords.length);
  });
  console.log(`    After filter: ${cleaned.length}`);

  // Extract URLs
  const extractUrl = (img) => {
    const src = img.source_url || "";
    if (src && /\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(src)) return src;
    return img.image_url || img.thumbnail_url || img.encoded_url || img.url || "";
  };

  // Sort: manufacturer first
  const sorted = [...cleaned].sort((a, b) => {
    const aM = MANUF_DOMAINS.some(d => (a.source_url || "").includes(d)) ? 0 : 1;
    const bM = MANUF_DOMAINS.some(d => (b.source_url || "").includes(d)) ? 0 : 1;
    return aM - bM;
  });

  const seen = new Set();
  const images = [];
  for (const img of sorted) {
    const url = extractUrl(img);
    if (!url || url.endsWith("/") || url.includes("?q=tbn")) continue;
    if (url.includes("64x") || url.includes("128x") || url.includes("thumbnail")) continue;
    const base = url.split("?")[0];
    if (seen.has(base)) continue;
    seen.add(base);
    images.push(url);
    if (images.length >= 5) break;
  }

  console.log(`    Selected: ${images.length} images`);

  // Download images to disk
  const productSlug = slug(productName);
  const productDir = path.join(IMG_DIR, productSlug);
  if (!fs.existsSync(productDir)) fs.mkdirSync(productDir, { recursive: true });

  const localPaths = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const ext = (images[i].match(/\.(jpg|jpeg|png|webp|gif)/i) || [".jpg"])[0] || ".jpg";
      const filename = `${i + 1}${ext.startsWith(".") ? ext : "." + ext}`;
      const filepath = path.join(productDir, filename);

      const response = await axios.get(images[i], {
        responseType: "arraybuffer",
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      fs.writeFileSync(filepath, response.data);
      localPaths.push(`/product-img/${productSlug}/${filename}`);
      console.log(`    💾 Saved: ${filename} (${Math.round(response.data.length / 1024)}KB)`);
    } catch (e) {
      console.log(`    ⚠️  Download failed for image ${i + 1}: ${e.message}`);
      // Keep the remote URL as fallback
      localPaths.push(images[i]);
    }
  }

  cache[cacheKey] = localPaths;
  return localPaths;
}

async function main() {
  console.log(`\n🖼️  Fetching product images for ${PRODUCTS.length} products...\n`);

  for (const product of PRODUCTS) {
    try {
      await fetchImages(product);
    } catch (e) {
      console.log(`  ❌ ${product}: ${e.message}`);
    }
    // Rate limit: 1.5s between requests
    await new Promise(r => setTimeout(r, 1500));
  }

  // Save cache
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  console.log(`\n✅ Done! Cache saved to ${CACHE_FILE}`);
  console.log(`   Images saved to ${IMG_DIR}/`);
  console.log(`   Total products: ${Object.keys(cache).length}`);
  console.log(`   Total images: ${Object.values(cache).reduce((s, arr) => s + arr.length, 0)}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
