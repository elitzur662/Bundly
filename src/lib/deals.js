/**
 * Bundly — Deal pricing, status, and similarity helpers (no React).
 */

/**
 * Generate the tiered pricing ladder from a base market-min price.
 * Each tier needs more participants and gives a deeper discount.
 * The percentages below mirror Bundly's published savings claims.
 */
export function makeTiers(marketMin) {
  const r = Math.round;
  return [
    { people: 5,   price: r(marketMin * 0.97), label: "כניסה לקבוצה" },
    { people: 10,  price: r(marketMin * 0.91), label: "הנחה ראשונה" },
    { people: 20,  price: r(marketMin * 0.83), label: "מחיר טוב" },
    { people: 40,  price: r(marketMin * 0.74), label: "מחיר מצוין" },
    { people: 75,  price: r(marketMin * 0.63), label: "מחיר סיטונאי" },
  ];
}

/** Highest tier reached given the current participant count, or null if below tier 1. */
export function activeTier(tiers, participants) {
  let active = null;
  for (const tier of tiers) {
    if (participants >= tier.people) active = tier;
  }
  return active;
}

/** First unmet tier above the current participant count, or null if all unlocked. */
export function nextTier(tiers, participants) {
  return tiers.find(t => participants < t.people) || null;
}

/**
 * Closing-date-derived deal status.
 *   active    — closingDate in the future
 *   filled    — closed and minParticipants reached
 *   cancelled — closed and minParticipants NOT reached (refunds the deposits)
 */
export function getDealStatus(deal) {
  const closed = new Date() > new Date(deal.closingDate);
  if (!closed) return "active";
  if (deal.participants >= deal.minParticipants) return "filled";
  return "cancelled";
}

/**
 * Sub-category-aware "you might also like" — only deals that share the
 * leading Hebrew noun phrase of the reference deal's name.
 *
 * Was: matched by `catIdx` (top-level), which lumped refrigerators with
 * washing machines and dishwashers under "home appliances". Per user
 * feedback that's too loose — they want fridge↔fridge, not fridge↔TV.
 *
 * `subCategoryKey` pulls the Hebrew prefix before the first Latin or
 * digit character. That's the natural product-type label in our data:
 *   "מקרר Samsung 580L"          → "מקרר"
 *   "מכונת כביסה LG 9 ק"ג"        → "מכונת כביסה"
 *   "טלוויזיה Sony 55\" 4K"       → "טלוויזיה"
 *   "MacBook Pro 16"             → "macbook" (Latin fallback)
 *
 * Catches all brand variants of the same product type without false
 * positives across types.
 */
function subCategoryKey(deal) {
  const raw = deal?.name?.he
    || deal?.name?.en
    || deal?.productName
    || deal?.title
    || "";
  const s = String(raw).trim();
  if (!s) return "";
  // Prefer the leading Hebrew word(s) before any Latin/digit character.
  const heLead = s.match(/^[֐-׿\s'"]+/);
  if (heLead && heLead[0].trim().length >= 2) return heLead[0].trim();
  // No Hebrew prefix — fall back to the first Latin word, lower-cased.
  const latinLead = s.match(/^[A-Za-z][A-Za-z0-9]*/);
  return latinLead ? latinLead[0].toLowerCase() : s.slice(0, 12).toLowerCase();
}

export function getAlternatives(deal, allDeals) {
  const refKey   = subCategoryKey(deal);
  const refPrice = deal.groupOffer || deal.marketMin || 0;
  if (!refKey) return [];
  return allDeals
    .filter(d => d.id !== deal.id && subCategoryKey(d) === refKey)
    .map(d => {
      const dPrice = d.groupOffer || d.marketMin || 0;
      const priceDiff = refPrice > 0 ? Math.abs(dPrice - refPrice) / refPrice : 1;
      // score: 100 = identical price, 0 = 45% away
      const priceScore = Math.max(0, Math.round((1 - priceDiff / 0.45) * 100));
      return { ...d, score: priceScore };
    })
    .filter(d => d.score > 0)           // within ±45% price range, same sub-category
    .sort((a, b) => b.score - a.score)  // closest price first
    .slice(0, 3);
}
