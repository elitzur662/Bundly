/**
 * Bundly — SMS Service (Twilio)
 * Requires: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in .env
 */
import twilio from "twilio";

// Normalize Israeli phone to E.164 (+972...)
export function normalizePhone(raw = "") {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0"))   return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

function getClient() {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) return null;
  return twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
}

// ── Send OTP ───────────────────────────────────────────────────────
export async function sendOtpSms(phone, code) {
  const client = getClient();
  if (!client) {
    console.warn("[SMS] Twilio not configured — OTP:", code);
    return; // will still be saved to DB; frontend shows it in dev mode
  }
  await client.messages.create({
    body: `קוד האימות שלך ב-Bundly: ${code}\nתקף ל-5 דקות.`,
    from: process.env.TWILIO_FROM,
    to:   normalizePhone(phone),
  });
  console.log(`[SMS] OTP sent to ${phone}`);
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
    console.log(`[SMS] Supplier offer sent to ${phone}`);
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
    console.log(`[SMS] Order ${orderId} status=${status} sent to ${phone}`);
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
