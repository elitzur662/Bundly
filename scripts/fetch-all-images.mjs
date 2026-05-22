/**
 * Bundly — unattended image fetch.  Run with:
 *
 *     node scripts/fetch-all-images.mjs --preset=launch    ← recommended for launch
 *     node scripts/fetch-all-images.mjs                    ← the whole catalog
 *
 * This is the "launch it and walk away" wrapper around fetch-zap-images.mjs.
 * It keeps re-launching the fetcher automatically and decides what to do by
 * measuring REAL progress (how many products got resolved) each round:
 *
 *   • Round resolved new products   → keep going.
 *   • Zap throttled us (exit 2)     → cool down once and resume; if a cooled-
 *                                     down round still resolves nothing, stop
 *                                     cleanly (the IP is blocked — re-run later).
 *   • A pass resolved nothing new   → run one --retry-failed sweep, then finish.
 *   • Unexpected crash (exit 1)     → wait a few minutes and retry (capped).
 *
 * fetch-zap-images.mjs is fully resumable (it caches every product), so each
 * re-launch — and each time YOU re-run this wrapper — picks up exactly where
 * it stopped. Safe to Ctrl+C at any time.
 *
 * Everything printed here is also appended to:
 *     scripts/.cache/fetch-all-images.log
 *
 * Any extra flags are forwarded to fetch-zap-images.mjs, e.g.
 *     node scripts/fetch-all-images.mjs --preset=launch
 *     node scripts/fetch-all-images.mjs --categories=tvs,phones
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "..");
const SCRIPT      = path.join(__dirname, "fetch-zap-images.mjs");
const LOG_FILE    = path.join(__dirname, ".cache", "fetch-all-images.log");
const CACHE_FILE  = path.join(__dirname, ".cache", "zap-images.json");
const REPORT_FILE = path.join(__dirname, ".cache", "zap-images-report.json");

const MAX_ROUNDS      = 40;                 // hard stop so it can never loop forever
const MAX_FATAL       = 5;                  // give up after this many unexpected crashes
const MAX_THROTTLES   = 12;                 // give up if Zap keeps hard-blocking this IP
const FATAL_WAIT_MS   = 5 * 60 * 1000;      // wait after an unexpected crash
const COOLDOWNS_MS    = [30, 45, 60, 90].map(m => m * 60 * 1000); // escalating throttle waits

// Extra flags the user passed (e.g. --category=tvs) are forwarded to every run.
const PASSTHRU_ARGS = process.argv.slice(2);

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function out(s) {
  process.stdout.write(s);
  logStream.write(s);
}
function stamp() {
  return new Date().toLocaleString("he-IL");
}

/** Run fetch-zap-images.mjs once; resolves with its exit code. */
function runOnce(extraArgs = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...extraArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", d => out(d.toString()));
    child.stderr.on("data", d => out(d.toString()));
    child.on("error", e => { out(`\n[wrapper] spawn error: ${e.message}\n`); resolve(1); });
    child.on("exit", code => resolve(code == null ? 1 : code));
  });
}

async function waitWithCountdown(ms, why) {
  out(`\n[wrapper] ${why} — waiting ${Math.round(ms / 60000)} min (until ${new Date(Date.now() + ms).toLocaleTimeString("he-IL")})…\n`);
  await sleep(ms);
}

/** How many products are resolved so far (status "ok" in the resume cache). */
function countResolved() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    let ok = 0;
    for (const k in c) if (c[k] && c[k].status === "ok") ok++;
    return ok;
  } catch { return 0; }
}

async function main() {
  out(`\n${"═".repeat(62)}\n`);
  out(` 🖼️  Bundly — unattended full-catalog image fetch\n`);
  out(`     started ${stamp()}\n`);
  out(`${"═".repeat(62)}\n`);

  let round = 0;
  let throttles = 0;       // how many cooldowns we've taken
  let fatals = 0;          // unexpected crashes
  let phase = "main";      // "main" → "retry"
  let stopReason = "";

  let prevOk = countResolved();
  out(` Starting point: ${prevOk} products already resolved.\n`);

  while (round < MAX_ROUNDS) {
    round++;
    const args = phase === "retry"
      ? ["--retry-failed", ...PASSTHRU_ARGS]
      : [...PASSTHRU_ARGS];
    out(`\n${"─".repeat(62)}\n[wrapper] round ${round}  (phase: ${phase})  ${stamp()}\n${"─".repeat(62)}\n`);

    const code = await runOnce(args);

    // Did this round actually resolve anything new?
    const nowOk  = countResolved();
    const gained = nowOk - prevOk;
    prevOk = nowOk;
    out(`\n[wrapper] round ${round}: +${gained} newly resolved  ·  ${nowOk} total resolved\n`);

    // ── unexpected crash ─────────────────────────────────────────────────
    if (code === 1) {
      fatals++;
      if (fatals >= MAX_FATAL) { stopReason = `${fatals} crashes — check the log`; break; }
      await waitWithCountdown(FATAL_WAIT_MS, `unexpected crash (#${fatals})`);
      continue;
    }

    // ── Zap throttled the connection (script aborted early) ──────────────
    if (code === 2) {
      // If a cooldown round STILL resolves nothing, Zap has hard-blocked this
      // IP — waiting more is pointless. Stop; the user re-runs later.
      if (gained <= 0 && throttles >= 1) {
        stopReason = "Zap is blocking this IP — a cooldown didn't help";
        break;
      }
      throttles++;
      if (throttles > MAX_THROTTLES) { stopReason = "too many throttle cooldowns"; break; }
      const wait = COOLDOWNS_MS[Math.min(throttles - 1, COOLDOWNS_MS.length - 1)];
      await waitWithCountdown(wait, `Zap throttled the connection (#${throttles})`);
      continue;
    }

    // ── code 0: a full pass completed cleanly ────────────────────────────
    if (gained > 0) continue;                 // still harvesting — keep going
    if (phase === "main") {                   // normal passes are dry → retry sweep
      out(`\n[wrapper] no new products from a normal pass — running a --retry-failed sweep…\n`);
      phase = "retry";
      continue;
    }
    stopReason = "catalog complete — nothing left to resolve";   // retry sweep was dry too
    break;
  }

  if (round >= MAX_ROUNDS && !stopReason) stopReason = `reached the ${MAX_ROUNDS}-round cap`;

  // ── Final report ───────────────────────────────────────────────────────
  const finalOk = countResolved();
  // Pending within THIS run's scope comes from the last run's own report
  // (so a --preset run isn't scared by pending counts from other categories).
  let pending = 0;
  try {
    const r = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
    pending = (r.stats?.error || 0) + (r.stats?.unmatched || 0);
  } catch {}
  const cmd = PASSTHRU_ARGS.length ? `node scripts/fetch-all-images.mjs ${PASSTHRU_ARGS.join(" ")}` : "node scripts/fetch-all-images.mjs";

  out(`\n${"═".repeat(62)}\n`);
  out(` Finished ${stamp()}  ·  ${round} round(s), ${throttles} cooldown(s)\n`);
  out(` Reason: ${stopReason}\n`);
  out(` Resolved across the catalog so far: ${finalOk} products\n`);
  out(` Still pending in this run's scope: ${pending}\n`);
  if (pending > 0) {
    out(`\n ⚠ Not everything is done. Re-run later (a few hours / next day):\n`);
    out(`     ${cmd}\n`);
    out(`   It resumes automatically — already-done products are skipped instantly.\n`);
  } else {
    out(`\n ✅ This run's scope is complete.\n`);
  }
  out(`\n Next step: commit & push the changed product-db/**/products.json files,\n`);
  out(` then Render will redeploy with the new images.\n`);
  out(`${"═".repeat(62)}\n`);
  logStream.end();
}

main().catch(e => { out(`\n[wrapper] fatal: ${e.stack || e.message}\n`); logStream.end(); process.exit(1); });
