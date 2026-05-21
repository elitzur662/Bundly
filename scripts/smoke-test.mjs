/**
 * Bundly — Smoke test. Run via `npm run smoke`.
 *
 * Verifies that after a refactor (or any other change) the server still
 * boots cleanly and the most critical endpoints answer with expected
 * status codes. Catches the failure modes that `npm run build` alone
 * cannot detect: bad imports at runtime, dead module-load paths,
 * missing exports, route handlers that crash on first request, etc.
 *
 * Exit code: 0 = all checks pass, 1 = at least one failed.
 *
 * Does NOT verify UI rendering, click flows, mobile-specific issues,
 * or any browser-side state — those still need a manual smoke test.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

const PORT = 3099; // pick a port unlikely to collide with the user's dev server
const BASE = `http://127.0.0.1:${PORT}`;

// Wait until the port is accepting TCP connections (more reliable than stdout polling).
async function waitForPort(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error",   () => { s.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(300);
  }
  return false;
}

const CHECKS = [
  // path,                              expectedStatus,        notes
  { path: "/api/health",                 ok: [200],            label: "health" },
  { path: "/api/suggest?q=טלוויזיה",    ok: [200],            label: "suggest" },
  { path: "/api/stripe-public-key",      ok: [200],            label: "stripe key" },
  { path: "/api/wizard-questions?q=מקרר", ok: [200],            label: "wizard questions" },
  // Auth-gated → 401 expected (proves the middleware fires)
  { path: "/api/auth/me",                ok: [401],            label: "auth/me (401 expected)" },
  { path: "/api/orders",                 ok: [401],            label: "orders (401 expected)" },
  // Admin-gated → 401
  { path: "/api/admin/activity",         ok: [401],            label: "admin activity (401 expected)" },
  // Debug routes — admin-gated (security hardening) → 401 for an unauthenticated probe
  { path: "/api/debug-zap?q=test",       ok: [401],            label: "debug route (401 expected)" },
  // Frontend asset
  { path: "/admin/activity",             ok: [200],            label: "admin html page" },
];

async function probe(server) {
  const results = [];
  for (const c of CHECKS) {
    const url = BASE + c.path;
    const ctrl = new AbortController();
    // Bump timeout to 20s — some endpoints (wizard-questions, search) hit
    // OpenAI on cold cache and can legitimately take >10s on first call.
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const pass = c.ok.includes(r.status);
      results.push({ label: c.label, status: r.status, pass, expected: c.ok.join("|") });
    } catch (e) {
      clearTimeout(timer);
      results.push({ label: c.label, status: "ERROR", pass: false, error: e.message?.slice(0, 60) });
    }
  }
  return results;
}

function fmtRow(r) {
  const icon = r.pass ? "✅" : "❌";
  const status = String(r.status).padStart(3);
  return `${icon} ${status}  ${r.label}${r.pass ? "" : ` (expected ${r.expected || ""}${r.error ? ", err: " + r.error : ""})`}`;
}

async function main() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(" 🔥 BUNDLY SMOKE TEST");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`Booting server on port ${PORT}…`);

  // Boot the server as a child process.
  // NOTE: NODE_ENV is intentionally NOT set to "production" — production
  // mounts enforceHttps which 301-redirects HTTP→HTTPS, and we can't curl
  // self-signed HTTPS without certs. Dev mode exercises the same handlers
  // and verifies imports + boot succeed equally well.
  const server = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      ZAP_USE_PROXY: "false", // skip outbound prewarm noise
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  let stdoutBuf = "";
  server.stderr.on("data", chunk => { stderrBuf += chunk.toString(); });
  server.stdout.on("data", chunk => { stdoutBuf += chunk.toString(); });

  let cleanExit = false;
  server.on("exit", code => {
    if (!cleanExit) {
      console.error("❌ Server exited before smoke test completed, code:", code);
      if (stderrBuf) console.error("STDERR (last 1000):\n", stderrBuf.slice(-1000));
      if (stdoutBuf) console.error("STDOUT (last 500):\n", stdoutBuf.slice(-500));
    }
  });

  // Wait for the port to actually accept TCP connections (most reliable)
  const ready = await waitForPort(PORT, 30_000);
  if (!ready) {
    console.error("❌ Port " + PORT + " never opened within 30s");
    if (stderrBuf) console.error("STDERR (last 1000):\n", stderrBuf.slice(-1000));
    if (stdoutBuf) console.error("STDOUT (last 500):\n", stdoutBuf.slice(-500));
    server.kill("SIGKILL");
    process.exit(1);
  }

  // Give post-boot init (caches, DB load) a moment to settle
  await sleep(1500);

  // Run probes
  console.log("\nRunning endpoint probes:\n");
  const results = await probe(server);
  for (const r of results) console.log("  " + fmtRow(r));

  const failed = results.filter(r => !r.pass);
  const passed = results.length - failed.length;
  console.log("\n──────────────────────────────────────────────────────────");
  console.log(` Results: ${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.log(" ❌ FAILED — refactor likely broke something");
  } else {
    console.log(" ✅ All probes passed — server boots & answers cleanly");
  }
  console.log("──────────────────────────────────────────────────────────");

  cleanExit = true;
  server.kill("SIGTERM");
  await sleep(500);
  if (!server.killed) server.kill("SIGKILL");

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
