// Lazy Stripe.js loader — fetches the publishable key from the server (so the
// key never ships in the client bundle and stub-mode works without redeploys).
// Returns a Promise resolving to a Stripe instance, or null if the server
// reports no key configured (demo / stub mode).
import { loadStripe } from "@stripe/stripe-js";

let _stripePromise = null;
let _stripeReady = null; // boolean once resolved

export function getStripePromise() {
  if (_stripePromise) return _stripePromise;
  _stripePromise = (async () => {
    try {
      const r = await fetch("/api/stripe-public-key", { credentials: "same-origin" });
      const d = r.ok ? await r.json() : null;
      if (!d?.key) { _stripeReady = false; return null; }
      const stripe = await loadStripe(d.key);
      _stripeReady = !!stripe;
      return stripe;
    } catch (e) {
      console.warn("[stripe] init failed:", e?.message);
      _stripeReady = false;
      return null;
    }
  })();
  return _stripePromise;
}

export function isStripeReady() {
  return _stripeReady;
}
