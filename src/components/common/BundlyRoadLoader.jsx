/**
 * Bundly, Branded loading indicator.
 *
 * Previously animated a delivery van around a winding race-circuit. Per
 * user feedback 2026-05-15 the van was too busy/playful for the spot
 * where we use it most (full-page loaders during product searches);
 * replaced with a calmer aesthetic: the Bundly "B" mark sits inside a
 * thin indigo ring that rotates around it.
 *
 * Two modes:
 *   compact=true  → 40×40 mini puck for inline status pills
 *   compact=false → 96×96 hero loader for modal/page-level loading
 *
 * Same props as the old loader, drop-in replacement, every caller in
 * App.jsx keeps working without changes.
 */

export default function BundlyRoadLoader({ message, subMessage, compact = false, productName = '' }) {
  // productName is unused now (was driving fake per-store prices in the
  // old design), kept in the signature so existing call sites compile.
  void productName;

  const size = compact ? 40 : 96;
  const ringThick = compact ? 3 : 5.5;
  const fontSize = compact ? 17 : 38;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ animation: 'spin 1.1s linear infinite', display: 'block' }}
        aria-label="טוען..."
        role="status"
      >
        <defs>
          <linearGradient id="bRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="#7e22ce" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>
        {/* Static track */}
        <circle
          cx="50" cy="50" r="42"
          fill="none" stroke="#ede9fe"
          strokeWidth={ringThick}
        />
        {/* Spinning arc, three-quarters of the circle so the motion reads cleanly */}
        <path
          d="M 50 8 A 42 42 0 0 1 92 50"
          fill="none"
          stroke="url(#bRingGrad)"
          strokeWidth={ringThick}
          strokeLinecap="round"
        />
      </svg>

      {/* Centre "B", sits ON TOP of the spinning ring, not inside the
          rotating SVG, so the letter stays upright while the ring rotates. */}
      <div
        style={{
          position: 'relative',
          marginTop: -size,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontFamily: 'Rubik, system-ui, sans-serif',
            fontWeight: 900,
            fontSize,
            background: 'linear-gradient(135deg, #7e22ce, #c084fc)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >B</span>
      </div>

      {!compact && (
        <>
          {message    && <p className="text-gray-800 font-bold text-base text-center mt-4">{message}</p>}
          {subMessage && <p className="text-indigo-600 text-sm font-semibold text-center mt-1">{subMessage}</p>}
        </>
      )}
    </div>
  );
}
