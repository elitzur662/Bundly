#!/usr/bin/env node
/**
 * generate-sitemap.mjs — emits public/sitemap.xml with every static page +
 * one entry per category-tree leaf using the ?q= deep-link pattern the
 * SPA already handles (see App.jsx line ~19718).
 *
 * Run automatically as part of `npm run build` (via the prebuild hook).
 *
 * Why ?q=Hebrew works as a separate indexable URL:
 *   • Google treats distinct query strings as distinct pages by default
 *   • The SPA's URL handler calls openCategory(q) on load → category page
 *   • The Quality Gate ensures empty categories show a branded message
 *     rather than broken cards → Google still has crawlable content
 *
 * Output is alphabetically deterministic so diffs stay clean across runs.
 */

import fs   from "node:fs";
import path from "node:path";
import url  from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const SITE      = "https://bundly.co";
const OUT_PATH  = path.join(ROOT, "public", "sitemap.xml");

// ── Read the category tree directly from its source ───────────────────────
const treeSrc = fs.readFileSync(path.join(ROOT, "src/data/category-tree.js"), "utf8");
const leaves  = new Set();
for (const m of treeSrc.matchAll(/items:\s*\[([^\]]+)\]/g)) {
  for (const q of m[1].matchAll(/"([^"]+)"/g)) leaves.add(q[1]);
}

// ── Static pages (priority, changefreq) ───────────────────────────────────
const STATIC = [
  { path: "/",                      changefreq: "daily",   priority: "1.0" },
  { path: "/accessibility.html",    changefreq: "monthly", priority: "0.5" },
  { path: "/terms.html",            changefreq: "monthly", priority: "0.3" },
  { path: "/privacy.html",          changefreq: "monthly", priority: "0.3" },
  { path: "/return-policy.html",    changefreq: "monthly", priority: "0.3" },
];

// ── Build the URL list ────────────────────────────────────────────────────
const entries = [];
for (const s of STATIC) {
  entries.push({ loc: SITE + s.path, changefreq: s.changefreq, priority: s.priority });
}
// Category leaves — alphabetical for stable diffs
for (const leaf of [...leaves].sort()) {
  entries.push({
    loc:        `${SITE}/?q=${encodeURIComponent(leaf)}`,
    changefreq: "weekly",
    priority:   "0.6",
  });
}

// ── XML output ────────────────────────────────────────────────────────────
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...entries.map(e => [
    "  <url>",
    `    <loc>${e.loc}</loc>`,
    `    <changefreq>${e.changefreq}</changefreq>`,
    `    <priority>${e.priority}</priority>`,
    "  </url>",
  ].join("\n")),
  "</urlset>",
  "",
].join("\n");

fs.writeFileSync(OUT_PATH, xml);
console.log(`✓ Wrote ${OUT_PATH}`);
console.log(`  ${STATIC.length} static pages + ${leaves.size} category leaves = ${entries.length} URLs`);
