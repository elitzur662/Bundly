// ─────────────────────────────────────────────────────────────────
//  categorize.js — central spec → filterTags normalizer
//  Used by:
//   • scripts/tag-products.mjs (offline batch tagging of product-db)
//   • server.js  /api/product-specs  (live single-product tagging)
//   • server.js  stream batch        (attach pre-computed tags)
//
//  Input:
//   • specs       Array<{name, value}>  (from parseZapSpecs / ZAP JSON-LD)
//   • productName String                 (model title — fallback when specs are sparse)
//   • category    String                 (product-db folder name, e.g. "laptops")
//
//  Output:
//   • Object with normalised filter dimensions:
//     { cpu, ram, os, gpu, screen, resolution, refreshRate, panel, storage,
//       capacity, energy, hp, hands, sleeves, drum, weight, capacity_l,
//       fridgeType, dryerType, washerType, ovenType, hobType, vacuumType,
//       batteryRuntime, voltage, suction, pressure, ... }
//
//  Design rules:
//   1. Every product MUST get tagged. If a dimension can't be resolved, omit it
//      (don't insert "unknown") so filters never have a false-positive bucket.
//   2. Specs are authoritative; productName is a fallback for missing specs.
//   3. Vocabulary mirrors the dropdowns in App.jsx smartFilterDims so the UI
//      and the data agree.
// ─────────────────────────────────────────────────────────────────

// Normalise text for matching.
const norm = (s) => String(s ?? "").toLowerCase();

// Strip RTL/LTR HTML markers and bidi controls that ZAP embeds in product
// names — they slip between digits and units (e.g. "1.0&rlm;כ\"ס") and
// break the regex pipelines.
function stripBidi(s) {
  return String(s || "")
    .replace(/&rlm;|&lrm;|&amp;rlm;|&amp;lrm;/gi, "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "");
}

// Heuristic: pick a value either from a spec field whose name matches `nameRe`
// or from the product title when specs don't carry it.
function pickValue(specs, nameRe) {
  for (const sp of specs || []) {
    if (nameRe.test(sp.name)) return String(sp.value || "");
  }
  return "";
}

// Concatenate ALL spec values into one haystack — useful when spec field
// names vary widely across products and the value carries the signal.
// (e.g. headphone type might be in "עיצוב האוזניות", "סוג האוזניות",
// or "סוג החיבור" depending on the listing.)
function allValues(specs) {
  return (specs || []).map(sp => String(sp.value || "")).join(" ");
}

// ── CPU ──────────────────────────────────────────────────────────
function tagCpu(text) {
  const t = text;
  if (/\bM4\b/i.test(t))                                 return "Apple M4";
  if (/\bM3\b/i.test(t))                                 return "Apple M3";
  if (/\bM2\b/i.test(t))                                 return "Apple M2";
  if (/\bM1\b/i.test(t))                                 return "Apple M1";
  if (/core\s+ultra\s*9/i.test(t))                       return "Intel Core Ultra 9";
  if (/core\s+ultra\s*7/i.test(t))                       return "Intel Core Ultra 7";
  if (/core\s+ultra\s*5/i.test(t))                       return "Intel Core Ultra 5";
  if (/\b(?:core\s+)?i9\b|\bi9[-\s]?\d/i.test(t))        return "Intel Core i9";
  if (/\b(?:core\s+)?i7\b|\bi7[-\s]?\d/i.test(t))        return "Intel Core i7";
  if (/\b(?:core\s+)?i5\b|\bi5[-\s]?\d/i.test(t))        return "Intel Core i5";
  if (/\b(?:core\s+)?i3\b|\bi3[-\s]?\d/i.test(t))        return "Intel Core i3";
  if (/ryzen\s+(?:ai\s+)?9/i.test(t))                    return "AMD Ryzen 9";
  if (/ryzen\s+(?:ai\s+)?7/i.test(t))                    return "AMD Ryzen 7";
  if (/ryzen\s+(?:ai\s+)?5/i.test(t))                    return "AMD Ryzen 5";
  if (/ryzen\s+(?:ai\s+)?3/i.test(t))                    return "AMD Ryzen 3";
  if (/celeron/i.test(t))                                return "Intel Celeron";
  if (/pentium/i.test(t))                                return "Intel Pentium";
  if (/snapdragon\s*x/i.test(t))                         return "Snapdragon X";
  if (/snapdragon\s*8\s*gen/i.test(t))                   return "Snapdragon 8 Gen";
  if (/dimensity/i.test(t))                              return "MediaTek Dimensity";
  if (/exynos/i.test(t))                                 return "Samsung Exynos";
  if (/tensor/i.test(t))                                 return "Google Tensor";
  if (/a18\s*pro/i.test(t))                              return "Apple A18 Pro";
  if (/\ba18\b/i.test(t))                                return "Apple A18";
  if (/\ba17\s*pro/i.test(t))                            return "Apple A17 Pro";
  if (/\ba16\b/i.test(t))                                return "Apple A16";
  if (/\ba15\b/i.test(t))                                return "Apple A15";
  return null;
}

// ── RAM ──────────────────────────────────────────────────────────
function tagRam(text) {
  // ZAP often emits "GB 16" (Hebrew RTL display: "16 GB" but stored as
  // "GB" RLM "16"). Accept both orderings.
  const explicit = text.match(/(\d+)\s*GB\s+(?:RAM|LPDDR\d*|DDR\d*|Unified|Shared)/i)
                || text.match(/(?:RAM|Memory|זיכרון|זכרון)[:\s]+(\d+)\s*GB/i)
                || text.match(/\bGB\s*(\d+)\b/i);   // "GB 16" → 16GB
  if (explicit) return `${explicit[1]}GB`;
  // Heuristic: smaller GB values when storage is also present
  const all = [...text.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1]));
  const ramish = all.filter(v => v >= 4 && v <= 64);
  const storish = all.filter(v => v >= 128);
  if (ramish.length && storish.length) return `${Math.min(...ramish)}GB`;
  return null;
}

// ── Operating system ─────────────────────────────────────────────
function tagOs(text) {
  if (/windows\s+11/i.test(text))     return "Windows 11";
  if (/windows\s+10/i.test(text))     return "Windows 10";
  if (/macos|mac\s*os/i.test(text))   return "macOS";
  if (/macbook|imac\b|mac\s*mini/i.test(text)) return "macOS";
  if (/chrome\s*os/i.test(text))      return "ChromeOS";
  if (/ubuntu|fedora/i.test(text) || /\blinux\b/i.test(text)) return "Linux";
  if (/no\s*os|freedos|ללא\s*מערכת/i.test(text)) return "ללא מערכת הפעלה";
  if (/\bandroid\b/i.test(text))      return "Android";
  if (/\bios\b/i.test(text))          return "iOS";
  if (/\bipados\b/i.test(text))       return "iPadOS";
  if (/\bharmonyos\b/i.test(text))    return "HarmonyOS";
  return null;
}

// ── GPU ──────────────────────────────────────────────────────────
function tagGpu(text) {
  if (/rtx\s*50\d\d/i.test(text))     return "NVIDIA RTX 50xx";
  if (/rtx\s*40\d\d/i.test(text))     return "NVIDIA RTX 40xx";
  if (/rtx\s*30\d\d/i.test(text))     return "NVIDIA RTX 30xx";
  if (/\brtx\b/i.test(text))          return "NVIDIA RTX";
  if (/gtx\s*16\d\d/i.test(text))     return "NVIDIA GTX 16xx";
  if (/\bgtx\b/i.test(text))          return "NVIDIA GTX";
  if (/radeon\s*rx/i.test(text))      return "AMD Radeon RX";
  if (/radeon/i.test(text))           return "AMD Radeon";
  if (/intel\s+arc/i.test(text))      return "Intel Arc";
  if (/iris\s*xe/i.test(text))        return "Intel Iris Xe";
  return null;
}

// ── Resolution ───────────────────────────────────────────────────
function tagResolution(text) {
  if (/\b8k\b|7680\s*[x×]\s*4320/i.test(text))    return "8K";
  if (/\b4k\b|\buhd\b|3840\s*[x×]\s*2160/i.test(text))            return "4K / UHD";
  if (/\bqhd\b|\bwqhd\b|\b2\.?5k\b|2560\s*[x×]\s*1440/i.test(text)) return "QHD / 2.5K";
  if (/\bfhd\b|full.?hd|1920\s*[x×]\s*1[02]\d\d/i.test(text))     return "Full HD";
  if (/\bhd\b|1366\s*[x×]|1280\s*[x×]/i.test(text))               return "HD";
  return null;
}

// ── Refresh rate ─────────────────────────────────────────────────
function tagRefreshRate(text) {
  const m = text.match(/\b(360|300|240|165|144|120|90|75|60)\s*Hz\b/i)
        || text.match(/(?:רענון|refresh)[:\s]+(\d+)/i);
  return m ? `${m[1]}Hz` : null;
}

// ── Panel type ───────────────────────────────────────────────────
function tagPanel(text) {
  if (/qd[-\s]?oled/i.test(text))     return "QD-OLED";
  if (/mini[-\s]?led/i.test(text))    return "Mini-LED";
  if (/\bqled\b/i.test(text))         return "QLED";
  if (/nano\s*ips/i.test(text))       return "Nano IPS";
  if (/\boled/i.test(text))           return "OLED";
  if (/\bips\b/i.test(text))          return "IPS";
  if (/\bva\b(?!\.|[a-z])/i.test(text)) return "VA";
  if (/\btn\b(?!\.|[a-z])/i.test(text)) return "TN";
  if (/\blcd\b/i.test(text))          return "LCD";
  if (/\bled\b/i.test(text))          return "LED";
  return null;
}

// ── Screen size ──────────────────────────────────────────────────
function tagScreen(text) {
  const m1 = text.match(/\b(\d{1,2}\.?\d?)\s*["״]/);
  if (m1) return `${m1[1]}"`;
  const m2 = text.match(/\b(\d{1,2}\.?\d?)\s*(?:inch|אינטש|אינץ)/i);
  if (m2) return `${m2[1]}"`;
  return null;
}

// ── Storage ──────────────────────────────────────────────────────
function tagStorage(text) {
  const tb = text.match(/\b(\d+)\s*TB\b/i);
  if (tb) return `${tb[1]} TB`;
  const all = [...text.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1]));
  const big = all.filter(v => v >= 32);
  if (big.length) return `${Math.max(...big)} GB`;
  return null;
}

// ── Capacity (litres) — fridges, dishwashers, ovens, washers ─────
function tagCapacityLitres(specs, text) {
  // Spec field
  const v = pickValue(specs, /(נפח|קיבולת|capacity)/i);
  const m = (v || text).match(/(\d+(?:\.\d+)?)\s*(?:ל[׳']|ליטר|liter|l\b)/i);
  if (m) return `${m[1]} ל'`;
  return null;
}

// ── Capacity (kg) — washers, dryers ──────────────────────────────
function tagCapacityKg(specs, text) {
  const v = pickValue(specs, /(קיבולת|כביסה|capacity|load)/i);
  const m = (v || text).match(/(\d+(?:\.\d+)?)\s*(?:ק["']?ג|kg)/i);
  if (m) return `${m[1]} ק"ג`;
  return null;
}

// ── BTU/HP — air conditioners ────────────────────────────────────
function tagBtu(specs, text) {
  const v = pickValue(specs, /(תפוקת\s*קור|btu|תפוקה)/i);
  const m = (v || text).match(/(\d{4,6})\s*BTU/i);
  if (m) return `${m[1]} BTU`;
  return null;
}

function tagHp(specs, text) {
  const v = pickValue(specs, /(כ"ס|hp|כוח\s*סוס)/i);
  const m = (v || text).match(/(\d+(?:\.\d+)?)\s*(?:כ"ס|hp)/i);
  if (m) return `${m[1]} כ"ס`;
  return null;
}

// ── Energy class — A++, A+, A, B, C ─────────────────────────────
function tagEnergy(specs, text) {
  // Accept all common Hebrew variants: דרוג / דירוג / אנרגיה / אנרגטי
  const v = pickValue(specs, /(אנרג|energy|ד[יו]?רוג)/i);
  const src = v || text;
  // "A+++", "A++", "A+", "A", "B"…"G"
  const m = src.match(/(?:^|\s|דירוג|דרוג)\s*(A\+{0,3}|[A-G])\b/i);
  if (m) return m[1].toUpperCase();
  return null;
}

// ── Fridge type ──────────────────────────────────────────────────
function tagFridgeType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/4\s*דלתות|french\s*door|צרפתי/i.test(v))         return "4 דלתות";
  if (/side[\s-]*by[\s-]*side|זה\s*מול\s*זה/i.test(v)) return "זה מול זה";
  if (/מקפיא\s*עליון|top\s*freezer/i.test(v))           return "מקפיא עליון";
  if (/מקפיא\s*תחתון|bottom\s*freezer/i.test(v))        return "מקפיא תחתון";
  if (/מיני\s*בר|mini\s*bar/i.test(v))                  return "מיני בר";
  return null;
}

// ── Washer/Dryer type ────────────────────────────────────────────
function tagLoadType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/פתח\s*עליון|top\s*load/i.test(v))   return "פתח עליון";
  if (/פתח\s*חזית|front\s*load/i.test(v))  return "פתח חזיתי";
  return null;
}

// ── Oven type ────────────────────────────────────────────────────
function tagOvenType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/בנוי|built[\s-]*in/i.test(v))            return "בנוי";
  if (/חופשי|free[\s-]*standing/i.test(v))      return "חופשי";
  if (/טורבו/i.test(v))                          return "טורבו";
  return null;
}

// ── Hob type ─────────────────────────────────────────────────────
function tagHobType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/אינדוקציה|induction/i.test(v))           return "אינדוקציה";
  if (/קרמי|ceramic/i.test(v))                   return "קרמי";
  if (/גז|gas/i.test(v))                         return "גז";
  return null;
}

// ── Vacuum type ──────────────────────────────────────────────────
function tagVacuumType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/רובוט|robot/i.test(v))                    return "רובוט";
  if (/מקל|stick|אלחוטי\s*זקוף/i.test(v))        return "מקלי";
  if (/ידני|handheld/i.test(v))                  return "ידני";
  if (/שואב\s*מים|wet/i.test(v))                 return "שואב מים";
  return null;
}

// ── Headphone type ───────────────────────────────────────────────
function tagHeadphoneType(specs, text) {
  const v = allValues(specs) + " " + text;
  // Over-ear / Max-style cans first — these often also contain ear-cup terms
  if (/airpods\s*max\b|over[-\s]*ear|circumaural|מקיף|חוסמות\s*אוזן|studio\s*pro|wh-1000xm/i.test(v)) return "over-ear";
  if (/on[-\s]*ear|supra/i.test(v))                                                                  return "on-ear";
  if (/in[-\s]*ear|earbuds|אוזניות\s*לאוזן|פקקים|true\s*wireless|tws\b/i.test(v))                    return "in-ear";
  return null;
}

// ── TV smart platform ────────────────────────────────────────────
function tagSmartTv(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/google\s*tv/i.test(v))    return "Google TV";
  if (/android\s*tv/i.test(v))   return "Android TV";
  if (/web\s*os/i.test(v))       return "webOS";
  if (/tizen/i.test(v))          return "Tizen";
  if (/fire\s*tv/i.test(v))      return "Fire TV";
  if (/roku/i.test(v))           return "Roku TV";
  return null;
}

// ── Connectivity (5G/4G/Wi-Fi) — phones, tablets ────────────────
function tagConnectivity(specs, text) {
  const v = pickValue(specs, /(תקשורת|connectivity|רשת)/i) + " " + text;
  if (/\b5g\b/i.test(v))         return "5G";
  if (/\b4g\b|\blte\b/i.test(v)) return "4G / LTE";
  if (/wi-?fi\s*only/i.test(v))  return "Wi-Fi only";
  return null;
}

// ── Battery capacity (mAh) ───────────────────────────────────────
function tagBattery(specs, text) {
  const v = pickValue(specs, /(סוללה|battery|קיבולת\s*סוללה)/i);
  const m = (v || text).match(/(\d{3,5})\s*m?Ah/i);
  if (m) return `${m[1]} mAh`;
  return null;
}

// ── Camera resolution (MP) ───────────────────────────────────────
function tagCameraMp(specs, text) {
  const v = pickValue(specs, /(מצלמה|camera|רזולוציה.*מצלמה)/i);
  const m = (v || text).match(/(\d{2,3})\s*(?:MP|מ"פ)/i);
  if (m) return `${m[1]} MP`;
  return null;
}

// ── Wattage — kettles, microwaves, vacuums, hairdryers ──────────
function tagWatts(specs, text) {
  const v = pickValue(specs, /(הספק|חשמל|wattage|power|וואט)/i);
  const m = (v || text).match(/(\d{3,5})\s*W\b/i);
  if (m) return `${m[1]}W`;
  return null;
}

// ── Bicycle motor watts (e-bikes) ────────────────────────────────
function tagMotorW(specs, text) {
  const v = pickValue(specs, /(מנוע|motor|וואט\s*מנוע)/i);
  const m = (v || text).match(/(\d{3,4})\s*W\b/i);
  if (m) return `${m[1]}W`;
  return null;
}

// ── Wheel size — bikes, scooters ─────────────────────────────────
function tagWheelSize(specs, text) {
  const v = pickValue(specs, /(גלגל|wheel|אופן)/i);
  const m = (v || text).match(/(\d{2}(?:\.\d)?)\s*["״inch]/i);
  if (m) return `${m[1]}"`;
  return null;
}

// ── Bike frame size ──────────────────────────────────────────────
function tagFrameSize(specs, text) {
  const v = pickValue(specs, /(שלדה|frame|מידה)/i) + " " + text;
  if (/\bxs\b/i.test(v))        return "XS";
  if (/\bsmall\b|\bs\b/i.test(v) && /\b(?:s|small)\b/i.test(v)) return "S";
  if (/\bmedium\b|\bm\b/i.test(v)) return "M";
  if (/\blarge\b|\bl\b/i.test(v))  return "L";
  if (/\bxl\b/i.test(v))           return "XL";
  return null;
}

// ── Treadmill speed ──────────────────────────────────────────────
function tagMaxSpeed(specs, text) {
  const v = pickValue(specs, /(מהירות|speed)/i);
  const m = (v || text).match(/(\d+(?:\.\d+)?)\s*(?:קמ"ש|km\/?h)/i);
  if (m) return `${m[1]} קמ"ש`;
  return null;
}

// ── Coffee machine type ──────────────────────────────────────────
function tagCoffeeType(specs, text) {
  const v = allValues(specs) + " " + text;
  if (/קפסול|capsule|nespresso|dolce/i.test(v))     return "קפסולות";
  if (/אספרסו\s*ידני|manual/i.test(v))               return "אספרסו ידני";
  if (/אוטומטי\s*מלא|fully\s*automatic/i.test(v))   return "אוטומטית מלאה";
  if (/פילטר|filter|drip/i.test(v))                  return "פילטר";
  if (/מוקה|moka/i.test(v))                          return "מוקה";
  return null;
}

// ── Console family ───────────────────────────────────────────────
function tagConsole(text) {
  if (/playstation\s*5|\bps5\b/i.test(text))   return "PS5";
  if (/playstation\s*4|\bps4\b/i.test(text))   return "PS4";
  if (/xbox\s*series\s*x/i.test(text))         return "Xbox Series X";
  if (/xbox\s*series\s*s/i.test(text))         return "Xbox Series S";
  if (/xbox\s*one/i.test(text))                return "Xbox One";
  if (/nintendo\s*switch\s*2/i.test(text))     return "Switch 2";
  if (/nintendo\s*switch/i.test(text))         return "Switch";
  return null;
}

// ── Speaker / soundbar power ─────────────────────────────────────
function tagSpeakerPower(specs, text) {
  const v = pickValue(specs, /(הספק|rms|power)/i);
  const m = (v || text).match(/(\d{2,4})\s*W\b/i);
  if (m) return `${m[1]}W`;
  return null;
}

// ── Channels (sound bar / hi-fi) ─────────────────────────────────
function tagChannels(specs, text) {
  const v = pickValue(specs, /(ערוצים|channels|מערכת)/i) + " " + text;
  const m = v.match(/\b([2-9])\.[0-2](?:\.[0-9])?\b/);
  if (m) return m[0];
  return null;
}

// ── Robot vacuum: mop ────────────────────────────────────────────
function tagRobotMop(specs, text) {
  const v = pickValue(specs, /(שטיפה|mop)/i) + " " + text;
  if (/שוטף|mop|wet/i.test(v)) return "שוטף+שואב";
  if (/שואב\s*בלבד|vacuum\s*only/i.test(v)) return "שואב בלבד";
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  Per-category pipeline
//  Each category has a list of dimensions to extract.
// ─────────────────────────────────────────────────────────────────
const CATEGORY_DIMS = {
  // Computing
  laptops:        ["cpu", "ram", "os", "gpu", "screen", "resolution", "refreshRate", "panel", "storage"],
  desktops:       ["cpu", "ram", "os", "gpu", "storage"],
  monitors:       ["screen", "resolution", "refreshRate", "panel"],
  tablets:        ["cpu", "ram", "os", "screen", "storage", "connectivity"],
  "graphics-cards": ["gpu"],
  keyboards:      [],
  mice:           [],
  printers:       [],
  webcams:        [],
  "gaming-chairs":[],
  "gaming-accessories": [],

  // Phones
  phones:         ["cpu", "ram", "os", "screen", "resolution", "storage", "connectivity", "battery", "cameraMp", "refreshRate"],
  cellphones:     ["cpu", "ram", "os", "screen", "resolution", "storage", "connectivity", "battery", "cameraMp", "refreshRate"],

  // TV / Audio
  tvs:            ["screen", "resolution", "refreshRate", "panel", "smartTv"],
  soundbars:      ["channels", "speakerPower"],
  "home-theater": ["channels", "speakerPower"],
  speakers:       ["speakerPower"],
  "portable-speakers": ["speakerPower", "battery"],
  headphones:     ["headphoneType", "battery"],
  "media-players":[],
  projectors:     ["resolution", "watts"],

  // Cameras
  cameras:        ["cameraMp"],

  // Gaming consoles + games
  "gaming-consoles": ["console", "storage"],
  "ps4-games":    [],
  "ps5-games":    [],
  "nintendo-games": [],

  // Kitchen / large appliances
  fridges:        ["fridgeType", "capacity_l", "energy"],
  freezers:       ["capacity_l", "energy"],
  "washing-machines": ["loadType", "capacity_kg", "energy"],
  dryers:         ["loadType", "capacity_kg", "energy"],
  dishwashers:    ["capacity_l", "energy"],
  ovens:          ["ovenType", "capacity_l", "energy"],
  microwaves:     ["capacity_l", "watts"],
  hobs:           ["hobType"],
  "range-hoods":  ["watts"],

  // Small kitchen
  "coffee-machines": ["coffeeType", "watts"],
  kettles:        ["capacity_l", "watts"],
  toasters:       ["watts"],
  blenders:       ["watts"],
  mixers:         ["watts"],
  "food-processors": ["watts"],
  juicers:        ["watts"],
  "cooking-pots": ["capacity_l", "watts"],
  "electric-hotplates": ["watts"],

  // Climate
  "air-conditioners": ["btu", "hp", "energy"],
  "air-purifiers":["watts"],
  fans:           ["watts"],
  heaters:        ["watts"],
  "water-dispensers": ["capacity_l"],

  // Beauty / personal
  "hair-dryers":  ["watts"],
  "hair-stylers": ["watts"],
  "hair-accessories": [],
  shavers:        ["battery"],
  "lady-shavers": ["battery"],
  "beauty-machines": [],
  massagers:      [],
  "blood-pressure-monitors": [],
  nebulizers:     [],

  // Cleaning
  "robot-vacuums": ["robotMop", "battery", "watts"],
  "steam-cleaners": ["watts"],
  irons:          ["watts"],

  // Sport / mobility
  bicycles:       ["wheelSize", "frameSize"],
  "electric-scooters": ["motorW", "battery", "wheelSize", "maxSpeed"],
  treadmills:     ["watts", "maxSpeed"],
  "exercise-bikes": ["watts"],
  "cross-trainers": ["watts"],

  // Tools / outdoor / smart home
  "power-tools":  ["watts", "battery"],
  "lawn-mowers":  ["watts", "battery"],
  "smart-home":   [],

  // Furniture
  beds:           [],
  sofas:          [],
};

// Maps dim id → tagger function (for pipeline dispatch).
const DIM_TAGGERS = {
  cpu:         (specs, text) => tagCpu(text + " " + (pickValue(specs, /(מעבד|processor|cpu|chip|chipset|שבב)/i))),
  ram:         (specs, text) => tagRam(text + " " + (pickValue(specs, /(זיכרון|זכרון|ram|memory)/i))),
  os:          (specs, text) => tagOs(text + " " + (pickValue(specs, /(מערכת|os|operating)/i))),
  gpu:         (specs, text) => tagGpu(text + " " + (pickValue(specs, /(כרטיס\s*מסך|graphics|gpu|vga)/i))),
  screen:      (specs, text) => tagScreen((pickValue(specs, /(גודל\s*מסך|screen|inch|אינטש|אינץ)/i) + " " + text)),
  resolution:  (specs, text) => tagResolution(text + " " + (pickValue(specs, /(רזולוצ|resolution)/i))),
  refreshRate: (specs, text) => tagRefreshRate(text + " " + (pickValue(specs, /(רענון|refresh|hz)/i))),
  panel:       (specs, text) => tagPanel(text + " " + (pickValue(specs, /(פאנל|panel|תצוגה|טכנולוגי)/i))),
  storage:     (specs, text) => tagStorage(text + " " + (pickValue(specs, /(אחסון|storage|disk|drive|ssd|hdd|נפח)/i))),
  capacity_l:  tagCapacityLitres,
  capacity_kg: tagCapacityKg,
  energy:      tagEnergy,
  fridgeType:  tagFridgeType,
  loadType:    tagLoadType,
  ovenType:    tagOvenType,
  hobType:     tagHobType,
  vacuumType:  tagVacuumType,
  headphoneType: tagHeadphoneType,
  smartTv:     tagSmartTv,
  connectivity: tagConnectivity,
  battery:     tagBattery,
  cameraMp:    tagCameraMp,
  watts:       tagWatts,
  motorW:      tagMotorW,
  wheelSize:   tagWheelSize,
  frameSize:   tagFrameSize,
  maxSpeed:    tagMaxSpeed,
  coffeeType:  tagCoffeeType,
  console:     (specs, text) => tagConsole(text + " " + (pickValue(specs, /(דגם|model|console)/i))),
  speakerPower: tagSpeakerPower,
  channels:    tagChannels,
  robotMop:    tagRobotMop,
  btu:         tagBtu,
  hp:          tagHp,
};

// ─────────────────────────────────────────────────────────────────
//  Public: tagsFromZapSpecs(specs, productName, category)
//  Returns an Object whose keys are dimension ids and whose values
//  are the resolved bucket strings (or absent if unresolved).
// ─────────────────────────────────────────────────────────────────
export function tagsFromZapSpecs(specs, productName = "", category = "") {
  const out = {};
  const text = stripBidi(productName);
  // Sanitise spec values too — ZAP embeds &rlm; inside values like prices.
  const cleanSpecs = (specs || []).map(sp => ({
    name:  String(sp.name || ""),
    value: stripBidi(sp.value || ""),
  }));
  specs = cleanSpecs;
  const dims = CATEGORY_DIMS[category] || null;

  // If category unknown, attempt a generic pipeline that picks up the
  // dimensions most likely to be relevant from name-based heuristics.
  // This guarantees products from "search results" (no category) still get tagged.
  const pipeline = dims || [
    "cpu", "ram", "os", "gpu", "screen", "resolution", "refreshRate", "panel",
    "storage", "battery", "cameraMp", "watts", "energy",
  ];

  for (const id of pipeline) {
    const fn = DIM_TAGGERS[id];
    if (!fn) continue;
    try {
      const v = fn(specs || [], text);
      if (v != null && v !== "") out[id] = v;
    } catch (_) {}
  }

  return out;
}

// Convenience: identify the category bucket for a product when only the
// product name is known (e.g. organic search results). Returns the matching
// product-db folder name or null.
export function inferCategory(productName) {
  const n = String(productName || "").toLowerCase();
  if (/macbook|laptop|notebook|מחשב\s*נייד|לפטופ|thinkpad|ideapad|vivobook|zenbook|inspiron|pavilion|legion/i.test(n))
    return "laptops";
  if (/imac|desktop|מחשב\s*נייח|מיני\s*pc|nuc/i.test(n))
    return "desktops";
  if (/iphone|אייפון|galaxy\s*s\d|pixel\s*\d|סמארטפון|smartphone/i.test(n))
    return "phones";
  if (/ipad|אייפד|tablet|טאבלט/i.test(n))
    return "tablets";
  if (/\btv\b|טלוויזיה|טלויזיה/i.test(n))
    return "tvs";
  if (/monitor|מסך\s*מחשב|צג/i.test(n))
    return "monitors";
  if (/headphone|earbuds|אוזניות/i.test(n))
    return "headphones";
  if (/soundbar|סאונד\s*בר/i.test(n))
    return "soundbars";
  if (/airpods|רמקול\s*נייד|portable\s*speaker/i.test(n))
    return "portable-speakers";
  if (/refrigerator|fridge|מקרר/i.test(n))
    return "fridges";
  if (/washing\s*machine|washer|מכונת\s*כביסה/i.test(n))
    return "washing-machines";
  if (/dryer|מייבש/i.test(n))
    return "dryers";
  if (/dishwasher|מדיח/i.test(n))
    return "dishwashers";
  if (/microwave|מיקרוגל/i.test(n))
    return "microwaves";
  if (/oven|תנור/i.test(n))
    return "ovens";
  if (/air\s*conditioner|מזגן/i.test(n))
    return "air-conditioners";
  if (/coffee\s*machine|מכונת\s*קפה/i.test(n))
    return "coffee-machines";
  if (/kettle|קומקום/i.test(n))
    return "kettles";
  if (/blender|בלנדר/i.test(n))
    return "blenders";
  if (/vacuum|שואב\s*אבק/i.test(n))
    return "robot-vacuums";
  if (/playstation|xbox|nintendo|switch\b/i.test(n))
    return "gaming-consoles";
  if (/electric\s*scooter|קורקינט\s*חשמלי/i.test(n))
    return "electric-scooters";
  if (/electric\s*bike|אופניים\s*חשמליים/i.test(n))
    return "bicycles";
  return null;
}
