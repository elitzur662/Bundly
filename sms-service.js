/**
 * Bundly — SMS Service (Twilio)
 * Requires: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in .env
 *
 * LAUNCH HARDENING:
 *   - Never print OTPs in production. Dev mode shows a masked preview only.
 *   - Never log full phone numbers — mask the middle digits.
 *   - In production, getClient() returning null is a hard error (caller
 *     decides whether to throw or return failure). The previous "silent
 *     skip" behavior would have let users register without ever receiving
 *     an OTP, leaving accounts stranded.
 */
import twilio from "twilio";

const IS_PROD = process.env.NODE_ENV === "production";

// Normalize Israeli phone to E.164 (+972...)
export function normalizePhone(raw = "") {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0"))   return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

// Mask a phone for log output: +972505551234 → +972505***234
function _maskPhone(phone) {
  const s = String(phone || "");
  if (s.length < 6) return "***";
  return s.slice(0, 6) + "***" + s.slice(-3);
}

function getClient() {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) return null;
  return twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
}

// ── Send OTP ───────────────────────────────────────────────────────
// Returns { ok: true } on success, { ok: false, error } on failure.
// In production, refusing to send means the caller must surface an error
// to the user — never let the OTP step succeed silently when SMS failed.
export async function sendOtpSms(phone, code) {
  const client = getClient();
  if (!client) {
    if (IS_PROD) {
      // Hard fail in production — don't print OTP to logs, don't silently
      // succeed. The /api/auth/send-otp handler relies on this signal to
      // return 503 to the user.
      console.error("[SMS] Twilio not configured in production — OTP send refused");
      return { ok: false, error: "SMS service not configured" };
    }
    // Dev only: log a masked notice (NOT the code) so devs can find the
    // OTP via the in-memory store rather than fishing it out of stdout.
    console.warn(`[SMS] dev mode — OTP for ${_maskPhone(phone)} would be sent (check DB)`);
    return { ok: true, dev: true };
  }
  try {
    await client.messages.create({
      body: `קוד האימות שלך ב-Bundly: ${code}\nתקף ל-5 דקות.`,
      from: process.env.TWILIO_FROM,
      to:   normalizePhone(phone),
    });
    console.log(`[SMS] OTP sent to ${_maskPhone(phone)}`);
    return { ok: true };
  } catch (e) {
    console.warn(`[SMS] OTP send failed for ${_maskPhone(phone)}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── Price Drop SMS ─────────────────────────────────────────────────
export async function sendPriceDropSms(phone, { productName, newPrice }) {
  const client = getClient();
  if (!client || !phone) return;
  await client.messages.create({
    body: `📉 Bundly: ${productName} ירד ל-₪${newPrice.toLocaleString()}! פתח האפליקציה לפרטים.`,
    from: process.env.TWILIO_FROM,
    to:   normalizePhone(phone),
  });
}

// ── Supplier Offer SMS ────────────────────────────────────────────
// Fired when a supplier submits an offer on a customer's personal request.
export async function sendSupplierOfferSms(phone, { productName, offerPrice, supplierName, isCounterOffer, previousLowest }) {
  const client = getClient();
  if (!client || !phone) return;
  const header = isCounterOffer ? "🎯 הצעת נגד חדשה" : "💰 הצעה חדשה";
  const savings = isCounterOffer && previousLowest
    ? ` (חסכון ₪${(previousLowest - offerPrice).toLocaleString()})`
    : "";
  const body = `${header} ב-Bundly\n${productName}\n₪${Number(offerPrice).toLocaleString()}${savings}\nמספק: ${supplierName || "ספק"}\nפתח את האפליקציה להצעה המלאה.`;
  try {
    await client.messages.create({
      body,
      from: process.env.TWILIO_FROM,
      to:   normalizePhone(phone),
    });
    console.log(`[SMS] Supplier offer sent to ${_maskPhone(phone)}`);
  } catch (e) {
    console.warn("[SMS] offer send failed:", e.message);
  }
}

// ── Order Status SMS ──────────────────────────────────────────────
export async function sendOrderStatusSms(phone, { orderId, productName, status, trackingNumber }) {
  const client = getClient();
  if (!client || !phone) return;
  const MSG = {
    confirmed: `✅ Bundly: ההזמנה שלך #${orderId} (${productName}) אושרה ושולמה. הספק מתחיל להכין.`,
    shipped:   `📦 Bundly: ההזמנה #${orderId} נשלחה!${trackingNumber ? ` מעקב: ${trackingNumber}` : ""}`,
    delivered: `🎉 Bundly: ההזמנה #${orderId} הגיעה אליך. פתח את האפליקציה כדי לדרג.`,
    cancelled: `❌ Bundly: ההזמנה #${orderId} בוטלה. החזר כספי תוך 7 ימי עסקים.`,
  };
  const body = MSG[status];
  if (!body) return;
  try {
    await client.messages.create({ body, from: process.env.TWILIO_FROM, to: normalizePhone(phone) });
    console.log(`[SMS] Order ${orderId} status=${status} sent to ${_maskPhone(phone)}`);
  } catch (e) { console.warn("[SMS] order status failed:", e.message); }
}

// ── Deal Activated SMS ─────────────────────────────────────────────
export async function sendDealActivatedSms(phone, { productName, participants }) {
  const client = getClient();
  if (!client || !phone) return;
  await client.messages.create({
    body: `✅ Bundly: הדיל "${productName}" הופעל! ${participants} משתתפים. פתח האפליקציה לפרטים.`,
    from: process.env.TWILIO_FROM,
    to:   normalizePhone(phone),
  });
}
