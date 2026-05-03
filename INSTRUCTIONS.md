# 🚀 Bundly — הוראות הרצה

## דרישות מקדימות
התקן **Node.js** אם עדיין לא התקנת:
👉 https://nodejs.org (הורד גרסת LTS)

---

## שלב 1 — התקן dependencies (פעם אחת)
```
npm install
```

---

## שלב 2 — הגדר API Keys

פתח את הקובץ `.env` בתיקיית הפרויקט ומלא:

```
SERP_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

| שירות | היכן להרשם | עלות |
|-------|-----------|------|
| **SerpAPI** | https://serpapi.com | 100 חיפושים/חודש חינם |
| **OpenAI** | https://platform.openai.com/api-keys | ~$0.002 לחיפוש |

---

## שלב 3 — הפעלה (שני חלונות טרמינל)

**חלון 1 — Backend (שרת AI):**
```
node server.js
```
תראה: `🚀 Bundly API server running on http://localhost:3001`

**חלון 2 — Frontend (האתר):**
```
npm run dev
```

### או בפקודה אחת:
```
npm run start
```

האתר יעלה על: 👉 http://localhost:3000

---

## איך עובד החיפוש החכם (AI)

1. לך ל **"עסקאות"** בניווט
2. בחלק העליון — שורת **"חיפוש חכם"**
3. הקלד שם מוצר: `iPhone 16`, `מקרר בוש`, `PS5`
4. לחץ **⚡ חפש AI** (ייקח 5-10 שניות)
5. ה-AI יחפש ב-Google Shopping ישראל + זאפ
6. תראה מחיר שוק אמיתי + ספקים ממוינים + מחיר קבוצתי מוצע
7. לחץ **"פתח דיל קבוצתי"** → הדיל נפתח מיד!

---

## מבנה הפרויקט
```
groupbuy-app/
├── src/
│   └── App.jsx        ← כל קוד הפרונטאנד
├── server.js          ← Backend (SerpAPI + Zap + OpenAI)
├── .env               ← API Keys (לא לשתף!)
├── vite.config.js     ← Proxy לבקנד
└── package.json
```

## לפרסום (Vercel + Railway)
- Frontend: גרור תיקיית `dist` ל-https://vercel.com
- Backend: העלה ל-https://railway.app (חינמי)
- עדכן את כתובת ה-API ב-`vite.config.js`
