#!/usr/bin/env node
/**
 * deploy.mjs — trigger a Render deploy from the terminal.
 *
 * Auto-Deploy is set to "After CI Checks Pass", so the normal way to ship is
 * simply `git push`: GitHub Actions runs the smoke test and Render deploys when
 * it goes green. That is the path you want almost always, and this script is
 * not a replacement for it.
 *
 * This exists for the case that path cannot cover: shipping when CI is stuck,
 * re-deploying the same commit after changing something in the dashboard, or
 * recovering when the GitHub connection breaks — which is exactly what happened
 * on 2026-08-26, when a push sat undeployed for an hour because Auto-Deploy was
 * off and there was no way to trigger a deploy without a browser.
 *
 * SETUP (once). Render dashboard → the service → Settings → Deploy Hook, reveal
 * it, and put it in .env:
 *
 *     RENDER_DEPLOY_HOOK=https://api.render.com/deploy/srv-...?key=...
 *
 * That URL is a credential: anyone holding it can deploy. .env is gitignored
 * (including sidecars, since the .env* rule was added) — keep it there and
 * nowhere else.
 *
 *   node scripts/deploy.mjs           # deploy whatever main is at
 *   node scripts/deploy.mjs --status  # check the hook is configured, send nothing
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";

const HOOK = (process.env.RENDER_DEPLOY_HOOK || "").trim();
const statusOnly = process.argv.includes("--status");

if (!HOOK) {
  console.error("✗ RENDER_DEPLOY_HOOK is not set.");
  console.error("  Render dashboard → service → Settings → Deploy Hook → reveal,");
  console.error("  then add it to .env as RENDER_DEPLOY_HOOK=<url>. See the header.");
  process.exit(2);
}
if (!/^https:\/\/api\.render\.com\/deploy\//.test(HOOK)) {
  console.error("✗ RENDER_DEPLOY_HOOK does not look like a Render deploy hook.");
  console.error("  Expected it to start with https://api.render.com/deploy/");
  process.exit(2);
}

// Never print the hook: it is a credential and terminals get pasted around.
const redacted = HOOK.replace(/(srv-[a-z0-9]{4})[a-z0-9]*/i, "$1…").replace(/key=[^&]+/i, "key=…");
console.log(`▸ hook: ${redacted}`);

let head = "unknown", subject = "";
try {
  head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  subject = execFileSync("git", ["log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  const unpushed = execFileSync("git", ["rev-list", "--count", "@{u}..HEAD"], { encoding: "utf8" }).trim();
  if (unpushed !== "0") {
    console.warn(`⚠️  ${unpushed} local commit(s) are not pushed. Render builds from the`);
    console.warn(`    remote, so those will NOT be in this deploy. Push first.`);
  }
} catch { /* not a repo, or no upstream — the hook still works */ }
console.log(`▸ remote HEAD locally: ${head} ${subject}`);

if (statusOnly) {
  console.log("✓ hook is configured. Nothing sent (--status).");
  process.exit(0);
}

const res = await fetch(HOOK, { method: "POST" });
const body = await res.text();
if (!res.ok) {
  console.error(`✗ Render answered ${res.status}: ${body.slice(0, 300)}`);
  process.exit(1);
}
console.log(`✓ deploy triggered (${res.status})`);
console.log("  Watch it land:  curl -s https://www.bundly.co/ | grep -o '/assets/b-[^\"]*\\.js'");
