/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        harvest: { purple: "#7C3AED", dark: "#5B21B6", amber: "#F59E0B", lavender: "#EDE9FE", cream: "#FFFBEB", border: "#E5E7EB" }
      },
      borderRadius: { card: "16px", pill: "9999px" }
    },
  },
  plugins: [],
}
