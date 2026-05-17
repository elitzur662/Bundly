/**
 * Bundly — Email Service (Nodemailer + Gmail)
 * Requires: EMAIL_USER and EMAIL_PASS (Gmail App Password) in .env
 */
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Google App Password (not your regular password)
  },
});

const BRAND_COLOR = "#4F46E5"; // indigo-600
const BRAND_NAME  = "Bundly";
const BRAND_LOGO  = "🛒";

// SECURITY (audit M-NEW-1): every user-controlled string interpolated into
// our email/invoice HTML MUST go through this helper. Order/product/supplier
// names are attacker-influenced — a supplier registering with a businessName
// of `<a href="https://evil.tld/phish">לחץ לזיכוי</a>` previously got their
// link rendered inside every customer email and every on-disk invoice HTML
// (served at /invoices/:filename under our origin, so cookies are in scope).
// `_esc` covers the 5 HTML-meaningful chars; for URLs use `_safeUrl`.
function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function _safeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  // Only allow absolute http/https URLs in email/invoice context. mailto: is
  // valid but we don't currently need it from user input; tel: same. Reject
  // javascript:/data:/file: outright.
  if (!/^https?:\/\//i.test(s)) return "";
  return _esc(s);
}

function baseTemplate(content) {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; direction: rtl; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: ${BRAND_COLOR}; padding: 28px 32px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 26px; letter-spacing: -0.5px; }
    .header p  { color: #c7d2fe; margin: 4px 0 0; font-size: 13px; }
    .body { padding: 32px; }
    .body h2 { color: #111; font-size: 20px; margin: 0 0 12px; }
    .body p  { color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .highlight { background: #eef2ff; border-right: 4px solid ${BRAND_COLOR}; padding: 14px 18px; border-radius: 8px; margin: 20px 0; }
    .highlight .price { font-size: 28px; font-weight: 900; color: ${BRAND_COLOR}; }
    .btn { display: inline-block; background: ${BRAND_COLOR}; color: #fff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 8px 0; }
    .footer { background: #f9fafb; padding: 20px 32px; text-align: center; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 0; }
    .otp-box { font-size: 38px; font-weight: 900; letter-spacing: 12px; color: ${BRAND_COLOR}; text-align: center; padding: 20px; background: #eef2ff; border-radius: 12px; margin: 20px 0; }
    .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${BRAND_LOGO} ${BRAND_NAME}</h1>
      <p>פלטפורמת הרכישה הקבוצתית הישראלית</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ${BRAND_NAME} — Israel 🇮🇱</p>
      <p style="margin-top:6px">לביטול עדכונים השב "הסר" לכל הודעה</p>
    </div>
  </div>
</body>
</html>`;
}

// ── OTP Email ──────────────────────────────────────────────────────
export async function sendOtpEmail(to, code) {
  if (!process.env.EMAIL_USER) return;
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject: `${code} — קוד האימות שלך ב-${BRAND_NAME}`,
    html: baseTemplate(`
      <h2>קוד האימות שלך</h2>
      <p>הכנס את הקוד הבא כדי לסיים את ההרשמה:</p>
      <div class="otp-box">${code}</div>
      <p style="color:#9ca3af;font-size:13px">הקוד תקף ל-5 דקות. אם לא ביקשת קוד — התעלם מהודעה זו.</p>
    `),
  });
}

// ── Welcome Email ──────────────────────────────────────────────────
export async function sendWelcomeEmail(to, name) {
  if (!process.env.EMAIL_USER || !to) return;
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject: `ברוכים הבאים ל-${BRAND_NAME}! 🎉`,
    html: baseTemplate(`
      <h2>היי ${_esc(name || "")}! ברוכים הבאים 👋</h2>
      <p>שמחים שהצטרפת ל-<strong>Bundly</strong> — המקום שבו קבוצות קונים ביחד וחוסכים ביחד.</p>
      <div class="highlight">
        <p style="margin:0;font-weight:700;color:#3730a3">מה אפשר לעשות עכשיו?</p>
        <ul style="margin:8px 0 0;padding-right:20px;color:#4338ca;font-size:14px;line-height:2">
          <li>🔍 חפש מוצר וקבל את המחיר הכי טוב ברשת</li>
          <li>👥 פתח דיל קבוצתי ותן לאחרים להצטרף</li>
          <li>🔔 קבל התראה ברגע שהמחיר יורד</li>
          <li>💬 שתף עם חברים ב-WhatsApp</li>
        </ul>
      </div>
      <p>כל שאלה — אנחנו כאן 💙</p>
      <p>צוות Bundly</p>
    `),
  });
}

// ── Price Drop Alert ───────────────────────────────────────────────
export async function sendPriceDropEmail(to, { productName, oldPrice, newPrice, link }) {
  if (!process.env.EMAIL_USER || !to) return;
  const saving = oldPrice - newPrice;
  const pct = Math.round((saving / oldPrice) * 100);
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📉 ירידת מחיר! ${_esc(productName)} — עכשיו ₪${newPrice.toLocaleString()}`,
    html: baseTemplate(`
      <h2>📉 ירידת מחיר!</h2>
      <p>המוצר שעקבת אחריו ירד במחיר:</p>
      <div class="highlight">
        <p style="margin:0 0 4px;font-weight:700">${_esc(productName)}</p>
        <p style="margin:0;text-decoration:line-through;color:#9ca3af;font-size:13px">₪${oldPrice.toLocaleString()}</p>
        <p class="price">₪${newPrice.toLocaleString()}</p>
        <span class="badge">חיסכון של ${pct}% — ₪${saving.toLocaleString()}</span>
      </div>
      ${_safeUrl(link) ? `<a class="btn" href="${_safeUrl(link)}">לצפייה בדיל ←</a>` : ""}
    `),
  });
}

// ── Supplier Offer Alert ───────────────────────────────────────────
// Fired when a supplier submits an offer on a customer's personal request.
export async function sendSupplierOfferEmail(to, { productName, offerPrice, supplierName, isCounterOffer, previousLowest, productImage }) {
  if (!process.env.EMAIL_USER || !to) return;
  const savingsBlock = isCounterOffer && previousLowest
    ? `<p style="margin:0;text-decoration:line-through;color:#9ca3af;font-size:13px">₪${previousLowest.toLocaleString()}</p>
       <span class="badge">חיסכון ₪${(previousLowest - offerPrice).toLocaleString()}</span>`
    : "";
  const header = isCounterOffer ? "🎯 הצעת נגד התקבלה" : "💰 הצעה חדשה מספק";
  try {
    await transporter.sendMail({
      from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
      to,
      subject: `${header} — ${_esc(productName)} ₪${Number(offerPrice).toLocaleString()}`,
      html: baseTemplate(`
        <h2>${header}</h2>
        <p>קיבלת הצעת מחיר חדשה על הבקשה ששלחת:</p>
        <div class="highlight">
          ${_safeUrl(productImage) ? `<img src="${_safeUrl(productImage)}" alt="" style="max-width:120px;border-radius:8px;display:block;margin:0 auto 10px"/>` : ""}
          <p style="margin:0 0 4px;font-weight:700">${_esc(productName)}</p>
          ${savingsBlock}
          <p class="price">₪${Number(offerPrice).toLocaleString()}</p>
          <p style="margin:6px 0 0;color:#6b7280;font-size:13px">מספק: <strong>${_esc(supplierName || "ספק")}</strong></p>
        </div>
        <p style="color:#6b7280;font-size:13px">פתח את האפליקציה כדי לאשר או לדחות את ההצעה.</p>
      `),
    });
    console.log(`[Email] Supplier offer sent to ${to}`);
  } catch (e) {
    console.warn("[Email] offer send failed:", e.message);
  }
}

// ── Order Status Notifications ─────────────────────────────────────
export async function sendOrderStatusEmail(to, { orderId, productName, status, trackingNumber }) {
  if (!process.env.EMAIL_USER || !to) return;
  const STATUS_META = {
    confirmed: { emoji: "✅", title: "ההזמנה שלך אושרה!",       body: "קיבלנו את התשלום. הספק מתחיל להכין את ההזמנה." },
    shipped:   { emoji: "📦", title: "ההזמנה שלך נשלחה!",       body: "ההזמנה יצאה לדרך. תוכל/י לעקוב דרך האפליקציה." },
    delivered: { emoji: "🎉", title: "ההזמנה שלך הגיעה!",       body: "מקווים שאת/ה מרוצ/ה! אם משהו לא בסדר, ניתן לפתוח תיק תמיכה." },
    cancelled: { emoji: "❌", title: "ההזמנה שלך בוטלה",         body: "ההזמנה בוטלה. אם שולם — הכסף יוחזר תוך 7 ימי עסקים." },
  };
  const meta = STATUS_META[status] || STATUS_META.confirmed;
  try {
    await transporter.sendMail({
      from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
      to,
      subject: `${meta.emoji} ${meta.title} — הזמנה #${_esc(orderId)}`,
      html: baseTemplate(`
        <h2>${meta.emoji} ${meta.title}</h2>
        <p>${meta.body}</p>
        <div class="highlight">
          <p style="margin:0 0 4px;font-weight:700">${_esc(productName)}</p>
          <p style="margin:0;color:#6b7280;font-size:13px">הזמנה #${_esc(orderId)}</p>
          ${trackingNumber ? `<p style="margin:8px 0 0;font-size:13px">מספר מעקב: <strong>${_esc(trackingNumber)}</strong></p>` : ""}
        </div>
      `),
    });
    console.log(`[Email] Order ${orderId} status=${status} sent to ${to}`);
  } catch (e) { console.warn("[Email] order status failed:", e.message); }
}

// ── KYC approval/rejection notifications ──────────────────────────
export async function sendKycDecisionEmail(to, { businessName, approved, rejectReason }) {
  if (!process.env.EMAIL_USER || !to) return;
  try {
    await transporter.sendMail({
      from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
      to,
      subject: approved ? `✅ החשבון שלך ב-Bundly אושר!` : `⚠️ בקשת ההצטרפות שלך נדחתה`,
      html: baseTemplate(
        approved
          ? `<h2>✅ ברוכים הבאים ל-Bundly!</h2>
             <p>שלום ${_esc(businessName)},</p>
             <p>בקשת ההצטרפות שלך אושרה. החשבון שלך פעיל ואת/ה יכול/ה להתחיל לקבל בקשות מלקוחות.</p>
             <a class="btn" href="https://bundly.co.il/suppliers">היכנס לדשבורד ←</a>`
          : `<h2>⚠️ בקשת ההצטרפות שלך נדחתה</h2>
             <p>שלום ${_esc(businessName)},</p>
             <p>לצערנו, לא הצלחנו לאשר את בקשת ההצטרפות שלך.</p>
             ${rejectReason ? `<div class="highlight"><strong>סיבה:</strong> ${_esc(rejectReason)}</div>` : ""}
             <p>את/ה יכול/ה לפנות אלינו לבירור נוסף.</p>`
      ),
    });
  } catch (e) { console.warn("[Email] KYC decision failed:", e.message); }
}

// ── Dispute resolution notification ────────────────────────────────
export async function sendDisputeResolutionEmail(to, { disputeId, orderId, resolution }) {
  if (!process.env.EMAIL_USER || !to) return;
  const msg = {
    refunded: "קיבלנו את הבקשה שלך והחזר כספי מלא בוצע. הכסף יחזור לאמצעי התשלום תוך 7 ימי עסקים.",
    replaced: "קיבלנו את הבקשה שלך. הספק יחליף לך את המוצר — נעדכן כשהמוצר החדש יצא לדרך.",
    rejected: "לאחר בדיקה, הבקשה שלך נדחתה. אם יש לך שאלות — ניתן ליצור קשר עם התמיכה.",
  };
  try {
    await transporter.sendMail({
      from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
      to,
      subject: `תיק תמיכה #${_esc(disputeId)} — עודכן`,
      html: baseTemplate(`
        <h2>תיק תמיכה ${resolution === "rejected" ? "נסגר" : "נפתר"}</h2>
        <p>${msg[resolution] || "התיק עודכן"}</p>
        <div class="highlight">
          <p style="margin:0;font-weight:700">הזמנה #${_esc(orderId)} · תיק #${_esc(disputeId)}</p>
        </div>
      `),
    });
  } catch (e) { console.warn("[Email] dispute email failed:", e.message); }
}

// ── Deal Activated Alert ───────────────────────────────────────────
export async function sendDealActivatedEmail(to, { productName, price, participants, link }) {
  if (!process.env.EMAIL_USER || !to) return;
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject: `✅ הדיל הופעל! ${_esc(productName)}`,
    html: baseTemplate(`
      <h2>✅ הדיל שלך הופעל!</h2>
      <p>${Number(participants) || 0} משתתפים הצטרפו לדיל — הספקים מתחילים להתחרות!</p>
      <div class="highlight">
        <p style="margin:0;font-weight:700">${_esc(productName)}</p>
        <p class="price">₪${price?.toLocaleString()}</p>
      </div>
      ${_safeUrl(link) ? `<a class="btn" href="${_safeUrl(link)}">לצפייה בדיל ←</a>` : ""}
    `),
  });
}

// Fired when a NEW member joins a deal — emails every existing member so
// they can feel the momentum and stay engaged. Subject + body emphasise
// the rising count and the gap to the next price tier (when known).
export async function sendDealMemberJoinedEmail(to, {
  productName,
  joinerName,        // optional — display "אנונימי" if missing for privacy
  currentCount,
  targetCount,       // min size needed to activate the deal
  link,
}) {
  if (!process.env.EMAIL_USER || !to) return;
  const remaining = targetCount && currentCount < targetCount
    ? Math.max(0, targetCount - currentCount)
    : 0;
  const safeProductName = _esc(productName);
  const subject = remaining > 0
    ? `🎉 עוד משתתף הצטרף — ${currentCount} כבר בסבב של ${productName}`
    : `🔥 הסבב מתמלא! ${currentCount} משתתפים על ${productName}`;
  const progressBar = targetCount
    ? `
      <div style="background:#f3f4f6;border-radius:999px;height:8px;overflow:hidden;margin:14px 0">
        <div style="background:linear-gradient(90deg,#7e22ce,#c084fc);height:8px;width:${Math.min(100, Math.round((currentCount / targetCount) * 100))}%"></div>
      </div>
      <p style="text-align:center;font-size:13px;color:#6b7280;margin:0">
        ${currentCount} / ${targetCount} משתתפים
      </p>`
    : "";
  const cta = remaining > 0
    ? `<p style="font-size:15px;margin-top:14px">עוד <strong>${remaining}</strong> משתתפים ונפעיל מחיר קבוצתי נמוך יותר. שתפו עם חברים — כל מצטרף מקרב את כולם להנחה.</p>`
    : `<p style="font-size:15px;margin-top:14px">הקבוצה כבר מספיק גדולה כדי להפעיל מחיר נמוך — אנחנו ניצור קשר ברגע שהסבב נסגר.</p>`;
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html: baseTemplate(`
      <h2>🎉 ${_esc(joinerName || "משתתף חדש")} הצטרף לסבב</h2>
      <div class="highlight">
        <p style="margin:0;font-weight:700">${safeProductName}</p>
        ${progressBar}
      </div>
      ${cta}
      ${_safeUrl(link) ? `<a class="btn" href="${_safeUrl(link)}">לצפייה בסבב ←</a>` : ""}
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:18px">
        עדכון זה נשלח כי הצטרפת לסבב. ניתן להפסיק עדכונים בכל עת מ"הסבבים שלי" באתר.
      </p>
    `),
  });
}
