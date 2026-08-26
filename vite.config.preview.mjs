/**
 * vite.config.preview.mjs — a plain-HTTP twin of vite.config.js, for looking at
 * the UI in a browser.
 *
 * THROWAWAY BY DESIGN. It is not the dev config and must not become it: the real
 * one runs HTTPS on purpose (`basicSsl`), and the Zap and DataForSEO proxies live
 * there. This file exists for one reason — an automated browser cannot click
 * through a self-signed certificate warning, so `npm run dev` shows it a black
 * screen with no console output and every UI check silently passes on nothing.
 *
 * It differs from the real config in exactly three ways:
 *   · no basicSsl, so http rather than https
 *   · port 3010, so it never fights the real dev server on 3000
 *   · Express is started here on 3001 (its standalone default) rather than by
 *     the real config's plugin on 3002, so both can run side by side
 *
 * Everything the page actually fetches is proxied through: /api, /product-img
 * and /product-db. The last one matters — product images resolve to local paths
 * served by `express.static("/product-db")`, so without it the catalogue renders
 * with every image broken and looks like a bug that is not there.
 *
 * NOTE: `node server.js` runs a ProductMem background refresh that rewrites many
 * product-db/<cat>/meta.json and products.json files. That is runtime noise, not
 * a change worth keeping — `git checkout -- product-db/` and remove
 * `.prewarm.lock` when you are done.
 *
 *   npm run dev -- --config vite.config.preview.mjs
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'child_process';

const API_PORT = 3001;

/** Start the Express API on its standalone port and stop it with Vite. */
function apiPlugin() {
  let child = null;
  return {
    name: 'bundly-preview-api',
    configureServer() {
      if (child) return;
      child = spawn(process.execPath, ['server.js'], {
        env: { ...process.env, PORT: String(API_PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      child.stdout.on('data', (b) => process.stdout.write(`[api] ${b}`));
      child.stderr.on('data', (b) => process.stderr.write(`[api] ${b}`));
      const stop = () => { if (child && !child.killed) { try { child.kill(); } catch { /* already gone */ } } };
      process.on('exit', stop);
      process.on('SIGINT', () => { stop(); process.exit(0); });
    },
  };
}

const toApi = { target: `http://localhost:${API_PORT}`, changeOrigin: true };

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 3010,
    https: false,
    open: false,
    proxy: {
      '/api': toApi,
      '/product-img': toApi,
      '/product-db': toApi,
    },
  },
});
