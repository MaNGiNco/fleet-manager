import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Ops Command palette
        ops: {
          bg: "#070B14",
          surface: "#0D1320",
          elevated: "#121A2B",
          border: "#1E2A3F",
          muted: "#64748B",
          cyan: "#22D3EE",
          teal: "#14B8A6",
          amber: "#F59E0B",
          rose: "#F43F5E",
          emerald: "#10B981",
          violet: "#8B5CF6",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        "ops-sm": "0 1px 2px 0 rgb(0 0 0 / 0.4), 0 0 0 1px rgb(30 42 63 / 0.6)",
        "ops": "0 4px 16px -2px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(30 42 63 / 0.5)",
        "ops-lg": "0 12px 40px -8px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(30 42 63 / 0.4)",
        "glow-cyan": "0 0 24px -4px rgb(34 211 238 / 0.35)",
        "glow-rose": "0 0 24px -4px rgb(244 63 94 / 0.3)",
        "glow-amber": "0 0 20px -4px rgb(245 158 11 / 0.3)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-in": "fade-in 200ms ease-out both",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.72" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
