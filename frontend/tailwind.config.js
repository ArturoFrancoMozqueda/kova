/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          muted: "hsl(var(--sidebar-muted))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          strong: "hsl(var(--warning-strong))",
        },
        // Kova brand palette (Phase 1 foundation — not yet applied to
        // component semantics; consume via `kova-*` utility classes).
        kova: {
          blue: "var(--kova-blue)",
          "blue-light": "var(--kova-blue-light)",
          ink: "var(--kova-ink)",
          mist: "var(--kova-mist)",
          growth: "var(--kova-growth)",
          muted: "var(--kova-muted)",
          tertiary: "var(--kova-tertiary)",
          border: "var(--kova-border)",
          danger: "var(--kova-danger)",
          "danger-foreground": "var(--kova-danger-foreground)",
          "on-ink": "var(--kova-on-ink)",
          "ink-border": "var(--kova-ink-border)",
        },
      },
      boxShadow: {
        "kova-card": "var(--kova-shadow-card)",
        "kova-card-hover": "var(--kova-shadow-card-hover)",
        "kova-hero": "var(--kova-shadow-hero)",
      },
      backgroundImage: {
        "kova-grad-blue": "var(--kova-grad-blue)",
        "kova-grad-mint": "var(--kova-grad-mint)",
        "kova-grad-sky": "var(--kova-grad-sky)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "kova-sm": "var(--radius-kova-sm)",
        "kova-md": "var(--radius-kova-md)",
        "kova-lg": "var(--radius-kova-lg)",
        "kova-xl": "var(--radius-kova-xl)",
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.2s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
        "pulse-soft": "pulse-soft 1.5s ease-in-out infinite",
        "slide-up": "slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
