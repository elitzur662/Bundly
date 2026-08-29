/**
 * zap-db.js  —  JSON-file-backed persistent cache for Zap data
 *
 * Drop-in replacement for the SQLite version — same exported API,
 * no native dependencies (no node-gyp / Python required).
 *
 * Files written to disk:
 *   zap-categories.json   sog → {candidates, timestamp}
 *   zap-prices.json       modelId → {prices, timestamp}
 *   ksp-cache.json        key → {data, timestamp}
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Honor DATA_DIR env so caches live on Render's persistent disk in production.
// Falls back to project dir locally. Without this, every Render deploy wipes
// the cache and the app spends 30+ minutes re-fetching ZAP/KSP catalogs.
const _DATA_DIR = (() => {
  const d = process.env.DATA_DIR;
  if (!d) return __dir;
  try { if (!existsSync(d)) mkdirSync(d, { recursive: true }); } catch {}
  return existsSync(d) ? d : __dir;
})();

const CAT_FILE    = join(_DATA_DIR, "zap-categories.json");
const PRICES_FILE = join(_DATA_DIR, "zap-prices.json");
const KSP_FILE    = join(_DATA_DIR, "ksp-cache.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadJson(path) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.warn(`[zap-db] warn: could not load ${path}: ${e.message}`);
  }
  return {};
}

function saveJsonNow(path, data) {
  // Atomic write: write to a .tmp file first, then rename over the target.
  // This prevents a corrupt JSON file if the process crashes mid-write.
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, path);
  } catch (e) {
    console.warn(`[zap-db] warn: could not save ${path}: ${e.message}`);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch (_) {}
  }
}

/**
 * Coalesced write. Marks the store dirty and flushes on a timer.
 *
 * saveJson used to serialise the WHOLE store on every call, and the callers
 * are per-item: saveModelPricesToDB runs once per price the trickle lands,
 * every 20 seconds, against a zap-prices.json that is 11.6 MB. That is roughly
 * 35 MB of throwaway string per minute, about 2 GB an hour, against a 1,048 MB
 * heap — continuous GC pressure that gets worse as the file grows, because
 * every entry added makes every subsequent write more expensive.
 *
 * On 2026-08-29 the server aborted with SIGABRT, V8 out of heap. Re-queueing
 * stale prices had raised how many fetches succeeded, so it raised how many
 * full-store serialisations ran, and it grew the store being serialised.
 *
 * The in-memory object is still updated synchronously, so every read is
 * immediately correct; only the disk copy lags. A crash can lose up to
 * FLUSH_MS of scraped prices, which the trickle simply fetches again — these
 * are caches, not records. Anything durable lives in db.js, which is untouched.
 */
const FLUSH_MS = 30_000;
const _dirty = new Map();   // path -> the object to write
let _flushTimer = null;

function flushNow() {
  if (_dirty.size === 0) return;
  for (const [path, data] of _dirty) saveJsonNow(path, data);
  _dirty.clear();
}

function saveJson(path, data) {
  _dirty.set(path, data);
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => { _flushTimer = null; flushNow(); }, FLUSH_MS);
  _flushTimer.unref?.();   // never hold the process open for a cache write
}

// A pending flush must not be lost on shutdown. Render stops the service with
// SIGTERM, and without this the last window of prices would be dropped on
// every single deploy.
let _exitHooked = false;
if (!_exitHooked) {
  _exitHooked = true;
  const onExit = () => { try { flushNow(); } catch {} };
  process.once("exit", onExit);
  process.once("SIGTERM", () => { onExit(); process.exit(0); });
  process.once("SIGINT",  () => { onExit(); process.exit(0); });
}

/** Force the pending writes out. Exported for shutdown paths and tests. */
export function flushZapDb() { flushNow(); }

// In-memory stores (write-through cache)
let _cats   = loadJson(CAT_FILE);
let _prices = loadJson(PRICES_FILE);
let _ksp    = loadJson(KSP_FILE);

console.log(`[zap-db] JSON store ready (cats=${Object.keys(_cats).length} prices=${Object.keys(_prices).length})`);

// ── Category cache ────────────────────────────────────────────────────────────

export function getCategoryFromDB(sog) {
  const entry = _cats[sog];
  if (!entry) return null;
  // Normalize to 'ts' so server.js (which uses cachedEntry.ts) works correctly.
  return { candidates: entry.candidates, ts: entry.timestamp || entry.ts || 0 };
}

export function saveCategoryToDB(sog, candidates) {
  _cats[sog] = { candidates, timestamp: Date.now() };
  saveJson(CAT_FILE, _cats);
}

export function getAllCachedCategories() {
  return Object.keys(_cats);
}

export function purgeOldCategories(maxAgeMs = 48 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const sog of Object.keys(_cats)) {
    if ((_cats[sog].timestamp || 0) < cutoff) {
      delete _cats[sog];
      removed++;
    }
  }
  if (removed) saveJson(CAT_FILE, _cats);
  return removed;
}

// ── Model-prices cache ────────────────────────────────────────────────────────

export function getModelPricesFromDB(modelId) {
  const entry = _prices[String(modelId)];
  if (!entry) return null;
  // Support both old nested format ({ prices: {stores,title,...}, timestamp })
  // and new flat format ({ stores, title, thumbnail, ts, timestamp }).
  // Always return the flat shape that server.js expects (checking cached.stores).
  const flat = entry.prices ?? entry; // unwrap legacy nested format if present
  return {
    title:     flat.title     || "",
    thumbnail: flat.thumbnail || "",
    stores:    flat.stores    || [],
    ts:        flat.ts || flat.timestamp || entry.timestamp || 0,
  };
}

export function saveModelPricesToDB(modelId, entry) {
  // Store flat — no nested 'prices' key — so getModelPricesFromDB can read it directly.
  _prices[String(modelId)] = {
    title:     entry.title     || "",
    thumbnail: entry.thumbnail || "",
    stores:    entry.stores    || [],
    timestamp: entry.ts || Date.now(),
  };
  saveJson(PRICES_FILE, _prices);
}

// Delete a single model price entry by modelId. Used by the trickle
// migration to purge poisoned entries (ksp-fuzzy match with wrong title).
export function deleteModelPriceFromDB(modelId) {
  const key = String(modelId);
  if (key in _prices) {
    delete _prices[key];
    saveJson(PRICES_FILE, _prices);
    return true;
  }
  return false;
}

export function purgeOldPrices(maxAgeMs = 48 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const id of Object.keys(_prices)) {
    if ((_prices[id].timestamp || 0) < cutoff) {
      delete _prices[id];
      removed++;
    }
  }
  if (removed) saveJson(PRICES_FILE, _prices);
  return removed;
}

export function getModelPricesCount() {
  return Object.keys(_prices).length;
}

export function getAllModelPriceIds() {
  return Object.keys(_prices);
}

// ── KSP search cache ──────────────────────────────────────────────────────────

export function getKspCacheFromDB(key) {
  const entry = _ksp[key];
  if (!entry) return null;
  return { data: entry.data, timestamp: entry.timestamp };
}

export function saveKspCacheToDB(key, data) {
  _ksp[key] = { data, timestamp: Date.now() };
  saveJson(KSP_FILE, _ksp);
}

// ── Migration (no-op — old JSON files already compatible) ────────────────────

export function migrateJsonCaches() {
  // Migrate old zap-cache.json → zap-categories.json if present
  const oldCat = join(__dir, "zap-cache.json");
  if (existsSync(oldCat) && !existsSync(CAT_FILE)) {
    try {
      const old = JSON.parse(readFileSync(oldCat, "utf8"));
      // old format: { sog: { candidates:[...], timestamp:N } }
      _cats = old;
      saveJson(CAT_FILE, _cats);
      renameSync(oldCat, oldCat + ".migrated");
      console.log(`[zap-db] migrated zap-cache.json → zap-categories.json (${Object.keys(_cats).length} entries)`);
    } catch (e) {
      console.warn(`[zap-db] migration warning: ${e.message}`);
    }
  }

  // Migrate old zap-prices-cache.json → zap-prices.json if present
  const oldPrices = join(__dir, "zap-prices-cache.json");
  if (existsSync(oldPrices) && !existsSync(PRICES_FILE)) {
    try {
      const old = JSON.parse(readFileSync(oldPrices, "utf8"));
      // old format: { modelId: { prices:[...], timestamp:N } }
      _prices = old;
      saveJson(PRICES_FILE, _prices);
      renameSync(oldPrices, oldPrices + ".migrated");
      console.log(`[zap-db] migrated zap-prices-cache.json → zap-prices.json (${Object.keys(_prices).length} entries)`);
    } catch (e) {
      console.warn(`[zap-db] migration warning: ${e.message}`);
    }
  }
}
