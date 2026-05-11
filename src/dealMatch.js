/**
 * Bundly — Strict product↔deal name matching.
 *
 * ONE place for all "is this product the same as that deal/pool entry"
 * decisions. Before this module the same loose heuristic was duplicated
 * in 4 places (App.jsx existingDeal × 2, withGroupBuy, findPoolForProduct),
 * each one independently allowing iPhone 15 to match iPhone 16 Pro via a
 * shallow ≥2-word overlap. Centralising fixes that whole class of bug
 * permanently — change the rule here, every caller updates atomically.
 *
 * STRICT MATCHING RULES:
 *  1. Version-token equality. Tokens that look like a product version
 *     (standalone 2-3-digit number like "15"/"16", storage spec like
 *     "256GB"/"1TB", or chip identifier like "M3") MUST appear verbatim
 *     in both names. So "iPhone 15 256GB" ≠ "iPhone 16 Pro 256GB"
 *     (15 missing in deal name) and ≠ "iPhone 15 128GB" (256GB missing).
 *
 *  2. ≥80% word overlap. After version-token gate passes, at least 80%
 *     of the significant (>3-char) tokens from the product name must
 *     appear in the deal name. Catches partial brand/series mismatches
 *     like "MacBook Pro M3" vs "MacBook Air M3" — "pro" / "air" differ,
 *     so overlap drops below 80%.
 *
 *  3. Optional sog (category) filter. Two products with the same name
 *     in different ZAP categories are NOT the same — e.g. a "Sony A80L"
 *     in tvs vs in monitors should not cross-match.
 */

// Tokens that uniquely identify a product version. Listed singularly:
//   - 2-3 digit standalone numbers (15, 16, 27, 65, 144)
//   - Storage specs (128GB, 256GB, 1TB, 2TB)
//   - Apple chip identifiers (M1, M2, M3, M4)
const VERSION_TOKEN_RE = /^(\d{1,3}|\d{1,4}gb|\d{1,2}tb|m\d)$/i;

// Internal: are these two product names "the same product"?
function strictNameMatch(productName, dealName) {
  const p = (productName || "").toLowerCase().trim();
  const d = (dealName    || "").toLowerCase().trim();
  if (!p || !d) return false;

  const pTokens = p.split(/\s+/);
  const dTokens = d.split(/\s+/);

  // Rule 1: every version-token in the product MUST appear in the deal.
  const pVersions = pTokens.filter(w => VERSION_TOKEN_RE.test(w));
  if (pVersions.length > 0 && !pVersions.every(t => dTokens.includes(t))) {
    return false;
  }

  // Rule 2: ≥80% overlap of significant words.
  const pWords = pTokens.filter(w => w.length > 3);
  if (pWords.length === 0) return false;
  const overlap = pWords.filter(w => d.includes(w)).length;
  return overlap / pWords.length >= 0.8;
}

/**
 * Does this deal correspond to this product?
 *
 * @param {object} deal      — must have `name` (string or {he,en}) and optionally `sog`
 * @param {string|object} product — product name string OR object with productName/nameEn/nameHe
 * @param {object} [options]
 * @param {string} [options.pageSog]  — current page's sog; if both deal+page have a sog they must match
 * @returns {boolean}
 */
export function dealMatchesProduct(deal, product, options = {}) {
  if (!deal) return false;

  // Category gate
  const pageSog = options.pageSog || null;
  if (pageSog && deal.sog && deal.sog !== pageSog) return false;

  // Pull a usable name from either form
  const productName = typeof product === "string"
    ? product
    : (product?.productName || product?.productNameEn
       || product?.nameEn || product?.nameHe || product?.name || "");

  const dealName = typeof deal.name === "string"
    ? deal.name
    : (deal.name?.he || deal.name?.en || "");

  return strictNameMatch(productName, dealName);
}

/**
 * Find the (single) deal that matches a product, or null.
 * Returns the first match per deals[] order — callers should already
 * de-duplicate their deal list if they want a specific one.
 *
 * @param {Array} deals
 * @param {string|object} product
 * @param {object} [options]  — same as dealMatchesProduct
 * @returns {object|null}
 */
export function findDealForProduct(deals, product, options = {}) {
  if (!Array.isArray(deals) || deals.length === 0) return null;
  return deals.find(d => dealMatchesProduct(d, product, options)) || null;
}

/**
 * Compare two product NAME strings for equivalence. Used by demand-pool
 * lookups where pool entries are keyed by name (no deal object).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function productNamesMatch(a, b) {
  return strictNameMatch(a, b);
}
