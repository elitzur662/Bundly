// flyToCart.js
// Visual "fly to cart" animation. When a user saves/likes/joins a product,
// we clone its image (or the source element itself if no image is available)
// and animate the clone across the screen to the navbar cart icon.
//
// Usage:
//   import { flyToCart } from "@/animations/flyToCart";
//   <button onClick={(e) => { flyToCart(e.currentTarget); addToMyProducts(...); }} />
//
// The function is a no-op (graceful) if the source element or cart target
// can't be found, so call sites never need defensive checks.

const CART_TARGET_ID = "navbar-cart-target";
const CART_BOUNCE_CLASS = "cart-bounce";
const FLIGHT_DURATION_MS = 700;
const BOUNCE_DURATION_MS = 320;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function bounceCart(cartEl) {
  if (!cartEl) return;
  cartEl.classList.remove(CART_BOUNCE_CLASS);
  // Force reflow so the class re-add restarts the animation.
  // eslint-disable-next-line no-unused-expressions
  void cartEl.offsetWidth;
  cartEl.classList.add(CART_BOUNCE_CLASS);
  setTimeout(() => {
    try { cartEl.classList.remove(CART_BOUNCE_CLASS); } catch {}
  }, BOUNCE_DURATION_MS + 30);
}

function pulseSource(sourceEl) {
  if (!sourceEl || !sourceEl.animate) return;
  try {
    sourceEl.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.18)" },
        { transform: "scale(1)" },
      ],
      { duration: 260, easing: "cubic-bezier(.22,.68,0,1.15)" }
    );
  } catch { /* ignore — purely decorative */ }
}

/**
 * Find an <img> inside the source element to clone. If none, return null
 * and the caller will fall back to a pulse on the source itself.
 */
function findCloneable(sourceEl) {
  if (!sourceEl) return null;
  // Prefer a real <img> — looks best when flying.
  const img = sourceEl.querySelector?.("img");
  if (img && img.complete && img.naturalWidth > 0) return img;
  // If the source IS an img.
  if (sourceEl.tagName === "IMG" && sourceEl.complete) return sourceEl;
  // Walk up — sometimes the button is below the card image. Look at the
  // nearest card-like ancestor for an image.
  let node = sourceEl.parentElement;
  let hops = 0;
  while (node && hops < 6) {
    const candidate = node.querySelector?.("img");
    if (candidate && candidate.complete && candidate.naturalWidth > 0) return candidate;
    node = node.parentElement;
    hops += 1;
  }
  return null;
}

/**
 * Animate a clone of `sourceElement`'s image to the navbar cart icon.
 *
 * @param {Element|EventTarget} sourceElement  Usually `event.currentTarget`.
 * @param {Object} options
 * @param {string} [options.cartId]   Override the default cart target id.
 * @param {number} [options.duration] Flight duration in ms (default 700).
 */
export function flyToCart(sourceElement, options = {}) {
  if (typeof document === "undefined") return;
  const sourceEl = sourceElement instanceof Element ? sourceElement : null;
  const cartEl = document.getElementById(options.cartId || CART_TARGET_ID);

  // Reduced motion: skip the fly entirely but still acknowledge with bounce.
  if (prefersReducedMotion()) {
    bounceCart(cartEl);
    return;
  }

  if (!sourceEl || !cartEl) {
    // Still bounce the cart so the user gets feedback even if source is gone.
    bounceCart(cartEl);
    return;
  }

  const cloneable = findCloneable(sourceEl);
  if (!cloneable) {
    // No image to fly — pulse the source button and bounce the cart.
    pulseSource(sourceEl);
    bounceCart(cartEl);
    return;
  }

  const srcRect = cloneable.getBoundingClientRect();
  const dstRect = cartEl.getBoundingClientRect();
  if (srcRect.width === 0 || srcRect.height === 0) {
    pulseSource(sourceEl);
    bounceCart(cartEl);
    return;
  }

  // Build the clone as a positioned wrapper so we can size it predictably
  // regardless of how the original is laid out (flex item, object-fit, etc.).
  const clone = document.createElement("div");
  const size = Math.min(Math.max(srcRect.width, 48), 140); // clamp 48..140
  clone.style.cssText = [
    "position: fixed",
    `left: ${srcRect.left + srcRect.width / 2 - size / 2}px`,
    `top: ${srcRect.top + srcRect.height / 2 - size / 2}px`,
    `width: ${size}px`,
    `height: ${size}px`,
    "border-radius: 14px",
    "overflow: hidden",
    "box-shadow: 0 10px 30px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.6)",
    "background: #fff",
    "pointer-events: none",
    "z-index: 9999",
    "will-change: transform, opacity",
    "transform-origin: center center",
  ].join("; ");

  const imgClone = document.createElement("img");
  imgClone.src = cloneable.currentSrc || cloneable.src;
  imgClone.alt = "";
  imgClone.style.cssText = "width:100%; height:100%; object-fit:cover; display:block;";
  imgClone.decoding = "async";
  imgClone.draggable = false;
  clone.appendChild(imgClone);
  document.body.appendChild(clone);

  // Destination is the centre of the cart icon.
  const dx = (dstRect.left + dstRect.width / 2) - (srcRect.left + srcRect.width / 2);
  const dy = (dstRect.top + dstRect.height / 2) - (srcRect.top + srcRect.height / 2);

  // Curve control: midpoint pulled upward so the path arcs gracefully.
  const midX = dx * 0.55;
  const midY = dy * 0.35 - Math.abs(dx) * 0.18 - 60;

  const duration = options.duration || FLIGHT_DURATION_MS;

  let animation;
  try {
    animation = clone.animate(
      [
        { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate(${midX}px, ${midY}px) scale(0.7)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0, offset: 1 },
      ],
      {
        duration,
        easing: "cubic-bezier(.55,.05,.6,.95)",
        fill: "forwards",
      }
    );
  } catch {
    // Browser without WAAPI — fall back to CSS transition.
    clone.style.transition = `transform ${duration}ms cubic-bezier(.55,.05,.6,.95), opacity ${duration}ms ease-in`;
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.3)`;
      clone.style.opacity = "0";
    });
  }

  // Trigger the cart bounce a touch before the clone "lands" so the two
  // motions overlap and feel like one beat.
  const bounceDelay = Math.max(0, duration - 180);
  setTimeout(() => bounceCart(cartEl), bounceDelay);

  const cleanup = () => {
    try { clone.remove(); } catch {}
  };
  if (animation && animation.finished && typeof animation.finished.then === "function") {
    animation.finished.then(cleanup, cleanup);
  } else {
    setTimeout(cleanup, duration + 60);
  }
  // Defensive safety net — always remove even if events misfire.
  setTimeout(cleanup, duration + 400);
}

export default flyToCart;
