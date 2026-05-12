/**
 * Bundly — Demo data: pending suppliers + initial deals shown on first load.
 *
 * INITIAL_PENDING_SUPPLIERS — Two demo supplier KYC applications. The owner
 *                            dashboard shows these so the supplier-approval
 *                            flow is testable end-to-end without onboarding
 *                            a real supplier.
 *
 * INITIAL_DEALS — ~18 demo deals across categories (TV, laptop, phone,
 *                 fridge, etc.) with bid history and supplier counts.
 *                 Used as seed data on every page-load: appended to the
 *                 server-fetched deal list so the home grid is never empty,
 *                 even before the catalog warms up.
 *
 *                 Each entry's _demo flag is set elsewhere (in App.jsx
 *                 initialization) so the UI renders a 'דוגמה' badge on
 *                 these cards — customers shouldn't mistake demo prices
 *                 for live group rounds.
 */
import { IMG } from './images.js';

// ─────────────────────────────────────────────────────────────────
//  DEALS DATA
// ─────────────────────────────────────────────────────────────────
export const INITIAL_PENDING_SUPPLIERS = [
  { id:"s1", bizName:"Tech4U", bizAddr:"תל אביב, דרך מנחם בגין 12", bizNum:"514-123456", bizBranches:"3", bizContact:"רון לוי", bizPhone:"03-1234567", bizEmail:"ron@tech4u.co.il", bizCategory:"אלקטרוניקה", bizDesc:"רשת חנויות אלקטרוניקה ותיקה", timestamp:"2024-01-15T10:30:00", status:"pending" },
  { id:"s2", bizName:"SmartHome IL", bizAddr:"חיפה, שד׳ הנשיא 8", bizNum:"515-654321", bizBranches:"1", bizContact:"מיה כהן", bizPhone:"04-9876543", bizEmail:"mia@smarthome.co.il", bizCategory:"מוצרי חשמל", bizDesc:"מתמחים במוצרי חשמל ביתיים", timestamp:"2024-01-16T08:15:00", status:"pending" },
];

export const INITIAL_DEALS = [
  {
    id:1, catIdx:0, sog:"e-tv",
    name:{ he:'סמסונג 65" Neo QLED 4K', en:'Samsung 65" Neo QLED 4K', ar:'سامسونج 65" Neo QLED 4K', ru:'Samsung 65" Neo QLED 4K' },
    image: IMG.tv,
    marketMin:4400, marketMax:5800, groupOffer:3890, discount:22,
    participants:34, watching:54, interested:135, maxParticipants:50, minParticipants:20, daysLeft:3,
    specs:['65" Neo QLED','4K 120Hz','Dolby Atmos','Smart TV 2024'],
    desc:{ he:"פאנל Neo QLED עם תאורה אחורית Mini LED, קצב רענון 120Hz ומערכת שמע Dolby Atmos מובנית.", en:"Neo QLED panel with Mini LED backlight, 120Hz refresh rate and built-in Dolby Atmos audio.", ar:"لوحة Neo QLED مع إضاءة خلفية Mini LED.", ru:"Neo QLED панель с Mini LED подсветкой и Dolby Atmos." },
    bids:[
      { id:"b1", code:"BL01", amount:4200, time:"לפני 4 שעות" },
      { id:"b2", code:"BL02", amount:3950, time:"לפני שעתיים" },
      { id:"b3", code:"BL03", amount:3890, time:"לפני 25 דקות" },
    ]
  },
  {
    id:2, catIdx:1, sog:"c-pclaptop",
    name:{ he:'MacBook Pro 14" M3', en:'MacBook Pro 14" M3', ar:'MacBook Pro 14" M3', ru:'MacBook Pro 14" M3' },
    image: IMG.laptop,
    marketMin:7200, marketMax:9000, groupOffer:6490, discount:20,
    participants:19, watching:32, interested:82, maxParticipants:30, minParticipants:15, daysLeft:5,
    specs:["Apple M3","18GB RAM","512GB SSD","Liquid Retina XDR"],
    desc:{ he:"שבב M3 עם ביצועים יוצאי דופן ומסך Liquid Retina XDR.", en:"M3 chip with exceptional performance and Liquid Retina XDR display.", ar:"شريحة M3 بأداء استثنائي وشاشة Liquid Retina XDR.", ru:"Чип M3, дисплей Liquid Retina XDR." },
    bids:[
      { id:"b1", code:"Bug", amount:7500, time:"לפני 6 שעות" },
      { id:"b2", code:"BL04", amount:7100, time:"לפני 3 שעות" },
      { id:"b3", code:"BL01", amount:6490, time:"לפני שעה" },
    ]
  },
  {
    id:3, catIdx:2, sog:"e-cellphone",
    name:{ he:"iPhone 16 Pro 256GB", en:"iPhone 16 Pro 256GB", ar:"iPhone 16 Pro 256GB", ru:"iPhone 16 Pro 256GB" },
    image: IMG.phone,
    marketMin:4300, marketMax:5500, groupOffer:3790, discount:19,
    participants:43, watching:68, interested:168, maxParticipants:60, minParticipants:30, daysLeft:2,
    specs:["A18 Pro","כפתור Action","מצלמה 48MP","Titanium"],
    desc:{ he:"הדגל של אפל עם שבב A18 Pro, מצלמת Ultra Wide משודרגת ומסגרת טיטניום.", en:"Apple's flagship with A18 Pro chip and titanium frame.", ar:"أجهزة أبل الرائدة مع شريحة A18 Pro.", ru:"Флагман Apple с чипом A18 Pro." },
    bids:[
      { id:"b1", code:"BL05", amount:4500, time:"לפני 8 שעות" },
      { id:"b2", code:"BL03", amount:4100, time:"לפני 4 שעות" },
      { id:"b3", code:"Bug", amount:3900, time:"לפני 2 שעות" },
      { id:"b4", code:"BL02", amount:3790, time:"לפני 30 דקות" },
    ]
  },
  {
    id:4, catIdx:3, sog:"e-washingmachine",
    name:{ he:"מכונת כביסה Bosch 9kg", en:"Bosch 9kg Washing Machine", ar:"غسالة بوش 9 كيلو", ru:"Стиральная машина Bosch 9кг" },
    image: IMG.wash,
    marketMin:2800, marketMax:3700, groupOffer:2390, discount:25,
    participants:14, watching:24, interested:63, maxParticipants:25, minParticipants:10, daysLeft:7,
    specs:['9 ק"ג','1400 RPM','Eco Program','A+++ Energy'],
    desc:{ he:"מכונת כביסה חסכונית עם תוכנית Eco ומנוע EcoSilence.", en:"Energy efficient washing machine with Eco program.", ar:"غسالة موفرة للطاقة مع برنامج Eco.", ru:"Экономичная машина с программой Eco." },
    bids:[
      { id:"b1", code:"BL01", amount:2900, time:"לפני 5 שעות" },
      { id:"b2", code:"BL04", amount:2390, time:"לפני 2 שעות" },
    ]
  },
  {
    id:5, catIdx:5, sog:"e-airconditioner",
    name:{ he:"מזגן Mitsubishi 1.5HP Inverter", en:"Mitsubishi 1.5HP Inverter AC", ar:"مكيف ميتسوبيشي 1.5 حصان إنفرتر", ru:"Кондиционер Mitsubishi 1.5HP Inverter" },
    image: IMG.ac,
    marketMin:2300, marketMax:3200, groupOffer:1890, discount:21,
    participants:26, watching:42, interested:106, maxParticipants:40, minParticipants:20, daysLeft:4,
    specs:['1.5 כ"ס','Inverter DC','Wi-Fi Control','PM2.5 Filter'],
    desc:{ he:"מזגן עם טכנולוגיית Inverter לחיסכון בחשמל ופילטר PM2.5.", en:"Inverter technology AC for energy savings and PM2.5 filter.", ar:"مكيف بتقنية الإنفرتر وفلتر PM2.5.", ru:"Кондиционер с инвертором и фильтром PM2.5." },
    bids:[
      { id:"b1", code:"Bug", amount:2500, time:"לפני 6 שעות" },
      { id:"b2", code:"BL03", amount:2200, time:"לפני 3 שעות" },
      { id:"b3", code:"BL05", amount:1890, time:"לפני שעה" },
    ]
  },
  {
    id:6, catIdx:8, sog:"s-bycicle",
    name:{ he:"אופניים חשמליים Trek e5", en:"Trek e5 Electric Bike", ar:"دراجة كهربائية Trek e5", ru:"Электровелосипед Trek e5" },
    image: IMG.bike,
    marketMin:5800, marketMax:7500, groupOffer:5190, discount:26,
    participants:11, watching:20, interested:53, maxParticipants:20, minParticipants:8, daysLeft:6,
    specs:["Bosch 250W","סוללה 625Wh","~130 ק\"מ","Shimano 12sp"],
    desc:{ he:"מנוע Bosch Performance 250W עם סוללה 625Wh לטווח של עד 130 ק\"מ.", en:"Bosch Performance 250W motor with 625Wh battery for up to 130km range.", ar:"محرك Bosch 250 واط وبطارية 625 واط ساعة.", ru:"Мотор Bosch 250Вт, батарея 625Вт*ч, до 130 км." },
    bids:[
      { id:"b1", code:"BL04", amount:5900, time:"לפני 10 שעות" },
      { id:"b2", code:"Bug", amount:5190, time:"לפני 3 שעות" },
    ]
  },
  {
    id:7, catIdx:11, sog:"e-tvgame",
    name:{ he:"Sony PlayStation 5 Slim + 2 בקרים", en:"Sony PlayStation 5 Slim + 2 Controllers", ar:"سوني PlayStation 5 Slim + وحدتا تحكم", ru:"Sony PlayStation 5 Slim + 2 геймпада" },
    image: IMG.gaming,
    marketMin:2100, marketMax:2700, groupOffer:1790, discount:23, hot:true,
    participants:48, watching:75, interested:185, maxParticipants:60, minParticipants:30, daysLeft:1,
    specs:["PS5 Slim","825GB SSD","4K 120fps","2× DualSense"],
    desc:{ he:"קונסולת ה-PS5 Slim עם שני בקרי DualSense וחיבור 4K.", en:"PS5 Slim console with two DualSense controllers and 4K support.", ar:"وحدة PS5 Slim مع وحدتي تحكم DualSense.", ru:"PS5 Slim с двумя геймпадами DualSense." },
    bids:[
      { id:"b1", code:"BL01", amount:2300, time:"לפני 12 שעות" },
      { id:"b2", code:"Bug", amount:2050, time:"לפני 6 שעות" },
      { id:"b3", code:"BL03", amount:1900, time:"לפני 2 שעות" },
      { id:"b4", code:"BL05", amount:1790, time:"לפני 20 דקות" },
    ]
  },
  {
    id:8, catIdx:10, sog:"e-camera",
    name:{ he:"Sony Alpha A7 IV Full Frame", en:"Sony Alpha A7 IV Full Frame", ar:"سوني Alpha A7 IV كاملة الإطار", ru:"Sony Alpha A7 IV полный кадр" },
    image: IMG.camera,
    marketMin:8500, marketMax:11000, groupOffer:7490, discount:18,
    participants:9, watching:17, interested:46, maxParticipants:20, minParticipants:8, daysLeft:8,
    specs:["33MP Full Frame","4K 60fps","Real-time Tracking","5-axis IBIS"],
    desc:{ he:"מצלמת Full Frame מקצועית עם 33 מגה-פיקסל, 4K 60fps וייצוב 5 צירים.", en:"Professional full-frame camera with 33MP, 4K 60fps and 5-axis stabilization.", ar:"كاميرا احترافية كاملة الإطار 33 ميجابكسل.", ru:"Профессиональная полнокадровая камера 33МП, 4K 60 кадр/с." },
    bids:[
      { id:"b1", code:"BL04", amount:9500, time:"לפני 24 שעות" },
      { id:"b2", code:"BL02", amount:8800, time:"לפני 10 שעות" },
      { id:"b3", code:"Bug", amount:7490, time:"לפני 4 שעות" },
    ]
  },
  {
    id:9, catIdx:5, sog:"e-vaccumcleaner",
    name:{ he:"שואב רובוטי iRobot Roomba j9+", en:"iRobot Roomba j9+ Robot Vacuum", ar:"مكنسة روبوتية iRobot Roomba j9+", ru:"Робот-пылесос iRobot Roomba j9+" },
    image: IMG.robot,
    marketMin:2900, marketMax:3800, groupOffer:2390, discount:24, hot:true,
    participants:31, watching:50, interested:125, maxParticipants:40, minParticipants:20, daysLeft:4,
    specs:["Auto Empty Base","Smart Mapping","PrecisionVision Nav","Rubber Brushes"],
    desc:{ he:"שואב רובוטי חכם עם AI Navigation, ריקון אוטומטי ומיפוי חכם.", en:"Smart robot vacuum with AI navigation and auto-empty base.", ar:"مكنسة روبوتية ذكية بملاحة AI وقاعدة تفريغ تلقائي.", ru:"Умный робот-пылесос с ИИ-навигацией и автоматическим опустошением." },
    bids:[
      { id:"b1", code:"BL01", amount:3100, time:"לפני 8 שעות" },
      { id:"b2", code:"BL03", amount:2700, time:"לפני 3 שעות" },
      { id:"b3", code:"BL04", amount:2390, time:"לפני שעה" },
    ]
  },
  {
    id:10, catIdx:6, sog:"h-livingroomset",
    name:{ he:"ספת תלת מושבית IKEA Kivik", en:"IKEA Kivik 3-Seat Sofa", ar:"أريكة IKEA Kivik 3 مقاعد", ru:"Диван IKEA Kivik 3-местный" },
    image: IMG.couch,
    marketMin:2100, marketMax:2800, groupOffer:1690, discount:28,
    participants:7, watching:14, interested:39, maxParticipants:15, minParticipants:6, daysLeft:10,
    specs:["תלת מושבית","ריפוד ניתן לכביסה","עמידות גבוהה","אחריות 10 שנים"],
    desc:{ he:"ספת תלת מושבית עם ריפוד ניתן לכביסה ואחריות יצרן של 10 שנים.", en:"3-seat sofa with washable cover and 10-year warranty.", ar:"أريكة 3 مقاعد بغطاء قابل للغسيل وضمان 10 سنوات.", ru:"Трёхместный диван со съёмным чехлом и гарантией 10 лет." },
    bids:[
      { id:"b1", code:"Bug", amount:2200, time:"לפני 15 שעות" },
      { id:"b2", code:"BL04", amount:1690, time:"לפני 5 שעות" },
    ]
  },
  {
    id:11, catIdx:0, sog:"e-tv",
    name:{ he:'Sony Bravia 55" OLED XR A80L', en:'Sony Bravia 55" OLED XR A80L', ar:'سوني Bravia 55" OLED XR', ru:'Sony Bravia 55" OLED XR A80L' },
    image: IMG.tv,
    marketMin:5500, marketMax:7200, groupOffer:4590, discount:20,
    participants:22, watching:36, interested:91, maxParticipants:35, minParticipants:15, daysLeft:5,
    specs:['55" OLED','4K XR','Dolby Vision IQ','Google TV'],
    desc:{ he:"מסך OLED עם מעבד XR של סוני, Dolby Vision IQ ומערכת Google TV.", en:"OLED display with Sony XR processor and Google TV.", ar:"شاشة OLED مع معالج XR وGoogle TV.", ru:"OLED дисплей с процессором XR и Google TV." },
    bids:[
      { id:"b1", code:"BL02", amount:6100, time:"לפני 7 שעות" },
      { id:"b2", code:"BL01", amount:5300, time:"לפני 3 שעות" },
      { id:"b3", code:"BL05", amount:4590, time:"לפני שעתיים" },
    ]
  },
  {
    id:12, catIdx:4, sog:"e-coffeemachine",
    name:{ he:"מכונת קפה De'Longhi Dinamica Plus", en:"De'Longhi Dinamica Plus Coffee Machine", ar:"ماكينة قهوة De'Longhi Dinamica Plus", ru:"Кофемашина De'Longhi Dinamica Plus" },
    image: IMG.coffee,
    marketMin:2400, marketMax:3200, groupOffer:1990, discount:24, hot:true,
    participants:18, watching:30, interested:77, maxParticipants:30, minParticipants:12, daysLeft:6,
    specs:["Fully Automatic","LatteCrema System","My Menu 3","13-level Grinder"],
    desc:{ he:"מכונת אספרסו מלאה-אוטומטית עם מערכת LatteCrema ו-3 פרופילים אישיים.", en:"Fully automatic espresso machine with LatteCrema system.", ar:"ماكينة إسبريسو أوتوماتيكية مع نظام LatteCrema.", ru:"Автоматическая кофемашина с системой LatteCrema." },
    bids:[
      { id:"b1", code:"Bug", amount:2800, time:"לפני 9 שעות" },
      { id:"b2", code:"BL01", amount:2400, time:"לפני 4 שעות" },
      { id:"b3", code:"BL04", amount:1990, time:"לפני 45 דקות" },
    ]
  },
  {
    id:13, catIdx:2, sog:"e-cellphone",
    name:{ he:"Samsung Galaxy S25 Ultra 256GB", en:"Samsung Galaxy S25 Ultra 256GB", ar:"سامسونج Galaxy S25 Ultra", ru:"Samsung Galaxy S25 Ultra 256GB" },
    image: IMG.phone,
    marketMin:5200, marketMax:6500, groupOffer:4490, discount:21, hot:true,
    participants:37, watching:59, interested:147, maxParticipants:60, minParticipants:25, daysLeft:3,
    specs:["Snapdragon 8 Elite","12GB RAM","200MP Camera","S Pen"],
    desc:{ he:"המכשיר הכי חזק של סמסונג עם עט S Pen, מצלמה ראשית 200MP ומסך Dynamic AMOLED 6.9 אינץ'.", en:"Samsung's most powerful device with S Pen and 200MP camera.", ar:"أقوى هاتف من سامسونج مع قلم S Pen وكاميرا 200 ميجابكسل.", ru:"Самый мощный Samsung с S Pen и камерой 200МП." },
    bids:[
      { id:"b1", code:"BL05", amount:5800, time:"לפני 10 שעות" },
      { id:"b2", code:"BL03", amount:5100, time:"לפני 5 שעות" },
      { id:"b3", code:"BL01", amount:4800, time:"לפני 2 שעות" },
      { id:"b4", code:"Bug", amount:4490, time:"לפני 40 דקות" },
    ]
  },
  {
    id:14, catIdx:11, sog:"e-headphone",
    name:{ he:"Sony WH-1000XM5 אוזניות אלחוטיות", en:"Sony WH-1000XM5 Wireless Headphones", ar:"سوني WH-1000XM5 سماعات لاسلكية", ru:"Sony WH-1000XM5 беспроводные наушники" },
    image: IMG.headphones,
    marketMin:1100, marketMax:1600, groupOffer:890, discount:28, hot:true,
    participants:52, watching:81, interested:199, maxParticipants:80, minParticipants:30, daysLeft:2,
    specs:["ANC Industry-Leading","30h Battery","Multipoint BT","LDAC Hi-Res"],
    desc:{ he:"האוזניות הטובות בעולם עם ביטול רעשים מוביל בתעשייה, 30 שעות סוללה וחיבור לשני מכשירים בו-זמנית.", en:"World's best ANC headphones with 30h battery and multipoint connection.", ar:"أفضل سماعات في العالم بإلغاء الضوضاء الرائد وبطارية 30 ساعة.", ru:"Лучшие в мире наушники с ANC и 30 часами автономности." },
    bids:[
      { id:"b1", code:"BL01", amount:1300, time:"לפני 6 שעות" },
      { id:"b2", code:"BL02", amount:1050, time:"לפני 3 שעות" },
      { id:"b3", code:"Bug", amount:890, time:"לפני שעה" },
    ]
  },
  {
    id:15, catIdx:10, sog:"e-camera",
    name:{ he:"DJI Mini 4 Pro רחפן", en:"DJI Mini 4 Pro Drone", ar:"طائرة بدون طيار DJI Mini 4 Pro", ru:"Дрон DJI Mini 4 Pro" },
    image: IMG.drone,
    marketMin:2800, marketMax:3800, groupOffer:2290, discount:24,
    participants:16, watching:27, interested:70, maxParticipants:35, minParticipants:12, daysLeft:8,
    specs:["4K/60fps","48MP","Omnidirectional Obstacle","34 min Flight"],
    desc:{ he:"רחפן קל משקל מתחת ל-249 גרם עם מצלמה 4K/60fps, 48MP ומניעת מחסום רב-כיווני.", en:"Lightweight drone under 249g with 4K/60fps camera and omnidirectional obstacle avoidance.", ar:"طائرة بدون طيار خفيفة الوزن مع كاميرا 4K/60fps.", ru:"Лёгкий дрон до 249г с камерой 4K/60fps." },
    bids:[
      { id:"b1", code:"BL04", amount:3200, time:"לפני 12 שעות" },
      { id:"b2", code:"Bug", amount:2700, time:"לפני 5 שעות" },
      { id:"b3", code:"BL01", amount:2290, time:"לפני שעתיים" },
    ]
  },
  {
    id:16, catIdx:1, sog:"c-pclaptop",
    name:{ he:'ASUS ROG Zephyrus G16 גיימינג', en:'ASUS ROG Zephyrus G16 Gaming Laptop', ar:'لابتوب ASUS ROG Zephyrus G16', ru:'ASUS ROG Zephyrus G16 Gaming' },
    image: IMG.laptop,
    marketMin:6500, marketMax:8500, groupOffer:5490, discount:22,
    participants:11, watching:20, interested:53, maxParticipants:25, minParticipants:10, daysLeft:9,
    specs:["RTX 4080","Intel i9-14900HX","32GB DDR5","240Hz OLED"],
    desc:{ he:"לפטופ גיימינג פרמיום עם RTX 4080, מסך OLED 240Hz ו-32GB DDR5 לביצועים מקסימליים.", en:"Premium gaming laptop with RTX 4080, 240Hz OLED display and 32GB DDR5.", ar:"لابتوب العاب بريميوم مع RTX 4080 وشاشة OLED 240Hz.", ru:"Игровой ноутбук RTX 4080, OLED 240Hz, 32GB DDR5." },
    bids:[
      { id:"b1", code:"BL01", amount:7200, time:"לפני 8 שעות" },
      { id:"b2", code:"Bug", amount:6300, time:"לפני 4 שעות" },
      { id:"b3", code:"BL05", amount:5490, time:"לפני שעה" },
    ]
  },
  {
    id:17, catIdx:3, sog:"e-vaccumcleaner",
    name:{ he:"Dyson V15 Detect שואב אבק אלחוטי", en:"Dyson V15 Detect Cordless Vacuum", ar:"مكنسة ديسون V15 Detect اللاسلكية", ru:"Dyson V15 Detect беспроводной пылесос" },
    image: IMG.vacuum,
    marketMin:2200, marketMax:3000, groupOffer:1790, discount:26, hot:true,
    participants:29, watching:47, interested:118, maxParticipants:45, minParticipants:18, daysLeft:5,
    specs:["Laser Dust Detection","HEPA Filter","60 min Runtime","LCD Screen"],
    desc:{ he:"שואב אבק אלחוטי עם לייזר לזיהוי אבק, מסנן HEPA ועד 60 דקות פעולה רציפה.", en:"Cordless vacuum with laser dust detection, HEPA filter and 60 min runtime.", ar:"مكنسة لاسلكية بليزر لاكتشاف الغبار وفلتر HEPA ومدة 60 دقيقة.", ru:"Беспроводной пылесос с лазером и фильтром HEPA, 60 минут работы." },
    bids:[
      { id:"b1", code:"BL02", amount:2600, time:"לפני 7 שעות" },
      { id:"b2", code:"BL01", amount:2200, time:"לפני 3 שעות" },
      { id:"b3", code:"BL04", amount:1790, time:"לפני 50 דקות" },
    ]
  },
  {
    id:18, catIdx:2, sog:"e-headphone",
    name:{ he:"Apple AirPods Pro 2 (USB-C)", en:"Apple AirPods Pro 2 (USB-C)", ar:"Apple AirPods Pro 2 (USB-C)", ru:"Apple AirPods Pro 2 (USB-C)" },
    image: IMG.earbuds,
    marketMin:850, marketMax:1150, groupOffer:690, discount:24, hot:true,
    participants:64, watching:99, interested:243, maxParticipants:100, minParticipants:40, daysLeft:1,
    specs:["ANC + Transparency","H2 Chip","6h + 30h Battery","MagSafe + USB-C"],
    desc:{ he:"האוזניות האלחוטיות הטובות של אפל עם ביטול רעשים H2, שקע USB-C ומסנן אקטיבי.", en:"Apple's best wireless earbuds with H2 ANC and USB-C charging.", ar:"أفضل سماعات آبل اللاسلكية مع إلغاء الضوضاء H2 وشحن USB-C.", ru:"Лучшие беспроводные наушники Apple с ANC H2 и USB-C." },
    bids:[
      { id:"b1", code:"BL03", amount:950, time:"לפני 5 שעות" },
      { id:"b2", code:"Bug", amount:820, time:"לפני 2 שעות" },
      { id:"b3", code:"BL05", amount:690, time:"לפני 20 דקות" },
    ]
  },
];