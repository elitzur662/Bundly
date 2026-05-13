/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      boxShadow: {
        // Updated to purple RGBA (#9333ea) to match the new brand palette.
        "indigo": "0 4px 24px -4px rgba(147,51,234,0.25)",
      },
      colors: {
        // ── Brand palette: pure purple ───────────────────────────────────
        // REDEFINE `indigo` (Tailwind's default blue-violet) so all 600+
        // existing `indigo-XXX` classes in the codebase read as true purple
        // without touching their call sites. Light shades stay clean pastel
        // purple — no cream tint.
        indigo: {
          50:  "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",   // brand purple
          700: "#7e22ce",   // hover / active
          800: "#6b21a8",
          900: "#581c87",
        },
        // Violet stays magenta-leaning so gradient pairings like
        // `from-indigo-600 to-violet-600` keep two distinct hues.
        violet: {
          50:  "#fdf4ff",
          100: "#fae8ff",
          200: "#f5d0fe",
          300: "#f0abfc",
          400: "#e879f9",
          500: "#d946ef",
          600: "#c026d3",
          700: "#a21caf",
          800: "#86198f",
          900: "#701a75",
        },
      },
    },
  },
  plugins: [],
  safelist: [
    "rounded-3xl",
    "rounded-2xl",
    "shadow-xl",
    "shadow-2xl",
    "from-indigo-600",
    "to-violet-600",
    "from-indigo-700",
    "to-violet-700",
    "bg-gradient-to-r",
    "bg-gradient-to-br",
    "bg-gradient-to-l",
    "shadow-indigo-200",
    "shadow-violet-200",
    "hover:shadow-xl",
    "hover:-translate-y-1",
    "hover:border-indigo-100",
    "backdrop-blur-xl",
    "backdrop-blur-md",
    "active:scale-95",
    "group-hover:scale-105",
  ],
}
