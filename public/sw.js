/* Bundly Service Worker
 * Powers the PWA: offline shell, push notifications, and the
 * "Install Bundly" prompt on installable platforms.
 *
 * Caching strategy:
 *   - shell (index.html + manifest + icons): cache-first with bg refresh
 *   - /api/*: network-only (we never want stale API data)
 *   - everything else (static assets): stale-while-revalidate
 */

const VERSION = "v1";
const SHELL_CACHE  = `bundly-shell-${VERSION}`;
const ASSET_CACHE  = `bundly-assets-${VERSION}`;

const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  // Pre-cache the shell so a fresh install works offline immediately
  // after the first online visit.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop old-version caches on upgrade so users always get fresh code
  // after a deploy. Each push of sw.js (new VERSION) cleans the previous one.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Same-origin only; never intercept third-party (Stripe, Resend webhooks, etc.)
  if (url.origin !== self.location.origin) return;
  // Never cache API responses; they're authoritative state.
  if (url.pathname.startsWith("/api/")) return;
  // GET only; never cache POST/PATCH/DELETE.
  if (req.method !== "GET") return;

  // Shell HTML: network-first so deploys take effect immediately, fall back
  // to cache for offline.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Don't poison cache with redirects or errors
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/").then((c) => c || Response.error()))
    );
    return;
  }

  // Static assets (built JS/CSS, images, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fetchPromise;
    })
  );
});

// ── Push notifications ────────────────────────────────────────────
// Triggered by a backend POST to the push provider when a deal closes,
// a new offer arrives, etc. The payload is a JSON blob:
//   { title, body, url?, tag?, icon?, badge? }
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    try { data = { title: "Bundly", body: event.data.text() }; } catch { data = {}; }
  }
  const title = data.title || "Bundly";
  const options = {
    body:  data.body  || "",
    icon:  data.icon  || "/icons/icon.svg",
    badge: data.badge || "/icons/icon.svg",
    tag:   data.tag   || "bundly-notification",
    data:  { url: data.url || "/" },
    dir:   "rtl",
    lang:  "he",
    requireInteraction: false,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Focus an existing window if one is open
      for (const w of wins) {
        if ("focus" in w && new URL(w.url).origin === self.location.origin) {
          w.focus();
          if ("navigate" in w) w.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Allow the page to trigger an immediate update (e.g., right after deploy).
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
