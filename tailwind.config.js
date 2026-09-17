/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        harvest: { purple: "#7C3AED", dark: "#5B21B6", amber: "#F59E0B", lavender: "#EDE9FE", cream: "#FFFBEB", border: "#E5E7EB" }
      },
      borderRadius: { card: "16px", pill: "9999px" },
      keyframes: {
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slide-up .35s cubic-bezier(.16,1,.3,1) both",
        "fade-in": "fade-in .25s ease-out both",
      },
    },
  },
  plugins: [],
}
