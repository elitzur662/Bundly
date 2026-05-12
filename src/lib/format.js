/**
 * Bundly — String and item formatting helpers (no React, no DOM).
 */

/**
 * Strip RTL/LTR marks, HTML entities, and collapse whitespace from a product
 * name. ZAP/KSP scrapers occasionally inject &rlm; or zero-width markers that
 * survive into the UI and break Hebrew rendering. Always pass user-visible
 * names through this before render.
 */
export function cleanName(s) {
  if (!s || typeof s !== "string") return s || "";
  return s
    .replace(/&rlm;|&lrm;|&amp;rlm;|&amp;lrm;/gi, "")
    .replace(/[‎‏​‌‍‪-‮⁦-⁩﻿]/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Suggestion item normalisation — backwards-compatible with two shapes:
 *   1. plain string (legacy autocomplete API)
 *   2. object { text, isProduct, slug }
 * Use sugText() to render the label, sugIsProduct() to branch on type.
 */
export const sugText = (s) => typeof s === "string" ? s : (s?.text || s?.name || "");
export const sugIsProduct = (s) => s != null && typeof s === "object" && (s.type === "product" || !!s.isProduct);
