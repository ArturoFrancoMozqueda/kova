// Shared landing theme — single source of truth for the `.lp-root` page-level
// CSS variables (themeVars) and the landing CSS (lp-* classes + keyframes).
//
// Extracted verbatim from routes/Home.tsx so that any surface reusing the
// landing product previews (e.g. the marketing showcase at
// landing/showcase/KovaShowcase.tsx) renders with the exact same theming and
// micro-interaction styles. Home.tsx and the showcase both import from here —
// keeping styling in one place instead of duplicating ~430 lines of CSS.
import type { CSSProperties } from "react";

/* ─── Theme ──────────────────────────────────────────────────────────────── */
export type Theme = "light" | "dark";

export function themeVars(theme: Theme): CSSProperties {
  if (theme === "dark") {
    return {
      "--page-bg": "var(--kova-ink)",
      "--page-fg": "var(--kova-on-ink)",
      "--surface": "#1A1D28",
      "--surface-2": "#161922",
      "--hairline-color": "rgba(255,255,255,0.08)",
      "--hairline-strong": "rgba(255,255,255,0.14)",
      "--accent": "var(--kova-blue-light)",
      "--accent-soft": "rgba(123,167,255,0.16)",
      "--text-muted": "#8892A4",
      "--text-tertiary": "#7C89A1",
      "--cta-blue": "#3D63DF",
      "--ink-on-fg": "var(--kova-ink)",
      "--card-bg": "#1A1D28",
      "--chip-bg": "rgba(255,255,255,0.06)",
      "--invert-ink-bg": "#FBFBFD",
      "--invert-ink-fg": "var(--kova-ink)",
    } as CSSProperties;
  }
  return {
    "--page-bg": "var(--kova-paper, #FBFBFD)",
    "--page-fg": "var(--kova-ink)",
    "--surface": "#FFFFFF",
    "--surface-2": "var(--kova-mist)",
    "--hairline-color": "var(--kova-border)",
    "--hairline-strong": "#CDD4E3",
    "--accent": "var(--kova-blue)",
    "--accent-soft": "rgba(79,126,247,0.12)",
    "--text-muted": "var(--kova-muted)",
    "--text-tertiary": "var(--kova-tertiary)",
    "--cta-blue": "#3D63DF",
    "--ink-on-fg": "var(--kova-on-ink)",
    "--card-bg": "#FFFFFF",
    "--chip-bg": "rgba(15,17,23,0.05)",
    "--invert-ink-bg": "var(--kova-ink)",
    "--invert-ink-fg": "var(--kova-on-ink)",
  } as CSSProperties;
}

/* ─── Landing-scoped CSS ─────────────────────────────────────────────────── */
export const LANDING_STYLES = `
  .lp-root {
    font-family: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
    background: var(--page-bg);
    color: var(--page-fg);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    transition: background 280ms var(--kova-ease-entrance), color 280ms var(--kova-ease-entrance);
  }
  .lp-root .tabular { font-variant-numeric: tabular-nums; }
  .lp-root ::selection { background: var(--accent); color: #fff; }

  .lp-section {
    padding: 88px 32px;
    border-top: 0.5px solid var(--hairline-color);
  }
  .lp-section-compact { padding: 72px 32px; }
  .lp-section-inner {
    max-width: 1180px;
    margin: 0 auto;
  }
  .lp-section-label {
    display: inline-flex;
    margin-bottom: 22px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lp-section-title {
    font-size: clamp(32px, 4vw, 54px);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.04;
    margin: 0;
    color: var(--page-fg);
  }
  .lp-section-copy {
    margin: 16px 0 0;
    max-width: 620px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .lp-live-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--kova-growth);
    box-shadow: 0 0 0 0 rgba(30,191,138,0.5);
    animation: lp-live-pulse 1.5s ease-out infinite;
    display: inline-block;
  }
  @keyframes lp-live-pulse {
    0%   { box-shadow: 0 0 0 0   rgba(30,191,138,0.5); }
    70%  { box-shadow: 0 0 0 8px rgba(30,191,138,0);   }
    100% { box-shadow: 0 0 0 0   rgba(30,191,138,0);   }
  }
  @keyframes lp-feed-in {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes lp-cart-pop {
    0%   { transform: scale(0.85); opacity: 0; }
    70%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes lp-hero-drift {
    0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); }
    50%      { transform: translate3d(0, -8px, 0) rotate(-0.4deg); }
  }

  .lp-root.lp-motion-ready .lp-hero-visual > * {
    animation: lp-hero-drift 7s ease-in-out infinite;
  }
  .lp-hero-visual > * {
    max-width: min(100%, 410px);
  }
  .lp-hero-logo {
    width: min(100%, 390px) !important;
  }
  @keyframes lp-story-in {
    from { opacity: 0; transform: translate3d(0, 10px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes lp-story-progress-fill {
    from { width: 0%; }
    to   { width: 100%; }
  }
  @keyframes lp-bar-grow {
    from { transform: scaleY(0); }
    to   { transform: scaleY(1); }
  }
  @keyframes lp-fill-x {
    from { width: 0; }
  }
  @keyframes lp-btn-pulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.03); }
  }
  @keyframes lp-flash-ring {
    0%   { box-shadow: 0 0 0 4px rgba(30,191,138,0.35); }
    100% { box-shadow: 0 0 0 0 rgba(30,191,138,0); }
  }

  /* Microinteracciones de la historia: solo corren dentro de un contenedor
     con data-lp-anim="on" (entrada del estado), una vez, sin loops. */
  [data-lp-anim="on"] .lp-story-fade {
    opacity: 0;
    animation: lp-feed-in 280ms var(--kova-ease-entrance) forwards;
    animation-delay: var(--lp-fade-delay, 0ms);
  }
  [data-lp-anim="on"] .lp-story-slide {
    animation: lp-story-in 300ms var(--kova-ease-entrance) both;
    animation-delay: 120ms;
  }
  [data-lp-anim="on"] .lp-story-pop {
    animation: lp-cart-pop 260ms var(--kova-ease-spring) both;
    /* Derivado de --lp-entry-delay (default 280ms → 160ms, el valor histórico)
       para que el showcase pueda retrasar toda la entrada de golpe. */
    animation-delay: calc(var(--lp-entry-delay, 280ms) - 120ms);
  }
  [data-lp-anim="on"] .lp-bar {
    transform-origin: bottom;
    animation: lp-bar-grow 420ms var(--kova-ease-entrance) both;
    animation-delay: var(--lp-fade-delay, 0ms);
  }
  [data-lp-anim="on"] .lp-fill {
    animation: lp-fill-x 480ms var(--kova-ease-entrance) both;
    animation-delay: 160ms;
  }
  [data-lp-anim="on"] .lp-charge-pulse {
    animation: lp-btn-pulse 320ms var(--kova-ease-spring) calc(var(--lp-entry-delay, 280ms) + 360ms);
  }
  [data-lp-anim="on"] .lp-flash {
    animation: lp-flash-ring 700ms var(--kova-ease-exit) 720ms;
  }

  .lp-story-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.42fr) minmax(0, 0.58fr);
    gap: 36px;
    align-items: start;
    margin-top: 30px;
  }
  .lp-story-rail {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lp-story-tab {
    position: relative;
    overflow: hidden;
    display: flex;
    gap: 14px;
    align-items: flex-start;
    text-align: left;
    padding: 16px 18px;
    border-radius: 12px;
    border: 0.5px solid transparent;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    color: var(--text-muted);
    transition: background 180ms var(--kova-ease-entrance), border-color 180ms var(--kova-ease-entrance);
  }
  .lp-story-tab:hover { background: var(--surface-2); }
  .lp-story-tab[data-active="1"] {
    background: var(--surface-2);
    border-color: var(--hairline-strong);
  }
  .lp-story-tab-num {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    background: var(--chip-bg);
    color: var(--text-muted);
    flex-shrink: 0;
    transition: background 180ms var(--kova-ease-entrance), color 180ms var(--kova-ease-entrance);
  }
  .lp-story-tab[data-active="1"] .lp-story-tab-num {
    background: var(--accent);
    color: #fff;
  }
  .lp-story-tab strong {
    display: block;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-muted);
    transition: color 180ms var(--kova-ease-entrance);
  }
  .lp-story-tab[data-active="1"] strong { color: var(--page-fg); }
  .lp-story-tab-line {
    display: block;
    font-size: 12.5px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .lp-story-progress {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: 0;
    background: var(--accent);
    animation: lp-story-progress-fill 6000ms linear forwards;
  }
  .lp-story-progress[data-paused="1"] { animation-play-state: paused; }
  .lp-story-stage {
    position: relative;
    min-height: 420px;
  }
  .lp-story-panel {
    position: relative;
    animation: lp-story-in 250ms var(--kova-ease-entrance) both;
    padding-bottom: 16px;
  }
  .lp-story-callout {
    position: absolute;
    left: 18px;
    bottom: -2px;
    background: var(--kova-ink);
    border: 1px solid var(--accent);
    color: var(--kova-on-ink);
    padding: 7px 14px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 10px 28px -10px rgba(0,0,0,0.6);
    white-space: nowrap;
  }
  .lp-story-mobile {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 26px;
  }
  .lp-story-card {
    border: 0.5px solid var(--hairline-color);
    border-radius: 14px;
    background: var(--page-bg);
    padding: 16px;
  }

  .lp-bento {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    list-style: none;
    padding: 0;
    margin: 36px 0 0;
  }
  .lp-bento-cell {
    display: flex;
    flex-direction: column;
    min-height: 178px;
    padding: 20px;
    border-radius: 14px;
    border: 0.5px solid var(--hairline-color);
    background: var(--page-bg);
    transition:
      border-color 180ms var(--kova-ease-entrance),
      transform 180ms var(--kova-ease-entrance),
      box-shadow 180ms var(--kova-ease-entrance);
  }
  .lp-bento-cell:hover {
    border-color: var(--hairline-strong);
    transform: translateY(-2px);
    box-shadow: 0 12px 32px -16px rgba(0,0,0,0.5);
  }
  .lp-bento-cell[data-large="1"] { grid-column: span 2; }

  /* Reusable card/chip lift — same feel as the bento cells */
  .lp-lift {
    transition:
      border-color 180ms var(--kova-ease-entrance),
      transform 180ms var(--kova-ease-entrance),
      box-shadow 180ms var(--kova-ease-entrance),
      background 180ms var(--kova-ease-entrance);
  }
  .lp-lift:hover {
    border-color: var(--hairline-strong);
    transform: translateY(-2px);
    box-shadow: 0 12px 32px -16px rgba(0,0,0,0.5);
  }
  .lp-chip-lift {
    transition:
      border-color 180ms var(--kova-ease-entrance),
      transform 180ms var(--kova-ease-entrance),
      background 180ms var(--kova-ease-entrance);
  }
  .lp-chip-lift:hover {
    border-color: var(--hairline-strong);
    transform: translateY(-1px);
    background: var(--surface-2);
  }

  .lp-cta-band {
    display: flex;
    flex-direction: column;
    gap: 30px;
    align-items: center;
    padding: 56px 40px;
    border-radius: 18px;
    border: 0.5px solid var(--hairline-strong);
    background: linear-gradient(180deg, var(--accent-soft), rgba(123,167,255,0.03));
  }
  .lp-cta-steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 26px;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .lp-root.lp-motion-ready [data-lp-reveal="true"] {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
    filter: blur(3px);
    transition:
      opacity 640ms var(--kova-ease-entrance),
      transform 640ms var(--kova-ease-entrance),
      filter 640ms var(--kova-ease-entrance);
    transition-delay: var(--lp-reveal-delay, 0ms);
    will-change: opacity, transform, filter;
  }
  .lp-root.lp-motion-ready [data-lp-reveal="true"][data-lp-visible="true"] {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
    filter: blur(0);
  }

  .lp-hero-section {
    padding: 74px 32px 60px;
  }
  .lp-hero-shell {
    width: 100%;
  }
  .lp-benefit-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 28px;
  }
  .lp-benefit-card {
    min-height: 96px;
    padding: 16px;
    border: 0.5px solid var(--hairline-color);
    border-radius: 12px;
    background: rgba(255,255,255,0.035);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lp-benefit-card strong {
    color: var(--page-fg);
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  .lp-benefit-card span {
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .lp-cta-fill {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    transition:
      color 220ms var(--kova-ease-entrance),
      border-color 220ms var(--kova-ease-entrance),
      transform 180ms var(--kova-ease-entrance),
      box-shadow 220ms var(--kova-ease-entrance);
  }
  .lp-cta-fill::before {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 0;
    z-index: 0;
    width: 150%;
    height: 0;
    border-radius: 50% 50% 0 0;
    background: var(--accent);
    transform: translate(-50%, 55%);
    transition: height 320ms var(--kova-ease-entrance);
  }
  .lp-cta-fill > * {
    position: relative;
    z-index: 1;
  }
  .lp-cta-fill:hover {
    color: #fff !important;
    border-color: transparent !important;
    transform: translateY(-1px);
    box-shadow: 0 14px 34px -22px rgba(79,126,247,0.9);
  }
  .lp-cta-fill:hover::before { height: 320%; }
  .lp-cta-fill:active { transform: translateY(0) scale(0.98); }

  .lp-product-tile:hover {
    border-color: var(--accent) !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px -6px rgba(15,17,23,0.18);
  }
  .lp-product-tile[data-active="1"] {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 1px var(--accent) inset;
  }
  .lp-product-tile:active { transform: scale(0.97); }
  .lp-product-tile .lp-cart-count {
    animation: lp-cart-pop 220ms var(--kova-ease-spring);
  }

  @media (prefers-reduced-motion: reduce) {
    .lp-live-dot { animation: none !important; }
    .lp-root.lp-motion-ready [data-lp-reveal="true"] {
      opacity: 1 !important;
      transform: none !important;
      filter: none !important;
    }
    .lp-root *, .lp-root *::before, .lp-root *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

export const RESPONSIVE_STYLES = `
  .lp-root {
    width: 100%;
    min-width: 100%;
    max-width: 100%;
    overflow-x: clip;
    background: var(--page-bg);
  }
  .lp-root > section { width: 100%; }
  .lp-root *, .lp-root *::before, .lp-root *::after {
    box-sizing: border-box;
  }
  .lp-pos-preview {
    max-width: 100%;
  }
  @media (max-width: 900px) {
    .lp-section { padding: 72px 24px !important; }
    .lp-section-compact { padding: 60px 24px !important; }
    .lp-section-inner { max-width: 100% !important; }
    .lp-hero-grid {
      grid-template-columns: 1fr !important;
    }
    .lp-3cols { grid-template-columns: 1fr !important; }
    .lp-benefit-strip { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 28px !important; }
    .lp-bento { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-own-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-own-bottom { grid-template-columns: 1fr !important; }
    .lp-footer-grid { grid-template-columns: 1fr 1fr !important; }
    .lp-hero-section { min-height: auto !important; padding: 44px 24px 56px !important; }
    .lp-hero-grid { gap: 32px !important; margin-top: 16px !important; }
    .lp-hero-title {
      font-size: 38px !important;
      letter-spacing: 0 !important;
      line-height: 1 !important;
    }
    .lp-hero-copy { font-size: 17px !important; max-width: 100% !important; }
    .lp-hero-visual { max-width: 100% !important; min-height: 320px !important; overflow: hidden !important; }
    .lp-hero-visual > * { max-width: min(100%, 360px) !important; }
    .lp-pos-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
    .lp-cash-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-rep-bottom { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 640px) {
    .lp-section { padding: 58px 20px !important; }
    .lp-section-compact { padding: 52px 20px !important; }
    .lp-section-title { font-size: 32px !important; line-height: 1.06 !important; }
    .lp-section-copy { font-size: 15px !important; }
    .lp-nav-shell {
      padding: 12px 16px !important;
      gap: 12px !important;
    }
    .lp-desktop-nav {
      display: none !important;
    }
    .lp-nav-actions {
      gap: 6px !important;
      min-width: 0 !important;
    }
    .lp-nav-primary {
      padding: 9px 12px !important;
      white-space: nowrap !important;
    }
    .lp-hero-section { padding: 28px 20px 44px !important; }
    .lp-hero-title { font-size: 31px !important; }
    .lp-hero-copy { font-size: 15px !important; margin-top: 14px !important; }
    .lp-hero-visual { order: -1; min-height: 190px !important; }
    .lp-hero-visual > * { max-width: min(100%, 220px) !important; }
    .lp-hero-logo { width: 220px !important; }
    .lp-hero-logo > div { padding: 0 !important; gap: 0 !important; }
    .lp-hero-logo > div > div:first-child {
      width: 150px !important;
      min-width: 150px !important;
      max-width: 150px !important;
    }
    /* Wordmark del IntroAnimation (div desde PR #43, antes h1; su clase es
       CSS-module así que se apunta por estructura: composition > textBlock > wordmark). */
    .lp-hero-logo > div > div:last-child > div { font-size: 42px !important; }
    .lp-hero-logo p { font-size: 12px !important; }
    .lp-benefit-strip { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 8px !important; margin-top: 22px !important; }
    .lp-benefit-card { min-height: 118px !important; padding: 13px !important; }
    .lp-benefit-card strong { font-size: 13px !important; }
    .lp-benefit-card span { font-size: 12px !important; }
    .lp-hero-actions {
      display: grid !important;
      grid-template-columns: 1fr !important;
    }
    .lp-hero-actions > * {
      width: 100% !important;
      justify-content: center !important;
      text-align: center !important;
    }
    .lp-pos-preview { grid-template-columns: 1fr !important; }
    .lp-pos-main {
      border-right: none !important;
      border-bottom: 0.5px solid var(--hairline-color) !important;
    }
    .lp-pos-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
    .lp-pos-lines { max-height: 132px !important; }
    .lp-pos-methods { display: none !important; }
    /* Historia en mobile: cada preview se recorta a su núcleo (brief §6). */
    .lp-story-card .lp-pos-main { display: none !important; }
    .lp-story-card .lp-pos-lines {
      max-height: none !important;
      overflow: visible !important;
      flex: 0 0 auto !important;
    }
    .lp-story-card .lp-inv-card[data-secondary="1"] { display: none !important; }
    .lp-story-card .lp-inv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-story-card .lp-cash-tile[data-secondary="1"] { display: none !important; }
    .lp-story-card .lp-rep-kpi[data-secondary="1"] { display: none !important; }
    .lp-story-card .lp-rep-kpis { grid-template-columns: 1fr !important; }
    .lp-story-card .lp-rep-secondary { display: none !important; }
    .lp-story-card .lp-rep-bar[data-extra="1"] { display: none !important; }
    .lp-footer-grid { grid-template-columns: 1fr !important; }
    .lp-bento { grid-template-columns: 1fr !important; }
    .lp-bento-cell[data-large="1"] { grid-column: auto !important; }
    .lp-own-kpis { grid-template-columns: 1fr 1fr !important; }
    .lp-own-kpi[data-secondary="1"] { display: none !important; }
    .lp-own-secondary { display: none !important; }
    .lp-cta-band { padding: 40px 22px !important; }
    .lp-cta-steps { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  }
  @media (max-width: 360px) {
    .lp-nav-primary { padding: 9px 10px !important; font-size: 12px !important; }
    .lp-hero-title { font-size: 30px !important; }
    .lp-hero-copy { font-size: 16px !important; }
  }
`;

/**
 * Injects the landing CSS (lp-* classes + keyframes + responsive rules) as a
 * single `<style>` tag. Render this once inside any `.lp-root` surface so the
 * reused product previews pick up their styling.
 */
export function LandingStyleTag() {
  return <style dangerouslySetInnerHTML={{ __html: LANDING_STYLES + RESPONSIVE_STYLES }} />;
}
