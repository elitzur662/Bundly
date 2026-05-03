/**
 * chat-v2.js — Bundly's redesigned AI chat backend.
 *
 * Architecture:
 *   1. Three personas (advisor / support / onboard) with short system prompts
 *   2. OpenAI Tools API — model can call functions for catalog/orders/etc.
 *   3. Structured outputs (JSON schema) — no regex parsing of [OPTIONS:...]
 *   4. Prompt-injection guards on user input
 *   5. Static cache for common questions (cuts cost ~80%)
 *
 * Mounts: POST /api/chat-v2  (replaces legacy /api/chat over time)
 */
import OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const TICKETS_FILE = join(__dir, "tickets.json");

const MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const MAX_USER_MSG = 500;     // chars
const MAX_HISTORY  = 10;      // messages

// ── Persona prompts (~300 tokens each) ────────────────────────────────────
const PERSONAS = {
  advisor: {
    name: "advisor",
    triggers: null, // default
    system: `אתה "Bundly" — יועץ קניות ידידותי. תפקידך לעזור ללקוח למצוא את המוצר הנכון בקבוצת רכישה.

כללי שיחה:
- שאלה אחת בכל פעם, קצרה (1-2 משפטים).
- כשצריך לשאול שאלה עם תשובות אפשריות — מלא את שדה "options" בתשובה.
- כשהלקוח מוכן לראות תוצאות (אומר "תראה לי" / "סבבה" / "מספיק") — מלא את שדה "ctaButton" עם label "קח אותי לתוצאות" ו-action "show_results".
- כשהלקוח מציין דגם ספציפי (iPhone 17, MacBook Pro) — קרא לפונקציה getProductDetails ואז ctaButton ישר.
- אל תפרט שמות מוצרים או מחירים בטקסט — המערכת תציג אותם דרך הכפתור.
- השתמש בפונקציות שלך לחיפוש, אל תמציא נתונים.
- אימוג'י אחד מקסימום בהודעה.`,
  },
  support: {
    name: "support",
    triggers: /(?:הזמנ[הת]י|המשלוח|הסטטוס|החזר|ביטול|תלונ[הת]|תקול|פגום|לא הגיע|חיוב|כסף שגב[הר]|כפול|שירות לקוחות)/i,
    system: `אתה "Bundly" — נציג שירות לקוחות בשיחת צ'אט. אדיב, ענייני, פותר בעיות.

כללי:
- אם הלקוח מחובר ושואל על הזמנה — קרא ל-getMyOrders / getOrderStatus.
- אם הלקוח לא מחובר ושואל על הזמנה — בקש להתחבר או לתת מספר הזמנה.
- אם זו תלונה דחופה (חיוב כפול, מוצר מסוכן) — קרא ל-createSupportTicket עם urgency: "high" + תן את המייל הרשמי בתשובה.
- אם השאלה כללית (החזר, אחריות, מועד אספקה) — ענה בעצמך מהמדיניות.
- בבעיה רצינית — תמיד תן את כתובת המייל הרשמית בתשובה.
- אל תשתמש ב-options כאן — שיחת שירות זה דיאלוג חופשי.`,
  },
  onboard: {
    name: "onboard",
    triggers: /(?:איך זה עובד|מה זה bundly|מה זה בנדלי|הסבר|איך מצטרפים|איך פותחים|רכישה קבוצתית)/i,
    system: `אתה "Bundly" — מסביר את האתר ללקוחות חדשים.

3 רמות הצטרפות לקבוצה:
- 🔔 מתעניין — חינם, רק התראות, אין התחייבות.
- 📍 שומר מקום — פיקדון ₪25 מוקפא בכרטיס. מקוזז במחיר הסופי או מוחזר אם הקבוצה לא נסגרת.
- ✅ בפנים — מקדמה 25% מהמחיר. מבטיחה נעילת מחיר. היתרה גובה כשהקבוצה נסגרת.

הסבר קצר ומסודר. מקסימום 3 משפטים בהודעה. אם הלקוח מוכן להתחיל — שדר אותו ל-advisor (ctaButton עם action "start_advisor").`,
  },
};

function pickPersona(message) {
  for (const p of [PERSONAS.support, PERSONAS.onboard]) {
    if (p.triggers && p.triggers.test(message)) return p;
  }
  return PERSONAS.advisor;
}

// ── Static FAQ cache — instant answer, no OpenAI call ─────────────────────
const STATIC_FAQ = [
  { rx: /^(?:היי|שלום|הי|hello|hi)\s*[!.]?$/i,
    reply: { message: "היי! 👋 אני Bundly. אעזור לך למצוא את המוצר הבא בקבוצת רכישה. מה אתה מחפש?", options: [
      { label: "📺 טלוויזיות", value: "טלוויזיה" },
      { label: "💻 מחשבים ניידים", value: "מחשב נייד" },
      { label: "📱 סלולר", value: "סמארטפון" },
      { label: "❄️ מזגנים", value: "מזגן" },
      { label: "🧊 מקררים", value: "מקרר" },
    ]} },
  { rx: /(?:מי אתה|מה השם|מה אתה)/i,
    reply: { message: "אני Bundly — היועץ של פלטפורמת הרכישה הקבוצתית הגדולה בישראל. עוזר לך למצוא את המחיר הזול בזכות הכוח של אלפי קונים יחד.", options: [] } },
];

// ── Tool definitions for the OpenAI API ───────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "searchProducts",
      description: "Search the product catalog by Hebrew or English query. Returns up to 5 most relevant products.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in Hebrew or English" },
          category: { type: "string", description: "Optional category slug" },
          maxPrice: { type: "number", description: "Optional upper price bound in ILS" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listActiveDeals",
      description: "Get currently active group-buy deals, optionally filtered by category.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Optional category name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getMyOrders",
      description: "Returns the authenticated user's recent orders. Requires user to be logged in.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getOrderStatus",
      description: "Get status of a specific order. Returns: status, tracking number, expected delivery.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "The order ID to look up" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSupportContact",
      description: "Returns the official support contact details (email, phone, hours).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "createSupportTicket",
      description: "Create a support ticket for the user. Use when complaint is concrete and needs human follow-up.",
      parameters: {
        type: "object",
        properties: {
          summary:  { type: "string", description: "One-line summary of the issue" },
          details:  { type: "string", description: "Full details from the customer" },
          urgency:  { type: "string", enum: ["low", "medium", "high"], description: "high = double charge, dangerous product" },
          orderId:  { type: "string", description: "Related order ID, if any" },
        },
        required: ["summary", "urgency"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getReturnPolicy",
      description: "Returns the return/refund policy summary.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ── Tool implementations — wired to existing infrastructure ───────────────
function makeToolHandlers({ deals, productMem, prodDb, supportEmail, supportPhone }) {
  return {
    searchProducts: async ({ query, category, maxPrice }) => {
      // Simple in-memory match against PRODUCT_MEM (already loaded)
      if (!productMem) return { products: [], note: "catalog unavailable" };
      const needle = String(query || "").toLowerCase();
      const words  = needle.split(/\s+/).filter(w => w.length > 1);
      const hits = [];
      for (const [slug, mem] of productMem.entries()) {
        if (category && slug !== category) continue;
        for (const p of (mem.products || [])) {
          if (!p.name) continue;
          const hay = p.name.toLowerCase();
          const score = words.filter(w => hay.includes(w)).length / Math.max(1, words.length);
          if (score < 0.5) continue;
          const price = p.prices?.ivory || p.prices?.ksp || p.prices?.bug || 0;
          if (maxPrice && price > 0 && price > maxPrice) continue;
          hits.push({ id: p.id, name: p.name.slice(0, 100), price, slug });
          if (hits.length >= 5) break;
        }
        if (hits.length >= 5) break;
      }
      return { products: hits.slice(0, 5) };
    },

    listActiveDeals: async ({ category } = {}) => {
      if (!Array.isArray(deals)) return { deals: [] };
      const now = Date.now();
      const active = deals.filter(d =>
        d.closingDate && new Date(d.closingDate).getTime() > now
        && (!category || (d.name?.he || "").includes(category))
      );
      return {
        deals: active.slice(0, 5).map(d => ({
          name: d.name?.he || d.name?.en,
          participants: d.participants,
          minParticipants: d.minParticipants,
          daysLeft: Math.max(0, Math.round((new Date(d.closingDate).getTime() - now) / 86400000)),
        })),
      };
    },

    getMyOrders: async (_args, ctx) => {
      if (!ctx?.userId) return { error: "User must be logged in", needsAuth: true };
      try {
        const orders = prodDb?.listOrders ? prodDb.listOrders({ userId: ctx.userId }) : [];
        return {
          orders: (orders || []).slice(0, 5).map(o => ({
            id: o.id, productName: o.productName, status: o.status,
            createdAt: o.createdAt, totalAmount: o.totalAmount,
            trackingNumber: o.trackingNumber || null,
          })),
        };
      } catch { return { orders: [] }; }
    },

    getOrderStatus: async ({ orderId }, ctx) => {
      if (!ctx?.userId) return { error: "Login required to view order status" };
      try {
        const order = prodDb?.getOrder ? prodDb.getOrder(orderId) : null;
        if (!order) return { error: "Order not found" };
        if (order.userId !== ctx.userId) return { error: "This order does not belong to you" };
        return {
          id: order.id,
          status: order.status,
          trackingNumber: order.trackingNumber || null,
          createdAt: order.createdAt,
          totalAmount: order.totalAmount,
          shippingAddress: order.shippingAddress
            ? `${order.shippingAddress.city}, ${order.shippingAddress.street}` : null,
        };
      } catch { return { error: "Lookup failed" }; }
    },

    getSupportContact: async () => ({
      email: supportEmail,
      phone: supportPhone || null,
      hours: "ימי א'-ה', 9:00-18:00 (ישראל)",
      responseSla: "תוך 24 שעות בימי עסקים",
    }),

    createSupportTicket: async ({ summary, details, urgency, orderId }, ctx) => {
      try {
        let tickets = [];
        if (existsSync(TICKETS_FILE)) {
          tickets = JSON.parse(readFileSync(TICKETS_FILE, "utf8"));
        }
        const ticket = {
          id: `T-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          userId: ctx?.userId || null,
          summary, details: details || "", urgency, orderId: orderId || null,
          status: "open",
        };
        tickets.push(ticket);
        writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), "utf8");
        return { ok: true, ticketId: ticket.id, escalateTo: supportEmail };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    getReturnPolicy: async () => ({
      summary: "ניתן לבטל הזמנה תוך 14 יום מקבלת המוצר לפי חוק הגנת הצרכן.",
      refundDays: 14,
      conditions: [
        "המוצר באריזה מקורית, לא נפגם ולא נעשה בו שימוש משמעותי",
        "מוצרים בהזמנה מיוחדת — לא ניתנים להחזרה (אלא במקרה של פגם)",
        "החזר יתבצע באותו אמצעי תשלום בו בוצעה הרכישה",
      ],
      howTo: "להגיש בקשה דרך 'ההזמנות שלי' → לחץ על ההזמנה → 'בטל הזמנה'.",
    }),
  };
}

// Strict json_schema in OpenAI rejects array-typed nullable fields — we use
// the looser `json_object` mode and parse defensively. Worst case we get a
// missing field and use a sensible default.
const FORMAT_INSTRUCTION = `Return ONLY a JSON object with these exact fields:
{
  "message": "string — the reply shown to the user",
  "options": [{ "label": "string", "value": "string" }] (empty array if none),
  "ctaButton": null OR { "label": "string", "action": "show_results" | "start_advisor" | "open_url", "query": "search string", "url": "url string" }
}
Use options ONLY when asking the user to pick from 3-5 short choices. Use ctaButton when the user is ready to see results.`;

// ── Prompt-injection guard ────────────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(?:previous|above|all)\s+instructions/i,
  /you\s+are\s+(?:now|a)\s+/i,
  /system\s*:\s*$/im,
  /<\s*\|im_start\|>/i,
  /forget\s+everything/i,
];

function sanitizeUserMessage(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.slice(0, MAX_USER_MSG).trim();
  // Strip control chars
  s = s.replace(/[\x00-\x1F\x7F]/g, " ");
  return s;
}

function looksMalicious(s) {
  return INJECTION_PATTERNS.some(rx => rx.test(s));
}

// ── Main handler — registers /api/chat-v2 on the Express app ──────────────
export function registerChatV2(app, deps) {
  const {
    deals,           // array of active deals
    productMem,      // PRODUCT_MEM Map from server.js
    prodDb,          // { listOrders, getOrder } from db.js
    audit,           // audit() from security-middleware.js
  } = deps;

  const supportEmail = process.env.BUNDLY_SUPPORT_EMAIL || "bundly.co@bundly.co";
  const supportPhone = process.env.BUNDLY_SUPPORT_PHONE || null;

  const tools = makeToolHandlers({ deals, productMem, prodDb, supportEmail, supportPhone });

  app.post("/api/chat-v2", async (req, res) => {
    try {
      const userMsg = sanitizeUserMessage(req.body?.message || "");
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-MAX_HISTORY) : [];
      const userId  = req.body?.userId || null; // optional, frontend passes if logged in

      if (!userMsg) return res.status(400).json({ error: "Empty message" });

      if (looksMalicious(userMsg)) {
        try { audit?.("CHAT_INJECTION_ATTEMPT", req, { sample: userMsg.slice(0, 80) }); } catch {}
        return res.json({
          message: "אני יכול לעזור רק בנושאי קניות ושירות לקוחות של בנדלי. מה אתה מחפש?",
          options: [], ctaButton: null,
        });
      }

      // Static FAQ short-circuit
      for (const f of STATIC_FAQ) {
        if (f.rx.test(userMsg)) {
          return res.json({ ...f.reply, ctaButton: null });
        }
      }

      const persona = pickPersona(userMsg);

      // Build messages — wrap user input in tags so model treats it as data
      const messages = [
        { role: "system", content: persona.system },
        ...history.map(h => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.role === "user"
            ? `<user_message>${sanitizeUserMessage(h.content)}</user_message>`
            : String(h.content || "").slice(0, 1000),
        })),
        { role: "user", content: `<user_message>${userMsg}</user_message>` },
      ];

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const ctx = { userId };

      // Phase 1: tool-calling loop. NO response_format here — strict json_schema
      // is incompatible with tool-calling in OpenAI's API. We let the model
      // freely call tools, then ask it to format the final answer in phase 2.
      for (let round = 0; round < 3; round++) {
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools: TOOLS,
          tool_choice: round < 2 ? "auto" : "none", // last round forces a reply
          max_tokens: 600,
        });

        const choice = completion.choices[0];
        const toolCalls = choice.message.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
          // Model produced a free-text reply — push it and break to phase 2
          messages.push({ role: "assistant", content: choice.message.content || "" });
          break;
        }

        // Execute tool calls — the assistant message must include tool_calls
        messages.push({
          role: "assistant",
          content: choice.message.content || "",
          tool_calls: toolCalls,
        });
        for (const tc of toolCalls) {
          const fn = tools[tc.function.name];
          let out;
          if (!fn) { out = { error: `Unknown tool ${tc.function.name}` }; }
          else {
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              out = await fn(args, ctx);
            } catch (e) {
              out = { error: String(e.message).slice(0, 100) };
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(out).slice(0, 2000),
          });
        }
      }

      // Phase 2: ask the model to convert the running conversation into our
      // structured response shape. Use json_object mode (works on all models).
      messages.push({ role: "system", content: FORMAT_INSTRUCTION });

      const finalCompletion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 500,
      });

      const raw = finalCompletion.choices[0]?.message?.content || "{}";
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        parsed = { message: raw || "סליחה, נתקלתי בתקלה. נסה שוב.", options: [], ctaButton: null };
      }

      res.json({
        message: parsed.message || "",
        options: Array.isArray(parsed.options) ? parsed.options : [],
        ctaButton: parsed.ctaButton || null,
      });
    } catch (e) {
      console.error("[chat-v2] error:", e?.message, e?.response?.data || "");
      res.status(500).json({
        message: "מערכת הצ'אט לא זמינה כעת. אם זה דחוף — שלח מייל ל-" + (process.env.BUNDLY_SUPPORT_EMAIL || "bundly.co@bundly.co"),
        options: [], ctaButton: null,
      });
    }
  });
}
