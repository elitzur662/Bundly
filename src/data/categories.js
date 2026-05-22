/**
 * Bundly, Top-level category lists and guided-search category data.
 *
 * Three exports:
 *
 *   CATEGORIES, 4-language array of top-level category labels. The index
 *                position is the canonical "catIdx" used as a numeric key
 *                across the app (deal.catIdx, DEAL_SUPPLIER map, etc.).
 *
 *   CAT_ICONS , Emoji icon per catIdx, parallel-indexed with CATEGORIES.
 *
 *   SEARCH_CATEGORIES, Hierarchical data for the guided product-search
 *                       flow ("pick category → brand → model"). Each item
 *                       lists popular brands per category and known models
 *                       per brand. Independent of catIdx.
 *
 * NOTE: The richer CATEGORY_TREE (mobile "חפש" browser) lives in App.jsx
 * for now; it'll move to data/category-tree.js in a follow-up phase.
 */

export const CATEGORIES = {
  he: ["טלוויזיות","מחשבים","טלפונים","מכשירי חשמל","מטבח","מזגנים","ריהוט","ספורט","אופניים","תינוקות","מצלמות","גיימינג","רכב","בריאות"],
  en: ["TVs","Computers","Phones","Appliances","Kitchen","AC & Fans","Furniture","Sports","Bikes","Baby","Cameras","Gaming","Automotive","Health"],
  ar: ["تلفزيونات","كمبيوتر","هواتف","أجهزة","مطبخ","مكيفات","أثاث","رياضة","دراجات","أطفال","كاميرات","ألعاب","سيارات","صحة"],
  ru: ["Телевизоры","Компьютеры","Телефоны","Техника","Кухня","Кондиционеры","Мебель","Спорт","Велосипеды","Детское","Камеры","Игры","Авто","Здоровье"],
};

export const CAT_ICONS = ["📺","💻","📱","🏠","🍳","❄️","🪑","⚽","🚲","🍼","📷","🎮","🚗","💊"];

export const SEARCH_CATEGORIES = [
  {
    icon: "📱", he: "סמארטפונים", en: "Smartphones",
    brands: ["Apple", "Samsung", "Google Pixel", "OnePlus", "Xiaomi"],
    models: { Apple: ["iPhone 16", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 15", "iPhone SE"],
               Samsung: ["Galaxy S25", "Galaxy S25 Ultra", "Galaxy A55", "Galaxy Z Fold 6"],
               "Google Pixel": ["Pixel 9", "Pixel 9 Pro", "Pixel 8a"],
               OnePlus: ["OnePlus 13", "OnePlus 12"], Xiaomi: ["Xiaomi 14", "Redmi Note 13"] }
  },
  {
    icon: "💻", he: "מחשבים ולפטופים", en: "Computers & Laptops",
    brands: ["Apple", "Dell", "Lenovo", "HP", "Asus", "Microsoft"],
    models: { Apple: ["MacBook Air M3", "MacBook Pro 14\"", "MacBook Pro 16\"", "Mac Mini M4"],
               Dell: ["XPS 13", "XPS 15", "Inspiron 15"], Lenovo: ["ThinkPad X1", "IdeaPad 5", "Legion 5"],
               HP: ["Spectre x360", "Envy 13", "EliteBook"], Asus: ["ZenBook 14", "ROG Zephyrus", "VivoBook"],
               Microsoft: ["Surface Pro 11", "Surface Laptop 6"] }
  },
  {
    icon: "📺", he: "טלוויזיות", en: "TVs",
    brands: ["Samsung", "LG", "Sony", "Hisense", "TCL"],
    models: { Samsung: ["Neo QLED 8K 75\"", "QLED 4K 65\"", "The Frame 55\""],
               LG: ["OLED C4 65\"", "OLED G4 55\"", "QNED 75\""],
               Sony: ["Bravia XR A95L", "Bravia XR X90L", "Bravia 7"],
               Hisense: ["U8N 65\"", "U7N 55\""], TCL: ["QM8 65\"", "C745"] }
  },
  {
    icon: "🏠", he: "מכשירי חשמל", en: "Appliances",
    brands: ["Bosch", "LG", "Samsung", "Whirlpool", "Electrolux"],
    models: { Bosch: ["מקרר NoFrost", "מדיח כלים SMS46", "מכונת כביסה WAT"],
               LG: ["מקרר Side-by-Side", "מדיח DFB512", "מכונת כביסה F4WV"],
               Samsung: ["מקרר French Door", "מדיח DW60", "מכונת כביסה WW11"],
               Whirlpool: ["מקרר WB70E", "מדיח WFO3O33P"], Electrolux: ["EW6F4", "EEA17100L"] }
  },
  {
    icon: "❄️", he: "מיזוג אוויר", en: "Air Conditioning",
    brands: ["Mitsubishi", "LG", "Samsung", "Daikin", "Gree"],
    models: { Mitsubishi: ["MSZ-AP25VG", "MSZ-LN35VG2", "MSZ-EF35VGKB"],
               LG: ["Artcool 09", "Artcool 12", "Dual Inverter 18"],
               Samsung: ["WindFree 09", "WindFree 12", "WindFree 18"],
               Daikin: ["FTXM25R", "FTXM35R"], Gree: ["FAIRY 12", "PULAR 18"] }
  },
  {
    icon: "🎮", he: "גיימינג", en: "Gaming",
    brands: ["Sony", "Microsoft", "Nintendo", "Valve"],
    models: { Sony: ["PlayStation 5 Slim", "PS5 Pro", "PlayStation VR2"],
               Microsoft: ["Xbox Series X", "Xbox Series S"],
               Nintendo: ["Nintendo Switch 2", "Nintendo Switch OLED"],
               Valve: ["Steam Deck OLED"] }
  },
  {
    icon: "📷", he: "מצלמות", en: "Cameras",
    brands: ["Sony", "Canon", "Nikon", "Fujifilm"],
    models: { Sony: ["Alpha A7 IV", "Alpha A7C II", "Alpha ZV-E10 II"],
               Canon: ["EOS R6 Mark II", "EOS R50", "PowerShot V10"],
               Nikon: ["Z6 III", "Z5 II", "Zfc"], Fujifilm: ["X-T5", "X100VI", "GFX100S II"] }
  },
  {
    icon: "🎧", he: "אודיו ואוזניות", en: "Audio & Headphones",
    brands: ["Sony", "Apple", "Bose", "Samsung", "Sennheiser"],
    models: { Sony: ["WH-1000XM5", "WF-1000XM5", "LinkBuds S"],
               Apple: ["AirPods Pro 2", "AirPods 4", "AirPods Max"],
               Bose: ["QuietComfort 45", "QuietComfort Ultra", "SoundLink Max"],
               Samsung: ["Galaxy Buds3 Pro"], Sennheiser: ["Momentum 4", "Accentum Plus"] }
  },
];
