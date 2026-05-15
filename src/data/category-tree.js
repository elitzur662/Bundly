/**
 * Bundly — Mobile category browser tree + per-category variant chips.
 *
 * CATEGORY_TREE — Hierarchical category structure for the mobile 'חפש'
 *                 browser. 7 top-level cards (electronics, computers,
 *                 bikes, beauty, sport, home, car), each with subcategories
 *                 and a flat 'items' list rendered as tappable tiles. The
 *                 same item list (flattened, ~230 entries) is mirrored on
 *                 the server in server.js#CATEGORY_TREE_ITEMS for the
 *                 prewarm queue.
 *
 * CATEGORY_VARIANT_CHIPS — Variant chips shown at the top of category
 *                          results when the category has clear sub-types
 *                          (e.g. refrigerators have 'מקפיא תחתון',
 *                          'דלת ליד דלת', etc.). Clicking a chip re-routes
 *                          the search with a more specific query string.
 */

// ─────────────────────────────────────────────────────────────────
//  CATEGORY TREE DATA (from Zap.co.il + Israeli shopping sites)
// ─────────────────────────────────────────────────────────────────
// Pruned 2026-05-15 — was 232 leaves across 7 tops + 26 subs. Audit
// (audit-categories.mjs) joined the category cache + price cache and
// flagged what's broken / missing. Strategy revision: instead of
// deleting every empty leaf, keep all mainstream consumer-electronics
// leaves (people buy these often) — the empty ones will be filled by
// the next pre-warm or a targeted refresh. We only DROP categories
// where the underlying source (ZAP) is structurally broken:
//   • Bicycles  — ZAP's bike catalogue is mostly brand-only stubs,
//                 no model-page prices. Specialty bike retailers would
//                 be needed for real coverage. Not in scope.
//   • Cars      — ZAP automotive coverage is sparse. Better via
//                 dedicated automotive retailers.
//   • Gardening — niche power equipment, low buy-frequency.
//   • Inside-tree: dropped non-electric items (gym benches, sit-up
//     racks), photography "sleds" typo, and "games" leaves under
//     consoles (ZAP doesn't sell video games as a category).
//
// Empty/sparse leaves kept in the tree are listed in
// docs/categories-needing-refresh.md so the next prewarm/scrape pass
// can target them. The front-end Quality Gate + branded empty-state
// message ensures users never see broken rows in the meantime.
export const CATEGORY_TREE = [
  {
    id: "electronics", name: "חשמל ואלקטרוניקה", icon: "⚡", color: "from-amber-400 to-orange-500", bg: "bg-amber-50", border: "border-amber-200",
    sub: [
      { name: "מטבח וחשמל ביתי", icon: "🍳", items: ["מקררים","מקפיאים","מדיחי כלים","תנורי אפייה","כיריים","קולטי אדים","מיקרוגלים","טוסטרים","בלנדרים","מיקסרים","מעבדי מזון","מכונות קפה","קומקומים ומיחמים","מסחטות","מתקני מים","סירי בישול וטיגון","פלטות חשמליות"] },
      // רובוטי ניקיון moved here from the dropped "בית חכם" sub — natural fit
      // alongside vacuums, and it was the strongest leaf in the smart-home set.
      { name: "ניקיון וכביסה", icon: "🧹", items: ["שואבי אבק","רובוטי ניקיון","מכונות כביסה","מייבשי כביסה","ערכות ניקוי בקיטור","מגהצים","מכונות שטיפה וטאטוא"] },
      { name: "טלוויזיות ושמע", icon: "📺", items: ["טלויזיות","אוזניות","סאונד בר","רמקולים ניידים","מקרנים","סטרימרים","רמקולים","מיקרופונים","קולנוע ביתי","מציאות מדומה"] },
      // Dropped: "משחקי PS5", "משחקי Nintendo" — ZAP doesn't cover
      // video-game titles as a category (only hardware).
      { name: "קונסולות משחק", icon: "🎮", items: ["PS5","PS4","Nintendo Switch","Xbox Series X","Xbox Series S","ג'ויסטיקים ואביזרי משחק"] },
      { name: "חימום וקירור", icon: "❄️", items: ["מזגנים","מאווררים","מפזרי חום","תנורי חשמל","מטהרי אוויר","מכשירי לחות"] },
      // Dropped: "מזחלות" (sled/luggage typo — wasn't a photography item).
      { name: "צילום", icon: "📷", items: ["מצלמות מירורלס","מצלמות DSLR","מצלמות אקסטרים","מצלמות קומפקטיות","עדשות","חצובות","תיקי מצלמה","מצלמות אבטחה","מזל\"טים"] },
      { name: "תקשורת וסלולר", icon: "📱", items: ["סמארטפונים","טלפונים סלולריים בסיסיים","שעונים חכמים","אביזרי סלולר","מטענים","מעמדים לסלולר"] },
    ]
  },
  {
    id: "computers", name: "מחשבים ותוכנות", icon: "💻", color: "from-blue-500 to-indigo-600", bg: "bg-blue-50", border: "border-blue-200",
    sub: [
      { name: "מחשבים ניידים", icon: "💻", items: ["מחשבים ניידים","מחשבים ניידים לגיימינג","MacBook Air","MacBook Pro","Chromebook","מחשבים ניידים לעסקים"] },
      { name: "מחשבים נייחים", icon: "🖥️", items: ["מחשבים נייחים","מחשבי All-in-One","Mac Mini","iMac","מחשבי גיימינג","שרתים","מחשבי מיני"] },
      { name: "טאבלטים", icon: "📱", items: ["iPad Pro","iPad Air","iPad","Samsung Galaxy Tab","Lenovo Tab","טאבלטים לילדים"] },
      // No drilldown — filter chips on the results page handle screen-size /
      // resolution / refresh-rate / panel.
      { name: "מסכי מחשב", icon: "🖥️", items: ["מסכי מחשב"] },
      { name: "חומרה ורכיבים", icon: "🔧", items: ["כרטיסי מסך","מעבדים","לוחות אם","זיכרון RAM","כוננים SSD","ספקי כוח","מארזי מחשב","מאווררים וקירור"] },
      { name: "ציוד היקפי", icon: "⌨️", items: ["מקלדות","עכברים","מדפסות","סורקים","מצלמות רשת","רמקולים למחשב","אוזניות גיימינג","כסאות גיימינג","שולחנות גיימינג"] },
      { name: "רשתות ואחסון", icon: "🌐", items: ["ראוטרים","מגדילי טווח WiFi","מתגי רשת","כוננים קשיחים","זיכרונות USB","כרטיסי זיכרון","NAS שרתי אחסון","כוננים חיצוניים"] },
    ]
  },
  {
    id: "beauty", name: "טיפוח ויופי", icon: "💄", color: "from-pink-400 to-rose-500", bg: "bg-pink-50", border: "border-pink-200",
    sub: [
      // Note: many of these are currently no-cache and rely on the next
      // pre-warm cycle for content. Keep them — beauty appliances are a
      // very common consumer purchase and the sogs are valid.
      { name: "שיער", icon: "💇", items: ["מייבשי שיער","מחליקי שיער","תלתלנים חשמליים","מסרקים חשמליים","מכשירי קרליות","מברשות מסלסלות","מייבשי נסיעה"] },
      { name: "הסרת שיער", icon: "✨", items: ["אפילטורים חשמליים","מכשירי IPL ביתי","מכשירי לייזר ביתי","מכשירי הסרת שיער","מכשירי שעווה חשמלית"] },
      { name: "גילוח", icon: "🪒", items: ["מכשירי גילוח חשמליים לגברים","מכשירי גילוח לנשים","מגזמי זקן","מכשירי גילוח פנים לנשים","מגזמי שיער ביתיים"] },
      { name: "טיפוח פנים", icon: "🧖", items: ["מכשירי ניקוי פנים חשמליים","מכשירי RF ביתי","מסכות LED לפנים","מכשירי אולטרסאונד לפנים","מכשירי מיקרוקרנט","מכשירי ניקוי פנים סוניק"] },
      { name: "עיסוי ורלקסציה", icon: "💆", items: ["מכשירי עיסוי חשמליים","אקדחי עיסוי (Massage Gun)","מוצרי עיסוי לרגליים","כרית עיסוי","חגורות עיסוי"] },
    ]
  },
  {
    id: "sport", name: "פנאי וספורט", icon: "🏃", color: "from-orange-400 to-red-500", bg: "bg-orange-50", border: "border-orange-200",
    sub: [
      // Dropped: "ספסלי כושר", "מכשירי כפיפות ישיבה" — not electric/electronic
      // products, mis-categorized in the original tree.
      { name: "ציוד כושר חשמלי", icon: "🏋️", items: ["הליכונים חשמליים","אופניים נייחים חשמליים","אליפטיקל","מכשירי חתירה"] },
      { name: "ניידות חשמלית", icon: "🛴", items: ["קורקינטים חשמליים","קלנועיות","מונופד חשמלי","Hoverboard","סגוויי"] },
      { name: "בריאות ורפואה", icon: "🩺", items: ["מדי לחץ דם","מד חמצן (Pulse Oximeter)","נבולייזרים","מכשירי TENS לשיכוך כאבים","מד חום חשמלי","מכשירי EMS","שמיכות חשמליות"] },
    ]
  },
  {
    id: "home", name: "בית וגן", icon: "🏠", color: "from-lime-500 to-green-600", bg: "bg-lime-50", border: "border-lime-200",
    sub: [
      // Dropped sub: "גינון חשמלי" — niche, low buy-frequency for our
      // electronics-focused audience. Power tools kept (DIYers buy these).
      { name: "כלי עבודה חשמליים", icon: "🔧", items: ["מברגות חשמליות","מקדחות חשמליות","מסורי דיסק","מסורי ג'יגסאו","מטחנות זווית","מכשירי שיוף","נעצות חשמליות","מפוחים חשמליים"] },
      // Note: smart-vacuums (רובוטי ניקיון) moved to ניקיון וכביסה sub above —
      // not duplicated here.
      { name: "בית חכם", icon: "💡", items: ["נורות LED חכמות","שקעים חכמים","מצלמות אבטחה","פעמוני דלת חכמים (Video Doorbell)","בקרי תאורה חכמים","מנעולים חכמים","חיישני תנועה"] },
    ]
  },
  // Dropped tops: "אופניים ואביזרים" (ZAP bicycle catalog is brand-only
  // stubs — needs specialty retailer integration to be useful) and
  // "רכב ואביזרים" (ZAP automotive coverage is sparse).
];

// ── Category → variant chips map. Same content that used to live in
//    ITEM_VARIANTS, but rendered as a horizontal chip row at the top of
//    CategoryResultsPage. Clicking a chip re-routes the search via
//    onReSearch(variant.query) so the user lands on a refined result set.
export const CATEGORY_VARIANT_CHIPS = {
  "מקררים": {
    title: "איזה סוג מקרר?",
    variants: [
      { label: "מקפיא תחתון",          query: "מקרר מקפיא תחתון",  icon: "🧊", desc: "הכי נוח לשימוש יומיומי" },
      { label: "מקפיא עליון",          query: "מקרר מקפיא עליון",  icon: "❄️", desc: "חסכוני וקלאסי" },
      { label: "דלת ליד דלת",           query: "מקרר סייד ביי סייד", icon: "🚪", desc: "Side-by-Side" },
      { label: "4 דלתות (French Door)", query: "מקרר 4 דלתות",     icon: "🏠", desc: "פרימיום, נפח גדול" },
      { label: "ללא מקפיא",             query: "מקרר ללא מקפיא",   icon: "🥬", desc: "לעסקים / בר" },
      { label: "מיני בר",               query: "מיני בר",          icon: "🍷", desc: "לחדר / משרד" },
    ],
  },
  "מקפיאים": {
    title: "איזה סוג מקפיא?",
    variants: [
      { label: "מקפיא ארגז (Chest)",    query: "מקפיא ארגז",   icon: "📦", desc: "נפח גדול, חסכוני" },
      { label: "מקפיא זקוף (Upright)",  query: "מקפיא מגירות", icon: "🗄️", desc: "נוח לגישה" },
      { label: "מקפיא עצמאי",           query: "מקפיא",         icon: "🔲", desc: "הצג את הכל" },
    ],
  },
  "מכונות כביסה": {
    title: "איזה סוג מכונת כביסה?",
    variants: [
      { label: "פתיחה קדמית",            query: "מכונת כביסה פתח קדמי",    icon: "👕", desc: "חוסך מים" },
      { label: "פתיחה עליונה",           query: "מכונת כביסה פתח עליון",   icon: "👔", desc: "קל לטעינה" },
      { label: "מכונה + מייבש (2 ב-1)", query: "מכונת כביסה משולבת מייבש", icon: "🌀", desc: "שתיים במחיר אחת" },
    ],
  },
  "מייבשי כביסה": {
    title: "איזה סוג מייבש כביסה?",
    variants: [
      { label: "משאבת חום (חסכוני)",    query: "מייבש כביסה משאבת חום", icon: "♻️", desc: "חיסכון מקסימלי" },
      { label: "קונדנסציה",              query: "מייבש כביסה קונדנסר",  icon: "💧", desc: "ללא פתח — הנפוץ" },
      { label: "אוויר חם (פשוט)",        query: "מייבש כביסה חשמלי",     icon: "🔥", desc: "מחיר נמוך" },
    ],
  },
  "שואבי אבק": {
    title: "איזה סוג שואב אבק?",
    variants: [
      { label: "עומד / מקל (אלחוטי)", query: "שואב אבק מקל אלחוטי", icon: "🧹", desc: "קל ונוח" },
      { label: "רובוטי",                query: "שואב אבק רובוט",       icon: "🤖", desc: "אוטומטי לגמרי" },
      { label: "נגרר",                  query: "שואב אבק נגרר",        icon: "🧲", desc: "עוצמה גבוהה" },
      { label: "ידני (כף יד)",          query: "שואב אבק ידני",        icon: "✋", desc: "לניקוי מהיר" },
      { label: "מנקה ספות / ריפודים",   query: "מנקה ספות ריפודים",     icon: "🛋️", desc: "לרהיטים" },
    ],
  },
  "טלוויזיות": {
    title: "איזה סוג מסך?",
    variants: [
      { label: "OLED",            query: 'טלוויזיה OLED',     icon: "✨", desc: "שחורים מושלמים" },
      { label: "QLED",            query: 'טלוויזיה QLED',     icon: "🌈", desc: "צבעים חיים, בהיר" },
      { label: "LED / 4K רגיל",   query: 'טלוויזיה 4K LED',   icon: "📺", desc: "מחיר משתלם" },
      { label: 'קטנה (עד 43")',    query: 'טלוויזיה 32 אינץ', icon: "📱", desc: "לחדר / מטבח" },
      { label: 'גדולה (75"+)',     query: 'טלוויזיה 75 אינץ', icon: "🎬", desc: "סלון גדול" },
    ],
  },
  "מזגנים": {
    title: "איזה סוג מזגן?",
    variants: [
      { label: "עילי (Split)",     query: "מזגן עילי",        icon: "🌬️", desc: "הנפוץ בישראל" },
      { label: "מרכזי",             query: "מזגן מרכזי",       icon: "🏠", desc: "לבית שלם" },
      { label: "מיני-מרכזי",        query: "מזגן מיני מרכזי",  icon: "🏡", desc: "פשרה זולה" },
      { label: "נייד",              query: "מזגן נייד",         icon: "🎒", desc: "בלי התקנה" },
      { label: "חלון",              query: "מזגן חלון",         icon: "🪟", desc: "ישן אבל זול" },
    ],
  },
  "תנורי אפייה": {
    title: "איזה סוג תנור אפייה?",
    variants: [
      { label: "תנור בנוי",       query: "תנור בנוי",             icon: "🏠", desc: "משתלב במטבח" },
      { label: "תנור עצמאי",      query: "תנור משולב כיריים",      icon: "🔥", desc: "עם כיריים למעלה" },
      { label: "תנור + מיקרוגל",  query: "תנור מיקרוגל משולב",    icon: "⚡", desc: "שניים במכשיר" },
      { label: "תנור אדים",       query: "תנור אדים",              icon: "💨", desc: "מקצועי" },
    ],
  },
  "כיריים": {
    title: "איזה סוג כיריים?",
    variants: [
      { label: "אינדוקציה", query: "כיריים אינדוקציה", icon: "⚡", desc: "הכי מהיר ובטוח" },
      { label: "קרמיות",     query: "כיריים קרמיות",   icon: "🔲", desc: "זכוכית חלקה" },
      { label: "גז",         query: "כיריים גז",        icon: "🔥", desc: "שליטה מלאה" },
      { label: "חשמל",       query: "כיריים חשמל",      icon: "🔌", desc: "בסיסי וזול" },
    ],
  },
  "מכונות קפה": {
    title: "איזה סוג מכונת קפה?",
    variants: [
      { label: "אוטומטית מלאה",   query: "מכונת קפה אוטומטית",  icon: "☕", desc: "מגרגר לכוס" },
      { label: "קפסולות",          query: "מכונת קפה קפסולות",    icon: "📦", desc: "Nespresso / Dolce Gusto" },
      { label: "ידנית / מנואלית",  query: "מכונת אספרסו ידנית",  icon: "🎛️", desc: "לחובבים" },
      { label: "פילטר (אמריקאי)",  query: "מכונת קפה פילטר",      icon: "☕", desc: "קפה רגיל" },
      { label: "מקציף חלב",        query: "מקציף חלב",           icon: "🥛", desc: "קפה חלב ביתי" },
    ],
  },
  "טוסטרים": {
    title: "איזה סוג טוסטר?",
    variants: [
      { label: "טוסטר לחם (פריסות)", query: "טוסטר לחם",    icon: "🍞", desc: "2-4 פריסות" },
      { label: "טוסטר אובן",           query: "טוסטר אובן",   icon: "🔥", desc: "גם לאפייה קלה" },
      { label: "מכונת כריכים",         query: "מכונת כריכים",  icon: "🥪", desc: "לכריכים חמים" },
    ],
  },
  "אוזניות": {
    title: "איזה סוג אוזניות?",
    variants: [
      { label: "אלחוטיות (אוזניים)",    query: "אוזניות אלחוטיות",   icon: "🎧", desc: "לנסיעות ועבודה" },
      { label: "אלחוטיות (תוך-אוזן)",   query: "אוזניות תוך אוזן",    icon: "🎵", desc: "AirPods / Galaxy Buds" },
      { label: "ביטול רעשים (ANC)",     query: "אוזניות ביטול רעשים", icon: "🔇", desc: "שקט מושלם" },
      { label: "גיימינג",                query: "אוזניות גיימינג",    icon: "🎮", desc: "עם מיקרופון" },
      { label: "ספורט",                  query: "אוזניות ספורט",       icon: "🏃", desc: "עמיד למים וזיעה" },
      { label: "חוטיות",                 query: "אוזניות חוטיות",      icon: "🔌", desc: "מחיר נמוך" },
    ],
  },
  "סמארטפונים": {
    title: "איזה סוג סמארטפון?",
    variants: [
      { label: "iPhone (אייפון)",    query: "אייפון",           icon: "🍎", desc: "Apple" },
      { label: "Samsung Galaxy",     query: "Samsung Galaxy",    icon: "📱", desc: "אנדרואיד פרימיום" },
      { label: "Google Pixel",       query: "Google Pixel",      icon: "🌐", desc: "Android נקי" },
      { label: "Xiaomi / Redmi",     query: "Xiaomi Redmi",      icon: "⚡", desc: "מחיר/ביצועים" },
      { label: "זול (עד ₪1,500)",    query: "סמארטפון זול",      icon: "💰", desc: "בסיסי" },
    ],
  },
};
