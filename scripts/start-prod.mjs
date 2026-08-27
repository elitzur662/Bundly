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
import v8 from "node:v8";
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

/**
 * The flag to pass, or [] to leave V8 alone.
 *
 * THIS FUNCTION MAY ONLY LOWER THE CAP. The first version took 80% of the
 * container and passed it unconditionally, which on the 2 GB plan raised
 * old-space from V8's default 1,048 MB to 1,662 MB — and Render OOM-killed the
 * instance within the hour.
 *
 * That is not a surprise in hindsight, it is what the flag does. V8 defers hard
 * GC until it approaches the cap, so raising the cap raises real usage. And the
 * cap governs the heap, while the kernel kills on RSS: heap plus everything
 * that never appears in the heap number — Buffers, the http parser, native
 * allocations, the JSON held during a catalogue sync. Measured on this service,
 * that overhead runs 90 MB idle and 218 MB under load. 1,662 + overhead sits
 * against a 2,078 MB ceiling. 1,048 + overhead does not, which is why the
 * default had been stable for months.
 *
 * The real risk this was meant to address was always the opposite one, and
 * render.yaml says so: V8's default is generous enough to exceed a SMALL
 * container (the 512 MB starter plan "consistently OOM'd"). So the rule is to
 * take the smaller of the two — the safe fraction of this container, and
 * whatever V8 would have chosen anyway. On a big container that is V8's own
 * number and nothing changes. On a small one it clamps down. It cannot
 * reintroduce the failure it just caused.
 */
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

    // What V8 would pick on its own, read from this process — the child gets
    // the same default because it is the same binary on the same machine.
    const v8DefaultMB = Math.round((v8.getHeapStatistics().heap_size_limit || 0) / 1024 / 1024);

    // Reserve for the RSS that is not heap, generously: the measured 218 MB
    // under load is a sample, not a bound, and being wrong upwards costs a
    // SIGKILL while being wrong downwards costs some GC.
    const reserveMB = Math.max(384, Math.floor(totalMB * 0.30));
    const safeMB = Math.max(256, Math.min(totalMB - reserveMB, 4096));

    if (!v8DefaultMB || safeMB >= v8DefaultMB) {
      console.log(
        `🧠 heap cap: leaving V8's default (${v8DefaultMB || "unknown"} MB). ` +
        `Container ${totalMB} MB, safe ceiling ${safeMB} MB — no reason to lower it.`
      );
      return [];
    }
    console.log(
      `🧠 heap cap: ${safeMB} MB, lowered from V8's default ${v8DefaultMB} MB ` +
      `(container ${totalMB} MB from ${limit ? "cgroup limit" : "os.totalmem()"}, ` +
      `reserving ${reserveMB} MB for non-heap RSS).`
    );
    return [`--max-old-space-size=${safeMB}`];
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
