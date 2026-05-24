/**
 * Bundly, JSON File Database (no native deps required)
 * Stores all data in bundly-db.json next to server.js
 */
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On Render (or any host with a mounted persistent disk) we set DATA_DIR to
// the disk mount path so the JSON DB survives deploys. Locally DATA_DIR is
// unset and we fall back to the project directory like before.
const _DATA_DIR = process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)
  ? process.env.DATA_DIR
  : __dirname;
const DB_FILE   = path.join(_DATA_DIR, "bundly-db.json");

// ── Load / persist ──────────────────────────────────────────────
// Exported: server.js calls `_prodDb.load()` in requireSupplierMatch,
// _resolveVerifiedSupplier, charge-confirmed and the deal handlers. It was
// a private function, so every one of those calls threw "_prodDb.load is
// not a function", 403ing the whole supplier dashboard.
export function load() {
  let data;
  let primaryError = null;
  try {
    data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    primaryError = e;
    // SECURITY (P0, audit 2026-05-23): if the primary DB file is missing or
    // corrupt (the SIGKILL'd-mid-rename case in save()), try to recover from
    // the rolling .bak before falling through to an empty seed. Without this,
    // the next save() would copy the empty seed over the .bak too and we
    // would have destroyed both copies of the data.
    const bakPath = DB_FILE + ".bak";
    try {
      if (fs.existsSync(bakPath)) {
        data = JSON.parse(fs.readFileSync(bakPath, "utf8"));
        console.warn(`[DB] primary load failed (${e.message}), restored from .bak with ${Array.isArray(data?.users) ? data.users.length : 0} users`);
        // Eagerly write the restored data back as the primary so a future
        // save() doesn't overwrite our .bak with the soon-to-arrive snapshot.
        try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8"); } catch (_) {}
      }
    } catch (e2) {
      console.warn(`[DB] .bak restore also failed (${e2.message}); starting from empty seed`);
    }
    if (!data) {
      data = { users: [], otps: [], prefs: [], watchlist: [] };
      console.warn(`[DB] LOADING EMPTY SEED, primary error: ${primaryError.message}`);
    }
  }
  // Ensure new collections exist on upgrade
  if (!Array.isArray(data.personalRequests))  data.personalRequests  = [];
  if (!Array.isArray(data.joinedDeals))       data.joinedDeals       = [];
  if (!Array.isArray(data.orders))            data.orders            = [];
  if (!Array.isArray(data.transactions))      data.transactions      = [];
  if (!Array.isArray(data.suppliersRegistry)) data.suppliersRegistry = [];
  if (!Array.isArray(data.disputes))          data.disputes          = [];
  if (!Array.isArray(data.cannedResponses))   data.cannedResponses   = [];
  if (!Array.isArray(data.reviews))           data.reviews           = [];
  if (!Array.isArray(data.savedProducts))     data.savedProducts     = [];
  // dealBids: { [dealId]: [bid, bid, ...] }, supplier offers per deal.
  // Stored as a map to keep lookups O(1) per deal page.
  if (!data.dealBids || typeof data.dealBids !== "object" || Array.isArray(data.dealBids)) {
    data.dealBids = {};
  }
  // cancelledBids: append-only audit log of cancelled supplier offers.
  // Each entry: { dealId, bid, reason, supplierId, supplierName, cancelledAt }
  if (!Array.isArray(data.cancelledBids)) data.cancelledBids = [];
  // supplierProfiles: { [supplierId]: { businessName, taxId, address, bank,
  //   shippingZones, primaryCategories, logoUrl, bankConfirmed, taxConfirmed,
  //   payoutDay, completedAt, ... } }
  if (!data.supplierProfiles || typeof data.supplierProfiles !== "object" || Array.isArray(data.supplierProfiles)) data.supplierProfiles = {};
  // supplierInventory: { [supplierId]: [{ sku, name, qty, cost, brand, category, updatedAt }, ...] }
  if (!data.supplierInventory || typeof data.supplierInventory !== "object" || Array.isArray(data.supplierInventory)) data.supplierInventory = {};
  // autoBidRules: array of { id, supplierId, category, brand, modelMatch,
  //   maxPrice, undercut, active, createdAt }
  if (!Array.isArray(data.autoBidRules)) data.autoBidRules = [];
  // supplierNotifications: array of { id, supplierId, type, title, message,
  //   dealId, read, createdAt }
  if (!Array.isArray(data.supplierNotifications)) data.supplierNotifications = [];
  // dealQuestions: { [dealId]: [{ id, question, answer, askedBy, askedAt,
  //   answeredBy, answeredAt, public }, ...] }
  if (!data.dealQuestions || typeof data.dealQuestions !== "object" || Array.isArray(data.dealQuestions)) data.dealQuestions = {};
  // invoices: array of { id, orderId, supplierId, customerId, items[], total, createdAt }
  if (!Array.isArray(data.invoices)) data.invoices = [];
  // userInteractions: append-only stream of events (view/click/join/buy/search).
  // Used to build a "taste vector" that powers personal recommendations.
  // Each entry: { id, userId, type, dealId, productName, category, brand, price, query, ts }
  if (!Array.isArray(data.userInteractions)) data.userInteractions = [];
  // userTasteProfile: { [userId]: { topBrands, topCategories, avgBudget,
  //   minBudget, maxBudget, recentSearches[], updatedAt, summary, embedding } }
  if (!data.userTasteProfile || typeof data.userTasteProfile !== "object" || Array.isArray(data.userTasteProfile)) data.userTasteProfile = {};
  // automationState: persistent flags for jobs that must run at most once per day,
  // survives server restarts. Shape: { lastDigestDate: "YYYY-MM-DD", ... }.
  if (!data.automationState || typeof data.automationState !== "object" || Array.isArray(data.automationState)) data.automationState = {};
  // supplierListings: products a supplier publishes themselves (free creation
  // OR sourced from the ZAP catalog). Shape per item: { id, supplierId,
  //   source: "free"|"zap"|"inventory", zapModelId?, sku?, name, image,
  //   category, brand, basePrice, qty, description, active, createdAt }
  if (!Array.isArray(data.supplierListings)) data.supplierListings = [];
  // deals: persisted group-buy deals. One deal per productKey, everyone
  // interested in the same product joins the SAME deal. Shape per item:
  //   { id, productKey, name{}, desc{}, image, catIdx, marketMin, marketMax,
  //     groupOffer, discount, participants, maxParticipants, minParticipants,
  //     daysLeft, specs[], bids[], status, createdAt, updatedAt }
  if (!Array.isArray(data.deals)) data.deals = [];
  return data;
}

// ── Atomic + backed-up persist ─────────────────────────────────
// save() must never leave a half-written / corrupt DB file. We mirror the
// temp+rename pattern used by the other JSON caches in this repo (zap-db.js,
// db-sync.js): write to <file>.tmp, fsync, then rename over the real file.
// Before the rename we copy the current file to <file>.bak (one-deep rolling
// backup) so a bad write can always be recovered.
function save(data) {
  const json = JSON.stringify(data, null, 2);
  const tmp  = DB_FILE + ".tmp";
  // Rolling backup: copy the current good file aside before we touch it.
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + ".bak");
  } catch (e) {
    console.warn(`[DB] backup copy failed (non-fatal): ${e.message}`);
  }
  // Write the temp file via a descriptor so we can fsync before closing —
  // guarantees the bytes are physically flushed before the rename swap.
  let fd;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, json, 0, "utf8");
    try { fs.fsyncSync(fd); } catch (_) { /* best-effort */ }
    fs.closeSync(fd);
    fd = undefined;
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
  // Windows-safe atomic replace: renameSync over an existing file fails on
  // Windows, so delete the target first, then rename.
  try {
    if (fs.existsSync(DB_FILE)) {
      try { fs.unlinkSync(DB_FILE); } catch (_) {}
    }
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    // Last resort if rename fails (e.g. cross-device): direct overwrite.
    fs.writeFileSync(DB_FILE, json, "utf8");
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

let _db = load();

// ── Write serialization ────────────────────────────────────────
// Every public mutating function does load → mutate → save. Node is
// single-threaded, so a *fully synchronous* mutator can never interleave
// with another. The danger is a mutator that reads, yields to the event
// loop, then writes stale state. `_mutate()` wraps the read-modify-write
// in one synchronous critical section: it loads the freshest snapshot,
// runs the mutator against it, persists, and returns the mutator's result.
// Because the whole body runs synchronously with no `await`, two in-flight
// requests can never read-modify-write the same file concurrently, the
// second call only starts after the first has fully returned (incl. save).
// A re-entrancy depth counter lets a mutator that internally calls another
// mutator-style helper share the single load/save (no nested double-write).
let _mutateDepth = 0;
function _mutate(fn) {
  if (_mutateDepth > 0) {
    // Re-entrant call, operate on the already-loaded snapshot, the
    // outermost _mutate() will perform the single save.
    return fn(_db);
  }
  _mutateDepth++;
  try {
    _db = load();
    const out = fn(_db);
    save(_db);
    return out;
  } finally {
    _mutateDepth--;
  }
}

// Auto-increment helper
function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(r => r.id || 0)) + 1;
}

// ── Users ───────────────────────────────────────────────────────
export function upsertUser({ phone, name, email }) {
  _db = load();
  const existing = _db.users.find(u => u.phone === phone);
  if (existing) {
    existing.last_login = new Date().toISOString();
    save(_db);
    return existing;
  }
  const user = {
    id:         nextId(_db.users),
    phone,
    name:       name  || null,
    email:      email || null,
    created_at: new Date().toISOString(),
    last_login: new Date().toISOString(),
  };
  _db.users.push(user);
  save(_db);
  return user;
}

// Create a user identified by EMAIL when a phone is not yet available
// (email-OTP registration path). Phone is filled in later at the profile
// step. Caller MUST check getUserByEmail first to enforce email uniqueness.
export function createUserByEmail({ email, name }) {
  _db = load();
  const user = {
    id:         nextId(_db.users),
    phone:      null,
    name:       name  || null,
    email:      email ? String(email).trim().toLowerCase() : null,
    created_at: new Date().toISOString(),
    last_login: new Date().toISOString(),
  };
  _db.users.push(user);
  save(_db);
  return user;
}

export function getUserByPhone(phone) {
  _db = load();
  return _db.users.find(u => u.phone === phone) || null;
}

// Lookup by email, used to prevent a second account being created with an
// email that's already attached to a different phone. Case-insensitive
// because emails are case-insensitive per RFC 5321.
export function getUserByEmail(email) {
  if (!email) return null;
  const norm = String(email).trim().toLowerCase();
  if (!norm) return null;
  _db = load();
  return _db.users.find(u => (u.email || "").trim().toLowerCase() === norm) || null;
}

export function updateUser(id, fields) {
  _db = load();
  const user = _db.users.find(u => u.id === id);
  if (user) {
    const allowed = ["name","firstName","lastName","email","city","street","buildingNum","apartmentNum","termsAcceptedAt"];
    for (const key of allowed) {
      if (fields[key] != null) user[key] = fields[key];
    }
    save(_db);
  }
  return user;
}

// SECURITY (P0, audit 2026-05-23): atomic phone-claim for the email-signup
// → profile-fill flow. Two simultaneous PATCH /api/auth/profile calls with
// the same phone would both pass a pre-write getUserByPhone(null) check at
// the route layer, then both updateUser(...) → two rows share a phone, the
// second user is locked out of OTP login forever.
//
// This helper runs the uniqueness check + write inside the _mutate critical
// section, which is synchronous: no other mutator can interleave. Returns:
//   { ok: true, user }                if claim succeeded
//   { ok: false, reason: "taken" }    another user already owns this phone
//   { ok: false, reason: "has_phone" } caller already has a phone set
//   { ok: false, reason: "not_found" } caller id doesn't exist
export function claimUserPhone(userId, normalizedPhone) {
  if (!normalizedPhone) return { ok: false, reason: "missing" };
  return _mutate(db => {
    const me = db.users.find(u => u.id === userId);
    if (!me) return { ok: false, reason: "not_found" };
    // Round 2 audit P1: idempotency. If the user already owns THIS exact
    // phone (legitimate retry on a flaky network), treat as success
    // rather than 403'ing. Only block when the user has a DIFFERENT phone.
    if (me.phone === normalizedPhone) return { ok: true, user: me, idempotent: true };
    if (me.phone) return { ok: false, reason: "has_phone" };
    const taken = db.users.some(u => u.id !== userId && u.phone === normalizedPhone);
    if (taken) return { ok: false, reason: "taken" };
    me.phone = normalizedPhone;
    return { ok: true, user: me };
  });
}

// ── OTPs ────────────────────────────────────────────────────────
export function saveOtp(phone, code) {
  _db = load();
  // Invalidate previous OTPs for this phone
  _db.otps = _db.otps.filter(o => o.phone !== phone);
  _db.otps.push({
    id:         nextId(_db.otps),
    phone,
    code,
    expires_at: Date.now() + 5 * 60 * 1000, // 5 min
    used:       false,
  });
  save(_db);
}

// Constant-time string comparison, prevents timing attacks that could
// reveal an OTP digit-by-digit. Length is compared first (OTPs are fixed
// 6-digit so length is not a meaningful secret), then every char is XORed.
function _constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyOtp(phone, code) {
  _db = load();
  // Find an unused OTP for this phone, then compare the code in constant time
  // rather than letting `===` inside .find() leak timing information.
  const row = _db.otps.find(o => o.phone === phone && !o.used
    && _constantTimeEqual(String(o.code), String(code)));
  if (!row)              return { ok: false, reason: "wrong_code" };
  if (Date.now() > row.expires_at) return { ok: false, reason: "expired" };
  row.used = true;
  save(_db);
  return { ok: true };
}

// ── Notification prefs ──────────────────────────────────────────
export function getPrefs(userId) {
  _db = load();
  return _db.prefs.find(p => p.user_id === userId) || null;
}

export function upsertPrefs(userId, incoming) {
  _db = load();
  // Prototype-pollution defense-in-depth: strip dangerous keys before merging.
  const safeIncoming = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    safeIncoming[k] = v;
  }
  incoming = safeIncoming;
  const existing = _db.prefs.find(p => p.user_id === userId);
  if (existing) {
    Object.assign(existing, incoming, { user_id: userId });
  } else {
    _db.prefs.push({
      user_id:        userId,
      email:          incoming.email          ?? null,
      sms_enabled:    incoming.sms_enabled    ?? 1,
      email_enabled:  incoming.email_enabled  ?? 1,
      price_drop:     incoming.price_drop     ?? 1,
      deal_activated: incoming.deal_activated ?? 1,
      supplier_joined:incoming.supplier_joined ?? 1,
    });
  }
  save(_db);
  return getPrefs(userId);
}

// ── Watchlist ───────────────────────────────────────────────────
export function addToWatchlist(userId, dealId, productName, targetPrice) {
  _db = load();
  const exists = _db.watchlist.find(w => w.user_id === userId && w.deal_id === dealId);
  if (!exists) {
    _db.watchlist.push({ id: nextId(_db.watchlist), user_id: userId, deal_id: dealId, product_name: productName, target_price: targetPrice || null, created_at: new Date().toISOString() });
    save(_db);
  }
}

export function getWatchlist(userId) {
  _db = load();
  return _db.watchlist.filter(w => w.user_id === userId);
}

// ── Personal Requests ───────────────────────────────────────────
// Customer requests sent to ALL suppliers for a best-price check.
// Fields: product, category, budget, desc, name, phone, email,
//         timestamp, status (pending|offered|closed), offerPrice,
//         offerSupplier, currentLowestPrice, isSpecificModel, productImage,
//         userId (optional, null for guest)
const PERSONAL_REQUEST_FIELDS = [
  "product", "category", "budget", "desc", "name", "phone", "email",
  "currentLowestPrice", "isSpecificModel", "productImage", "userId",
];

export function listPersonalRequests() {
  _db = load();
  return _db.personalRequests
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function createPersonalRequest(input) {
  _db = load();
  const row = {
    id:        nextId(_db.personalRequests),
    timestamp: new Date().toISOString(),
    status:    "pending",
    offerPrice:    null,
    offerSupplier: null,
    offerAt:       null,
  };
  const TEXT_FIELDS = ["product", "category", "desc", "name", "phone", "email"];
  for (const key of PERSONAL_REQUEST_FIELDS) {
    let v = input[key] != null ? input[key] : null;
    if (typeof v === "string" && TEXT_FIELDS.includes(key)) v = sanitizeText(v);
    row[key] = v;
  }
  _db.personalRequests.unshift(row);
  save(_db);
  return row;
}

export function updatePersonalRequest(id, fields) {
  _db = load();
  const req = _db.personalRequests.find(r => r.id === Number(id));
  if (!req) return null;
  const allowed = ["status", "offerPrice", "offerSupplier", "offerSupplierId", "offerAt"];
  for (const key of allowed) {
    if (fields[key] !== undefined) req[key] = fields[key];
  }
  save(_db);
  return req;
}

export function getPersonalRequest(id) {
  _db = load();
  return _db.personalRequests.find(r => r.id === Number(id)) || null;
}

// Seed demo data on first boot (only if collection is empty).
// Keeps the supplier dashboard useful for a fresh install.
export function seedPersonalRequestsIfEmpty(seed) {
  _db = load();
  if (_db.personalRequests.length > 0) return;
  if (!Array.isArray(seed) || seed.length === 0) return;
  let idCounter = 1;
  _db.personalRequests = seed.map(s => ({
    id:        idCounter++,
    timestamp: s.timestamp || new Date().toISOString(),
    status:    s.status || "pending",
    offerPrice:    s.offerPrice || null,
    offerSupplier: s.offerSupplier || null,
    offerAt:       null,
    ...Object.fromEntries(
      PERSONAL_REQUEST_FIELDS.map(k => [k, s[k] != null ? s[k] : null])
    ),
  }));
  save(_db);
  console.log(`[DB] Seeded ${_db.personalRequests.length} personal requests`);
}

// ── Joined Deals ────────────────────────────────────────────────
// Customer commits to a deal at a specific tier (interested/watching/committed)
// Reverse-lookup: all joins for a single deal. Used by the deal-close
// endpoint to materialize orders for every committed participant without
// having to walk every user in the database.
export function listJoinedDealsByDealId(dealId) {
  _db = load();
  return (_db.joinedDeals || []).filter(j => String(j.dealId) === String(dealId));
}

export function listJoinedDeals(userId) {
  _db = load();
  return _db.joinedDeals.filter(j => j.userId === Number(userId));
}

export function upsertJoinedDeal({ userId, dealId, tier }) {
  _db = load();
  const existing = _db.joinedDeals.find(j => j.userId === Number(userId) && j.dealId === Number(dealId));
  if (existing) {
    existing.tier = tier;
    existing.updatedAt = new Date().toISOString();
  } else {
    _db.joinedDeals.push({
      id: nextId(_db.joinedDeals),
      userId: Number(userId),
      dealId: Number(dealId),
      tier,
      joinedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  save(_db);
  return _db.joinedDeals.filter(j => j.userId === Number(userId));
}

export function removeJoinedDeal(userId, dealId) {
  _db = load();
  _db.joinedDeals = _db.joinedDeals.filter(j => !(j.userId === Number(userId) && j.dealId === Number(dealId)));
  save(_db);
}

// Patch payment-related fields on an existing join record.
// Used by the SetupIntent + off-session charge flow:
//   • after /hold-spot or /commit-deposit  → { stripeCustomerId, setupIntentId, reservedAmount }
//   • after frontend confirmCardSetup     → { paymentMethodId, cardLast4, cardBrand, savedAt }
//   • after deal-close charge succeeds    → { chargedAt, lastChargeTxId, lastPaymentIntentId, chargeStatus }
// Non-destructive: only assigns fields that are passed in.
export function updateJoinedDealPayment(userId, dealId, fields = {}) {
  _db = load();
  const j = _db.joinedDeals.find(x => x.userId === Number(userId) && String(x.dealId) === String(dealId));
  if (!j) return null;
  const allowed = [
    "stripeCustomerId", "setupIntentId", "reservedAmount",
    "paymentMethodId", "cardLast4", "cardBrand", "savedAt",
    "chargedAt", "lastChargeTxId", "lastPaymentIntentId", "chargeStatus",
  ];
  for (const k of allowed) {
    if (fields[k] !== undefined) j[k] = fields[k];
  }
  j.updatedAt = new Date().toISOString();
  save(_db);
  return j;
}

// ── Orders ──────────────────────────────────────────────────────
// Created when a customer accepts a supplier offer OR a deal closes successfully
export function createOrder({ userId, supplierId, supplierName, productName, productImage, price, quantity = 1, requestId = null, dealId = null, shippingAddress, paymentMethod = "stub", paymentOption = "bundly" }) {
  _db = load();
  const order = {
    id: nextId(_db.orders),
    userId: userId ? Number(userId) : null,
    supplierId: supplierId || null,
    supplierName: supplierName || "",
    productName: productName || "",
    productImage: productImage || null,
    price: Number(price) || 0,
    quantity: Number(quantity) || 1,
    totalAmount: (Number(price) || 0) * (Number(quantity) || 1),
    requestId: requestId ? Number(requestId) : null,
    // dealId may be a string (e.g. "deal_abc") or a number, preserve as-is.
    // The earlier Number() coercion silently became NaN for string ids,
    // so the dealId field was lost on every group-buy order.
    dealId: dealId != null && dealId !== "" ? String(dealId) : null,
    shippingAddress: shippingAddress || null,
    paymentMethod,
    // paymentOption: "bundly" (Bundly processes the card) | "supplier_direct"
    // (customer pays the supplier on the supplier's own payment link).
    paymentOption: paymentOption === "supplier_direct" ? "supplier_direct" : "bundly",
    paymentStatus: "pending", // pending | paid | refunded | failed | pending_supplier
    status: "placed",         // placed | confirmed | shipped | delivered | cancelled
    trackingNumber: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  _db.orders.unshift(order);
  save(_db);
  return order;
}

export function listOrders(filter = {}) {
  _db = load();
  let rows = _db.orders;
  if (filter.userId) rows = rows.filter(o => o.userId === Number(filter.userId));
  if (filter.supplierId) rows = rows.filter(o => o.supplierId === filter.supplierId);
  if (filter.status) rows = rows.filter(o => o.status === filter.status);
  return rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getOrder(id) {
  _db = load();
  return _db.orders.find(o => o.id === Number(id)) || null;
}

export function updateOrder(id, fields) {
  _db = load();
  const order = _db.orders.find(o => o.id === Number(id));
  if (!order) return null;
  const allowed = ["status", "paymentStatus", "trackingNumber", "shippingAddress", "shippedAt", "deliveredAt", "cancelledAt", "cancelReason"];
  for (const k of allowed) {
    if (fields[k] !== undefined) order[k] = fields[k];
  }
  // Auto-stamp transition timestamps so the order timeline is complete
  // without callers having to remember every field. The "shipped at"
  // missing was particularly painful, the stale-shipped-order automation
  // had to fall back to updatedAt which would change again on delivery.
  const now = new Date().toISOString();
  if (fields.status === "shipped"   && !order.shippedAt)   order.shippedAt   = now;
  if (fields.status === "delivered" && !order.deliveredAt) order.deliveredAt = now;
  if (fields.status === "cancelled" && !order.cancelledAt) order.cancelledAt = now;
  order.updatedAt = now;
  save(_db);
  return order;
}

// ── Transactions ────────────────────────────────────────────────
// Every money movement: charge, refund, supplier payout, commission
export function createTransaction({ orderId, userId, supplierId, amount, type, status = "pending", paymentIntentId = null, notes = "" }) {
  _db = load();
  const tx = {
    id: nextId(_db.transactions),
    orderId: orderId ? Number(orderId) : null,
    userId: userId ? Number(userId) : null,
    supplierId: supplierId || null,
    amount: Number(amount) || 0,
    type,            // charge | refund | payout | commission
    status,          // pending | succeeded | failed
    paymentIntentId, // Stripe PaymentIntent id (when integrated)
    notes,
    createdAt: new Date().toISOString(),
  };
  _db.transactions.unshift(tx);
  save(_db);
  return tx;
}

export function listTransactions(filter = {}) {
  _db = load();
  let rows = _db.transactions;
  if (filter.orderId) rows = rows.filter(t => t.orderId === Number(filter.orderId));
  if (filter.userId) rows = rows.filter(t => t.userId === Number(filter.userId));
  if (filter.supplierId) rows = rows.filter(t => t.supplierId === filter.supplierId);
  if (filter.type) rows = rows.filter(t => t.type === filter.type);
  return rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function updateTransaction(id, fields) {
  _db = load();
  const tx = _db.transactions.find(t => t.id === Number(id));
  if (!tx) return null;
  const allowed = ["status", "paymentIntentId", "notes"];
  for (const k of allowed) {
    if (fields[k] !== undefined) tx[k] = fields[k];
  }
  save(_db);
  return tx;
}

// ── Suppliers Registry (KYC) ────────────────────────────────────
// Persistent supplier accounts with KYC verification
export function createSupplier({ businessName, businessNumber, ownerName, email, phone, address, category, description, licenseDoc = null, bankAccount = null }) {
  _db = load();
  const supplier = {
    id: nextId(_db.suppliersRegistry),
    businessName: businessName || "",
    businessNumber: businessNumber || "",
    ownerName: ownerName || "",
    email: email || "",
    phone: phone || "",
    address: address || "",
    category: category || "",
    description: description || "",
    licenseDoc,                   // path to uploaded business license PDF
    bankAccount,                  // { bank, branch, accountNumber }, for payouts
    paymentLink: "",              // supplier's own payment URL, used when a customer picks "pay supplier directly"
    commissionRate: 3,            // percent, Bundly commission billed to the supplier (first-year rate per supplier agreement)
    kycStatus: "pending",         // pending | approved | rejected
    kycReviewedAt: null,
    kycReviewedBy: null,
    kycRejectReason: null,
    rating: null,                 // average from reviews
    totalOrders: 0,
    totalRevenue: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  _db.suppliersRegistry.push(supplier);
  save(_db);
  return supplier;
}

export function listSuppliers(filter = {}) {
  _db = load();
  let rows = _db.suppliersRegistry;
  if (filter.kycStatus) rows = rows.filter(s => s.kycStatus === filter.kycStatus);
  if (filter.category) rows = rows.filter(s => s.category === filter.category);
  return rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getSupplier(id) {
  _db = load();
  return _db.suppliersRegistry.find(s => s.id === Number(id)) || null;
}

export function getSupplierByEmail(email) {
  _db = load();
  return _db.suppliersRegistry.find(s => s.email?.toLowerCase() === email.toLowerCase()) || null;
}

// Lookup by business number (ח.פ). Used by the real supplier-login flow:
// the supplier proves account ownership by their registered ח.פ + an OTP.
// Comparison strips whitespace/dashes so "51-234567-8" matches "512345678".
export function getSupplierByBusinessNumber(businessNumber) {
  _db = load();
  const norm = v => String(v ?? "").replace(/[\s-]/g, "");
  const wanted = norm(businessNumber);
  if (!wanted) return null;
  return _db.suppliersRegistry.find(s => norm(s.businessNumber) === wanted) || null;
}

export function updateSupplier(id, fields) {
  _db = load();
  const s = _db.suppliersRegistry.find(x => x.id === Number(id));
  if (!s) return null;
  const allowed = ["businessName","businessNumber","ownerName","email","phone","address","category","description","licenseDoc","bankAccount","kycStatus","kycReviewedAt","kycReviewedBy","kycRejectReason","rating","totalOrders","totalRevenue",
    // Feed-fetch metadata (P1 fix 2026-05-23): without these in the
    // whitelist, PUT /api/suppliers/:id/feed-url silently no-op'd, the
    // 6h cron found no feedUrl, and supplier inventory drifted out of
    // sync with their actual stock → oversold deals + cancellations.
    "feedUrl","feedFormat","feedLastSync","feedLastSyncCount","feedLastError"];
  for (const k of allowed) {
    if (fields[k] !== undefined) s[k] = fields[k];
  }
  s.updatedAt = new Date().toISOString();
  save(_db);
  return s;
}

// ── Disputes / Support Tickets ─────────────────────────────────
// "Disputes" was historically only per-order. We now also use this collection
// for general support tickets (no orderId), complaints, and feature requests
//, distinguished by `type`. New fields:
//   • type:        "order_dispute" | "general_support" | "complaint" | "feature_request"
//   • subject:     short title for general tickets
//   • category:    "billing" | "delivery" | "product" | "account" | "other"
//   • priority:    "urgent" | "high" | "normal" | "low"   (default "normal")
//   • slaTargetAt: ISO timestamp for first-response SLA
//   • tags:        array of admin-applied tag strings
//   • messages:    [{ role: "user"|"admin"|"system", text, ts, authorId, isCanned? }]
//   • csat:        { rating: 1..5, comment, submittedAt } | null
//   • contactEmail/contactPhone: for guests submitting without account
// Backward compat: orderId stays as-is for legacy entries; new general tickets pass orderId=null.
const SLA_HOURS_BY_PRIORITY = { urgent: 2, high: 6, normal: 24, low: 72 };
function _slaTargetFor(priority) {
  const hours = SLA_HOURS_BY_PRIORITY[priority] || SLA_HOURS_BY_PRIORITY.normal;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function createDispute({
  orderId = null, userId = null, reason, description,
  type = "order_dispute", subject = "", category = "other",
  priority = "normal", contactEmail = "", contactPhone = "",
}) {
  _db = load();
  const safePriority = ["urgent", "high", "normal", "low"].includes(priority) ? priority : "normal";
  const safeType     = ["order_dispute", "general_support", "complaint", "feature_request"].includes(type) ? type : "general_support";
  const dispute = {
    id: nextId(_db.disputes),
    type:        safeType,
    orderId:     orderId != null ? Number(orderId) : null,
    userId:      userId != null ? Number(userId) : null,
    subject:     sanitizeText(subject).slice(0, 120),
    category:    sanitizeText(category).slice(0, 30) || "other",
    priority:    safePriority,
    reason:      sanitizeText(reason).slice(0, 50),
    description: sanitizeText(description).slice(0, 2000),
    contactEmail: sanitizeText(contactEmail).slice(0, 120),
    contactPhone: sanitizeText(contactPhone).slice(0, 30),
    status: "open",        // open | in_progress | awaiting_user | resolved | rejected
    resolution: null,      // "refunded" | "replaced" | "rejected" | "info_provided" | null
    adminNotes: "",
    tags: [],
    messages: description ? [{
      role: "user",
      text: sanitizeText(description).slice(0, 2000),
      ts: new Date().toISOString(),
      authorId: userId != null ? Number(userId) : null,
    }] : [],
    csat: null,
    slaTargetAt: _slaTargetFor(safePriority),
    firstAdminReplyAt: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  _db.disputes.unshift(dispute);
  save(_db);
  return dispute;
}

export function listDisputes(filter = {}) {
  _db = load();
  let rows = _db.disputes;
  if (filter.status)   rows = rows.filter(d => d.status === filter.status);
  if (filter.userId)   rows = rows.filter(d => d.userId === Number(filter.userId));
  if (filter.orderId)  rows = rows.filter(d => d.orderId === Number(filter.orderId));
  if (filter.type)     rows = rows.filter(d => (d.type || "order_dispute") === filter.type);
  if (filter.priority) rows = rows.filter(d => (d.priority || "normal") === filter.priority);
  return rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getDispute(id) {
  _db = load();
  return _db.disputes.find(x => x.id === Number(id)) || null;
}

export function updateDispute(id, fields) {
  _db = load();
  const d = _db.disputes.find(x => x.id === Number(id));
  if (!d) return null;
  const allowed = [
    "status", "resolution", "adminNotes", "resolvedAt",
    "priority", "tags", "category", "subject",
  ];
  for (const k of allowed) {
    if (fields[k] !== undefined) d[k] = fields[k];
  }
  // Refresh SLA if priority changed and the ticket is still open
  if (fields.priority !== undefined && d.status !== "resolved" && d.status !== "rejected") {
    d.slaTargetAt = _slaTargetFor(d.priority || "normal");
  }
  save(_db);
  return d;
}

// Add a message to a dispute thread (user or admin reply).
// Tracks `firstAdminReplyAt` automatically so SLA reports can compute response time.
export function addDisputeMessage(id, { role, text, authorId = null, isCanned = false }) {
  _db = load();
  const d = _db.disputes.find(x => x.id === Number(id));
  if (!d) return null;
  if (!Array.isArray(d.messages)) d.messages = [];
  const msg = {
    role: ["user", "admin", "system"].includes(role) ? role : "user",
    text: sanitizeText(text).slice(0, 2000),
    ts: new Date().toISOString(),
    authorId: authorId != null ? Number(authorId) : null,
    isCanned: !!isCanned,
  };
  d.messages.push(msg);
  if (msg.role === "admin" && !d.firstAdminReplyAt) d.firstAdminReplyAt = msg.ts;
  // Admin reply flips status from "open" to "in_progress" if still open
  if (msg.role === "admin" && d.status === "open") d.status = "in_progress";
  save(_db);
  return msg;
}

// Customer-side CSAT survey after a ticket is resolved.
export function submitCsat(id, { rating, comment = "" }) {
  _db = load();
  const d = _db.disputes.find(x => x.id === Number(id));
  if (!d) return null;
  const r = Math.max(1, Math.min(5, Number(rating) || 0));
  if (!r) return null;
  d.csat = {
    rating: r,
    comment: sanitizeText(comment).slice(0, 500),
    submittedAt: new Date().toISOString(),
  };
  save(_db);
  return d.csat;
}

// Admin reports: totals + SLA breach count + CSAT avg.
export function getDisputeStats() {
  _db = load();
  const all = _db.disputes || [];
  const now = Date.now();
  const isOpen = d => d.status !== "resolved" && d.status !== "rejected";
  const slaBreached = d => isOpen(d) && d.slaTargetAt && new Date(d.slaTargetAt).getTime() < now && !d.firstAdminReplyAt;
  const csatRatings = all.filter(d => d.csat?.rating).map(d => d.csat.rating);
  const csatAvg = csatRatings.length > 0 ? (csatRatings.reduce((s, r) => s + r, 0) / csatRatings.length) : null;
  const byStatus = {}, byPriority = {}, byType = {};
  for (const d of all) {
    byStatus[d.status || "open"] = (byStatus[d.status || "open"] || 0) + 1;
    byPriority[d.priority || "normal"] = (byPriority[d.priority || "normal"] || 0) + 1;
    byType[d.type || "order_dispute"] = (byType[d.type || "order_dispute"] || 0) + 1;
  }
  // Compute median first-response time in hours over the last 90 days
  const since = now - 90 * 86400_000;
  const responseTimes = all
    .filter(d => d.firstAdminReplyAt && new Date(d.createdAt).getTime() >= since)
    .map(d => (new Date(d.firstAdminReplyAt).getTime() - new Date(d.createdAt).getTime()) / 3600_000)
    .sort((a, b) => a - b);
  const median = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length / 2)] : null;
  return {
    total: all.length,
    open: all.filter(isOpen).length,
    slaBreaches: all.filter(slaBreached).length,
    byStatus, byPriority, byType,
    csatAvg: csatAvg != null ? Math.round(csatAvg * 10) / 10 : null,
    csatCount: csatRatings.length,
    medianFirstResponseHours: median != null ? Math.round(median * 10) / 10 : null,
  };
}

// ── Canned responses (admin reply templates) ────────────────────
// Stored as flat array under _db.cannedResponses, keyed by id.
export function listCannedResponses() {
  _db = load();
  return (_db.cannedResponses || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}
export function createCannedResponse({ title, body, category = "general" }) {
  _db = load();
  if (!Array.isArray(_db.cannedResponses)) _db.cannedResponses = [];
  const r = {
    id: nextId(_db.cannedResponses),
    title: sanitizeText(title).slice(0, 80),
    body:  sanitizeText(body).slice(0, 2000),
    category: sanitizeText(category).slice(0, 30) || "general",
    order: _db.cannedResponses.length,
    createdAt: new Date().toISOString(),
  };
  _db.cannedResponses.push(r);
  save(_db);
  return r;
}
export function updateCannedResponse(id, fields) {
  _db = load();
  const r = (_db.cannedResponses || []).find(x => x.id === Number(id));
  if (!r) return null;
  for (const k of ["title", "body", "category", "order"]) {
    if (fields[k] !== undefined) r[k] = fields[k];
  }
  save(_db);
  return r;
}
export function deleteCannedResponse(id) {
  _db = load();
  if (!Array.isArray(_db.cannedResponses)) return false;
  const idx = _db.cannedResponses.findIndex(x => x.id === Number(id));
  if (idx < 0) return false;
  _db.cannedResponses.splice(idx, 1);
  save(_db);
  return true;
}

// ── Input sanitization: strip HTML tags + dangerous protocols ──
function sanitizeText(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, "")           // strip all HTML tags
    .replace(/javascript:/gi, "")      // strip javascript: URLs
    .replace(/on\w+\s*=/gi, "")        // strip on* handlers
    .trim();
}

// ── Reviews ─────────────────────────────────────────────────────
export function createReview({ supplierId, userId, orderId = null, rating, comment = "" }) {
  _db = load();
  const review = {
    id: nextId(_db.reviews),
    supplierId,
    userId: Number(userId),
    orderId: orderId ? Number(orderId) : null,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: sanitizeText(comment).slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  _db.reviews.unshift(review);
  save(_db);
  // Update supplier rating average
  const supplierReviews = _db.reviews.filter(r => r.supplierId === supplierId);
  const avg = supplierReviews.reduce((s, r) => s + r.rating, 0) / supplierReviews.length;
  const supplier = _db.suppliersRegistry.find(s => s.id === Number(supplierId));
  if (supplier) {
    supplier.rating = Math.round(avg * 10) / 10;
    save(_db);
  }
  return review;
}

export function listReviews(supplierId) {
  _db = load();
  return _db.reviews.filter(r => r.supplierId === (isNaN(Number(supplierId)) ? supplierId : Number(supplierId)))
    .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ── Web Push subscriptions ─────────────────────────────────────
// Each entry: { endpoint, keys: { p256dh, auth }, userId?, createdAt }
// The endpoint is the unique key (one device per push service URL).
export function savePushSubscription(userId, sub) {
  if (!sub || !sub.endpoint) return null;
  return _mutate(db => {
    if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
    // Dedup by endpoint; refresh userId on re-subscribe.
    const idx = db.pushSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
    const row = {
      endpoint:  sub.endpoint,
      keys:      sub.keys || {},
      userId:    Number(userId) || null,
      createdAt: idx >= 0 ? db.pushSubscriptions[idx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) db.pushSubscriptions[idx] = row;
    else db.pushSubscriptions.push(row);
    return row;
  });
}
export function removePushSubscription(endpoint) {
  if (!endpoint) return false;
  return _mutate(db => {
    const before = (db.pushSubscriptions || []).length;
    db.pushSubscriptions = (db.pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
    return db.pushSubscriptions.length < before;
  });
}
export function listPushSubscriptions(filter = {}) {
  _db = load();
  let rows = _db.pushSubscriptions || [];
  if (filter.userId != null) rows = rows.filter(s => Number(s.userId) === Number(filter.userId));
  return rows;
}

// ── Saved Products (cart) ───────────────────────────────────────
export function listSavedProducts(userId) {
  _db = load();
  return _db.savedProducts
    .filter(p => p.userId === Number(userId))
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}

export function addSavedProduct(userId, product) {
  _db = load();
  // Dedupe by product name per user. If the user is updating quantity
  // on an existing entry, refresh that field in place (no second row).
  const key = (product.name || product.productName || "").toLowerCase();
  if (!key) return null;
  const exists = _db.savedProducts.find(p => p.userId === Number(userId) && (p.name || "").toLowerCase() === key);
  if (exists) {
    if (product.quantity != null) {
      exists.quantity = Math.max(1, Math.min(10, Number(product.quantity) || 1));
    }
    save(_db);
    return exists;
  }
  const row = {
    id: nextId(_db.savedProducts),
    userId: Number(userId),
    name: product.name || product.productName || "",
    image: product.image || "",
    tier: product.tier || "interested",
    action: product.action || "saved",
    catIdx: product.catIdx ?? null,
    price: Number(product.price) || 0,
    quantity: Math.max(1, Math.min(10, Number(product.quantity) || 1)),
    _cachedResult: product._cachedResult || null,
    addedAt: new Date().toISOString(),
  };
  _db.savedProducts.push(row);
  save(_db);
  return row;
}

// Aggregate "מתעניינים" (interested customers) per product, used by the
// supplier dashboard to show real demand signals without exposing PII.
// Returns rows: { name, image, catIdx, customers, units, latest, price }
// where `customers` is the count of distinct users who saved this product
// and `units` is the sum of their quantities.
// catIdxFilter: optional array of catIdx values the supplier serves; only
// rows matching these are returned (suppliers only see demand in their
// own categories).
export function aggregateCustomerInterests({ catIdxFilter = null, limit = 50, excludeUserIds = null } = {}) {
  _db = load();
  const buckets = new Map();
  // SECURITY (P1, audit 2026-05-23): suppliers testing the platform as
  // customers (e.g. saving a product to their own wishlist) used to show
  // up in their OWN "מתעניינים" tile as a phantom customer. excludeUserIds
  // lets the supplier-side endpoint filter out the supplier's own user
  // account(s), giving a clean demand signal.
  const _exclude = Array.isArray(excludeUserIds) && excludeUserIds.length > 0
    ? new Set(excludeUserIds.map(n => Number(n)))
    : null;
  for (const row of (_db.savedProducts || [])) {
    if (!row || !row.name) continue;
    if (_exclude && _exclude.has(Number(row.userId))) continue;
    if (Array.isArray(catIdxFilter) && catIdxFilter.length > 0
        && (row.catIdx == null || !catIdxFilter.includes(row.catIdx))) continue;
    const key = String(row.name).trim().toLowerCase();
    if (!key) continue;
    const bucket = buckets.get(key) || {
      name: row.name,
      image: row.image || "",
      catIdx: row.catIdx,
      customers: 0,
      units: 0,
      latest: null,
      avgPrice: 0,
      _prices: [],
      _userIds: new Set(),
    };
    if (!bucket._userIds.has(row.userId)) {
      bucket._userIds.add(row.userId);
      bucket.customers += 1;
    }
    bucket.units += Math.max(1, Number(row.quantity) || 1);
    if (Number(row.price) > 0) bucket._prices.push(Number(row.price));
    const added = row.addedAt ? new Date(row.addedAt).getTime() : 0;
    if (!bucket.latest || added > new Date(bucket.latest).getTime()) {
      bucket.latest = row.addedAt;
    }
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values())
    .map(b => ({
      name:      b.name,
      image:     b.image,
      catIdx:    b.catIdx,
      customers: b.customers,
      units:     b.units,
      latest:    b.latest,
      avgPrice:  b._prices.length
        ? Math.round(b._prices.reduce((s, n) => s + n, 0) / b._prices.length)
        : 0,
    }))
    .sort((a, b) => b.customers - a.customers || b.units - a.units)
    .slice(0, limit);
}

export function removeSavedProduct(userId, productId) {
  _db = load();
  _db.savedProducts = _db.savedProducts.filter(p => !(p.userId === Number(userId) && p.id === Number(productId)));
  save(_db);
}

// ── Deal bids (supplier offers) ────────────────────────────────
// Storage shape: db.dealBids = { [dealId]: [bid, bid, ...] }
// Each bid: { id, amount, time, supplierId, supplierName, code, createdAt }
// Bids are kept sorted ascending by amount on insert so the lowest is bid[0].

export function listDealBids() {
  _db = load();
  return _db.dealBids || {};
}

export function getDealBids(dealId) {
  _db = load();
  return (_db.dealBids?.[String(dealId)]) || [];
}

// Cap the cancellation audit log to 5,000 entries (drop oldest).
// Without this, the log grew forever, every cancel adds one entry.
function _capCancelledBids(list) {
  if (!Array.isArray(list)) return [];
  if (list.length <= 5000) return list;
  return list.slice(-5000);
}

// Cancel (remove) a supplier's bid. Records the cancellation with reason
// in cancelledBids so admins/disputes can audit later.
// Returns { ok, bids: updatedList, cancelled: { bid, reason, ... } }.
export function cancelDealBid(dealId, bidId, supplierId, reason) {
  _db = load();
  if (!_db.dealBids || typeof _db.dealBids !== "object") _db.dealBids = {};
  if (!Array.isArray(_db.cancelledBids)) _db.cancelledBids = [];
  const key  = String(dealId);
  const list = _db.dealBids[key] || [];
  const idx  = list.findIndex(b => b.id === bidId && b.supplierId === supplierId);
  if (idx === -1) return { ok: false, reason: "not_found", bids: list };
  const [removed] = list.splice(idx, 1);
  _db.dealBids[key] = list;
  const auditEntry = {
    dealId:       key,
    bid:          removed,
    reason:       String(reason || "").slice(0, 500),
    supplierId,
    supplierName: removed.supplierName || "",
    cancelledAt:  new Date().toISOString(),
  };
  _db.cancelledBids.push(auditEntry);
  _db.cancelledBids = _capCancelledBids(_db.cancelledBids);
  save(_db);
  return { ok: true, bids: list, cancelled: auditEntry };
}

export function addDealBid(dealId, bid) {
  _db = load();
  if (!_db.dealBids || typeof _db.dealBids !== "object" || Array.isArray(_db.dealBids)) {
    _db.dealBids = {};
  }
  const key = String(dealId);
  const list = _db.dealBids[key] || [];
  // De-dupe: same supplier + same amount within 5s = same bid (race protection)
  const exists = list.some(b =>
    b.supplierId === bid.supplierId &&
    Number(b.amount) === Number(bid.amount) &&
    Math.abs(Date.parse(b.createdAt || 0) - Date.now()) < 5000
  );
  if (exists) return list;
  const enriched = {
    ...bid,
    id:        bid.id || `b${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    createdAt: new Date().toISOString(),
  };
  list.push(enriched);
  list.sort((a, b) => (a.amount || 0) - (b.amount || 0));
  _db.dealBids[key] = list;
  save(_db);
  return list;
}

// ── Supplier profiles ──────────────────────────────────────────
export function getSupplierProfile(supplierId) {
  _db = load();
  return _db.supplierProfiles?.[String(supplierId)] || null;
}
export function upsertSupplierProfile(supplierId, fields) {
  _db = load();
  if (!_db.supplierProfiles || typeof _db.supplierProfiles !== "object" || Array.isArray(_db.supplierProfiles)) _db.supplierProfiles = {};
  const key = String(supplierId);
  const existing = _db.supplierProfiles[key] || { supplierId: key, createdAt: new Date().toISOString() };
  // Treat null / undefined / "" / [] as explicit clears so a supplier can
  // remove their address or empty their primary categories list. Non-empty
  // values overwrite as before.
  const merged = { ...existing };
  for (const [k, v] of Object.entries(fields)) {
    // Prototype-pollution defense-in-depth: never copy dangerous keys.
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (v === null || v === undefined) {
      delete merged[k];
      continue;
    }
    if (typeof v === "string" && v.trim() === "") {
      delete merged[k];
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      delete merged[k];
      continue;
    }
    merged[k] = v;
  }
  merged.updatedAt = new Date().toISOString();
  // Recompute completion checklist on every save
  merged.checklist = {
    business:    !!(merged.businessName && merged.taxId),
    address:     !!(merged.address && merged.city),
    bank:        !!(merged.bankAccount && merged.bankBranch && merged.bankNumber),
    categories:  Array.isArray(merged.primaryCategories) && merged.primaryCategories.length > 0,
    shipping:    Array.isArray(merged.shippingZones) && merged.shippingZones.length > 0,
    logo:        !!merged.logoUrl,
  };
  merged.completionPct = Math.round(
    (Object.values(merged.checklist).filter(Boolean).length / Object.keys(merged.checklist).length) * 100
  );
  _db.supplierProfiles[key] = merged;
  save(_db);
  return merged;
}

// ── Supplier inventory ─────────────────────────────────────────
export function listSupplierInventory(supplierId) {
  _db = load();
  return _db.supplierInventory?.[String(supplierId)] || [];
}
export function upsertInventoryItem(supplierId, item) {
  _db = load();
  if (!_db.supplierInventory || typeof _db.supplierInventory !== "object" || Array.isArray(_db.supplierInventory)) _db.supplierInventory = {};
  const key  = String(supplierId);
  const list = _db.supplierInventory[key] || [];
  const idx  = list.findIndex(x => x.sku === item.sku);
  const enriched = {
    sku:       String(item.sku || "").trim(),
    name:      String(item.name || "").trim(),
    qty:       Number.isFinite(Number(item.qty))  ? Number(item.qty)  : 0,
    cost:      Number.isFinite(Number(item.cost)) ? Number(item.cost) : 0,
    brand:     String(item.brand || "").trim(),
    category:  String(item.category || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!enriched.sku) return null;
  if (idx >= 0) list[idx] = { ...list[idx], ...enriched };
  else list.push(enriched);
  _db.supplierInventory[key] = list;
  save(_db);
  return enriched;
}
// Real bulk upsert, single load + single save. Calling upsertInventoryItem
// in a loop would do 2× len(items) disk operations; this reduces it to 2.
export function bulkUpsertInventory(supplierId, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  _db = load();
  if (!_db.supplierInventory || typeof _db.supplierInventory !== "object" || Array.isArray(_db.supplierInventory)) _db.supplierInventory = {};
  const key  = String(supplierId);
  const list = _db.supplierInventory[key] || [];
  const indexBySku = new Map(list.map((x, i) => [x.sku, i]));
  const enrichedAll = [];
  for (const item of items) {
    const sku = String(item.sku || "").trim();
    if (!sku) continue;
    const enriched = {
      sku,
      name:      String(item.name || "").trim(),
      qty:       Number.isFinite(Number(item.qty))  ? Number(item.qty)  : 0,
      cost:      Number.isFinite(Number(item.cost)) ? Number(item.cost) : 0,
      brand:     String(item.brand || "").trim(),
      category:  String(item.category || "").trim(),
      updatedAt: new Date().toISOString(),
    };
    const idx = indexBySku.get(sku);
    if (idx !== undefined) {
      list[idx] = { ...list[idx], ...enriched };
    } else {
      list.push(enriched);
      indexBySku.set(sku, list.length - 1);
    }
    enrichedAll.push(enriched);
  }
  _db.supplierInventory[key] = list;
  save(_db);
  return enrichedAll;
}
export function deleteInventoryItem(supplierId, sku) {
  _db = load();
  const key = String(supplierId);
  const list = _db.supplierInventory?.[key];
  if (!list) return false;
  _db.supplierInventory[key] = list.filter(x => x.sku !== sku);
  save(_db);
  return true;
}

// ── Auto-bid rules ─────────────────────────────────────────────
export function listAutoBidRules(supplierId) {
  _db = load();
  return (_db.autoBidRules || []).filter(r => r.supplierId === String(supplierId));
}
export function listAllActiveAutoBidRules() {
  _db = load();
  return (_db.autoBidRules || []).filter(r => r.active);
}
export function createAutoBidRule(supplierId, rule) {
  _db = load();
  if (!Array.isArray(_db.autoBidRules)) _db.autoBidRules = [];
  const newRule = {
    id:           `r${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    supplierId:   String(supplierId),
    category:     String(rule.category || "").trim(),
    brand:        String(rule.brand || "").trim(),
    modelMatch:   String(rule.modelMatch || "").trim(),
    maxPrice:     Number(rule.maxPrice) || 0,
    undercut:     Math.max(0, Number(rule.undercut) || 0),
    active:       rule.active !== false,
    createdAt:    new Date().toISOString(),
  };
  _db.autoBidRules.push(newRule);
  save(_db);
  return newRule;
}
export function updateAutoBidRule(ruleId, supplierId, fields) {
  _db = load();
  const rules = _db.autoBidRules || [];
  const idx = rules.findIndex(r => r.id === ruleId && r.supplierId === String(supplierId));
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...fields, updatedAt: new Date().toISOString() };
  save(_db);
  return rules[idx];
}
export function deleteAutoBidRule(ruleId, supplierId) {
  _db = load();
  const before = _db.autoBidRules?.length || 0;
  _db.autoBidRules = (_db.autoBidRules || []).filter(r => !(r.id === ruleId && r.supplierId === String(supplierId)));
  save(_db);
  return _db.autoBidRules.length < before;
}

// ── Notifications ──────────────────────────────────────────────
// Pure factory for a notification record, used by both the single-push and
// the batch-push helpers below so the shape stays identical.
// Strip HTML tags and JS-protocol URLs from any string we persist + show
// later. Defends against stored XSS if these strings end up rendered raw
// (e.g. in a future email digest, PDF invoice, or admin SSR page).
function _sanitiseStored(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, "")                  // strip all HTML tags
    .replace(/javascript:/gi, "")             // strip javascript: protocol
    .replace(/data:[^;]*;base64/gi, "")       // strip base64 data URLs (can hide payloads)
    .replace(/[-]/g, "");   // strip control chars
}

function _buildNotification(supplierId, { type, title, message, dealId = null }) {
  return {
    id:         `n${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    supplierId: String(supplierId),
    type:       String(type || "info"),
    title:      _sanitiseStored(title).slice(0, 120),
    message:    _sanitiseStored(message).slice(0, 500),
    dealId:     dealId ? String(dealId) : null,
    read:       false,
    createdAt:  new Date().toISOString(),
  };
}

// Bulk-push: when a single event needs to fan out to many suppliers (deal
// close → notify winner + every losing bidder, daily digest → notify all
// active suppliers), use this helper. ONE load + ONE save instead of N.
export function pushSupplierNotificationsBulk(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];
  _db = load();
  if (!Array.isArray(_db.supplierNotifications)) _db.supplierNotifications = [];
  const built = notifications.map(n => {
    const note = _buildNotification(n.supplierId, n);
    _db.supplierNotifications.push(note);
    return note;
  });
  // Apply the per-supplier cap once at the end (cheaper than per-push)
  const PER_SUPPLIER_CAP = 200;
  const counts = {};
  const reversed = _db.supplierNotifications.slice().reverse();
  const kept = [];
  for (const n of reversed) {
    counts[n.supplierId] = (counts[n.supplierId] || 0) + 1;
    if (counts[n.supplierId] <= PER_SUPPLIER_CAP) kept.push(n);
  }
  _db.supplierNotifications = kept.reverse();
  save(_db);
  return built;
}

export function listSupplierNotifications(supplierId, { unreadOnly = false, limit = 50 } = {}) {
  _db = load();
  let items = (_db.supplierNotifications || []).filter(n => n.supplierId === String(supplierId));
  if (unreadOnly) items = items.filter(n => !n.read);
  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}
export function pushSupplierNotification(supplierId, { type, title, message, dealId = null }) {
  _db = load();
  if (!Array.isArray(_db.supplierNotifications)) _db.supplierNotifications = [];
  const note = _buildNotification(supplierId, { type, title, message, dealId });
  _db.supplierNotifications.push(note);
  // Per-supplier LRU: keep at most 200 notifications per supplier so a noisy
  // supplier (e.g. one with hundreds of auto-bid events) cannot push another
  // supplier's important events out of the global window.
  const PER_SUPPLIER_CAP = 200;
  const counts = {};
  // Walk newest → oldest, keep the first N per supplier, drop the rest
  const reversed = _db.supplierNotifications.slice().reverse();
  const kept = [];
  for (const n of reversed) {
    counts[n.supplierId] = (counts[n.supplierId] || 0) + 1;
    if (counts[n.supplierId] <= PER_SUPPLIER_CAP) kept.push(n);
  }
  // Restore chronological order
  _db.supplierNotifications = kept.reverse();
  save(_db);
  return note;
}
export function markNotificationRead(supplierId, notificationId) {
  _db = load();
  const list = _db.supplierNotifications || [];
  const idx  = list.findIndex(n => n.id === notificationId && n.supplierId === String(supplierId));
  if (idx === -1) return false;
  list[idx].read = true;
  save(_db);
  return true;
}
export function markAllNotificationsRead(supplierId) {
  _db = load();
  let n = 0;
  (_db.supplierNotifications || []).forEach(note => {
    if (note.supplierId === String(supplierId) && !note.read) { note.read = true; n++; }
  });
  save(_db);
  return n;
}

// ── Deal Q&A ──────────────────────────────────────────────────
export function listDealQuestions(dealId) {
  _db = load();
  return _db.dealQuestions?.[String(dealId)] || [];
}
export function addDealQuestion(dealId, { question, askedBy }) {
  _db = load();
  if (!_db.dealQuestions || typeof _db.dealQuestions !== "object" || Array.isArray(_db.dealQuestions)) _db.dealQuestions = {};
  const key = String(dealId);
  const list = _db.dealQuestions[key] || [];
  const entry = {
    id:        `q${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    question:  _sanitiseStored(question).slice(0, 500),
    askedBy:   _sanitiseStored(askedBy).slice(0, 80),
    askedAt:   new Date().toISOString(),
    answer:    null,
    answeredBy:null,
    answeredAt:null,
  };
  // Per-deal cap: keep the 100 most recent questions so a single popular
  // deal can't bloat the JSON file.
  list.push(entry);
  if (list.length > 100) list.splice(0, list.length - 100);
  _db.dealQuestions[key] = list;
  save(_db);
  return entry;
}
export function answerDealQuestion(dealId, questionId, { answer, answeredBy }) {
  _db = load();
  const list = _db.dealQuestions?.[String(dealId)];
  if (!list) return null;
  const idx = list.findIndex(q => q.id === questionId);
  if (idx === -1) return null;
  list[idx].answer     = _sanitiseStored(answer).slice(0, 1000);
  list[idx].answeredBy = _sanitiseStored(answeredBy).slice(0, 80);
  list[idx].answeredAt = new Date().toISOString();
  save(_db);
  return list[idx];
}

// ── Invoices (auto-generated on order completion) ─────────────
export function createInvoice(invoice) {
  _db = load();
  if (!Array.isArray(_db.invoices)) _db.invoices = [];
  const newInv = {
    id:         `inv${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    orderId:    String(invoice.orderId || ""),
    supplierId: String(invoice.supplierId || ""),
    customerId: invoice.customerId ? String(invoice.customerId) : null,
    items:      Array.isArray(invoice.items) ? invoice.items : [],
    total:      Number(invoice.total) || 0,
    vat:        Number(invoice.vat)   || 0,
    customerName:    String(invoice.customerName || ""),
    customerAddress: String(invoice.customerAddress || ""),
    supplierName:    String(invoice.supplierName || ""),
    supplierTaxId:   String(invoice.supplierTaxId || ""),
    createdAt:  new Date().toISOString(),
  };
  _db.invoices.push(newInv);
  save(_db);
  return newInv;
}
export function listInvoices(supplierId) {
  _db = load();
  return (_db.invoices || []).filter(i => i.supplierId === String(supplierId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function getInvoice(invoiceId) {
  _db = load();
  return (_db.invoices || []).find(i => i.id === invoiceId) || null;
}

// ── Supplier listings (products a supplier publishes) ─────────
export function listSupplierListings(supplierId) {
  _db = load();
  return (_db.supplierListings || []).filter(l => l.supplierId === String(supplierId));
}
export function listAllActiveListings() {
  _db = load();
  return (_db.supplierListings || []).filter(l => l.active);
}
export function createSupplierListing(supplierId, listing) {
  _db = load();
  if (!Array.isArray(_db.supplierListings)) _db.supplierListings = [];
  // Validate the source so we never end up with weird states
  const allowed = new Set(["free", "zap", "inventory"]);
  const source  = allowed.has(listing.source) ? listing.source : "free";
  // Whitelist & sanitize. Trim long strings to bounded sizes so a single
  // listing can't bloat the JSON file.
  // Validate image URL, only http(s) allowed (no javascript:, data:, file:).
  const cleanImg = String(listing.image || "").trim().slice(0, 500);
  const safeImg  = /^https?:\/\//i.test(cleanImg) ? cleanImg : "";
  const newListing = {
    id:          `l${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    supplierId:  String(supplierId),
    source,
    zapModelId:  source === "zap"       ? _sanitiseStored(listing.zapModelId).slice(0, 30) : null,
    sku:         source === "inventory" ? _sanitiseStored(listing.sku).slice(0, 50)        : (listing.sku ? _sanitiseStored(listing.sku).slice(0, 50) : null),
    name:        _sanitiseStored(listing.name).slice(0, 200),
    image:       safeImg,
    category:    _sanitiseStored(listing.category).slice(0, 80),
    brand:       _sanitiseStored(listing.brand).slice(0, 80),
    basePrice:   Number(listing.basePrice) > 0 ? Number(listing.basePrice) : 0,
    qty:         Number.isFinite(Number(listing.qty)) ? Math.max(0, Number(listing.qty)) : 0,
    description: _sanitiseStored(listing.description).slice(0, 1000),
    active:      listing.active !== false,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  if (!newListing.name || newListing.basePrice <= 0) return null;
  _db.supplierListings.push(newListing);
  save(_db);
  return newListing;
}
export function updateSupplierListing(listingId, supplierId, fields) {
  _db = load();
  const list = _db.supplierListings || [];
  const idx  = list.findIndex(l => l.id === listingId && l.supplierId === String(supplierId));
  if (idx === -1) return null;
  // Only mutate whitelisted fields, never source/supplierId/createdAt.
  // SECURITY (P1, audit 2026-05-23): coerce numeric fields and reject
  // negative/NaN values. Without this a PATCH with basePrice:-100,
  // qty:-9999, active:"javascript:" stored verbatim, public listing
  // then rendered ₪-100 and stayed active because "string" is truthy.
  const ALLOWED = ["name","image","category","brand","basePrice","qty","description","active"];
  const merged = { ...list[idx] };
  for (const k of ALLOWED) {
    if (!(k in fields)) continue;
    let v = fields[k];
    if (k === "basePrice") v = Math.max(0, Number(v) || 0);
    else if (k === "qty")  v = Math.max(0, Math.floor(Number(v) || 0));
    else if (k === "active") v = v === true || v === "true" || v === 1;
    else if (k === "image") {
      // Round 2 audit P1: createSupplierListing already validates image
      // as http(s); the update path was missing the same check, letting a
      // supplier PATCH `javascript:` or `data:text/html,...` into a public
      // listing. Keep the previous value when the incoming URL is not http(s).
      v = (typeof v === "string" && /^https?:\/\//i.test(v)) ? v.slice(0, 500) : merged[k];
    }
    else if (typeof v === "string") v = v.slice(0, 500);
    merged[k] = v;
  }
  merged.updatedAt = new Date().toISOString();
  list[idx] = merged;
  save(_db);
  return merged;
}
export function deleteSupplierListing(listingId, supplierId) {
  _db = load();
  const before = _db.supplierListings?.length || 0;
  _db.supplierListings = (_db.supplierListings || []).filter(
    l => !(l.id === listingId && l.supplierId === String(supplierId))
  );
  save(_db);
  return _db.supplierListings.length < before;
}

// ── Automation state (persistent flags) ────────────────────────
export function getAutomationFlag(key) {
  _db = load();
  return _db.automationState?.[key] || null;
}
export function setAutomationFlag(key, value) {
  _db = load();
  if (!_db.automationState || typeof _db.automationState !== "object" || Array.isArray(_db.automationState)) _db.automationState = {};
  _db.automationState[key] = value;
  save(_db);
  return value;
}

// ── User interactions (taste tracking) ─────────────────────────
// Records every click/view/join/buy/search so we can build a taste profile.
// Deduplicates same-event-on-same-target within a 30-second window so a
// double-click doesn't bias the model.
export function trackUserInteraction(userId, event) {
  _db = load();
  if (!Array.isArray(_db.userInteractions)) _db.userInteractions = [];
  const ALLOWED_TYPES = new Set(["view","click","join","buy","search","wishlist","cancel"]);
  if (!ALLOWED_TYPES.has(event.type)) return null;
  const now = Date.now();
  // De-dup
  const key = `${event.type}|${event.dealId || event.productName || event.query || ""}`;
  const recent = _db.userInteractions
    .slice(-50)
    .find(e =>
      e.userId === String(userId) &&
      `${e.type}|${e.dealId || e.productName || e.query || ""}` === key &&
      now - Date.parse(e.ts || 0) < 30_000
    );
  if (recent) return recent;
  const entry = {
    id:          `i${now}_${Math.random().toString(36).slice(2,5)}`,
    userId:      String(userId),
    type:        event.type,
    dealId:      event.dealId      ? String(event.dealId)      : null,
    productName: event.productName ? String(event.productName).slice(0, 200) : null,
    category:    event.category    ? String(event.category).slice(0, 80)     : null,
    brand:       event.brand       ? String(event.brand).slice(0, 80)        : null,
    price:       Number.isFinite(Number(event.price)) ? Number(event.price)  : null,
    query:       event.query       ? String(event.query).slice(0, 200)       : null,
    ts:          new Date().toISOString(),
  };
  _db.userInteractions.push(entry);
  // Per-user cap of 500 events, without this, a single noisy user (or bot)
  // could drown out other users' taste profiles by stealing all of the 30K
  // global slots. The global cap of 50K is a defence-in-depth backstop.
  const PER_USER_CAP = 500;
  const counts = {};
  const reversed = _db.userInteractions.slice().reverse();
  const kept = [];
  for (const e of reversed) {
    counts[e.userId] = (counts[e.userId] || 0) + 1;
    if (counts[e.userId] <= PER_USER_CAP) kept.push(e);
  }
  _db.userInteractions = kept.reverse();
  if (_db.userInteractions.length > 50_000) _db.userInteractions = _db.userInteractions.slice(-30_000);
  save(_db);
  return entry;
}
export function listUserInteractions(userId, { limit = 200, sinceDays = null } = {}) {
  _db = load();
  let items = (_db.userInteractions || []).filter(e => e.userId === String(userId));
  if (sinceDays) {
    const cutoff = Date.now() - sinceDays * 86_400_000;
    items = items.filter(e => Date.parse(e.ts || 0) >= cutoff);
  }
  return items.slice(-limit).reverse();
}

// ── Taste profile ──────────────────────────────────────────────
// Computed (and cached) view of the user's preferences. Recomputed
// on demand or when interactions reach a threshold; the GPT-summary
// step is optional and added by the server (we just persist it).
export function getUserTasteProfile(userId) {
  _db = load();
  return _db.userTasteProfile?.[String(userId)] || null;
}
export function setUserTasteProfile(userId, profile) {
  _db = load();
  if (!_db.userTasteProfile || typeof _db.userTasteProfile !== "object" || Array.isArray(_db.userTasteProfile)) _db.userTasteProfile = {};
  _db.userTasteProfile[String(userId)] = { ...profile, updatedAt: new Date().toISOString() };
  save(_db);
  return _db.userTasteProfile[String(userId)];
}
// Compute a taste profile heuristically from raw interactions.
// (No AI, fast, runs on every recommendations call. AI summary is
// added separately on the server.)
export function buildTasteProfileFromInteractions(userId) {
  const events = listUserInteractions(userId, { limit: 500, sinceDays: 180 });
  if (events.length === 0) return null;
  const brandTally    = {};
  const catTally      = {};
  const recentSearches = [];
  const prices        = [];
  for (const e of events) {
    if (e.brand)    brandTally[e.brand]   = (brandTally[e.brand]   || 0) + (e.type === "buy" ? 5 : e.type === "join" ? 3 : 1);
    if (e.category) catTally[e.category]  = (catTally[e.category]  || 0) + (e.type === "buy" ? 5 : e.type === "join" ? 3 : 1);
    if (e.type === "search" && e.query)   recentSearches.push(e.query);
    if (e.type === "buy" && e.price)      prices.push(e.price);
    if (e.type === "join" && e.price)     prices.push(e.price);
  }
  const sortByCount = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const profile = {
    topBrands:     sortByCount(brandTally).slice(0, 5),
    topCategories: sortByCount(catTally).slice(0, 5),
    minBudget:     prices.length ? Math.min(...prices) : null,
    maxBudget:     prices.length ? Math.max(...prices) : null,
    avgBudget:     prices.length ? Math.round(prices.reduce((a,b)=>a+b,0) / prices.length) : null,
    recentSearches:[...new Set(recentSearches.slice(-10))].reverse(),
    interactionCount: events.length,
  };
  return profile;
}

// ── Deals (persisted group-buy deals) ───────────────────────────
// One deal per productKey. Everyone interested in the same product joins
// the SAME deal, that is the group-buy concept. createDeal dedupes by
// productKey: if a deal with that key already exists it is returned as-is.
//
// Server id style mirrors the other string-id collections in this file
// (notifications, listings, invoices): `d<timestamp>_<rand>`, NOT
// Date.now() alone, which is collision-prone and was the broken client id.
function _newDealId() {
  return `d${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDeal(data = {}) {
  return _mutate(db => {
    if (!Array.isArray(db.deals)) db.deals = [];
    const productKey = data.productKey ? String(data.productKey) : null;
    // Dedupe by productKey + name match. Same productKey AND same name = same
    // product → return the existing deal so all interested buyers converge on
    // ONE deal. Same productKey but DIFFERENT name = upstream key collision
    // (rare, but it produced the "every TV → one TV" routing bug), so we
    // create a fresh deal instead of collapsing the wrong product onto an
    // unrelated one. The name comparison normalizes whitespace + case so a
    // re-fetch with cosmetic differences still dedupes correctly.
    const _normName = (n) => {
      if (!n) return "";
      const s = typeof n === "string" ? n : (n.he || n.en || "");
      return String(s).trim().toLowerCase().replace(/\s+/g, " ");
    };
    const incomingName = _normName(data.name);
    if (productKey) {
      const existing = db.deals.find(d => d.productKey && String(d.productKey) === productKey);
      if (existing) {
        const existingName = _normName(existing.name);
        if (!incomingName || !existingName || incomingName === existingName) return existing;
        console.warn(`[createDeal] productKey collision, different names: existing="${existingName.slice(0,60)}" incoming="${incomingName.slice(0,60)}" — creating a new deal instead of collapsing`);
      }
    }
    const now = new Date().toISOString();
    const deal = {
      id:              _newDealId(),
      productKey,
      name:            data.name || {},
      desc:            data.desc || {},
      image:           data.image || "",
      catIdx:          Number.isFinite(Number(data.catIdx)) ? Number(data.catIdx) : 0,
      marketMin:       Number(data.marketMin) || 0,
      marketMax:       Number(data.marketMax) || 0,
      groupOffer:      Number(data.groupOffer) || 0,
      discount:        Number(data.discount) || 0,
      participants:    Number.isFinite(Number(data.participants)) ? Number(data.participants) : 1,
      maxParticipants: Number.isFinite(Number(data.maxParticipants)) ? Number(data.maxParticipants) : 50,
      minParticipants: Number.isFinite(Number(data.minParticipants)) ? Number(data.minParticipants) : 10,
      daysLeft:        Number.isFinite(Number(data.daysLeft)) ? Number(data.daysLeft) : 14,
      specs:           Array.isArray(data.specs) ? data.specs : [],
      // SECURITY: a new deal ALWAYS starts with zero bids. Bids may only be
      // added by the supplier-authenticated POST /api/deals/:id/bids endpoint
      // (supplierId pinned from the JWT). Accepting client-supplied bids here
      // let a customer seed a fake low "winning bid" and be charged that price.
      bids:            [],
      status:          "active",   // active | closed | confirmed | cancelled
      createdAt:       now,
      updatedAt:       now,
    };
    db.deals.unshift(deal);
    return deal;
  });
}

export function getDeal(id) {
  _db = load();
  return (_db.deals || []).find(d => String(d.id) === String(id)) || null;
}

export function getDealByProductKey(productKey) {
  if (!productKey) return null;
  _db = load();
  return (_db.deals || []).find(d => d.productKey && String(d.productKey) === String(productKey)) || null;
}

export function listDeals(filterOpts = {}) {
  _db = load();
  let rows = _db.deals || [];
  if (filterOpts.status)   rows = rows.filter(d => (d.status || "active") === filterOpts.status);
  if (filterOpts.catIdx != null) rows = rows.filter(d => d.catIdx === Number(filterOpts.catIdx));
  return rows.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export function updateDeal(id, patch = {}) {
  return _mutate(db => {
    if (!Array.isArray(db.deals)) db.deals = [];
    const deal = db.deals.find(d => String(d.id) === String(id));
    if (!deal) return null;
    // Whitelist mutable fields, never let a caller rewrite id/productKey/createdAt.
    const allowed = [
      "name", "desc", "image", "catIdx", "marketMin", "marketMax",
      "groupOffer", "discount", "participants", "maxParticipants",
      "minParticipants", "daysLeft", "specs", "bids", "status",
    ];
    for (const k of allowed) {
      if (patch[k] !== undefined) deal[k] = patch[k];
    }
    deal.updatedAt = new Date().toISOString();
    return deal;
  });
}

export default { load, save };
