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

// BUG FIX (TV-routing convergence): A "model code" is an alphanumeric token
// that mixes letters AND digits and is at least 4 chars long, e.g.
// "QE65Q60D", "UE55U8000F", "OLED65C56LA", "FX607VJB-RL144W", "WW8ST5543AT".
// It is the single most discriminating feature for consumer electronics:
// two TVs of the same brand + size + year are different products iff their
// model codes differ. Previously rule-2's 80% word overlap could merge them
// when the only differing token was the model code itself (e.g. "Samsung
// QE65Q60D" vs "Samsung QE65Q8F" share טלוויזיה+Samsung+4k+65+אינטש = 5 of
// 6 significant words = 83%, above the 80% gate). Treat the model code as
// a HARD identity field, equality required on both sides.
function _extractModelCodes(tokens) {
  return tokens.filter(t => {
    if (t.length < 4) return false;
    if (!/[a-z]/.test(t)) return false;  // must contain a letter
    if (!/\d/.test(t))    return false;  // must contain a digit
    // Drop pure storage/size tokens we already handle as version tokens
    if (VERSION_TOKEN_RE.test(t))    return false;
    return true;
  });
}

// Internal: are these two product names "the same product"?
function strictNameMatch(productName, dealName) {
  const p = (productName || "").toLowerCase().trim();
  const d = (dealName    || "").toLowerCase().trim();
  if (!p || !d) return false;

  const pTokens = p.split(/\s+/);
  const dTokens = d.split(/\s+/);

  // Rule 0: reject single-significant-token product names. A product called
  // just "Samsung" or "Sony" (brand-only, common in scraped product-db
  // entries) would trivially pass the 80% overlap rule against EVERY deal
  // containing that brand, routing every card on a TV listing to the same
  // demo deal. Require at least 2 long tokens before matching, so brand-
  // only entries never link to a deal.
  const pWords = pTokens.filter(w => w.length > 3);
  if (pWords.length < 2) return false;

  // Rule 1: every version-token in the product MUST appear in the deal.
  const pVersions = pTokens.filter(w => VERSION_TOKEN_RE.test(w));
  if (pVersions.length > 0 && !pVersions.every(t => dTokens.includes(t))) {
    return false;
  }

  // BUG FIX (TV-routing convergence): Rule 1.5, model-code identity gate.
  // If either name carries a model code (alphanumeric token mixing letters
  // and digits, e.g. "QE65Q60D"), it MUST appear verbatim in the OTHER
  // name. This is the strongest signal in consumer electronics, two TVs
  // are the SAME product iff their model code is the same, and a different
  // model code means a different product regardless of brand/size overlap.
  // Without this gate, "Samsung QE65Q60D" and "Samsung QE65Q8F" overlap at
  // 83% by significant words (brand + 4k + 65 + אינטש + טלוויזיה + סמסונג)
  // and the previous rule-2 alone (80% threshold) collapsed them into the
  // same deal, which routed every TV click to the first-created TV's deal.
  const pCodes = _extractModelCodes(pTokens);
  const dCodes = _extractModelCodes(dTokens);
  if (pCodes.length > 0 || dCodes.length > 0) {
    // At least one side carries a model code; require exact equality of at
    // least one code on each side. Equality is checked both as full-token
    // (a in dTokens) AND prefix (handles "QE65Q60D" vs "QE65Q60D-2024"),
    // but never via loose substring across unrelated tokens.
    const dCodeSet = new Set(dCodes);
    const pCodeSet = new Set(pCodes);
    const anyShared =
      pCodes.some(pc => dCodeSet.has(pc)) ||
      dCodes.some(dc => pCodeSet.has(dc));
    if (!anyShared) return false;
  }

  // Rule 2: ≥80% overlap of significant words. Tokenised match (a word
  // counts only when it appears as a whole token in the deal name), not
  // substring, so "65" can never count as "found in qe65q60d" and brand
  // tokens never accidentally match a longer compound.
  const dWordSet = new Set(dTokens);
  const overlap = pWords.filter(w => dWordSet.has(w)).length;
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
