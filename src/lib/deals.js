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
 * Category-aware "you might also like" — same catIdx, within ±45% price.
 * Ranked by price closeness so accessories don't get suggested next to a TV.
 * Returns top 3.
 */
export function getAlternatives(deal, allDeals) {
  const refPrice = deal.groupOffer || deal.marketMin || 0;
  return allDeals
    .filter(d => d.id !== deal.id && d.catIdx === deal.catIdx)
    .map(d => {
      const dPrice = d.groupOffer || d.marketMin || 0;
      const priceDiff = refPrice > 0 ? Math.abs(dPrice - refPrice) / refPrice : 1;
      // score: 100 = identical price, 0 = 45% away
      const priceScore = Math.max(0, Math.round((1 - priceDiff / 0.45) * 100));
      return { ...d, score: priceScore };
    })
    .filter(d => d.score > 0)           // within ±45% price range, same category
    .sort((a, b) => b.score - a.score)  // closest price first
    .slice(0, 3);
}
