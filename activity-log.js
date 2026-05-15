/**
 * Bundly — Activity log + admin notification dispatcher.
 *
 * Every meaningful action on the platform (signup, request, bid, order, etc.)
 * is funnelled through logActivity() which:
 *   1. Appends to an in-memory ring buffer (last RING_SIZE events)
 *   2. Persists periodically to a JSON file on disk (survives restarts)
 *   3. Fires a Telegram message to the admin if a bot is configured
 *
 * Two consumers:
 *   - /api/admin/activity — exposes the buffer to the admin dashboard
 *   - Telegram bot — pushes real-time notifications to the operator's phone
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const ACTIVITY_FILE = path.join(DATA_DIR, "activity-log.json");

const RING_SIZE = 1000;
const SAVE_INTERVAL_MS = 5 * 60 * 1000;

let _log = [];
let _dirty = false;

// ── Persistence ────────────────────────────────────────────────────────────
function loadFromDisk() {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return;
    const raw = fs.readFileSync(ACTIVITY_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      _log = arr.slice(-RING_SIZE);
      console.log(`📜 ActivityLog: loaded ${_log.length} events from disk`);
    }
  } catch (e) {
    console.warn(`[activity-log] load error: ${e.message}`);
  }
}

function saveToDisk() {
  if (!_dirty) return;
  try {
    const tmp = ACTIVITY_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(_log), "utf8");
    fs.renameSync(tmp, ACTIVITY_FILE);
    _dirty = false;
  } catch (e) {
    console.warn(`[activity-log] save error: ${e.message}`);
  }
}

setInterval(saveToDisk, SAVE_INTERVAL_MS).unref?.();
loadFromDisk();

// ── Telegram dispatcher ─────────────────────────────────────────────────────
// User creates bot via @BotFather → token. Starts a chat with bot → chat id
// (from https://api.telegram.org/bot<TOKEN>/getUpdates). Both go in env vars.
// If either is missing, dispatcher is a silent no-op (log only).
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || "";
let _tgWarnedDisabled = false;
let _tgFirstSuccessLogged = false;

// Confirm bot config at startup with a single log line.
if (TG_TOKEN && TG_CHAT_ID) {
  console.log(`📢 ActivityLog: Telegram configured (chat=${TG_CHAT_ID.slice(0,4)}...) — will dispatch events`);
}

export function tgSendMessage(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    if (!_tgWarnedDisabled) {
      console.log("📢 ActivityLog: Telegram not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable)");
      _tgWarnedDisabled = true;
    }
    return;
  }
  // Telegram supports up to 4096 chars per message; truncate to be safe.
  const body = JSON.stringify({
    chat_id: TG_CHAT_ID,
    text: text.slice(0, 4000),
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
  const req = https.request({
    hostname: "api.telegram.org",
    path:     `/bot${TG_TOKEN}/sendMessage`,
    method:   "POST",
    headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout:  10000,
  }, res => {
    // Collect response body so we can surface Telegram API errors (e.g.
    // "chat not found", "Forbidden: bot can't initiate conversation").
    // Without this, only socket-level errors were logged — silent failures
    // when the API itself rejected the message.
    let chunks = "";
    res.on("data", d => { if (chunks.length < 2000) chunks += d.toString(); });
    res.on("end",  () => {
      if (res.statusCode === 200) {
        if (!_tgFirstSuccessLogged) {
          console.log("📢 ActivityLog: Telegram dispatch OK — first message delivered");
          _tgFirstSuccessLogged = true;
        }
        return;
      }
      try {
        const parsed = JSON.parse(chunks);
        console.warn(`[telegram] HTTP ${res.statusCode} ${parsed.error_code || ""}: ${parsed.description || chunks.slice(0,200)}`);
      } catch {
        console.warn(`[telegram] HTTP ${res.statusCode}: ${chunks.slice(0,200)}`);
      }
    });
  });
  req.on("error", e => console.warn(`[telegram] send error: ${e.message}`));
  req.on("timeout", () => req.destroy());
  req.write(body);
  req.end();
}

// ── Event types → emoji + title for Telegram + dashboard ───────────────────
const TYPE_META = {
  supplier_register:   { emoji: "🏷️",  title: "ספק חדש נרשם" },
  customer_register:   { emoji: "👤",  title: "לקוח חדש נרשם" },
  customer_login:      { emoji: "🔓",  title: "לקוח התחבר" },
  personal_request:    { emoji: "📝",  title: "בקשה אישית" },
  supplier_offer:      { emoji: "💰",  title: "הצעה מספק" },
  offer_accepted:      { emoji: "✅",  title: "הצעה התקבלה" },
  offer_rejected:      { emoji: "❌",  title: "הצעה נדחתה" },
  deal_join:           { emoji: "👥",  title: "הצטרפות לסבב" },
  deal_commit:         { emoji: "📝",  title: "הזמנה הוגשה" },
  order_placed:        { emoji: "🛒",  title: "הזמנה נוצרה" },
  order_shipped:       { emoji: "📦",  title: "ספק סימן כנשלח" },
  order_delivered:     { emoji: "✓",   title: "לקוח אישר קבלה" },
  rating_submitted:    { emoji: "⭐",  title: "דירוג ספק" },
  bid_placed:          { emoji: "🔨",  title: "הצעה במכרז" },
  email_conflict:      { emoji: "⚠️",  title: "ניסיון רישום עם אימייל קיים" },
};

// ── Public API ─────────────────────────────────────────────────────────────
export function logActivity(type, details = {}) {
  const meta = TYPE_META[type] || { emoji: "ℹ️", title: type };
  const event = {
    id:      Date.now() + Math.random().toString(36).slice(2, 6),
    type,
    title:   meta.title,
    emoji:   meta.emoji,
    details,
    ts:      Date.now(),
    dateIso: new Date().toISOString(),
  };
  _log.push(event);
  if (_log.length > RING_SIZE) _log = _log.slice(-RING_SIZE);
  _dirty = true;

  // Fire-and-forget Telegram dispatch
  try {
    const lines = [`${meta.emoji} *${meta.title}*`];
    for (const [k, v] of Object.entries(details)) {
      if (v == null || v === "") continue;
      const safeV = String(v).slice(0, 200).replace(/[*_`[\]]/g, "\\$&");
      lines.push(`• ${k}: ${safeV}`);
    }
    lines.push(`_${new Date(event.ts).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}_`);
    tgSendMessage(lines.join("\n"));
  } catch (e) {
    console.warn(`[activity-log] dispatch error: ${e.message}`);
  }

  return event;
}

export function getRecentActivities({ limit = 100, type = null, since = null } = {}) {
  let result = _log.slice();
  if (type) result = result.filter(e => e.type === type);
  if (since) result = result.filter(e => e.ts >= since);
  // Newest first
  result.reverse();
  return result.slice(0, Math.max(1, Math.min(500, limit)));
}

export function getActivityStats() {
  const stats = {};
  for (const e of _log) {
    stats[e.type] = (stats[e.type] || 0) + 1;
  }
  return { total: _log.length, byType: stats };
}

// Flush on shutdown so we don't lose recent events
process.on("beforeExit", () => { saveToDisk(); });
process.on("SIGTERM",    () => { saveToDisk(); });
process.on("SIGINT",     () => { saveToDisk(); });
