/**
 * Bundly — Security Middleware
 *
 * Defense-in-depth layer applied to every request.
 * Provides protection against: XSS, CSRF, clickjacking, MIME sniffing,
 * DoS, prototype pollution, path traversal, scraping, timing attacks,
 * bot farms, credential stuffing, and known injection vectors.
 *
 * Designed to work without external deps so the app is resilient even
 * if node_modules is incomplete. Optional deps (helmet, express-rate-limit)
 * are detected and used when present for stronger guarantees.
 */
import { timingSafeEqual, randomBytes, createHmac, createHash } from "node:crypto";
import { appendFile, statSync, renameSync, existsSync } from "node:fs";

const IS_PROD = process.env.NODE_ENV === "production";

// ── Optional deps: load helmet, express-rate-limit, validator, redis if installed ──
let helmet = null, rateLimitLib = null, validator = null, redisClient = null, RedisStore = null;
try { helmet = (await import("helmet")).default; } catch {}
try { rateLimitLib = (await import("express-rate-limit")).default; } catch {}
try { validator = (await import("validator")).default; } catch {}

// Redis (optional) — for multi-server rate limiting + account lockout persistence
if (process.env.REDIS_URL) {
  try {
    const { createClient } = await import("redis");
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", e => console.warn("[redis]", e.message));
    await redisClient.connect();
    console.log("✅ Redis connected — rate limits + lockouts are multi-server-safe");
    try {
      const { default: RedisRateLimitStore } = await import("rate-limit-redis");
      RedisStore = RedisRateLimitStore;
    } catch { /* rate-limit-redis not installed */ }
  } catch (e) {
    console.warn("⚠️  REDIS_URL set but connection failed:", e.message);
    redisClient = null;
  }
}

// SECURITY (audit F-03, P1): export the (possibly-null) redisClient so other
// modules in server.js can persist counters (e.g. OTP per-phone lockouts) to
// Redis when configured. The export is read-only; consumers should treat
// `null` as "no Redis, fall back to disk".
export function getRedisClient() { return redisClient; }

// ── Centralized audit log ─────────────────────────────────────────
// Suspicious requests get logged to security.log (rotated by pm2 / logrotate).
// Defense: sanitize EVERY string field — replace CR/LF/escape sequences so an
// attacker can't inject fake log entries via User-Agent, path, or details.
const AUDIT_FILE = process.cwd() + "/security.log";

// SECURITY (audit F12): redact PII before writing to security.log. The log
// goes to disk (Render persistent volume + any log-shipping tail) and is
// retained for forensics — we MUST avoid storing plaintext emails, phones,
// passwords, OTPs, JWT bodies, Stripe IDs. Hashing preserves correlation
// across log lines without storing the secret itself.
const _PII_KEYS = new Set([
  "password", "pw", "token", "jwt", "bearer", "secret", "apiKey", "api_key",
  "otp", "otpCode", "captchaToken",
  "email", "phone", "phoneNumber", "mobile",
  "paymentIntentId", "stripeCustomerId", "paymentMethodId", "setupIntentId",
  "bankAccount", "iban", "ssn", "taxId",
  "address", "street", "zip", "postal",
]);
function _hashPII(v) {
  try {
    const h = createHash("sha256").update(String(v)).digest("hex");
    return `redacted:${h.slice(0, 8)}`;
  } catch {
    return "redacted";
  }
}
function _sanitizeLogValue(v, keyHint = "") {
  if (v == null) return v;
  if (typeof v === "string") {
    if (keyHint && _PII_KEYS.has(keyHint)) return _hashPII(v);
    // Strip ALL control chars (0x00-0x1F + 0x7F) — prevents log injection
    // and binary garbage that breaks log parsers.
    return v.replace(/[\x00-\x1F\x7F]/g, "?").slice(0, 500);
  }
  if (Array.isArray(v)) return v.map(x => _sanitizeLogValue(x, keyHint));
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = _sanitizeLogValue(val, k);
    return out;
  }
  return v;
}
export function audit(type, req, details = {}) {
  const safeDetails = _sanitizeLogValue(details) || {};
  const line = JSON.stringify({
    ts:      new Date().toISOString(),
    type:    _sanitizeLogValue(String(type || "")),
    ip:      _sanitizeLogValue(req?.ip || req?.headers?.["x-forwarded-for"] || "unknown"),
    ua:      _sanitizeLogValue(req?.headers?.["user-agent"]?.slice(0, 120) || ""),
    path:    _sanitizeLogValue(req?.path || req?.url || ""),
    method:  _sanitizeLogValue(req?.method || ""),
    ...safeDetails,
  }) + "\n";
  _rotateAuditLogIfNeeded();
  appendFile(AUDIT_FILE, line, () => {});
  if (!IS_PROD) console.log(`[AUDIT ${type}]`, safeDetails, req?.path);
}

// SECURITY (red-team round 2 — L-R2-3): rotate the audit log to prevent
// disk-fill DoS via flood of auth-fail / WAF-block events. Default cap is
// 50 MB per file; rotate to .1 and start fresh. We only check every ~1000
// writes (Math.random < 0.001) to avoid statSync per request.
const _AUDIT_MAX_BYTES = Number(process.env.AUDIT_LOG_MAX_BYTES) || (50 * 1024 * 1024);
function _rotateAuditLogIfNeeded() {
  if (Math.random() > 0.001) return;
  try {
    if (!existsSync(AUDIT_FILE)) return;
    const sz = statSync(AUDIT_FILE).size;
    if (sz < _AUDIT_MAX_BYTES) return;
    renameSync(AUDIT_FILE, AUDIT_FILE + ".1");
  } catch {}
}

// ── Production-grade security headers via helmet (if installed) ──
// Helmet combines ~12 security headers + sensible defaults maintained by the OWASP community.
export function helmetHeaders() {
  if (!helmet) return securityHeaders; // fallback to custom
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // Stripe.js loads from js.stripe.com (and may load helper scripts from
        // m.stripe.com). Without these the credit-card iframe never appears.
        // hCaptcha needs js.hcaptcha.com + newassets.hcaptcha.com (worker + widget assets)
        scriptSrc:  ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://m.stripe.com", "https://m.stripe.network", "https://js.hcaptcha.com", "https://*.hcaptcha.com", "https://newassets.hcaptcha.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://m.stripe.com", "https://m.stripe.network", "https://js.hcaptcha.com", "https://*.hcaptcha.com", "https://newassets.hcaptcha.com"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc:     ["'self'", "data:", "https:", "blob:"],
        // Stripe issues fetch/xhr to js.stripe.com, m.stripe.network, q.stripe.com (telemetry)
        connectSrc: ["'self'", "https://api.stripe.com", "https://js.stripe.com", "https://m.stripe.com", "https://m.stripe.network", "https://q.stripe.com", "https://hcaptcha.com", "https://*.hcaptcha.com"],
        // The CardElement renders inside an iframe served from js.stripe.com / hooks.stripe.com
        frameSrc:   ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://m.stripe.network", "https://hcaptcha.com", "https://*.hcaptcha.com"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri:    ["'self'"],
        objectSrc:  ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,       // allows product images from external CDNs
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy:   { policy: "same-origin" },
    referrerPolicy:            { policy: "strict-origin-when-cross-origin" },
    hsts: IS_PROD ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    frameguard:   { action: "deny" },
    noSniff:      true,
    xssFilter:    true,
    hidePoweredBy: true,
  });
}

// ── Extra security headers that helmet doesn't set ──────────────
// Mounted right after helmetHeaders(). Adds:
//  • X-Robots-Tag on /api/* — keep API surface out of Google
//  • Permissions-Policy — helmet 7 doesn't set this; tightly scoped
//  • Server header strip — replaces Express's "Server: …" with neutral value
//  • X-DNS-Prefetch-Control off — fewer outbound lookups leaked
export function extraSecurityHeaders(req, res, next) {
  // Block search engine indexing of API responses entirely.
  // Static frontend pages are still indexable since they don't match /api.
  if (req.path.startsWith("/api/")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, nosnippet, noarchive");
  }
  // Disable browser features we never use. payment=(self) and geolocation=(self)
  // are kept open because Stripe and any future store-locator may need them.
  // NOTE: 'ambient-light-sensor' was removed — Chrome 110+ rejects it as an
  // unrecognized feature (logs a console warning on every page load).
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(self), " +
    "usb=(), magnetometer=(), gyroscope=(), accelerometer=(), " +
    "autoplay=(), encrypted-media=(self), " +
    "midi=(), picture-in-picture=(), screen-wake-lock=(), xr-spatial-tracking=(), " +
    "fullscreen=(self), serial=(), hid=(), bluetooth=(), idle-detection=()"
  );
  // Mask server signature
  res.setHeader("Server", "bundly");
  // Disable speculative DNS prefetch from response context
  res.setHeader("X-DNS-Prefetch-Control", "off");
  // Permanent removal of the "X-Powered-By: Express" header.
  // helmet.hidePoweredBy already does this but defense-in-depth.
  res.removeHeader("X-Powered-By");
  next();
}

// ── HTTP Security Headers (fallback if helmet not installed) ─────
export function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Prevent iframe embedding (clickjacking)
  res.setHeader("X-Frame-Options", "DENY");
  // Block legacy XSS attempts at browser level
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Referrer policy — don't leak full URLs to third parties
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions: disable unneeded browser features
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(self)");
  // HSTS: force HTTPS for 2 years (only safe after TLS is live!)
  if (IS_PROD) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  // CSP — tightened. Note: 'unsafe-inline' for styles needed by Tailwind/CSS-in-JS.
  // Scripts are strictly same-origin + Stripe.js domains; disable eval; disable plugins.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://m.stripe.com https://m.stripe.network https://js.hcaptcha.com https://*.hcaptcha.com https://newassets.hcaptcha.com",
    "script-src-elem 'self' 'unsafe-inline' https://js.stripe.com https://m.stripe.com https://m.stripe.network https://js.hcaptcha.com https://*.hcaptcha.com https://newassets.hcaptcha.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.stripe.com https://js.stripe.com https://m.stripe.com https://m.stripe.network https://q.stripe.com https://hcaptcha.com https://*.hcaptcha.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network https://hcaptcha.com https://*.hcaptcha.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  // Remove Express signature
  res.removeHeader("X-Powered-By");
  next();
}

// ── HTTPS enforcement ────────────────────────────────────────────
// When behind a reverse proxy (nginx, cloudflare), trust X-Forwarded-Proto.
// In production, redirect all http → https.
export function enforceHttps(req, res, next) {
  if (!IS_PROD) return next();
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (proto !== "https") {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
}

// ── CORS with origin whitelist ────────────────────────────────────
// Replaces unconfigured cors() which allowed all origins.
export function strictCors(allowedOrigins = []) {
  // Production origins only — apex + www of the canonical domain.
  // Dev ports added back below only when NODE_ENV !== "production" so an
  // attacker can't trick a victim with a malicious localhost:3000 service
  // into making credentialed cross-origin calls against prod. (M3 audit.)
  const prodDefaults = [
    "https://bundly.co",      "https://www.bundly.co",
    "https://bundly.co.il",   "https://www.bundly.co.il",
  ];
  const devDefaults = [
    "http://localhost:3000", "http://localhost:3001", "http://localhost:3002",
  ];
  const defaults = IS_PROD ? prodDefaults : [...prodDefaults, ...devDefaults];
  const whitelist = new Set([...defaults, ...allowedOrigins]);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && whitelist.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}

// ── Rate limiter — 3-tier fallback: Redis → express-rate-limit → in-memory ──
const _buckets = new Map();
export function rateLimit({ windowMs = 60_000, max = 100, keyFn = r => r.ip, label = "default" } = {}) {
  if (rateLimitLib) {
    const opts = {
      windowMs, max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: keyFn,
      handler: (req, res) => {
        audit("RATE_LIMIT", req, { label });
        res.status(429).json({ error: "יותר מדי בקשות, נסה שוב עוד רגע" });
      },
    };
    // Use Redis store if available — required for multi-server deployments
    if (RedisStore && redisClient) {
      opts.store = new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix:      `rl:${label}:`,
      });
    }
    return rateLimitLib(opts);
  }
  // Pure in-memory fallback
  return (req, res, next) => {
    const key = `${label}:${keyFn(req)}`;
    const now = Date.now();
    const arr = (_buckets.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      audit("RATE_LIMIT", req, { label, count: arr.length });
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: "יותר מדי בקשות, נסה שוב עוד רגע" });
    }
    arr.push(now);
    _buckets.set(key, arr);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of _buckets) {
    const active = arr.filter(t => now - t < 60 * 60_000);
    if (active.length === 0) _buckets.delete(k);
    else _buckets.set(k, active);
  }
}, 10 * 60_000);

// ── Bot / scraper detection ───────────────────────────────────────
// Block known bot UAs, missing UA, headless browsers, and suspicious patterns.
const BOT_UA_REGEX = /(bot|crawl|spider|scrape|fetch|wget|curl|python-requests|java\/|php-|go-http|ruby|postman|insomnia|httrack|axios\/\d+\.\d+\.\d+ node)/i;
const ALLOWED_BOT_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/favicon.ico"]);
export function blockBots(req, res, next) {
  if (ALLOWED_BOT_PATHS.has(req.path)) return next();
  const ua = req.headers["user-agent"] || "";
  // Allow API calls with valid auth token (real clients)
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  if (!ua || ua.length < 20 || BOT_UA_REGEX.test(ua)) {
    audit("BOT_BLOCKED", req, { ua: ua.slice(0, 80) });
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ── Prototype pollution guard on req.body ─────────────────────────
// Strips __proto__, constructor, prototype keys recursively.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function stripProtoKeys(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) { obj.forEach(stripProtoKeys); return obj; }
  for (const k of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(k)) delete obj[k];
    else stripProtoKeys(obj[k]);
  }
  return obj;
}
export function preventPrototypePollution(req, _res, next) {
  if (req.body) stripProtoKeys(req.body);
  if (req.query) stripProtoKeys(req.query);
  next();
}

// ── Path traversal + prototype-pollution guard on URL params ──────
// Blocks ../../../etc/passwd style attacks AND path-component prototype
// pollution like `/api/deals/__proto__/bids` (audit F2). The DB helpers
// use `obj[key] = value` patterns where `key` is taken from req.params;
// JS assignment to the literal key "__proto__" mutates the prototype
// chain and corrupts every subsequent read. Catch it at the edge.
const TRAVERSAL_REGEX = /(\.\.[\\/]|%2e%2e|%00|\x00)/i;
const PROTO_POLLUTION_VALUES = new Set([
  "__proto__", "constructor", "prototype",
  "%5f%5fproto%5f%5f", "%5F%5Fproto%5F%5F",
]);
export function preventTraversal(req, res, next) {
  const allValues = [
    ...Object.values(req.params || {}),
    ...Object.values(req.query || {}).filter(v => typeof v === "string"),
  ];
  for (const v of allValues) {
    if (typeof v !== "string") continue;
    if (TRAVERSAL_REGEX.test(v)) {
      audit("TRAVERSAL_BLOCKED", req, { value: String(v).slice(0, 100) });
      return res.status(400).json({ error: "Invalid parameter" });
    }
    // Compare URL-decoded form too — attacker may send `%5f%5fproto%5f%5f`.
    const lowered = v.toLowerCase();
    let decoded = lowered;
    try { decoded = decodeURIComponent(lowered); } catch { /* malformed % escape */ }
    if (PROTO_POLLUTION_VALUES.has(lowered) || PROTO_POLLUTION_VALUES.has(decoded)) {
      audit("PROTO_POLLUTION_BLOCKED", req, { value: String(v).slice(0, 100), path: req.path });
      return res.status(400).json({ error: "Invalid parameter" });
    }
  }
  next();
}

// ── Timing-safe string comparison (for passwords, tokens) ─────────
// Prevents attackers from learning password length via response timing.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a dummy compare to avoid length leak
    try { timingSafeEqual(bufA, bufA); } catch { /* */ }
    return false;
  }
  try { return timingSafeEqual(bufA, bufB); } catch { return false; }
}

// ── Sensitive field stripper for API responses ────────────────────
// Ensures we never leak: password hashes, bank accounts, license docs,
// internal IPs, token secrets, etc.
const SENSITIVE_FIELDS = new Set([
  "password", "passwordHash", "pwd",
  "bankAccount", "licenseDoc",
  "stripeSecret", "webhookSecret",
  "__internal", "_notes",
]);
export function stripSensitive(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSensitive);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(k)) continue;
    out[k] = (typeof v === "object" && v !== null) ? stripSensitive(v) : v;
  }
  return out;
}

// ── Safe error handler (never leaks stack in production) ──────────
// Always set as the LAST middleware after all routes.
export function safeErrorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  // In production, NEVER leak `err.message` for 5xx errors — could expose
  // file paths, stack hints, library names, DB column names, etc. Generic
  // Hebrew message is shown instead. 4xx errors keep their text since they're
  // validation/auth feedback the user needs to act on.
  let message;
  if (IS_PROD) {
    if (status >= 500) message = "שגיאת שרת פנימית. נסה/י שוב עוד רגע.";
    else if (status === 404) message = "המשאב לא נמצא";
    else if (status === 403) message = "הגישה אסורה";
    else if (status === 401) message = "נדרשת התחברות";
    else if (status === 429) message = "יותר מדי בקשות, נסה/י שוב בעוד רגע";
    else message = err.message || "שגיאה";
  } else {
    message = err.message || "שגיאה";
  }
  audit("ERROR", req, { status, message: err.message, stack: IS_PROD ? undefined : err.stack?.split("\n").slice(0, 3).join(" | ") });
  // Strip stack traces and any non-message fields from prod responses.
  res.status(status).json({ error: message, ...(IS_PROD ? {} : { stack: err.stack }) });
}

// ── Request ID + basic logging ────────────────────────────────────
// Helps correlate audit entries across logs.
export function requestId(req, res, next) {
  req.id = randomBytes(8).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  next();
}

// ── Failed-login brute-force tracker — Redis-backed when available ──
// After 5 failed attempts per IP in 15min, lock out for 30min.
// Using Redis ensures lockouts survive restarts + apply across all servers.
const _failMap = new Map(); // ip -> { count, lockedUntil }
const LOCK_DURATION_MS = 30 * 60_000;
const MAX_FAILS = 5;

// Track failed logins by BOTH ip and identity (phone/email). Either dimension
// hitting MAX_FAILS triggers a lockout — a botnet can't bypass via IP rotation
// because the user's phone-side counter still rises.
async function _trackKey(key) {
  if (redisClient) {
    const countKey = `fail:${key}`;
    const lockKey  = `lock:${key}`;
    if (await redisClient.get(lockKey)) return { locked: true };
    const count = await redisClient.incr(countKey);
    if (count === 1) await redisClient.expire(countKey, 15 * 60);
    if (count >= MAX_FAILS) {
      await redisClient.set(lockKey, "1", { EX: LOCK_DURATION_MS / 1000 });
      await redisClient.del(countKey);
      audit("ACCOUNT_LOCKED", { key }, { lockDurationMs: LOCK_DURATION_MS });
      return { locked: true };
    }
    return { locked: false };
  }
  const rec = _failMap.get(key) || { count: 0, lockedUntil: 0 };
  if (rec.lockedUntil > Date.now()) return { locked: true };
  rec.count++;
  if (rec.count >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCK_DURATION_MS;
    rec.count = 0;
    audit("ACCOUNT_LOCKED", { key }, { lockDurationMs: LOCK_DURATION_MS });
  }
  _failMap.set(key, rec);
  return { locked: false };
}

export async function trackFailedLogin(ip, identity = null) {
  const ipResult = await _trackKey(`ip:${ip}`);
  if (!identity) return ipResult;
  const idResult = await _trackKey(`id:${identity}`);
  return { locked: ipResult.locked || idResult.locked };
}

export async function clearFailedLogins(ip, identity = null) {
  if (redisClient) {
    await redisClient.del(`fail:ip:${ip}`); await redisClient.del(`lock:ip:${ip}`);
    if (identity) {
      await redisClient.del(`fail:id:${identity}`); await redisClient.del(`lock:id:${identity}`);
    }
    return;
  }
  _failMap.delete(`ip:${ip}`);
  if (identity) _failMap.delete(`id:${identity}`);
}

export async function isLocked(ip, identity = null) {
  const checkKey = async (k) => {
    if (redisClient) return !!(await redisClient.get(`lock:${k}`));
    const rec = _failMap.get(k);
    return rec?.lockedUntil > Date.now();
  };
  if (await checkKey(`ip:${ip}`)) return true;
  if (identity && await checkKey(`id:${identity}`)) return true;
  return false;
}

// ── Signed URL utilities (HMAC-SHA256) ────────────────────────────
// Generates short-lived, tamper-proof URLs for sensitive downloads (invoices,
// private images). Format: path?exp=<unix_ts>&sig=<hex>[&aud=<userId>]
//
// SECURITY (audit M-NEW-2): optional `audUserId` binds the URL to a specific
// recipient. The user id is folded into the HMAC payload so an attacker who
// snatches a URL out of one user's history cannot replay it against another
// account when a session is present (see /invoices/:filename verifier — if
// the request carries Authorization, req.user.id MUST equal aud).
const URL_SIGN_SECRET = process.env.URL_SIGN_SECRET || process.env.JWT_SECRET || "bundly-fallback-signing";
export function signUrl(path, ttlSeconds = 300, audUserId = null) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const aud = audUserId == null ? "" : String(audUserId);
  const sig = createHmac("sha256", URL_SIGN_SECRET).update(`${path}|${exp}|${aud}`).digest("hex").slice(0, 32);
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}exp=${exp}&sig=${sig}${aud ? `&aud=${encodeURIComponent(aud)}` : ""}`;
}
export function verifySignedUrl(path, exp, sig, audUserId = null) {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (isNaN(expNum) || expNum < Math.floor(Date.now() / 1000)) return false; // expired
  const aud = audUserId == null ? "" : String(audUserId);
  const expected = createHmac("sha256", URL_SIGN_SECRET).update(`${path}|${exp}|${aud}`).digest("hex").slice(0, 32);
  return safeEqual(expected, String(sig));
}

// ── hCaptcha verification (free bot-detection service) ────────────
// To enable: sign up at hcaptcha.com, set HCAPTCHA_SECRET in .env.
// Replay defense: each captcha token is single-use — if attacker replays
// the same token, we reject without even calling hCaptcha.
const _usedCaptchaTokens = new Map(); // token → expiresAt
function _purgeUsedCaptcha() {
  const now = Date.now();
  for (const [t, exp] of _usedCaptchaTokens) if (exp < now) _usedCaptchaTokens.delete(t);
}
setInterval(_purgeUsedCaptcha, 60_000).unref?.();

export async function verifyCaptcha(token, remoteIp = null) {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    // H5 (audit): silent bypass in production was a CAPTCHA-defeats-bot
    // protection failure. In production, missing secret must FAIL closed.
    if (IS_PROD) {
      console.warn("[captcha] HCAPTCHA_SECRET missing in production — rejecting");
      return { ok: false, error: "Captcha service unavailable", reason: "no-secret" };
    }
    return { ok: true, skipped: true }; // disabled only in dev
  }
  if (!token) return { ok: false, error: "Missing captcha token" };
  // SECURITY (red-team round 2 — M-R2-2): TOCTOU close. Previously the
  // .has(token) check ran, then we awaited siteverify, THEN we called
  // .set(token, …). Concurrent requests in the same tick all passed the
  // check before any set ran → one valid token reused N times.
  // Now we RESERVE the token synchronously *before* awaiting siteverify.
  // On siteverify failure, evict so a genuine retry isn't blocked.
  if (_usedCaptchaTokens.has(token)) {
    return { ok: false, error: "Captcha token already used", replay: true };
  }
  _usedCaptchaTokens.set(token, Date.now() + 10 * 60_000); // reserve
  try {
    const body = new URLSearchParams({ secret, response: token, ...(remoteIp && { remoteip: remoteIp }) });
    const res = await fetch("https://hcaptcha.com/siteverify", { method: "POST", body });
    const data = await res.json();
    if (data.success) {
      return { ok: true, score: data.score };
    }
    // hCaptcha rejected — evict the reservation so the user can retry with
    // a fresh token (their existing one is already burned by hCaptcha anyway).
    _usedCaptchaTokens.delete(token);
    return { ok: false, error: "Captcha failed", codes: data["error-codes"] };
  } catch (e) {
    _usedCaptchaTokens.delete(token);
    return { ok: false, error: e.message };
  }
}

// ── Strict input validators using validator.js ───────────────────
// Enforces format constraints with battle-tested library.
export function validate(type, value, opts = {}) {
  if (!validator) return true; // dev mode without validator installed
  if (value == null || value === "") return !opts.required;
  const v = String(value);
  switch (type) {
    case "email":   return validator.isEmail(v);
    case "mobile":  return validator.isMobilePhone(v, "he-IL") || validator.isMobilePhone(v, "any");
    case "url":     return validator.isURL(v, { require_protocol: true, protocols: ["https", "http"] });
    case "uuid":    return validator.isUUID(v);
    case "int":     return validator.isInt(v, { min: opts.min, max: opts.max });
    case "float":   return validator.isFloat(v, { min: opts.min, max: opts.max });
    case "length":  return validator.isLength(v, { min: opts.min || 0, max: opts.max || 500 });
    case "alphanum": return validator.isAlphanumeric(v, "en-US", { ignore: " -_" });
    case "zip-il":  return /^\d{5,7}$/.test(v.replace(/\s/g, ""));
    case "iban":    return validator.isIBAN(v);
    case "creditCard": return validator.isCreditCard(v);
    default: return true;
  }
}

// ── Strict ID sanitizer ──────────────────────────────────────────
// Parses numeric IDs from URL params / query / body. Rejects non-ints,
// negatives, overflow (> 2^53), and strings that look clever ("1e10", "0x1F").
// Use BEFORE any DB lookup: const id = safeId(req.params.id); if (id == null) return 400
export function safeId(v, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (v == null) return null;
  const s = String(v).trim();
  // Strict decimal integer: /^\d+$/ only
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}
// Middleware: sanitizes :id param and rejects bad values before handler runs
export function sanitizeIdParam(paramName = "id") {
  return (req, res, next) => {
    const v = req.params[paramName];
    if (v === undefined) return next();
    const safe = safeId(v);
    if (safe == null) {
      audit("BAD_ID", req, { param: paramName, value: String(v).slice(0, 50) });
      return res.status(400).json({ error: "Invalid ID" });
    }
    req.params[paramName] = safe;
    next();
  };
}

// ── Authorization helper: IDOR (Insecure Direct Object Reference) guard ──
// Verifies the current user owns a resource before operations.
// Usage: if (!ownsResource(req.user, order, "userId")) return 403
export function ownsResource(user, resource, ownerField = "userId") {
  if (!user || !resource) return false;
  const ownerId = resource[ownerField];
  if (ownerId == null) return false;
  return String(ownerId) === String(user.id);
}

// Express middleware variant: loads resource, checks ownership, attaches to req
export function requireOwnership({ loader, ownerField = "userId", param = "id" }) {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      const resource = await loader(id);
      if (!resource) return res.status(404).json({ error: "Not found" });
      if (!ownsResource(req.user, resource, ownerField)) {
        audit("IDOR_BLOCKED", req, { resourceId: id, ownerField });
        return res.status(403).json({ error: "Forbidden" });
      }
      req.resource = resource;
      next();
    } catch (e) {
      next(e);
    }
  };
}

// ── Regex DoS guard ───────────────────────────────────────────────
// Wraps a regex in a timeout. Usage: safeMatch(str, /.../i, 50)
export function safeMatch(str, pattern, timeoutMs = 50) {
  const start = Date.now();
  try {
    const result = pattern.exec(str);
    if (Date.now() - start > timeoutMs) return null; // too slow, bail
    return result;
  } catch { return null; }
}
