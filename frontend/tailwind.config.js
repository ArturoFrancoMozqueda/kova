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
      // Motion scale (values in styles.css). Pick the duration by how often the
      // control is touched, not by how the animation looks in isolation:
      // `duration-press` for a cashier's hot path, `duration-celebrate` only for
      // rare moments. See docs/claude/motion-system.md.
      transitionDuration: {
        press: "var(--kova-dur-press)",
        quick: "var(--kova-dur-quick)",
        hover: "var(--kova-dur-hover)",
        panel: "var(--kova-dur-panel)",
        modal: "var(--kova-dur-modal)",
        celebrate: "var(--kova-dur-celebrate)",
        "panel-exit": "var(--kova-dur-panel-exit)",
        "modal-exit": "var(--kova-dur-modal-exit)",
      },
      transitionTimingFunction: {
        standard: "var(--kova-ease-standard)",
        entrance: "var(--kova-ease-entrance)",
        exit: "var(--kova-ease-exit)",
        spring: "var(--kova-ease-spring)",
      },
      // PRINT SAFETY: every `to:` state ends at `transform: none`, never at
      // translate/scale zero. A non-`none` transform makes the element a
      // containing block for absolutely positioned descendants, and ViewLayout
      // (which carries animate-fade-in) is an ancestor of .print-receipt-root
      // and .print-corte-root. Ending at `none` is what makes a `forwards` or
      // `both` fill-mode safe here. See the @media print block in styles.css.
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "none" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "none" },
        },
        // Exit counterparts, one per surface the presence pattern unmounts.
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "scale-out": {
          from: { opacity: "1", transform: "none" },
          to: { opacity: "0", transform: "scale(0.97)" },
        },
        "slide-down": {
          from: { transform: "none" },
          to: { transform: "translateY(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--kova-dur-hover) var(--kova-ease-standard)",
        "slide-in-right": "slide-in-right var(--kova-dur-panel) var(--kova-ease-standard)",
        "scale-in": "scale-in var(--kova-dur-modal) var(--kova-ease-entrance)",
        "pulse-soft": "pulse-soft 1.5s var(--kova-ease-standard) infinite",
        "slide-up": "slide-up var(--kova-dur-modal) var(--kova-ease-entrance)",
        // Exits hold their end state so the node can't flash back before unmount.
        "fade-out": "fade-out var(--kova-dur-panel-exit) var(--kova-ease-exit) forwards",
        "scale-out": "scale-out var(--kova-dur-modal-exit) var(--kova-ease-exit) forwards",
        "slide-down": "slide-down var(--kova-dur-modal-exit) var(--kova-ease-exit) forwards",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
