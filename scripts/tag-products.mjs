// tag-products.mjs — bulk-categorise every product in product-db
//
// Walks product-db/<category>/products.json, fetches ZAP specs for each
// model id (via the local server's /api/product-specs endpoint, which
// already does proxy + cache + WAF handling), then runs the result
// through categorize.js → tagsFromZapSpecs and writes a `filterTags`
// object back into the product entry.
//
// Resumable: skips products that already have a `filterTags` field
// unless --force is passed. Concurrency: 6 in-flight requests to avoid
// stressing the local server (which fans out to ZAP). Retries on
// transient errors.
//
// Usage:
//   node scripts/tag-products.mjs                      — all categories
//   node scripts/tag-products.mjs --cat laptops        — single category
//   node scripts/tag-products.mjs --cat laptops --force — re-tag everything
//   node scripts/tag-products.mjs --port 3000          — server port (default 3000)
//
// Run while server is up (npm start).

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tagsFromZapSpecs } from "../categorize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const DB_DIR    = join(ROOT, "product-db");

// ── CLI ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
const onlyCat = arg("cat");
const port    = parseInt(arg("port", "3000"), 10);
const force   = argv.includes("--force");
const dryRun  = argv.includes("--dry-run");
const limit   = parseInt(arg("limit", "0"), 10) || 0; // 0 = no limit per category

const CONCURRENCY = parseInt(arg("conc", "2"), 10);
const PACE_MS     = parseInt(arg("pace", "350"), 10); // min ms between launches
const TIMEOUT_MS  = 15000;
const RETRIES     = 3;
const SERVER      = `http://127.0.0.1:${port}`;

// ── Helpers ───────────────────────────────────────────────────────
function listCategories() {
  return readdirSync(DB_DIR)
    .filter(name => {
      const p = join(DB_DIR, name);
      try { return statSync(p).isDirectory() && existsSync(join(p, "products.json")); }
      catch { return false; }
    })
    .sort();
}

async function fetchSpecs(modelid) {
  const url = `${SERVER}/api/product-specs?modelid=${encodeURIComponent(modelid)}`;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      // 429 = global rate-limit hit — back off heavily so we let the bucket refill
      if (r.status === 429) {
        await new Promise(res => setTimeout(res, 5000 + attempt * 5000));
        if (attempt === RETRIES) throw new Error("HTTP 429 (rate-limited)");
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === RETRIES) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

function atomicWrite(path, data) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

async function tagCategory(category) {
  const file = join(DB_DIR, category, "products.json");
  let products;
  try { products = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { console.warn(`  ⚠️  ${category}: read error — ${e.message}`); return; }

  if (!Array.isArray(products) || products.length === 0) {
    console.log(`  ${category}: empty`);
    return;
  }

  // Filter products that need tagging
  const todo = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && p.id && (force || !p.filterTags));

  const totalNeed = todo.length;
  const slice = limit > 0 ? todo.slice(0, limit) : todo;

  console.log(`📦 ${category}: ${products.length} products, ${totalNeed} need tagging${limit > 0 ? `, processing ${slice.length}` : ""}`);

  if (slice.length === 0) return;

  let done = 0, failed = 0, tagged = 0;
  let lastSave = Date.now();

  // Pace-limited concurrency: each worker waits PACE_MS between launches so
  // the global rate-limit bucket on the server doesn't drain. With CONCURRENCY=2
  // and PACE_MS=350 we land at ~5.7 req/sec — well under the global limit.
  const queue = slice.slice();
  let lastLaunch = 0;
  const paceGate = async () => {
    const now = Date.now();
    const wait = Math.max(0, lastLaunch + PACE_MS - now);
    lastLaunch = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  };
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { p, i } = item;
      await paceGate();
      try {
        const data = await fetchSpecs(p.id);
        const tags = tagsFromZapSpecs(data?.specs || [], data?.name || p.name || "", category);
        // Only persist if we actually resolved at least one dimension OR force is on
        if (Object.keys(tags).length > 0 || force) {
          products[i] = { ...products[i], filterTags: tags };
          tagged++;
        }
      } catch (e) {
        failed++;
      }
      done++;
      if (done % 25 === 0) {
        process.stdout.write(`\r    ${done}/${slice.length}  (✅ ${tagged}  ❌ ${failed})  `);
      }
      // Periodic checkpoint write so a Ctrl-C doesn't lose progress
      if (!dryRun && Date.now() - lastSave > 30_000) {
        atomicWrite(file, JSON.stringify(products, null, 2));
        lastSave = Date.now();
      }
    }
  });

  await Promise.all(workers);

  if (!dryRun) {
    atomicWrite(file, JSON.stringify(products, null, 2));
  }
  process.stdout.write(`\r    ${done}/${slice.length}  (✅ ${tagged}  ❌ ${failed})  \n`);
  console.log(`  ✓ ${category}: tagged ${tagged}, failed ${failed}${dryRun ? " (dry run, no save)" : ""}`);
}

// ── Entrypoint ────────────────────────────────────────────────────
(async () => {
  // Health check
  try {
    const r = await fetch(`${SERVER}/api/product-specs?modelid=0`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`❌ Server not reachable at ${SERVER} — start it with 'npm start' first.`);
    process.exit(1);
  }

  const cats = onlyCat ? [onlyCat] : listCategories();
  console.log(`🏷️  Tagging ${cats.length} categor${cats.length === 1 ? "y" : "ies"} (concurrency=${CONCURRENCY}${force ? ", FORCE" : ""}${dryRun ? ", DRY-RUN" : ""})\n`);

  const t0 = Date.now();
  for (const cat of cats) {
    if (!existsSync(join(DB_DIR, cat, "products.json"))) {
      console.warn(`  ⚠️  ${cat}: no products.json, skipping`);
      continue;
    }
    await tagCategory(cat);
  }
  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s`);
})();
