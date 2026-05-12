/**
 * Bundly — Localise Stripe payment errors to Hebrew.
 *
 * Maps Stripe's English error codes / decline_codes to user-friendly Hebrew
 * sentences. Falls back to pattern-matching common English phrases when the
 * code isn't in the table. Final fallback shows the raw English with a Hebrew
 * prefix — better than a silent failure.
 *
 * Used by DepositModal, OrderConfirmPayment, and any other Stripe-touching
 * UI path.
 */

const STRIPE_ERROR_HE = {
  card_declined:           "הכרטיס נדחה. נסה כרטיס אחר או צור קשר עם הבנק.",
  insufficient_funds:      "אין כיסוי בכרטיס. נסה כרטיס אחר.",
  expired_card:            "תוקף הכרטיס פג. עדכן פרטים או נסה כרטיס אחר.",
  incorrect_cvc:           "ה-CVC שגוי. בדוק את שלוש הספרות בגב הכרטיס.",
  incorrect_number:        "מספר הכרטיס לא תקין.",
  invalid_expiry_month:    "חודש התוקף לא תקין.",
  invalid_expiry_year:     "שנת התוקף לא תקינה.",
  invalid_cvc:             "ה-CVC לא תקין.",
  processing_error:        "תקלה זמנית בעיבוד. נסה שוב בעוד כמה שניות.",
  authentication_required: "הבנק שלך דורש אימות נוסף. בדוק את הסמ\"ס/אפליקציה.",
};

export function localizeStripeError(err) {
  if (!err) return "תשלום נכשל — נסה שוב";
  const code = err.code || err.decline_code;
  if (code && STRIPE_ERROR_HE[code]) return STRIPE_ERROR_HE[code];
  // Fallback: try to match common English text patterns
  const msg = String(err.message || err);
  if (/declined/i.test(msg))           return STRIPE_ERROR_HE.card_declined;
  if (/insufficient/i.test(msg))       return STRIPE_ERROR_HE.insufficient_funds;
  if (/expired/i.test(msg))            return STRIPE_ERROR_HE.expired_card;
  if (/cvc|security code/i.test(msg))  return STRIPE_ERROR_HE.incorrect_cvc;
  if (/number/i.test(msg))             return STRIPE_ERROR_HE.incorrect_number;
  // Last resort — show the original text but with a Hebrew prefix
  return `תשלום נכשל: ${msg.slice(0, 100)}`;
}
