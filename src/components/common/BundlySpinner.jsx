/**
 * Bundly — Branded SVG spinner.
 *
 * Used everywhere we'd otherwise show Loader2 from lucide-react. The Bundly
 * "B" mark sits inside a partial indigo arc that rotates on the standard CSS
 * `spin` keyframe (defined in index.css). Visually announces the brand even
 * during loading.
 *
 * Props:
 *   size      — number, pixel dimensions (default 24)
 *   className — extra Tailwind classes for layout (the size + animation are
 *               applied inline so they always render even before CSS loads)
 */
export default function BundlySpinner({ size = 24, className = "" }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 32 32"
      className={`flex-shrink-0 ${className}`}
      style={{ animation: "spin 0.85s linear infinite" }}
      aria-label="טוען..."
    >
      {/* Outer track */}
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="#e0e7ff" strokeWidth="3.5" />
      {/* Spinning arc — indigo */}
      <path
        d="M 16 3.5 A 12.5 12.5 0 0 1 28.5 16"
        fill="none" stroke="#4f46e5" strokeWidth="3.5" strokeLinecap="round"
      />
      {/* Bundly "B" in center */}
      <text
        x="16" y="21"
        textAnchor="middle"
        fontSize="13" fontWeight="900"
        fill="#4f46e5"
        fontFamily="Rubik, system-ui, sans-serif"
        style={{ userSelect: "none" }}
      >B</text>
    </svg>
  );
}
