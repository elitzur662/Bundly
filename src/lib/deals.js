/**
 * Bundly, Deal pricing, status, and similarity helpers (no React).
 */

/**
 * Generate the tiered pricing ladder from a base market-min price.
 * Each tier needs more participants and gives a deeper discount.
 * The percentages below mirror Bundly's published savings claims.
 */
export function makeTiers(marketMin, entryPrice) {
  const r = Math.round;
  const base = Number(marketMin);
  if (!Number.isFinite(base) || base <= 0) return [];
  // THE FIRST RUNG IS THE PRICE ACTUALLY BEING OFFERED, not a hardcoded 0.97.
  //
  // It used to be r(base * 0.97) while the server hands the card a groupOffer
  // of r(base * 0.95) — two pricing models that never spoke to each other. The
  // card printed ₪2,004 and the ladder underneath it promised "4 more buyers →
  // ₪2,046", i.e. recruit your friends and pay MORE. Every live deal showed it,
  // and the "additional saving" line rendered a negative shekel figure.
  //
  // Anchoring rung 1 to the real entry price makes the ladder describe the same
  // deal the rest of the card describes.
  const entry = Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0 && Number(entryPrice) < base
    ? r(Number(entryPrice))
    : r(base * 0.97);
  const rungs = [
    { people: 5,   price: entry,          label: "כניסה לקבוצה" },
    { people: 10,  price: r(base * 0.91), label: "הנחה ראשונה" },
    { people: 20,  price: r(base * 0.83), label: "מחיר טוב" },
    { people: 40,  price: r(base * 0.74), label: "מחיר מצוין" },
    { people: 75,  price: r(base * 0.63), label: "מחיר סיטונאי" },
  ];
  // Keep the ladder strictly descending. A supplier bid well under the ladder
  // (entry = 0.60 * base, say) would otherwise make rungs 2-4 climb back up.
  const out = [];
  for (const rung of rungs) {
    if (!out.length || rung.price < out[out.length - 1].price) out.push(rung);
  }
  return out;
}

/** Highest tier reached given the current participant count, or null if below tier 1. */
export function activeTier(tiers, participants) {
  let active = null;
  for (const tier of tiers) {
    if (participants >= tier.people) active = tier;
  }
  return active;
}

/**
 * First unmet tier above the current participant count, or null if all unlocked.
 *
 * `currentPrice` is optional but should be passed by anything that renders the
 * result next to a price: a rung is only "next" if it is genuinely CHEAPER than
 * what the customer is being shown right now. Without it the UI can advertise
 * recruiting more buyers in order to reach a higher number, which is what it
 * did on every live deal before makeTiers was anchored to the entry price.
 */
export function nextTier(tiers, participants, currentPrice) {
  const cur = Number(currentPrice);
  const compare = Number.isFinite(cur) && cur > 0;
  return (tiers || []).find(t =>
    participants < t.people && (!compare || t.price < cur)
  ) || null;
}

/**
 * Closing-date-derived deal status.
 *   active   , closingDate in the future
 *   filled   , closed and minParticipants reached
 *   cancelled, closed and minParticipants NOT reached (refunds the deposits)
 */
export function getDealStatus(deal) {
  // A deal with no usable closingDate can never close. Server-persisted deals
  // carried exactly that shape — `closingDate` was written nowhere in server.js
  // or db.js — so `new Date() > new Date(undefined)` compared against Invalid
  // Date, evaluated false, and every deal on the live site sat "active" for
  // three months while still claiming "14 days left". Deals now get a closing
  // date at creation (db.js), and createdAt + daysLeft is the fallback for rows
  // that predate that, so they age out instead of hanging forever.
  const closingMs = dealClosingMs(deal);
  if (closingMs === null) return "active";
  if (Date.now() <= closingMs) return "active";
  if (Number(deal?.participants) >= Number(deal?.minParticipants)) return "filled";
  return "cancelled";
}

/**
 * Milliseconds-since-epoch at which a deal closes, or null when unknowable.
 * Prefers an explicit closingDate, falls back to createdAt + daysLeft.
 */
export function dealClosingMs(deal) {
  const explicit = Date.parse(deal?.closingDate ?? "");
  if (Number.isFinite(explicit)) return explicit;
  const created = Date.parse(deal?.createdAt ?? "");
  const days = Number(deal?.daysLeft);
  if (Number.isFinite(created) && Number.isFinite(days) && days > 0) {
    return created + days * 86400000;
  }
  return null;
}

/** Whole days remaining before a deal closes, or null when unknowable. */
export function dealDaysLeft(deal) {
  const ms = dealClosingMs(deal);
  if (ms === null) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
}

/**
 * Sub-category-aware "you might also like", only deals that share the
 * leading Hebrew noun phrase of the reference deal's name.
 *
 * Was: matched by `catIdx` (top-level), which lumped refrigerators with
 * washing machines and dishwashers under "home appliances". Per user
 * feedback that's too loose, they want fridge↔fridge, not fridge↔TV.
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
  // No Hebrew prefix, fall back to the first Latin word, lower-cased.
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
