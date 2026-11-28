/** @type {import('tailwindcss').Config} */
// Design tokens are the single source of truth for colour. They are declared as
// CSS custom properties in src/index.css (RGB channels, so Tailwind's
// `<alpha-value>` opacity modifiers keep working) and mapped here. Screens must
// use the semantic names below — never raw hex utilities.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
          sunken: "rgb(var(--surface-sunken) / <alpha-value>)",
          inverse: "rgb(var(--surface-inverse) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle) / <alpha-value>)",
          inverse: "rgb(var(--ink-inverse) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          strong: "rgb(var(--accent-strong) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          wash: "rgb(var(--accent-wash) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--gold) / <alpha-value>)",
          strong: "rgb(var(--gold-strong) / <alpha-value>)",
          soft: "rgb(var(--gold-soft) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          soft: "rgb(var(--success-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          soft: "rgb(var(--danger-soft) / <alpha-value>)",
        },
        // Legacy alias kept so the palette already referenced in older files
        // keeps compiling. New code uses the semantic names above.
        harvest: {
          purple: "#221A56",
          dark: "#140F38",
          amber: "#EEB609",
          lavender: "#E8E5F4",
          cream: "#F6F4EC",
          border: "#DDD7C8",
        },
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "system-ui", "sans-serif"],
      },
      // A real scale, not per-screen guesses. 12px is the floor for UI labels;
      // nothing smaller ships. Screens pick a step, never a pixel value.
      fontSize: {
        "2xs": ["0.75rem", { lineHeight: "1.05rem", letterSpacing: "0.01em" }],
        caption: ["0.8125rem", { lineHeight: "1.2rem" }],
        body: ["0.9375rem", { lineHeight: "1.45rem" }],
        heading: ["1.125rem", { lineHeight: "1.45rem", letterSpacing: "-0.01em" }],
        title: ["1.5rem", { lineHeight: "1.85rem", letterSpacing: "-0.025em" }],
        display: ["2rem", { lineHeight: "2.25rem", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        card: "20px",
        pill: "9999px",
      },
      // Elevation is tinted with the logo navy, not neutral grey: on cream,
      // a warm-grey shadow reads as dust while navy reads as depth. The gold
      // hairline is the "premium" note carried by cards and the primary button.
      boxShadow: {
        card: "0 1px 2px rgb(34 26 86 / 0.05), 0 10px 26px -16px rgb(34 26 86 / 0.20)",
        raised: "0 2px 4px rgb(34 26 86 / 0.06), 0 18px 44px -20px rgb(34 26 86 / 0.30)",
        focus: "0 0 0 3px rgb(var(--accent) / 0.28)",
        gold: "inset 0 1px 0 rgb(238 182 9 / 0.45)",
      },
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
