#!/usr/bin/env node
/**
 * start-prod.mjs — boot server.js with a heap cap that matches the container.
 *
 * WHY THIS EXISTS. render.yaml sets NODE_OPTIONS=--max-old-space-size=1700 and
 * explains at length why: V8's default lets the process run past the container
 * ceiling and get SIGKILLed mid-request instead of GCing first. That env var is
 * not applied to the live service — /api/health reports a 1,048 MB cap, which
 * is V8's own default, not 1700. The blueprint and the running service drifted
 * apart (the service also runs in us-west1 while the blueprint says frankfurt),
 * and a value that only exists in a file nobody applied is not a setting.
 *
 * So the cap is computed here, at boot, from the memory the process actually
 * has. Nothing to configure and nothing to keep in sync, and it stays correct
 * if the plan is ever resized.
 *
 * A NOTE ON os.totalmem(). Inside a container it usually reports the HOST's
 * memory rather than the limit the kernel will enforce — on a large host that
 * computes a cap far above the real ceiling and reintroduces exactly the
 * SIGKILL this is meant to prevent. The cgroup limit is the number that binds,
 * so it is read first and totalmem() is only the fallback.
 *
 * TWO RULES THIS FILE FOLLOWS, because it sits on the production boot path and
 * CI boots `node server.js` directly, so nothing else exercises it:
 *
 *   1. An explicit NODE_OPTIONS wins. If someone sets it in the dashboard that
 *      is a deliberate operator decision, and this must not quietly override it.
 *   2. It can never be worse than what it replaced. Every part of the
 *      computation is wrapped: if anything throws, the flag is dropped and the
 *      server starts exactly as it does today, with V8's default.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Bytes the kernel will actually let this process use, or null if unbounded. */
function cgroupLimitBytes() {
  const candidates = [
    "/sys/fs/cgroup/memory.max",                   // cgroup v2
    "/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
  ];
  for (const file of candidates) {
    try {
      const raw = readFileSync(file, "utf8").trim();
      if (raw === "max") return null;              // v2, explicitly unbounded
      const n = Number(raw);
      // v1 reports a sentinel near 2^63 when unbounded. Anything at or above
      // 64 GB is the host talking, not a limit meant for this service.
      if (Number.isFinite(n) && n > 0 && n < 64 * 1024 ** 3) return n;
    } catch { /* not linux, or not readable — try the next candidate */ }
  }
  return null;
}

/** The flag to pass, or [] when we cannot work out a trustworthy number. */
function heapFlag() {
  try {
    if ((process.env.NODE_OPTIONS || "").includes("--max-old-space-size")) {
      console.log(`🧠 heap cap: left to NODE_OPTIONS (${process.env.NODE_OPTIONS.trim()})`);
      return [];
    }
    const limit = cgroupLimitBytes();
    const bytes = limit ?? os.totalmem();
    if (!Number.isFinite(bytes) || bytes <= 0) return [];
    const totalMB = Math.floor(bytes / 1024 / 1024);
    // 80% of the container. The remainder is not slack: it covers the RSS that
    // never appears in the heap number — Buffers, the http parser, native
    // allocations, and the JSON read off disk during a catalogue sync.
    // Floor so a misread cannot strangle the process; ceiling because V8 will
    // not treat old-space as much larger than 4 GB anyway.
    const cap = Math.max(256, Math.min(Math.floor(totalMB * 0.8), 4096));
    console.log(`🧠 heap cap: ${cap} MB (80% of ${totalMB} MB, from ${limit ? "cgroup limit" : "os.totalmem()"})`);
    return [`--max-old-space-size=${cap}`];
  } catch (e) {
    console.warn(`🧠 heap cap: could not size it (${e.message}), using V8 defaults`);
    return [];
  }
}

// Seed the catalogue first, exactly as the previous start:prod chain did.
// Failing here must stop the boot — serving an empty catalogue reads as data
// loss, and it is better to fail the deploy than to serve nothing.
const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts", "seed-product-db.mjs")], {
  cwd: ROOT, stdio: "inherit",
});
if (seed.status !== 0) {
  console.error(`✗ seed-product-db.mjs exited ${seed.status}, refusing to start`);
  process.exit(seed.status ?? 1);
}

const child = spawn(process.execPath, [...heapFlag(), path.join(ROOT, "server.js")], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

// Render stops a service with SIGTERM and expects it to drain. Forward the
// signal rather than dying and orphaning the server, and mirror however the
// child ended so the platform sees the truth about why it stopped.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
}
child.on("exit", (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
child.on("error", (e) => {
  console.error(`✗ could not start server.js: ${e.message}`);
  process.exit(1);
});
