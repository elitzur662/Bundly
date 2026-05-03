/**
 * zap_suppliers.js  –  Bundly supplier discovery tool
 * Fetches ZAP category pages (models.aspx?sog=X), extracts model IDs,
 * visits each model page, parses JSON-LD store offers, aggregates the
 * cheapest / most-active stores per category, saves results to JSON.
 *
 * Run: node zap_suppliers.js
 * Output: zap_suppliers_data.json
 */

const axios = require('axios');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ZAP_BASE   = 'https://www.zap.co.il';
const CF_WORKER  = 'https://bundly-zap-proxy.bundly-co-shop.workers.dev';
const DELAY_MS   = 1600;   // polite pause between requests
const MAX_MODELS = 20;     // models to sample per category

// Route through the CF Worker proxy (same as server.js cfWrap)
function cfWrap(zapUrl) {
  return `${CF_WORKER}/?url=${encodeURIComponent(zapUrl)}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── User-agent rotation (mirrors server.js) ────────────────────────────────
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];
let uai = 0;
const nextUA = () => UAS[uai++ % UAS.length];

function zapHeaders(referer = 'https://www.zap.co.il/') {
  return {
    'User-Agent':      nextUA(),
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer':         referer,
    'Cache-Control':   'no-cache',
  };
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const axCfg = (extra = {}) => ({
  headers:        zapHeaders(),
  httpsAgent,
  timeout:        22000,
  maxRedirects:   5,
  responseType:   'arraybuffer',
  ...extra,
});

// Decode Windows-1255 (ZAP's encoding)
function decode1255(buf) {
  try { return new TextDecoder('windows-1255').decode(buf); }
  catch(_) { return buf.toString('latin1'); }
}

// ── Extract model IDs + names from a ZAP models.aspx page ─────────────────
function extractModelIds(html) {
  const seenIds = new Set();
  const models  = [];

  // Primary pattern (same as server.js Method 1)
  const re1 = /href="\/model\.aspx\?modelid=(\d+)"[^>]{0,300}aria-label="להשוואת מחירים\s+([^"]{3,150})"/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    if (!seenIds.has(m[1])) { seenIds.add(m[1]); models.push({ id: m[1], name: m[2].trim() }); }
  }

  // Fallback: any modelid in href
  if (models.length === 0) {
    const re2 = /href="\/model\.aspx\?modelid=(\d+)"/g;
    while ((m = re2.exec(html)) !== null) {
      if (!seenIds.has(m[1])) { seenIds.add(m[1]); models.push({ id: m[1], name: '' }); }
    }
  }

  return models;
}

// ── Fetch one category page ────────────────────────────────────────────────
async function fetchCategoryPage(sog, pageIdx = 1) {
  const zapUrl = `${ZAP_BASE}/models.aspx?sog=${sog}&orderby=2${pageIdx > 1 ? `&Pageindex=${pageIdx}` : ''}`;
  // Try CF Worker first, fallback to direct
  for (const url of [cfWrap(zapUrl), zapUrl]) {
    try {
      const resp = await axios.get(url, axCfg());
      const html = decode1255(resp.data);
      const models = extractModelIds(html);
      if (models.length > 0 || url === zapUrl) return models;
    } catch (e) {
      process.stderr.write(`  ⚠ cat page ${sog} p${pageIdx} [${url.includes('workers') ? 'CF' : 'direct'}]: ${e.message}\n`);
    }
  }
  return [];
}

// ── Parse JSON-LD offers from a ZAP model page (same logic as server.js) ─
function parseModelPageStores(html, modelId) {
  const scriptRe = /<script[^>]+type=["']application\/ld(?:\+|&#x2[Bb];|&#43;)json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    try {
      const raw = sm[1]
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
        .replace(/&#x([0-9a-fA-F]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
        .replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(parseInt(d,10)));
      const data = JSON.parse(raw);

      const offers = Array.isArray(data?.offers?.offers) ? data.offers.offers
                   : Array.isArray(data?.offers)         ? data.offers : null;
      if (!Array.isArray(offers) || offers.length === 0) continue;

      const stores = [];
      for (const offer of offers) {
        const price     = parseFloat(offer.price || offer.lowPrice || 0);
        const storeName = offer.seller?.name || offer.offeredBy?.name || '';
        if (!storeName || price < 50) continue;
        const offerLink = offer.url || '';
        stores.push({
          storeName,
          price:     Math.round(price),
          storeLink: offerLink.startsWith('http') ? offerLink
                   : `${ZAP_BASE}/model.aspx?modelid=${modelId}`,
        });
      }
      if (stores.length > 0) return stores.sort((a,b) => a.price - b.price);
    } catch(_) {}
  }

  // Fallback: HTML row parsing (older ZAP pages)
  const stores = [];
  const chunks = html.split(/class="compare-item-row/);
  for (const chunk of chunks.slice(1)) {
    const priceM = chunk.match(/class="price">([0-9,]+)</);
    if (!priceM) continue;
    const price = parseInt(priceM[1].replace(/,/g,''));
    if (price < 50) continue;
    const nameM = chunk.match(/נותן אחריות\s*[-–]\s*([^<"]{2,40})/);
    if (!nameM) continue;
    stores.push({ storeName: nameM[1].trim(), price, storeLink: `${ZAP_BASE}/model.aspx?modelid=${modelId}` });
  }
  return stores.sort((a,b) => a.price - b.price);
}

// ── Fetch a model page and return its stores ───────────────────────────────
async function fetchModelStores(modelId) {
  const zapUrl = `${ZAP_BASE}/model.aspx?modelid=${modelId}&orderby=1`;
  for (const url of [cfWrap(zapUrl), zapUrl]) {
    try {
      const resp = await axios.get(url, axCfg({ headers: zapHeaders(`${ZAP_BASE}/models.aspx`) }));
      const html = decode1255(resp.data);
      const stores = parseModelPageStores(html, modelId);
      if (stores.length > 0 || url === zapUrl) return stores;
    } catch (e) {
      process.stderr.write(`  ⚠ model ${modelId} [${url.includes('workers') ? 'CF' : 'direct'}]: ${e.message}\n`);
    }
  }
  return [];
}

// ── Aggregate stores across multiple models ────────────────────────────────
function aggregateStores(allStoreArrays) {
  const map = {}; // storeName → { count, prices[], links: Set }
  for (const stores of allStoreArrays) {
    if (!stores || stores.length === 0) continue;
    const minP = stores[0].price;
    // Include stores within 12% of the cheapest offer (competitive)
    for (const s of stores.filter(x => x.price <= minP * 1.12)) {
      const k = s.storeName.trim();
      if (!k) continue;
      if (!map[k]) map[k] = { count: 0, prices: [], link: '' };
      map[k].count++;
      map[k].prices.push(s.price);
      if (s.storeLink && !map[k].link) map[k].link = s.storeLink;
    }
  }
  return Object.entries(map)
    .map(([name, d]) => ({
      storeName:   name,
      appearances: d.count,
      minPrice:    Math.min(...d.prices),
      avgPrice:    Math.round(d.prices.reduce((a,b)=>a+b,0) / d.prices.length),
      storeLink:   d.link,
    }))
    .sort((a,b) => b.appearances - a.appearances || a.avgPrice - b.avgPrice)
    .slice(0, 5);
}

// ── Categories to scan ────────────────────────────────────────────────────
const CATEGORIES = [
  { label: 'סמארטפונים',         sog: 'e-cellphone'       },
  { label: 'טלוויזיות',          sog: 'e-tv'              },
  { label: 'אוזניות',            sog: 'e-headphone'       },
  { label: 'רמקולים לבית',       sog: 'e-speaker'         },
  { label: 'רמקולים ניידים',     sog: 'e-mpspeakers'      },
  { label: 'סאונד בר',           sog: 'e-soundbar'        },
  { label: 'קולנוע ביתי',        sog: 'e-hometheater'     },
  { label: 'מקרנים',             sog: 'e-slideprojector'  },
  { label: 'מחשבים ניידים',      sog: 'c-pclaptop'        },
  { label: 'מחשבים נייחים',      sog: 'c-pcdesktop'       },
  { label: 'טאבלטים',            sog: 'c-tabletpc'        },
  { label: 'מסכי מחשב',          sog: 'c-monitor'         },
  { label: 'כרטיסי מסך',         sog: 'c-graphiccard'     },
  { label: 'מדפסות',             sog: 'c-printer'         },
  { label: 'מקלדות',             sog: 'c-keyboard'        },
  { label: 'עכברים',             sog: 'c-mouse'           },
  { label: 'מצלמות',             sog: 'e-camera'          },
  { label: 'קונסולות משחק',      sog: 'e-tvgame'          },
  { label: 'מזגנים',             sog: 'e-airconditioner'  },
  { label: 'מקררים',             sog: 'e-fridge'          },
  { label: 'מכונות כביסה',       sog: 'e-washingmachine'  },
  { label: 'מדיחי כלים',         sog: 'e-dishwasher'      },
  { label: 'מייבשי כביסה',       sog: 'e-drayer'          },
  { label: 'תנורי אפייה',         sog: 'e-oven'            },
  { label: 'כיריים',             sog: 'e-hobs'            },
  { label: 'מיקרוגלים',          sog: 'e-microwaveoven'   },
  { label: 'מכונות קפה',         sog: 'e-coffeemachine'   },
  { label: 'בלנדרים',            sog: 'e-blender'         },
  { label: 'קומקומים',           sog: 'e-kettle'          },
  { label: 'מגהצים',             sog: 'e-iron'            },
  { label: 'שואבי אבק',          sog: 'e-vaccumcleaner'   },
  { label: 'רובוטי ניקיון',      sog: 'e-robotvaccum'     },
  { label: 'מאווררים',           sog: 'e-fan'             },
  { label: 'מפזרי חום',          sog: 'e-airheater'       },
  { label: 'מייבשי שיער',        sog: 'e-hairdrier'       },
  { label: 'מגלחים',             sog: 'e-shaver'          },
  { label: 'מכשירי עיסוי',       sog: 'e-massager'        },
  { label: 'מכשירי יופי',        sog: 'e-beautymachine'   },
  { label: 'מקפיאים',            sog: 'e-freezer'         },
  { label: 'שמיכות חשמליות',     sog: 'e-electricblanket' },
  { label: 'מדי לחץ דם',         sog: 'e-bloodpressure'   },
  { label: 'נבולייזרים',         sog: 'e-nebulizer'       },
  { label: 'מד חמצן',            sog: 'e-oximeter'        },
  { label: 'הליכונים',           sog: 's-treadmill'       },
  { label: 'אופניים נייחים',     sog: 's-exercisebike'    },
  { label: 'קורקינטים חשמליים',  sog: 's-electricscooter' },
  { label: 'אופניים חשמליים',    sog: 's-electricbike'    },
  { label: 'אופניים רגילים',     sog: 's-bycicle'         },
  { label: 'כלי עבודה חשמליים',  sog: 'b-powertools'      },
  { label: 'בית חכם',            sog: 'b-smarthome'       },
  { label: 'מתקני מים',          sog: 'h-water'           },
];

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const results = [];
  const total   = CATEGORIES.length;

  for (let ci = 0; ci < total; ci++) {
    const cat = CATEGORIES[ci];
    process.stdout.write(`\n[${ci+1}/${total}] 📦 ${cat.label} (${cat.sog})\n`);

    // 1. Get model list from category page(s)
    let models = await fetchCategoryPage(cat.sog, 1);
    await sleep(DELAY_MS);

    if (models.length < 10) {
      const p2 = await fetchCategoryPage(cat.sog, 2);
      models = [...models, ...p2];
      if (p2.length > 0) await sleep(DELAY_MS);
    }

    process.stdout.write(`  → ${models.length} models found\n`);

    if (models.length === 0) {
      results.push({ label: cat.label, sog: cat.sog, stores: [] });
      continue;
    }

    // 2. Fetch model pages and collect store data
    const allStoreArrays = [];
    const toCheck = models.slice(0, MAX_MODELS);

    for (let mi = 0; mi < toCheck.length; mi++) {
      const model = toCheck[mi];
      const stores = await fetchModelStores(model.id);
      allStoreArrays.push(stores);
      process.stdout.write(`  [${mi+1}/${toCheck.length}] ${model.name.slice(0,45)} → ${stores.length} stores\n`);
      await sleep(DELAY_MS);
    }

    // 3. Aggregate
    const topStores = aggregateStores(allStoreArrays);
    process.stdout.write(`  ✅ Top stores:\n`);
    topStores.forEach((s,i) => process.stdout.write(`     ${i+1}. ${s.storeName} (${s.appearances} מוצרים, מינ. ₪${s.minPrice})\n`));

    results.push({ label: cat.label, sog: cat.sog, stores: topStores });
    await sleep(1000);
  }

  // 4. Save JSON for Excel step
  const outPath = '/sessions/optimistic-inspiring-bohr/zap_suppliers_data.json';
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  process.stdout.write(`\n✅ Saved JSON: ${outPath}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
