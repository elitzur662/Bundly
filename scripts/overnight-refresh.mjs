// overnight-refresh.mjs — chained orchestrator for unattended runs.
//
// Pipeline (each step waits for the previous to finish):
//   1. Wait for the in-progress tag-products.mjs to finish (polls /tmp/tag-products.log
//      for the "✅ Done" terminator). Runs immediately if log already shows done.
//   2. Run syncAll({ force: true }) — pulls fresh catalog + prices + images from ZAP
//      for every category in db-sync.js's CATEGORIES map. Already throttled with
//      1.5s gap between categories to keep CF / proxies happy.
//   3. Run tag-products.mjs (resumable, NOT --force) → tags only the new products
//      that step 2 added.
//
// Usage:  node scripts/overnight-refresh.mjs --port 3001 > /tmp/overnight.log 2>&1
//
// Safe to launch alongside the running tagger — it sleeps until the tagger is done
// before doing anything that hits ZAP.

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const portArg = argv.indexOf("--port");
const PORT    = portArg >= 0 ? argv[portArg + 1] : "3001";

// On Windows, Bash's /tmp resolves to %TEMP% (C:\Users\User\AppData\Local\Temp)
// but Node treats /tmp literally as C:\tmp. Use os.tmpdir() so paths align.
const TAGGER_LOG = join(tmpdir(), "tag-products.log");
const POLL_SEC   = 60; // check tagger status every minute

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (msg) => console.log(`[${ts()}] ${msg}`);

// ── Step 1: Wait for current tagger to finish ─────────────────────
async function waitForTagger() {
  log("⏳ Waiting for in-progress tag-products to finish...");
  while (true) {
    if (existsSync(TAGGER_LOG)) {
      const txt = readFileSync(TAGGER_LOG, "utf8");
      if (/✅ Done in/.test(txt)) {
        log("✅ Tagger finished — proceeding to refresh.");
        return;
      }
      // Heartbeat: the tagger uses \r between progress updates so the entire
      // run ends up on one giant line. Pull the LAST "(N/M)" pair plus the
      // current category for an accurate progress signal.
      const allProgress = [...txt.matchAll(/(\d+)\/(\d+)\s+\(✅\s*(\d+)\s*❌\s*(\d+)\)/g)];
      const lastCat     = (txt.match(/📦\s+([\w-]+):/g) || []).pop() || "?";
      if (allProgress.length > 0) {
        const last = allProgress[allProgress.length - 1];
        log(`   tagger heartbeat: ${lastCat.replace("📦 ", "")} ${last[1]}/${last[2]}  (✅ ${last[3]} ❌ ${last[4]})`);
      }
    } else {
      log("   tagger log not found — waiting anyway");
    }
    await new Promise(r => setTimeout(r, POLL_SEC * 1000));
  }
}

// ── Helper: run a node script and pipe its output to our log ──────
function runNode(scriptArgs, label) {
  return new Promise((resolveProm, rejectProm) => {
    log(`▶ ${label}: node ${scriptArgs.join(" ")}`);
    const child = spawn("node", scriptArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b) => process.stdout.write(b));
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("exit", (code) => {
      if (code === 0) { log(`✓ ${label} completed`); resolveProm(); }
      else            { log(`✗ ${label} exited code=${code}`); rejectProm(new Error(`${label} failed`)); }
    });
    child.on("error", rejectProm);
  });
}

// ── Step 2: Refresh catalog + prices + images from ZAP ────────────
async function refreshCatalog() {
  log("─── Phase 2: catalog refresh from ZAP ───");
  // Use the existing syncAll which iterates CATEGORIES with 1.5s gap.
  // force:true = re-fetch even if catalogTs is < CATALOG_FRESH_HOURS.
  // This pulls new products that have appeared in ZAP since the last sync,
  // updates prices, and re-fetches missing images.
  // Dynamic import on Windows requires file:// URLs, not raw paths.
  const { syncAll } = await import(pathToFileURL(join(ROOT, "db-sync-runner.js")).href);
  await syncAll({ force: true });
  log("✓ Catalog refresh done");
}

// ── Step 3: Tag any newly-added products ──────────────────────────
async function tagNewProducts() {
  log("─── Phase 3: tagging newly-added products ───");
  // No --force: skips products that already have filterTags from earlier run.
  // Same gentle pacing (conc=2, pace=350ms) as the current tagger.
  await runNode(
    ["scripts/tag-products.mjs", "--port", PORT],
    "tag-products (incremental)"
  );
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  log("🌙 Overnight refresh started");
  try {
    await waitForTagger();
    await refreshCatalog();
    await tagNewProducts();
    log("🎉 Overnight refresh complete");
  } catch (e) {
    log(`💥 Overnight refresh failed: ${e.message}`);
    process.exit(1);
  }
})();
