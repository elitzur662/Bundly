import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const categories = [
  "מחשב נייד", "מחשב נייד גיימינג", "מחשב נייח", "טאבלט",
  "טלוויזיה", "סמארטפון", "מזגן", "תנור אפייה", "מיקרוגל",
  "מדיח כלים", "מקרר", "מכונת כביסה", "שואב אבק",
  "אוזניות", "מצלמה", "כרטיס מסך (GPU)", "מסך מחשב",
  "ראוטר / נתב", "מכונת קפה", "PlayStation", "Xbox",
  "Nintendo Switch", "Steam Deck", "מדפסת",
  "רמקולים / סאונד בר", "שעון חכם", "הליכון", "גריל / ברביקיו"
];

const prompt = `אתה מומחה לשוק הצרכנות בישראל 2024-2025.
עבור כל קטגוריה, צור 4-6 טווחי תקציב ריאליים לפי מחירי השוק הישראלי בשקלים.

כללים:
- השתמש בפסיקים לאלפים: ₪1,500
- תחילת טיר: "עד ₪X,XXX" | אמצע: "₪X,XXX–X,XXX" | סוף: "₪X,XXX+"
- desc: מלא רק לטיר הראשון ולאחרון (קצר: "בסיסי" / "פלגשיפ")
- PlayStation 5 Slim = ~₪1,900 | Xbox Series X = ~₪2,200 | Switch OLED = ~₪1,400
- מזגן ספליט 1HP = ~₪1,800 | 1.5HP = ~₪2,200 | 2HP = ~₪3,000
- מכונת כביסה בסיסית = ~₪1,500 | מקצועית = ~₪4,000+
- מחשב נייד בסיסי = ~₪1,500 | גיימינג = ₪4,000-₪12,000
- GPU RTX 3060 = ~₪1,200 | RTX 4070 = ~₪3,000 | RTX 4090 = ~₪8,000+

החזר JSON בדיוק:
{
  "categories": [
    {
      "name": "שם קטגוריה",
      "tiers": [
        { "label": "עד ₪X,XXX", "min": 0, "max": 1000, "desc": "בסיסי" },
        { "label": "₪X,XXX–X,XXX", "min": 1000, "max": 2000, "desc": "" },
        { "label": "₪X,XXX+", "min": 3000, "max": null, "desc": "פרימיום" }
      ]
    }
  ]
}

קטגוריות:
${categories.join("\n")}`;

const resp = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: prompt }],
  response_format: { type: "json_object" },
  temperature: 0.1,
  max_tokens: 4000,
});

const result = JSON.parse(resp.choices[0].message.content);
console.log(JSON.stringify(result, null, 2));
