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
        "indigo": "0 4px 24px -4px rgba(79,70,229,0.25)",
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
