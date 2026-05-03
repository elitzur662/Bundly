# Bundly — Supplier Explainer Video Brief

## What this document is
A complete, self-contained briefing for an AI video tool (Synthesia, Veo, Pictory, ChatGPT, etc.) so it can generate a 90-second explainer video that walks suppliers through the Bundly supplier portal. Paste this entire file into the tool's prompt — it has the product context, the visual elements, the click sequence, and the Hebrew narration script.

---

## 1. Product context (so the video tool understands the platform)

Bundly is an **Israeli group-buying platform**. Consumers form "buying groups" (קבוצות רכישה) where they collectively demand a product (e.g. "20 people want a Samsung 65" OLED TV"). **Suppliers compete** to offer the lowest price; the supplier with the cheapest accepted bid wins all the orders in that group. The site is in Hebrew, RTL, with an Indigo/Violet color palette for customers and an **Emerald/Teal palette for suppliers** (so suppliers always know they're in their portal).

**Key concepts**:
- **Deal / Group** (קבוצת רכישה) — a pool of people waiting to buy the same product
- **Bid** (הצעה) — a price a supplier offers to all members of the group
- **Counter-offer** (הצעת נגד) — a custom price below or above the asking price
- **Group price** (מחיר הקבוצה) — what the customers are asking
- **Price floor** (מחיר רצפה) — informational, going below = "aggressive offer"
- **Auto-bid** (אוטומציה) — declarative rules that fire bids automatically
- **Lead supplier / leading bid** (מוביל) — the cheapest active bid

---

## 2. Visual identity for the video

- **Primary palette**: Emerald → Teal → Cyan gradient (supplier mode)
- **Accent**: Pink/Rose for "personalized" / "matched"
- **Errors**: Red
- **Success**: Emerald with ✓ checkmark
- **Notifications**: 🔔 bell icon (top right) with red badge counter
- **Cursor**: White/light, with a subtle yellow ring when hovering, a small click ripple on click
- **Font**: Hebrew Heebo or Assistant (RTL); fallback Arial Hebrew
- **Layout**: Right-to-left throughout

---

## 3. Scene-by-scene script (90 seconds total)

### Scene 1 — Login (0:00–0:08)
**On screen**: Bundly home page, customer view (indigo nav). Cursor moves to top right and clicks "כניסת ספקים". A login modal appears (email + password). Cursor types `demo@supplier.co.il` and clicks "התחבר".

**Voice-over (Hebrew)**:
> "ברוכים הבאים ל-Bundly. בואו נראה איך אתה, כספק, מצטרף לאתר ומתחיל למכור."

---

### Scene 2 — The Supplier Navbar (0:08–0:14)
**On screen**: After login, the **navbar changes color** from indigo to **emerald-teal gradient**. Top-left shows logo + "אזור ספקים · Supplier Portal". A tooltip appears on the navbar: "צבע ירוק = מצב ספק".

**Voice-over**:
> "שים לב, הסרגל למעלה הופך לירוק. ככה אתה תמיד יודע שאתה במצב ספק, לא לקוח."

---

### Scene 3 — Profile Strip & Bell (0:14–0:25)
**On screen**: A wide **profile strip** at the top of the page. It's amber/orange (incomplete profile) with progress bar at 65%, checklist showing ✓ business, ✓ address, ○ bank, ✓ categories, ○ shipping, ○ logo. Cursor hovers over **🔔 bell icon** with red badge "3" → a dropdown opens with 3 unread notifications: "💸 מתחרה ירד מתחת להצעתך", "🤖 הוגשה הצעה אוטומטית בשמך", "🏆 זכית בקבוצה!"

**Voice-over**:
> "בראש העמוד — הפרופיל שלך. השלמת אותו ל-100% נותנת לך נראות גדולה יותר. הפעמון מתעדכן בזמן אמת על כל מה שקורה — מתחרה שירד ממך, הצעה אוטומטית שלך שרצה, וקבוצה שזכית בה."

---

### Scene 4 — All Groups Tab + Smart Filters (0:25–0:40)
**On screen**: Cursor clicks "🛒 כל הקבוצות" tab. Grid of deals appears. **Filter chips** highlight: "⏰ נסגרות ב-48 שעות", "🎯 אין הצעות עדיין", "📈 קרובות לסף מינימום", "⚠️ מתחרה עוקף אותי". Cursor clicks "🎯 אין הצעות עדיין" → grid filters down to 4 deals with no bids yet. Each card shows badge "🎯 ניצחון קל".

**Voice-over**:
> "כל הקבוצות הפעילות במקום אחד. הסינונים החכמים מראים לך הזדמנויות — קבוצות שאף ספק עדיין לא הציע עליהן זה ניצחון קל. קבוצות שעוד מעט נסגרות זה עכשיו או אף פעם."

---

### Scene 5 — Submitting a Bid (0:40–0:55)
**On screen**: Cursor clicks one deal: **"מקרר Samsung 4 דלתות 620L"**. Modal opens showing:
- Product image + name
- "מחיר הקבוצה: ₪3,450"
- "📊 16/35 קונים · 3 הצעות מתחרים"
- Two big buttons: **"✅ קבל מחיר הקבוצה"** and **"💬 הצעת נגד"**

Cursor clicks "💬 הצעת נגד", types **2890** in the input. **Three green check messages appear**:
- ✓ מתחת למחיר הרצפה — הצעה אטרקטיבית במיוחד
- ✓ סיכוי גבוה לסגירה — הזולה מבין כל המתחרים
- ✓ קונים נוטים להצטרף מהר להצעה במחיר זה

Cursor clicks "הגש הצעת נגד" → modal closes, toast notification "✅ ההצעה הוגשה".

**Voice-over**:
> "הגשת הצעה היא לחיצה אחת. או שאתה מקבל את מחיר הקבוצה, או שאתה מציע מחיר משלך. ככל שאתה זול יותר — יש לך סיכוי גדול יותר לסגור את העסקה."

---

### Scene 6 — My Bids Tab (0:55–1:05)
**On screen**: Cursor clicks "📥 ההצעות שלי" tab. List of deals where the supplier has bid. The Samsung fridge appears with **emerald badge "מובחן ✓"** (= leading). Below it, an LG TV with amber badge "יש זול יותר". Each row has buttons "עדכן הצעה" and **"❌ בטל"**.

**Voice-over**:
> "כאן אתה רואה את כל ההצעות שהגשת. ירוק זה מוביל, ענבר זה יש מתחרה זול יותר. אתה יכול לעדכן את ההצעה — אבל רק כלפי מטה, לא כלפי מעלה."

---

### Scene 7 — Auto-Bid Rules (1:05–1:20)
**On screen**: Cursor clicks "🤖 אוטומציה" tab. A form appears. Cursor fills:
- Category: **מקררים**
- Brand: **Samsung**
- Max price: **3000**
- Undercut by: **50**

Clicks "➕ הוסף חוק" → rule appears in the list with a purple "פעיל" toggle. **2 seconds later**, a notification pops in the bell: **"🤖 הוגשה הצעה אוטומטית בשמך — ₪2,840"**. The rule fired in real-time because a new matching deal just appeared.

**Voice-over**:
> "אוטומציה זה השלב הבא. אתה אומר למערכת: בכל קבוצה של מקררי Samsung עד 3,000 שקלים — הוריד אותי 50 שקל מתחת למתחרים. המערכת תרוץ בשבילך, גם בלילה."

---

### Scene 8 — Inventory & Profile (1:20–1:30)
**On screen**: Quick montage:
- "📦 מלאי" tab — table of products with qty/cost columns. Cursor changes one row's qty from 12 to 0. Row turns red. Notification fires: **"⚠️ פריט נגמר במלאי"**.
- "⚙️ פרופיל" tab — supplier completes the bank fields. Progress bar fills to **100%**. Banner turns from amber to **emerald** with **"✓ מוסמך"** badge.

**Voice-over**:
> "נהל את המלאי שלך — פריט שנגמר נסגר אוטומטית. השלם את הפרופיל ל-100% — תקבל את החותמת 'מוסמך' שלקוחות רואים."

---

### Scene 9 — Closing CTA (1:30–1:35)
**On screen**: Final shot of the supplier dashboard with all KPIs lit up (5 leading deals, ₪14,200 pending payout, 47 bids this month). Logo "Bundly · אזור ספקים" centered. Text: **"להצטרף עוד היום: bundly.co.il/supplier"**

**Voice-over**:
> "Bundly — לקבל יותר הזמנות, לעבוד פחות. בנדלי, פלטפורמת קבוצות הרכישה של ישראל."

---

## 4. Click sequence (in order, for click-tracking video tools)

```
1. CLICK   #nav-supplier-login
2. TYPE    #email "demo@supplier.co.il"
3. TYPE    #password "••••••••"
4. CLICK   #login-submit
5. WAIT    1.5s
6. HOVER   .supplier-navbar (show tooltip)
7. WAIT    1s
8. HOVER   .bell-icon
9. CLICK   .bell-icon
10. WAIT   1.5s (show notifications)
11. CLICK  body (close panel)
12. CLICK  .tab[data-key="all-active"]
13. CLICK  .filter-chip[data-key="no-bids"]
14. WAIT   1s
15. CLICK  .deal-card[data-product="Samsung Fridge 620L"] .bid-btn
16. CLICK  .bid-modal .mode-btn[data-mode="counter"]
17. TYPE   .bid-modal input[type=number] "2890"
18. WAIT   1s (show 3 green check messages)
19. CLICK  .bid-modal .submit-btn
20. WAIT   1.5s (toast)
21. CLICK  .tab[data-key="my-bids"]
22. WAIT   1s
23. CLICK  .tab[data-key="auto-bid"]
24. TYPE   #rule-category "מקררים"
25. TYPE   #rule-brand "Samsung"
26. TYPE   #rule-max-price "3000"
27. TYPE   #rule-undercut "50"
28. CLICK  .add-rule-btn
29. WAIT   2s (auto-bid fires, notification appears)
30. HOVER  .bell-icon[data-unread="1"]
31. CLICK  .tab[data-key="inventory"]
32. CLICK  .inv-row .qty-input (change to 0)
33. CLICK  .tab[data-key="profile"]
34. TYPE   #bank-account "לאומי"
35. TYPE   #bank-branch "800"
36. TYPE   #bank-number "12345678"
37. CLICK  .save-profile-btn
38. WAIT   2s (progress fills to 100%, banner turns emerald)
39. END
```

---

## 5. Visual cues to add automatically

- **Click ripples** on every CLICK
- **Yellow ring** on focused element on every HOVER
- **Smooth zoom-in** (1.05×) when cursor approaches a card
- **Toast slide-in** from top for every successful action
- **Number counter animation** when the profile completion % updates
- **Bell shake** animation when a new notification arrives

---

## 6. Audio direction

- **Voice gender**: Female, Hebrew (Sarit / Daniela)
- **Pace**: 1.0× (clear, friendly, slightly upbeat)
- **Tone**: Confident, helpful, not corporate
- **Background music**: Soft tech/optimistic loop, -20dB. Fade out during last narration line.

---

## 7. Reference brand colors (CSS hex)

| Use | Hex |
|---|---|
| Supplier nav gradient | `#047857 → #0F766E → #0891B2` |
| Customer nav gradient | `#4F46E5 → #7C3AED` |
| Profile incomplete banner | `#FEF3C7 → #FEE2E2` |
| Profile complete banner | `#D1FAE5 → #CCFBF1` |
| Bell unread badge | `#EF4444` |
| "Mukhshan" ✓ badge | `#10B981` |
| Auto-bid panel | `#F3E8FF` (purple-50) |
| Personal recos badge | `#EC4899` (pink-500) |
| Counter-bid amber | `#F59E0B` |
| Floor-beat emerald | `#059669` |

---

## 8. End frame

```
                  Bundly
              אזור ספקים

   bundly.co.il/supplier
       הצטרף עוד היום
```
Background: same emerald-teal-cyan gradient. Logo centered. Subtle confetti animation rising from the bottom edge.

---

## 9. Hashtags / Description (for upload)

```
#Bundly #קבוצותרכישה #ספקים #מסחראלקטרוני #ישראל
```

**Description**:
> "ב-90 שניות: איך הופכים מספק רגיל לספק שמוכר אוטומטית. הגשה, אוטומציה, ניהול מלאי, פרופיל מוסמך — הכל במקום אחד."
