// Build israel-streets.json from the official data.gov.il street dataset.
// Usage: node scripts/build-streets.mjs
import https from "node:https";
import { writeFileSync } from "node:fs";

const RESOURCE_ID = "9ad3862c-8391-4b2f-84a4-2d4c68625f4b";
const PAGE_SIZE = 10000;

function fetchPage(offset) {
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${PAGE_SIZE}&offset=${offset}`;
  return new Promise((resolve, reject) => {
    https.get(url, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

const streetsByCity = {};
let offset = 0;
let total = Infinity;
let fetched = 0;

while (offset < total) {
  process.stdout.write(`\rFetching offset ${offset}... `);
  const j = await fetchPage(offset);
  if (offset === 0) {
    total = j.result?.total || 0;
    console.log(`\nTotal records to fetch: ${total}`);
  }
  const recs = j.result?.records || [];
  if (recs.length === 0) break;
  for (const r of recs) {
    const city   = String(r["שם_ישוב"]   || "").trim();
    const street = String(r["שם_רחוב"]   || "").trim();
    if (!city || !street) continue;
    // Skip placeholder rows where street == city (used for villages without streets)
    if (street === city || street === city.replace(/\s*\(.*?\)\s*/g, "").trim()) continue;
    // Skip "לא רלוונטי" / unmapped placeholders
    if (/^(לא רלוונטי|ללא שם|לא ידוע)/.test(street)) continue;
    if (!streetsByCity[city]) streetsByCity[city] = new Set();
    streetsByCity[city].add(street);
  }
  fetched += recs.length;
  offset += PAGE_SIZE;
}

console.log(`\nFetched ${fetched} records, ${Object.keys(streetsByCity).length} cities.`);

// Convert sets to sorted arrays
const out = {};
for (const [city, set] of Object.entries(streetsByCity)) {
  out[city] = [...set].sort((a, b) => a.localeCompare(b, "he"));
}

const totalStreets = Object.values(out).reduce((s, a) => s + a.length, 0);
console.log(`Writing israel-streets.json: ${Object.keys(out).length} cities, ${totalStreets} unique streets.`);

writeFileSync("israel-streets.json", JSON.stringify(out, null, 0), "utf8");
console.log("Done.");

// Sanity: verify Bnei Brak has "מנחם בגין" (or similar) and NOT "בגין" alone
const bb = out["בני ברק"] || [];
console.log(`\nSanity check — בני ברק: ${bb.length} streets`);
console.log(`  בגין-related streets: ${bb.filter(s => s.includes("בגין")).join(" | ") || "(none)"}`);
const tlv = out["תל אביב - יפו"] || out["תל אביב-יפו"] || [];
console.log(`  תל אביב: ${tlv.length} streets`);
