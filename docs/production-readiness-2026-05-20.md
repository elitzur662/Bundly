# דוח מוכנות לפרודקשן — Bundly

**תאריך**: 20 במאי 2026
**ענף נסקר**: `fix/ci-smoke-prod-env` (9 קומיטים מעבר ל-`main`)
**HEAD**: `af58272 Merge branch 'main' of ... into fix/ci-smoke-prod-env`

---

## TL;DR

הקוד עצמו מוכן לפרודקשן ברמה גבוהה. ה-deployment config שקול, יש boot guards שמונעים secrets חלשים, ה-CI שלם, ועברו 4 סבבי bug audit מתועדים. **הסכר העיקרי לפני go-live הוא תהליכי, לא טכני**: הענף הנוכחי לא ממוזג ל-`main`, ו-render.yaml מגדיר `branch: main` עם `autoDeploy: true`.

---

## ✅ פעולות שבוצעו בסשן הזה

1. **npm audit fix** — תוקנה פגיעות `ws` (8.20.0 → 8.20.1). `npm audit` מציג כעת 0 vulnerabilities.
2. **.gitignore עודכן** — נוספו 5 קבצי runtime: `activity-log.json`, `jwt-revoked.json`, `search-products-cache.json`, `.backfill-all-progress.json`, `.category-prewarm-progress`. גם תוקן EOL ל-LF (היה CRLF ושבר את החיפוש של הדפוסים).
3. **.gitattributes נוצר** — `* text=auto` מנרמל line endings ל-LF ב-repo. binaries מסומנים. shell scripts ו-render.yaml/yml נעולים ל-LF.
4. **git add --renormalize . רץ** — 142 קבצים נוקו מרעש CRLF. server.js, db.js, App.jsx וכל קבצי הקוד יצאו מ-diff (היו רעש בלבד).

---

## ⏳ מה שנשאר לבצע ידנית (מ-Windows terminal של הפרויקט)

### שלב 1 — לסיים את הסטייג'ינג ולקמיט

ה-Linux sandbox השאיר אחריו `.git/index.lock` שאין לי הרשאה למחוק. צריך להריץ מ-Windows:

```powershell
cd C:\Users\User\groupbuy-app

# נקה את ה-lock שנשאר מהסשן
del .git\index.lock 2>$null

# צרף את הקבצים שעוד לא הוצנעו
git add .gitattributes .gitignore
git add product-db/chargers product-db/cpus product-db/hair-removers
git add product-db/hot-plates product-db/kitchen-pots product-db/phone-cases
git add product-db/routers product-db/security-cameras product-db/smartwatches

# אופציונלי: השאר את דוח המוכנות בצד (לא הכרחי לקמיט אותו)
# git add docs/production-readiness-2026-05-20.md

# ודא מה אתה עומד לקמיט
git status

# קמיט מסודר. השם מקבץ נכון את 3 הסוגי-שינוי.
git commit -m "chore(prep-launch): audit fix + EOL normalize + 8 new catalog categories

- npm audit fix: ws 8.20.0 -> 8.20.1 (GHSA-58qx-3vcg-4xpx)
- Add .gitattributes (text=auto, binaries marked, scripts/yml locked to LF)
- Renormalize line endings (resolves 186-file CRLF noise in git diff)
- .gitignore: add 5 server-runtime files + fix CRLF that broke pattern matching
- 8 new product-db categories: chargers, cpus, hair-removers, hot-plates,
  kitchen-pots, phone-cases, routers, security-cameras, smartwatches
- product-db catalog refresh (price/meta updates across 70 categories)"

# דחוף לענף
git push origin fix/ci-smoke-prod-env
```

### שלב 2 — לפתוח PR ל-main

```
https://github.com/elitzur662/Bundly/pull/new/fix/ci-smoke-prod-env
```

לחכות ל-3 ה-CI checks ירוקים:
- `Smoke test — Build + boot + probe`
- `Security scan — npm audit`
- `Security scan — Secret detection`
- `Security scan — CodeQL static analysis`

### שלב 3 — להגדיר ENV ב-Render Dashboard לפני merge

ב-Render → Service `bundly` → Environment:

**HARD-REQUIRED (בלעדיהם השרת לא יעלה):**
- `STRIPE_SECRET_KEY` = `sk_live_...` (לא `sk_test_`!)
- `STRIPE_PUBLISHABLE_KEY` = `pk_live_...`
- `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- `HCAPTCHA_SECRET`
- `ALLOWED_ORIGINS` = `https://bundly.co,https://www.bundly.co` (כבר ב-blueprint)

**מסופקים אוטומטית מ-blueprint:**
- `JWT_SECRET`, `URL_SIGN_SECRET`, `SESSION_SECRET` (generateValue: true)

**SOFT-REQUIRED (השרת יעלה אבל יחסר feature):**
- `STRIPE_WEBHOOK_SECRET` — קבל מ-Stripe Dashboard → Webhooks → endpoint חדש `https://bundly.co/webhook/stripe`. בלעדיו webhooks → 503 וסטטוסים לא יתעדכנו.
- `EMAIL_USER` + `EMAIL_PASS` — Gmail App Password. בלעדיהם אין welcome/KYC/dispute emails.

### שלב 4 — Merge ל-main

לאחר שכל ה-CI ירוק וה-ENV ב-Render מסודר:
- מזג את ה-PR (merge commit, לא squash — שומר על היסטוריית התיקונים)
- `render.yaml` עם `autoDeploy: true` יזהה את ה-push ל-main ויבנה אוטומטית.

### שלב 5 — מעקב אחרי deploy

- צפה ב-build logs ב-Render → Logs.
- אחרי שה-service "Live", בדוק:
  - `https://bundly.co/api/health` → 200 עם `dist: ok`, `heap: < 90%`, `db: ok`.
  - דף הבית טוען עם CSS+JS.
  - OTP login: כניסה עם מספר טלפון → קבלת SMS → התחברות.

---

## מה נראה טוב ולא דורש פעולה

- **Boot guards של secrets**: `_assertStrongSecret` בודק אורך ≥ 32, blacklist ידוע, `_WEAK_SUBSTRINGS`. exit(1) על כשל.
- **`/api/health` endpoint**: dist exists, heap < 90%, DB reachable. Render polls כל ~30s ויעשה restart על כשל.
- **render.yaml**: standard plan (2GB RAM), Frankfurt, persistent disk 5GB, NODE_OPTIONS=--max-old-space-size=1700.
- **CI smoke**: בונה, מעלה את השרת ב-NODE_ENV=production, מוודא Content-Type ב-/ וב-/assets/*.js, מוודא 404 ב-asset לא קיים, /api/health → 200.
- **CI security**: npm audit (high), gitleaks, weak-default grep, CodeQL.
- **Audit מתועד בקוד**: 30+ הערות `BUG FIX (round 3/4 P0/P1)`. אין TODO/FIXME פתוחים.
- **CORS**: `ALLOWED_ORIGINS` ב-blueprint מגדיר `https://bundly.co,https://www.bundly.co`.
- **Helmet + rate limiting + audit log**: `security-middleware.js` מטפל בכל הסטנדרטים.
