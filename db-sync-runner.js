/**
 * db-sync-runner.js — thin wrapper so server.js can import syncAll()
 * without triggering db-sync.js's CLI main() on import.
 */
import { CATEGORIES, syncCategory } from "./db-sync.js";

export async function syncAll({ force = false, pricesOnly = false, noImages = false, cats } = {}) {
  const slugs = cats ?? Object.keys(CATEGORIES);
  for (const slug of slugs) {
    await syncCategory(slug, { force, pricesOnly, noImages });
    await new Promise(r => setTimeout(r, 1500));
  }
}
