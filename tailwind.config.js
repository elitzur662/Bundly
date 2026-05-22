/** @type {import('tailwindcss').Config} */

// ── Brand palette: deep navy ───────────────────────────────────────────────
// Bundly's brand colour. The codebase scatters several colour families for
// what is really ONE brand accent (indigo / violet / purple / pink / fuchsia).
// Redefining all of them to the SAME navy scale unifies every button, badge
// and gradient into one disciplined, premium accent — without touching the
// thousands of `*-indigo-600` / `*-purple-600` … call sites.
//
// Semantic colours are deliberately LEFT as Tailwind defaults:
//   emerald = active group / success,  amber = warning,  red = error.
const navy = {
  50:  "#eef2f8",
  100: "#dde4f0",
  200: "#bdcae1",
  300: "#92a6cc",
  400: "#5e7cb3",
  500: "#345699",
  600: "#1e3a8a",   // brand navy — primary buttons, links, badges
  700: "#1a3070",   // hover / active
  800: "#172554",
  900: "#111b3f",
  950: "#0c1330",
};
// A slightly deeper navy for `violet` so two-stop gradients like
// `from-indigo-600 to-violet-600` keep a subtle, premium depth.
const navyDeep = {
  50:  "#edf0f6",
  100: "#d9e0ec",
  200: "#b4c1da",
  300: "#8497bd",
  400: "#506b9c",
  500: "#28447f",
  600: "#172554",
  700: "#131e45",
  800: "#0f1838",
  900: "#0b112a",
  950: "#070b1c",
};

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
        // Navy RGBA (#1e3a8a) to match the brand palette.
        "indigo": "0 4px 24px -4px rgba(30,58,138,0.25)",
      },
      colors: {
        // Every brand-accent family → the one navy scale.
        indigo:  navy,
        purple:  navy,
        pink:    navy,
        fuchsia: navy,
        // Gradient partner — one step deeper for subtle depth.
        violet:  navyDeep,
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
