/**
 * Bundly — Payment Service (Stripe stub)
 *
 * INFRASTRUCTURE ONLY — no real Stripe keys required yet.
 * When ready for production:
 *   1. Install stripe: npm install stripe
 *   2. Set STRIPE_SECRET_KEY in .env
 *   3. Set STRIPE_WEBHOOK_SECRET in .env (for webhooks)
 *   4. Replace the stubbed functions below with real Stripe SDK calls
 *
 * Supports Israeli payment providers — easy swap later:
 *   - Stripe Israel (card payments)
 *   - PayPal
 *   - Cardcom / Tranzila / PayPlus (Israeli gateways)
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_READY = !!STRIPE_KEY && STRIPE_KEY.startsWith("sk_");

let _stripeClient = null;
async function _getStripe() {
  if (_stripeClient) return _stripeClient;
  if (!STRIPE_READY) return null;
  try {
    const StripeMod = (await import("stripe")).default;
    _stripeClient = new StripeMod(STRIPE_KEY);
    return _stripeClient;
  } catch {
    return null;
  }
}

/**
 * Create a payment intent for an order.
 *
 * IMPORTANT — captureMethod modes:
 *   - "automatic" (default): card is charged immediately when confirmed
 *   - "manual":             card is AUTHORIZED only; funds held but not transferred.
 *                           Use captureManualPayment() later to actually charge.
 *
 * For Bundly's group-buy flow, we PREFER captureMethod: "manual" — funds are
 * held while the group fills up, then captured when the group closes successfully
 * (or released if the group fails to reach minimum participants).
 *
 * STUB MODE (no Stripe key): returns fake IDs so the flow can be tested.
 */
export async function createPaymentIntent({ amount, currency = "ils", orderId, userId, description = "", captureMethod = "automatic" }) {
  if (!STRIPE_READY) {
    const fakeId = `pi_stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[payment] STUB ${captureMethod} intent ${fakeId} for order ${orderId} — ₪${amount}`);
    return {
      ok: true, stub: true,
      paymentIntentId: fakeId,
      clientSecret:    `${fakeId}_secret_stub`,
      amount: Math.round(Number(amount) * 100),
      currency, captureMethod,
      status: captureMethod === "manual" ? "requires_capture" : "succeeded",
    };
  }

  const stripe = await _getStripe();
  if (!stripe) return { ok: false, error: "Stripe not loaded" };

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(Number(amount) * 100),
    currency,
    capture_method: captureMethod, // "automatic" | "manual"
    metadata: { orderId: String(orderId || ""), userId: String(userId || ""), bundlyType: captureMethod === "manual" ? "preauth" : "charge" },
    description: description || `Bundly order ${orderId}`,
  });

  return {
    ok: true,
    paymentIntentId: intent.id,
    clientSecret:    intent.client_secret,
    amount:          intent.amount,
    currency:        intent.currency,
    captureMethod,
    status:          intent.status,
  };
}

/**
 * Capture a previously-authorized payment (manual capture mode).
 * Called when a group successfully reaches its minimum participants.
 */
export async function captureManualPayment({ paymentIntentId, amount = null }) {
  if (!STRIPE_READY || paymentIntentId.startsWith("pi_stub_")) {
    console.log(`[payment] STUB capture ${paymentIntentId}${amount ? ` — ₪${amount}` : ""}`);
    return { ok: true, stub: true, status: "succeeded", amount };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false };
  const intent = await stripe.paymentIntents.capture(paymentIntentId, {
    ...(amount != null && { amount_to_capture: Math.round(Number(amount) * 100) }),
  });
  return { ok: true, status: intent.status, amount: intent.amount };
}

/**
 * Release / cancel a held authorization (called when group fails to fill).
 * Returns the held funds to the customer's bank within 7 days.
 */
export async function cancelPaymentIntent({ paymentIntentId, reason = "abandoned" }) {
  if (!STRIPE_READY || paymentIntentId.startsWith("pi_stub_")) {
    console.log(`[payment] STUB cancel ${paymentIntentId} (${reason})`);
    return { ok: true, stub: true, status: "canceled" };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false };
  const intent = await stripe.paymentIntents.cancel(paymentIntentId, { cancellation_reason: reason });
  return { ok: true, status: intent.status };
}

/**
 * Confirm a payment intent succeeded (called from webhook or client).
 * In stub mode, always returns success.
 */
export async function retrievePaymentIntent(paymentIntentId) {
  if (!STRIPE_READY || paymentIntentId.startsWith("pi_stub_")) {
    return { ok: true, stub: true, id: paymentIntentId, status: "succeeded", amount: 0 };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false };
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    ok: true,
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    metadata: intent.metadata,
  };
}

// ── Card-on-file flow: SetupIntent + off-session charge ─────────
// Used by the new "approve card but don't charge yet" deposit flow.
// SetupIntent validates the card (issuing bank may do a $0 or $1
// authorisation that's immediately voided) and saves the PaymentMethod
// onto a customer for later off-session charges. No money moves at this
// point — the user only sees their card was approved.

/**
 * Find an existing Stripe Customer for this Bundly user, or create one.
 * STUB: returns a fake customer id keyed off userId.
 */
export async function findOrCreateCustomer({ userId, email = "", name = "" }) {
  if (!STRIPE_READY) {
    return { ok: true, stub: true, customerId: `cus_stub_${userId}` };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false, error: "Stripe not loaded" };
  // Search by metadata.userId so re-runs don't create duplicate customers.
  try {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${String(userId)}'`,
      limit: 1,
    });
    if (found.data.length > 0) {
      return { ok: true, customerId: found.data[0].id, existing: true };
    }
  } catch (e) {
    // search may be unavailable on some accounts — fall through to create
  }
  const customer = await stripe.customers.create({
    email: email || undefined,
    name:  name  || undefined,
    metadata: { userId: String(userId), source: "bundly" },
  });
  return { ok: true, customerId: customer.id, created: true };
}

/**
 * Create a SetupIntent to validate + save a card for future off-session use.
 * No charge occurs. Returns a clientSecret the frontend feeds to
 * stripe.confirmCardSetup() so the card stays on Stripe's side (PCI scope SAQ-A).
 */
export async function createSetupIntent({ customerId, userId, dealId = null, description = "" }) {
  if (!STRIPE_READY) {
    const fakeId = `seti_stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[payment] STUB SetupIntent ${fakeId} for user ${userId} (deal ${dealId})`);
    return {
      ok: true, stub: true,
      setupIntentId: fakeId,
      clientSecret:  `${fakeId}_secret_stub`,
      customerId,
      status: "succeeded",
    };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false, error: "Stripe not loaded" };
  const intent = await stripe.setupIntents.create({
    customer:            customerId,
    payment_method_types: ["card"],
    usage:               "off_session",
    description:         description || `Bundly card-on-file (deal ${dealId || "n/a"})`,
    metadata: {
      userId: String(userId || ""), dealId: String(dealId || ""), bundlyType: "card_on_file",
    },
  });
  return {
    ok: true,
    setupIntentId: intent.id,
    clientSecret:  intent.client_secret,
    customerId,
    status:        intent.status,
  };
}

/**
 * Charge a previously-saved card off-session (no customer present).
 *
 * Triggered when a deal closes and the user has confirmed via the
 * "approve payment" link in email/SMS. The PaymentMethod must already be
 * attached to `customerId` (via a prior SetupIntent.confirm()).
 *
 * If the bank requires 3DS / SCA at this charge attempt, the intent comes
 * back with status: "requires_action". The caller should then notify the
 * customer to complete authentication via Stripe's hosted flow.
 */
export async function chargeOffSession({
  customerId, paymentMethodId, amount, currency = "ils",
  orderId = null, userId = null, description = "",
}) {
  if (!STRIPE_READY) {
    const fakeId = `pi_offsession_stub_${Date.now()}`;
    console.log(`[payment] STUB off-session charge ${fakeId} cust=${customerId} pm=${paymentMethodId} ₪${amount}`);
    return {
      ok: true, stub: true,
      paymentIntentId: fakeId, status: "succeeded",
      amount: Math.round(Number(amount) * 100), currency,
    };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false, error: "Stripe not loaded" };
  try {
    const intent = await stripe.paymentIntents.create({
      amount:         Math.round(Number(amount) * 100),
      currency,
      customer:       customerId,
      payment_method: paymentMethodId,
      off_session:    true,
      confirm:        true,
      description:    description || `Bundly order ${orderId || ""}`,
      metadata:       { orderId: String(orderId || ""), userId: String(userId || ""), bundlyType: "deal_close_charge" },
    });
    return {
      ok: true,
      paymentIntentId: intent.id,
      status:          intent.status,
      amount:          intent.amount,
      currency:        intent.currency,
      // requires_action means the bank wants 3DS — return the next-action URL
      // so the customer can complete the challenge.
      requiresAction:  intent.status === "requires_action",
      nextActionUrl:   intent.next_action?.redirect_to_url?.url || null,
    };
  } catch (e) {
    // Stripe throws on declined cards (StripeCardError) and authentication
    // failures (authentication_required). Surface a friendly code so the
    // server can pick the right notification template.
    return {
      ok: false,
      error: e.message,
      code:  e.code || e.decline_code || null,
      paymentIntentId: e.payment_intent?.id || null,
    };
  }
}

/**
 * Issue a refund against a payment intent.
 */
export async function refundPayment({ paymentIntentId, amount = null, reason = "requested_by_customer" }) {
  if (!STRIPE_READY || paymentIntentId.startsWith("pi_stub_")) {
    const fakeRefundId = `re_stub_${Date.now()}`;
    console.log(`[payment] STUB refund ${fakeRefundId} for ${paymentIntentId}`);
    return { ok: true, stub: true, refundId: fakeRefundId, status: "succeeded", amount };
  }
  const stripe = await _getStripe();
  if (!stripe) return { ok: false };
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amount != null && { amount: Math.round(Number(amount) * 100) }),
    reason,
  });
  return { ok: true, refundId: refund.id, status: refund.status, amount: refund.amount };
}

/**
 * Create a payout to a supplier's bank account.
 * In production this uses Stripe Connect (requires supplier onboarding).
 */
export async function createPayout({ supplierId, amount, bankAccount, description = "" }) {
  if (!STRIPE_READY) {
    const fakePayoutId = `po_stub_${Date.now()}`;
    console.log(`[payment] STUB payout ${fakePayoutId} to supplier ${supplierId} — ₪${amount}`);
    return { ok: true, stub: true, payoutId: fakePayoutId, amount, status: "pending" };
  }
  // Real implementation requires Stripe Connect accounts per supplier
  // Placeholder: just log — production code goes here
  return { ok: false, error: "Stripe Connect not configured for supplier" };
}

/**
 * Verify a Stripe webhook signature AND prevent replay attacks.
 *
 * Replay defense: tracks every accepted event.id in a persisted Set.
 * If the same event.id arrives again (attacker re-sends a previously
 * captured webhook payload), we return ok:false even though the signature
 * is technically valid. Stripe events are typed event.id = "evt_..." and
 * unique per event — perfect for de-duplication.
 *
 * Additional defense: reject events older than 5 minutes — Stripe's
 * recommended freshness window. Mitigates timing attacks.
 */
import { readFileSync as _whRd, writeFileSync as _whWr, existsSync as _whEx } from "node:fs";
import { dirname as _whDn, join as _whJn } from "node:path";
import { fileURLToPath as _whUrl } from "node:url";
const _WH_FILE = _whJn(_whDn(_whUrl(import.meta.url)), "stripe-webhook-events.json");
const _WH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const _seenWebhookIds = (() => {
  try {
    if (_whEx(_WH_FILE)) {
      const raw = JSON.parse(_whRd(_WH_FILE, "utf8"));
      const m = new Map();
      const cutoff = Date.now() - _WH_TTL_MS;
      for (const [id, ts] of Object.entries(raw)) if (ts > cutoff) m.set(id, ts);
      return m;
    }
  } catch {}
  return new Map();
})();
let _whDirty = false;
function _saveWebhookSeen() {
  if (!_whDirty) return;
  _whDirty = false;
  try {
    const out = {};
    for (const [id, ts] of _seenWebhookIds) out[id] = ts;
    _whWr(_WH_FILE, JSON.stringify(out), "utf8");
  } catch {}
}
setInterval(_saveWebhookSeen, 5000).unref?.();

export function verifyWebhookSignature(rawBody, signature) {
  if (!STRIPE_READY) return { ok: true, stub: true, event: null };
  const stripe = _stripeClient;
  if (!stripe) return { ok: false };
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET
    );
    // 1) Replay defense — reject if we've already processed this event.id
    if (event.id && _seenWebhookIds.has(event.id)) {
      return { ok: false, error: "Webhook replay rejected", replay: true, eventId: event.id };
    }
    // 2) Freshness window — events >5min old likely captured-and-replayed
    const eventAgeMs = Date.now() - (event.created * 1000);
    if (eventAgeMs > 5 * 60 * 1000) {
      return { ok: false, error: "Webhook event too old", stale: true, ageMs: eventAgeMs };
    }
    // 3) Mark as seen
    if (event.id) {
      _seenWebhookIds.set(event.id, Date.now());
      _whDirty = true;
    }
    return { ok: true, event };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const PAYMENT_READY = STRIPE_READY;
