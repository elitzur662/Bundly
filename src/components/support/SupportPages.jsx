/**
 * Bundly — Support: FAQ, Contact form, My-Tickets, CSAT.
 *
 * Self-contained module so the giant App.jsx only has to mount one entry
 * point per surface. All five user-facing flows wire up to the same backend
 * dispute/ticket store (see server.js /api/support/*).
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, X, Mail, Phone, MessageCircle, Star, Send, AlertCircle, CheckCircle, Clock } from "lucide-react";

// ── FAQ knowledge base entries ─────────────────────────────────
// Plain Q/A data — keep small + concrete. New items go at the bottom of the
// relevant section so existing anchors / search-rank stay stable.
export const FAQ_SECTIONS = [
  {
    id: "general",
    title: "כללי",
    items: [
      { q: "מה זה Bundly?",
        a: "Bundly היא פלטפורמת קבוצות רכישה — אנחנו מאגדים לקוחות שמעוניינים באותו מוצר, מנהלים מכרז מבוקש מול ספקים, וכל מי שמצטרף נהנה ממחיר נמוך משמעותית. ככל שיותר אנשים מצטרפים, המחיר יורד." },
      { q: "מי יכול להצטרף לקבוצה?",
        a: "כל אזרח ישראלי מעל גיל 18 עם כתובת משלוח בישראל. ההצטרפות מותנית ביצירת חשבון ואימות SMS חד-פעמי." },
      { q: "האם זה חינם?",
        a: "ההרשמה והשימוש באתר חינמיים. אנחנו לוקחים עמלה קטנה מהספק בעסקה שמתבצעת בהצלחה — לא מהלקוח." },
    ],
  },
  {
    id: "joining",
    title: "הצטרפות לקבוצה",
    items: [
      { q: "איך אני מצטרף לקבוצה?",
        a: "בכל דף מוצר תראה כפתור 'הצטרף עכשיו'. תזין פרטי משלוח, תאשר את ההצטרפות עם פיקדון קטן (5%), והקבוצה תעקוב אחר ההתקדמות. כשהקבוצה תסגור — תקבל הודעה לתשלום המלא." },
      { q: "מה זה פיקדון?",
        a: "סכום קטן (5% ממחיר היעד) שמחויב מיידית כדי לסמן רצינות. אם הקבוצה לא נסגרת תוך X ימים — הפיקדון מוחזר אוטומטית. אם הקבוצה כן נסגרת — הוא מקוזז מהתשלום הסופי." },
      { q: "מתי הקבוצה נסגרת?",
        a: "כשמגיעים למספר המינימלי של חברים שהוגדר במכרז, או בתאריך הסגירה — מה שמגיע קודם." },
      { q: "מה קורה אם הקבוצה לא נסגרת?",
        a: "כל פיקדון מוחזר אוטומטית לאמצעי התשלום שלך תוך 3-5 ימי עסקים. תקבל אימייל אישור." },
    ],
  },
  {
    id: "payment",
    title: "תשלום ומשלוח",
    items: [
      { q: "איך משלמים?",
        a: "כל התשלומים מבוצעים בכרטיס אשראי דרך Stripe — המעבד התשלומים הגדול בעולם, עם תקני PCI-DSS מלאים. אנחנו לא רואים את פרטי הכרטיס שלך בשום שלב." },
      { q: "מתי המוצר מגיע?",
        a: "מרגע שהקבוצה נסגרת, הספק מתחיל באריזה ושילוח. בדרך כלל המוצר מגיע תוך 5-10 ימי עסקים, בהתאם לסוג המוצר ולמיקום שלך. תקבל מספר מעקב לאחר השליחה." },
      { q: "האם יש דמי משלוח?",
        a: "ברוב המקרים — לא. דמי המשלוח כלולים במחיר הקבוצתי. אם יש משלוח מיוחד (לאיים, אזורים מרוחקים) — זה יצוין מראש בדף הקבוצה." },
    ],
  },
  {
    id: "returns",
    title: "החזרות והחלפות",
    items: [
      { q: "אפשר להחזיר מוצר?",
        a: "כן — בהתאם לחוק הגנת הצרכן הישראלי, יש לך 14 יום מקבלת המוצר להחזיר אותו ולקבל החזר מלא. המוצר חייב להיות במצב חדש, באריזה המקורית." },
      { q: "המוצר הגיע פגום, מה לעשות?",
        a: "פתח תיק תמיכה דרך 'ההזמנות שלי' תוך 7 ימים מההגעה, או כאן בעמוד 'צור קשר' עם תיאור הבעיה ותמונות. נחזור אליך תוך 24 שעות." },
      { q: "כמה זמן לוקח לקבל את ההחזר?",
        a: "3-7 ימי עסקים מרגע שאישרנו את ההחזרה (לאחר קבלת המוצר חזרה)." },
    ],
  },
  {
    id: "account",
    title: "החשבון שלי",
    items: [
      { q: "איך אני מאפס סיסמה?",
        a: "אין סיסמה — אנחנו משתמשים באימות SMS. הקלד את מספר הטלפון שלך וקבל קוד חד-פעמי." },
      { q: "איך אני משנה כתובת או טלפון?",
        a: "בעמוד הפרופיל (הכפתור עם השם שלך) → ערוך פרטים." },
      { q: "איך אני מוחק את החשבון?",
        a: "שלח לנו פנייה דרך 'צור קשר' עם בקשת מחיקה. הנתונים שלך יימחקו תוך 30 יום בהתאם לחוק הגנת הפרטיות." },
    ],
  },
];

// Flatten + light fuzzy search for the FAQ filter input.
function searchFaq(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return FAQ_SECTIONS;
  return FAQ_SECTIONS.map(sec => ({
    ...sec,
    items: sec.items.filter(it => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q)),
  })).filter(sec => sec.items.length > 0);
}

// ── FAQ page ───────────────────────────────────────────────────
export function FaqPage({ onContact, onBack }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const sections = useMemo(() => searchFaq(query), [query]);
  const toggle = (key) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
  };
  return (
    <div className="max-w-3xl mx-auto px-4 py-8" dir="rtl">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 mb-4">
        <ChevronLeft className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl sm:text-3xl font-black text-gray-900 mb-2">מרכז העזרה</h1>
      <p className="text-gray-600 text-sm mb-6">שאלות נפוצות + מענה אנושי. לא מצאת תשובה? <button onClick={onContact} className="text-indigo-600 font-bold underline-offset-2 hover:underline">צור קשר</button></p>
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="חפש שאלה..."
        className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 mb-6"
      />
      {sections.length === 0 && (
        <div className="bg-gray-50 rounded-2xl p-6 text-center">
          <p className="text-gray-500 text-sm">לא מצאנו תשובה לחיפוש שלך.</p>
          <button onClick={onContact} className="mt-3 inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-xl">
            <MessageCircle className="w-4 h-4" /> פתח פנייה
          </button>
        </div>
      )}
      <div className="space-y-6">
        {sections.map(sec => (
          <section key={sec.id}>
            <h2 className="text-base font-black text-gray-700 mb-2">{sec.title}</h2>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {sec.items.map((it, i) => {
                const key = `${sec.id}-${i}`;
                const open = expanded.has(key);
                return (
                  <div key={key}>
                    <button onClick={() => toggle(key)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/40 transition">
                      <span className="text-sm font-bold text-gray-900 leading-snug">{it.q}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && (
                      <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                        {it.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-10 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl p-5 text-center">
        <p className="text-sm font-bold text-gray-700 mb-2">עדיין צריך עזרה?</p>
        <button onClick={onContact} className="inline-flex items-center gap-1.5 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-sm font-black px-5 py-2.5 rounded-xl shadow-md">
          <MessageCircle className="w-4 h-4" /> שלח פנייה לתמיכה
        </button>
      </div>
    </div>
  );
}

// ── Contact form (general support ticket) ─────────────────────
// Works for both authenticated users (auto-attaches userId) and guests
// (requires contactEmail). On success the user is forwarded to MyTicketsPage.
export function ContactForm({ onClose, onSuccess, isAuthed = false, prefillEmail = "", prefillPhone = "", token = "" }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("normal");
  const [email, setEmail] = useState(prefillEmail);
  const [phone, setPhone] = useState(prefillPhone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const CATEGORIES = [
    { value: "delivery", label: "משלוח / מעקב הזמנה" },
    { value: "billing",  label: "תשלום / חיוב" },
    { value: "product",  label: "בעיה במוצר" },
    { value: "account",  label: "חשבון / כניסה" },
    { value: "other",    label: "אחר" },
  ];
  const PRIORITIES = [
    { value: "low",    label: "לא דחוף",  color: "bg-gray-100 text-gray-700" },
    { value: "normal", label: "רגיל",     color: "bg-indigo-100 text-indigo-700" },
    { value: "high",   label: "חשוב",     color: "bg-amber-100 text-amber-800" },
    { value: "urgent", label: "דחוף מאוד", color: "bg-red-100 text-red-700" },
  ];

  const submit = async () => {
    setError("");
    if (description.trim().length < 5) { setError("צריך לפרט קצת יותר"); return; }
    if (!isAuthed && !email) { setError("צריך לציין אימייל ליצירת קשר"); return; }
    setSubmitting(true);
    try {
      const headers = { "Content-Type": "application/json" };
      if (isAuthed && token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/support/tickets", {
        method: "POST", headers,
        body: JSON.stringify({
          subject, description, category, priority,
          contactEmail: isAuthed ? "" : email,
          contactPhone: isAuthed ? "" : phone,
          type: "general_support",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "שגיאה בשליחה");
      onSuccess?.(data.ticket);
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-3xl p-6 max-w-md w-full max-h-[92vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-gray-900">צור קשר עם התמיכה</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">נחזור אליך בדרך כלל תוך 24 שעות. תיקים דחופים מטופלים תוך 2-6 שעות.</p>

        <label className="block text-[11px] font-bold text-gray-500 mb-1">נושא קצר</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="למשל: לא קיבלתי אישור הזמנה"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300" />

        <label className="block text-[11px] font-bold text-gray-500 mb-1">קטגוריה</label>
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <label className="block text-[11px] font-bold text-gray-500 mb-1">דחיפות</label>
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {PRIORITIES.map(p => (
            <button key={p.value} type="button" onClick={() => setPriority(p.value)}
              className={`text-[11px] font-bold py-1.5 rounded-lg transition ${priority === p.value ? p.color + " ring-2 ring-current/40" : "bg-gray-50 text-gray-400 hover:bg-gray-100"}`}>
              {p.label}
            </button>
          ))}
        </div>

        <label className="block text-[11px] font-bold text-gray-500 mb-1">תיאור מלא *</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="פרט את הבעיה בכמה משפטים..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />

        {!isAuthed && (
          <>
            <label className="block text-[11px] font-bold text-gray-500 mb-1">אימייל ליצירת קשר *</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="example@gmail.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <label className="block text-[11px] font-bold text-gray-500 mb-1">טלפון (אופציונלי)</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="050-0000000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg mb-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-50">ביטול</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2.5 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 text-white font-black rounded-xl text-sm flex items-center justify-center gap-1.5">
            {submitting ? "שולח..." : <><Send className="w-4 h-4" /> שלח פנייה</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── User's tickets page (status, timeline, reply, CSAT) ───────
const STATUS_META = {
  open:           { label: "פתוח",            color: "bg-blue-100 text-blue-700",     icon: Clock },
  in_progress:    { label: "בטיפול",          color: "bg-amber-100 text-amber-700",   icon: Clock },
  awaiting_user:  { label: "ממתין לתגובתך",   color: "bg-violet-100 text-violet-700", icon: AlertCircle },
  resolved:       { label: "נפתר",            color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  rejected:       { label: "נדחה",            color: "bg-gray-100 text-gray-700",     icon: X },
};
const PRIORITY_LABEL = { urgent: "🔴 דחוף מאוד", high: "🟠 חשוב", normal: "⚪ רגיל", low: "⚫ לא דחוף" };

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${meta.color}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
}

function CsatSurvey({ ticketId, token, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (!rating) return;
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/csat`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating, comment }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "שגיאה");
      setDone(true);
      onSubmitted?.();
    } catch (_) {}
  };
  if (done) return <div className="mt-3 text-xs text-emerald-700 font-bold">תודה! קיבלנו את הדירוג שלך 🙏</div>;
  return (
    <div className="mt-3 bg-indigo-50 rounded-xl p-3">
      <p className="text-xs font-black text-gray-700 mb-2">איך היה הטיפול?</p>
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => setRating(n)}
            className={`text-xl ${rating >= n ? "text-amber-400" : "text-gray-300"} hover:scale-110 transition`}>
            <Star className="w-5 h-5" fill={rating >= n ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      <input value={comment} onChange={e => setComment(e.target.value)} placeholder="הערה לצוות (לא חובה)"
        className="w-full text-xs border border-indigo-200 rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      <button onClick={submit} disabled={!rating} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg">
        שלח דירוג
      </button>
    </div>
  );
}

function TicketCard({ ticket, token, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const isClosed = ticket.status === "resolved" || ticket.status === "rejected";

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: reply }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "שגיאה");
      setReply("");
      onRefresh?.();
    } catch (_) {}
    setSending(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-start gap-3 p-4 text-right hover:bg-indigo-50/30 transition">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusPill status={ticket.status} />
            <span className="text-[10px] text-gray-500">#{ticket.id}</span>
            <span className="text-[10px] text-gray-400">{PRIORITY_LABEL[ticket.priority] || ""}</span>
          </div>
          <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-1">
            {ticket.subject || `תיק תמיכה — ${ticket.reason}`}
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            נפתח {new Date(ticket.createdAt).toLocaleDateString("he-IL")} · {messages.length} הודעות
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-gray-100 p-4 bg-gray-50/50">
          <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
            {messages.length === 0 && <p className="text-xs text-gray-400 text-center py-4">אין עדיין הודעות.</p>}
            {messages.map((m, i) => (
              <div key={i} className={`p-3 rounded-xl text-xs ${
                m.role === "admin" ? "bg-indigo-50 border border-indigo-200" :
                m.role === "system" ? "bg-amber-50 border border-amber-200 italic" :
                "bg-white border border-gray-200"
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-gray-700 text-[10px]">
                    {m.role === "admin" ? "👤 תמיכת Bundly" : m.role === "system" ? "⚙️ מערכת" : "אתה"}
                  </span>
                  <span className="text-[9px] text-gray-400">{new Date(m.ts).toLocaleString("he-IL")}</span>
                </div>
                <p className="text-gray-800 whitespace-pre-line">{m.text}</p>
              </div>
            ))}
          </div>
          {ticket.adminNotes && (
            <p className="text-[11px] text-gray-500 italic mb-2">פרטי פתרון: {ticket.adminNotes}</p>
          )}
          {!isClosed ? (
            <div className="flex gap-2">
              <input value={reply} onChange={e => setReply(e.target.value)} placeholder="הוסף הודעה..." onKeyDown={e => e.key === "Enter" && send()}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={send} disabled={sending || !reply.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black px-3 py-2 rounded-lg flex items-center gap-1">
                <Send className="w-3 h-3" /> שלח
              </button>
            </div>
          ) : !ticket.csat ? (
            <CsatSurvey ticketId={ticket.id} token={token} onSubmitted={onRefresh} />
          ) : (
            <p className="text-xs text-gray-500 text-center">דורגת ⭐ {ticket.csat.rating}/5 — תודה!</p>
          )}
        </div>
      )}
    </div>
  );
}

export function MyTicketsPage({ token, onBack, onNewTicket }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchTickets = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/tickets", { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.ok) setTickets(d.tickets || []);
    } catch (_) {}
    setLoading(false);
  };
  useEffect(() => { fetchTickets(); }, []);
  return (
    <div className="max-w-3xl mx-auto px-4 py-8" dir="rtl">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 mb-4">
        <ChevronLeft className="w-4 h-4" /> חזרה
      </button>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black text-gray-900">התיקים שלי</h1>
        <button onClick={onNewTicket} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" /> פתח תיק חדש
        </button>
      </div>
      {loading ? (
        <p className="text-center text-gray-400 py-10">טוען…</p>
      ) : tickets.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center">
          <p className="text-gray-500 text-sm mb-3">אין לך עדיין תיקי תמיכה.</p>
          <button onClick={onNewTicket} className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black px-4 py-2 rounded-xl">
            <MessageCircle className="w-4 h-4" /> פתיחת תיק ראשון
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => <TicketCard key={t.id} ticket={t} token={token} onRefresh={fetchTickets} />)}
        </div>
      )}
    </div>
  );
}
