/**
 * test-zap-structure.mjs
 * Run: node test-zap-structure.mjs
 *
 * Fetches models.aspx?sog=c-pcdesktop page 1, analyses the HTML structure
 * to identify how Zap encodes product model IDs, and tests whether
 * data-model-id values work with model.aspx?modelid=NNN.
 */

import axios from "axios";

const ZAP_BASE = "https://www.zap.co.il";
const ZAP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Referer": "https://www.zap.co.il/",
};

async function diagnose() {
  const url = `${ZAP_BASE}/models.aspx?sog=c-pcdesktop&orderby=2`;
  console.log(`\nFetching: ${url}\n`);

  let resp;
  try {
    resp = await axios.get(url, {
      timeout: 20000,
      headers: ZAP_HEADERS,
      maxRedirects: 0,
      validateStatus: s => s < 500,
    });
  } catch (e) {
    console.error("Fetch failed:", e.message);
    return;
  }

  console.log(`Status: ${resp.status}`);
  console.log(`Content-Type: ${resp.headers["content-type"] || "(not set)"}`);
  console.log(`Location (redirect): ${resp.headers["location"] || "none"}`);

  const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
  console.log(`Body size: ${html.length} bytes\n`);

  // If tiny response, print full body to diagnose WAF block
  if (html.length < 5000) {
    console.log("=== FULL BODY (tiny response — likely WAF block) ===");
    console.log(html);
    console.log("=== END BODY ===\n");
    return;
  }

  // ── Pattern analysis ──────────────────────────────────────────────────────
  const modelidQuery   = [...new Set((html.match(/modelid=(\d+)/gi)          || []).map(m => m.match(/\d+/)[0]))];
  const dataModelHyph  = [...new Set((html.match(/data-model-id="(\d+)"/gi)  || []).map(m => m.match(/\d+/)[0]))]; // NEW with hyphen
  const dataModelNoH   = [...new Set((html.match(/data-modelid="(\d+)"/gi)   || []).map(m => m.match(/\d+/)[0]))]; // old no hyphen
  const seoPaths       = [...new Set((html.match(/\/model\/(\d+)-/gi)        || []).map(m => m.match(/\d+/)[0]))];
  const jsonModelids   = [...new Set((html.match(/"modelid"\s*:\s*(\d+)/gi)  || []).map(m => m.match(/\d+/)[0]))];
  const ariaLabel      = (html.match(/aria-label="להשוואת מחירים/g) || []).length;
  const modelRowCount  = (html.match(/class="model-row-v2/g) || []).length;
  const noModelCount   = (html.match(/noModelRow/g) || []).length;

  console.log("=== PATTERN COUNTS ===");
  console.log(`  model-row-v2 divs total:     ${modelRowCount}`);
  console.log(`  noModelRow (no compare page): ${noModelCount}`);
  console.log(`  modelid=NNN (query string):  ${modelidQuery.length} unique`);
  console.log(`  data-model-id="NNN" (hyphen): ${dataModelHyph.length} unique  ← NEW format`);
  console.log(`  data-modelid="NNN" (no hyph): ${dataModelNoH.length} unique`);
  console.log(`  /model/NNN- (SEO path):      ${seoPaths.length} unique`);
  console.log(`  "modelid": NNN (JSON):       ${jsonModelids.length} unique`);
  console.log(`  aria-label=להשוואת מחירים:  ${ariaLabel}`);

  if (modelidQuery.length > 0)  console.log(`  Sample modelid= IDs:          ${modelidQuery.slice(0,5).join(", ")}`);
  if (dataModelHyph.length > 0) console.log(`  Sample data-model-id IDs:     ${dataModelHyph.slice(0,5).join(", ")}`);

  // ── Show a full model-row-v2 div to understand its structure ─────────────
  console.log(`\n=== FIRST model-row-v2 div (truncated to 1200 chars) ===`);
  const firstRow = html.match(/<div class="model-row-v2[^>]*>[\s\S]{0,1200}/);
  if (firstRow) console.log(firstRow[0].replace(/\s+/g, " "));

  // ── Test if data-model-id works with model.aspx ──────────────────────────
  if (dataModelHyph.length > 0) {
    const testId = dataModelHyph[0];
    const testUrl = `${ZAP_BASE}/model.aspx?modelid=${testId}`;
    console.log(`\n=== TESTING model.aspx with data-model-id="${testId}" ===`);
    console.log(`  GET ${testUrl}`);
    try {
      const tr = await axios.get(testUrl, {
        timeout: 15000, headers: ZAP_HEADERS, maxRedirects: 5,
        validateStatus: s => s < 500,
      });
      const th = typeof tr.data === "string" ? tr.data : "";
      const finalUrl = tr.request?.res?.responseUrl || testUrl;
      const storeCount = (th.match(/class="price-box/g) || []).length;
      const titleMatch = th.match(/<h1[^>]*>([^<]{3,120})<\/h1>/);
      console.log(`  Status: ${tr.status} | Size: ${th.length}B | Final URL: ${finalUrl}`);
      console.log(`  H1 title: ${titleMatch ? titleMatch[1].trim() : "(not found)"}`);
      console.log(`  price-box count (stores): ${storeCount}`);
      if (th.length < 1000) console.log(`  Response: ${th.slice(0,500)}`);
    } catch(e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }

  // ── Also test one of the existing modelid= IDs for comparison ────────────
  if (modelidQuery.length > 0) {
    const testId = modelidQuery[0];
    const testUrl = `${ZAP_BASE}/model.aspx?modelid=${testId}`;
    console.log(`\n=== TESTING model.aspx with existing modelid="${testId}" ===`);
    console.log(`  GET ${testUrl}`);
    try {
      const tr = await axios.get(testUrl, {
        timeout: 15000, headers: ZAP_HEADERS, maxRedirects: 5,
        validateStatus: s => s < 500,
      });
      const th = typeof tr.data === "string" ? tr.data : "";
      const finalUrl = tr.request?.res?.responseUrl || testUrl;
      const storeCount = (th.match(/class="price-box/g) || []).length;
      const titleMatch = th.match(/<h1[^>]*>([^<]{3,120})<\/h1>/);
      console.log(`  Status: ${tr.status} | Size: ${th.length}B | Final URL: ${finalUrl}`);
      console.log(`  H1 title: ${titleMatch ? titleMatch[1].trim() : "(not found)"}`);
      console.log(`  price-box count (stores): ${storeCount}`);
    } catch(e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }

  console.log(`\n=== DONE ===\n`);
}

diagnose().catch(e => { console.error("Fatal:", e); process.exit(1); });
