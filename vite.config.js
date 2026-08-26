import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { spawn, execSync } from 'child_process'
import { statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Plugin: auto-start and restart Express when Vite restarts ── v8
// Runs on PORT 3002 so it doesn't conflict with any manually-started server on 3001
// Uses POLLING to detect server.js changes (works across VM/sandbox boundaries)
function expressPlugin() {
  let child = null
  let lastMtime = 0
  let starting = false   // mutex — prevents concurrent startServer() calls

  // Kill whatever process is holding port 3002 (only used AFTER the tracked child dies)
  function freePort3002() {
    if (process.platform !== 'win32') return
    try {
      const out = execSync('netstat -ano | findstr ":3002 "', { encoding: 'utf8', shell: true, timeout: 3000 })
      const pids = [...new Set([...out.matchAll(/(?:LISTENING|ESTABLISHED|TIME_WAIT)\s+(\d+)/g)].map(m => m[1]))]
      pids.forEach(pid => {
        try { execSync(`taskkill /F /PID ${pid}`, { shell: true, stdio: 'ignore', timeout: 2000 }) } catch(_) {}
      })
      if (pids.length) console.log(`[bundly] freed port 3002 (PIDs: ${pids.join(',')})`)
    } catch(_) {}
  }

  function startServer() {
    if (starting) return          // already in a restart cycle — skip
    starting = true

    // 1. Kill the tracked child
    const oldPid = child?.pid
    child = null
    if (oldPid) {
      if (process.platform === 'win32') {
        try { execSync(`taskkill /F /PID ${oldPid} /T`, { shell: true, stdio: 'ignore', timeout: 3000 }) } catch(_) {}
      } else {
        try { process.kill(oldPid, 'SIGKILL') } catch(_) {}
      }
    }

    // 2. Wait for OS to release the port, then free any zombie, then spawn
    setTimeout(() => {
      freePort3002()         // kill zombie only after tracked child had time to die
      setTimeout(() => {
        starting = false
        child = spawn('node', ['server.js'], {
          cwd: __dirname, stdio: 'inherit', shell: false,
          env: { ...process.env, PORT: '3002' },
        })
        child.on('exit', (code) => {
          child = null
          if (code !== 0 && code !== null && !starting) {
            console.log(`[bundly] Express exited (${code}), restarting in 3s...`)
            setTimeout(startServer, 3000)
          }
        })
        console.log('[bundly] Express started on :3002')
      }, 300)
    }, 1500)
  }

  return {
    name: 'express-manager',
    configureServer() {
      // Get initial mtime
      try { lastMtime = statSync(path.join(__dirname, 'server.js')).mtimeMs } catch(e) {}
      startServer()

      // Poll every 1.5s for server.js changes (works when fs.watch doesn't fire)
      const pollInterval = setInterval(() => {
        try {
          const mtime = statSync(path.join(__dirname, 'server.js')).mtimeMs
          if (mtime !== lastMtime) {
            lastMtime = mtime
            console.log('[bundly] server.js changed (poll) — restarting Express...')
            startServer()
          }
        } catch(e) {}
      }, 1500)

      process.on('exit', () => {
        clearInterval(pollInterval)
        if (child) { try { child.kill() } catch(e) {} }
      })
    },
  }
}

// ── Plugin: refuse to emit a "production" build that is secretly a dev build ──
//
// Vite reads NODE_ENV out of .env (as VITE_USER_NODE_ENV) and lets it outrank
// `--mode production`. With NODE_ENV=development sitting in .env, `vite build`
// happily reported "building for production" while emitting a bundle whose
// import.meta.env.DEV was TRUE and PROD was FALSE. Every DEV/PROD guard in
// src/ shipped inverted, which is how demo seed data reached real visitors and
// how the Stripe stub guard in App.jsx (a P0 from the 2026-05-23 audit) came to
// be disarmed in the one build where it mattered.
//
// Nothing about that failure is visible in the build output, so it gets an
// assertion rather than a comment.
function assertProductionEnv() {
  return {
    name: "bundly-assert-production-env",
    apply: "build",
    configResolved(config) {
      if (config.mode === "production" && !config.isProduction) {
        throw new Error(
          "Refusing to build.\n" +
          "  mode is \"production\" but isProduction is false, so the bundle would\n" +
          "  ship with import.meta.env.DEV === true and PROD === false. Every\n" +
          "  DEV/PROD guard in src/ would be inverted: demo seed data would render\n" +
          "  to real visitors, dev diagnostics would log in production, and the\n" +
          "  \"confirm.stub && import.meta.env.PROD\" payment guard in App.jsx would\n" +
          "  be disabled.\n" +
          "  Cause: NODE_ENV is set to something other than \"production\" in a .env\n" +
          "  file Vite loads. Remove NODE_ENV from .env — production hosts should\n" +
          "  set it as a real environment variable instead."
        );
      }
    },
  };
}

export default defineConfig({
  // basicSsl auto-generates a self-signed cert so the dev server runs on
  // https://localhost:3000. Required so Chrome enables credit-card autofill
  // on Stripe Elements (autofill is blocked on plain http even on localhost).
  // First load shows a "not private" warning — click "Advanced → Proceed".
  plugins: [assertProductionEnv(), react(), basicSsl(), expressPlugin()],
  // Production hardening:
  //   - sourcemap:false → no .js.map files exposing original source structure
  //   - drop console/debugger → reverse-engineering harder, smaller bundle
  //   - manualChunks → split vendor code so attackers see less in one file
  build: {
    sourcemap: false,
    minify: "esbuild",
    target: "es2020",
    rollupOptions: {
      output: {
        // Hash filenames so cached files invalidate cleanly per release
        entryFileNames:  "assets/b-[hash].js",
        chunkFileNames:  "assets/c-[hash].js",
        assetFileNames:  "assets/a-[hash][extname]",
        // Code splitting: separate React, Stripe, and Lucide into their own
        // chunks. Each chunk is a separate file — keeps individual files
        // smaller, harder to fingerprint, and improves caching.
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "vendor-react";
          if (id.includes("node_modules/@stripe")) return "vendor-stripe";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
        },
      },
    },
  },
  esbuild: {
    // Strip console.log + console.warn + debugger statements from production
    // bundle. Errors stay so we still get crash reports.
    drop: ["debugger"],
    pure: ["console.log", "console.warn", "console.info", "console.debug", "console.trace"],
  },
  server: {
    port: 3000,
    https: true,
    open: false,
    proxy: {
      // All /api/* calls go to the managed Express backend
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // Serve downloaded product images from Express
      '/product-img': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // Relay for Zap — Express calls http://localhost:3000/zap-proxy/...
      // Vite (on user's machine) forwards to https://www.zap.co.il/
      '/zap-proxy': {
        target: 'https://www.zap.co.il',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/zap-proxy/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'he-IL,he;q=0.9',
          'Referer': 'https://www.zap.co.il/',
        },
      },
      // Relay for DataForSEO
      '/dfs-proxy': {
        target: 'https://api.dataforseo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dfs-proxy/, ''),
      },
    },
  },
})
