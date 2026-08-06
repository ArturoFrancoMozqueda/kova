// Shared landing theme — single source of truth for the `.lp-root` page-level
// CSS variables (themeVars) and the landing CSS (lp-* classes + keyframes).
//
// Extracted verbatim from routes/Home.tsx so that any surface reusing the
// landing product previews (e.g. the marketing showcase at
// landing/showcase/KovaShowcase.tsx) renders with the exact same theming and
// micro-interaction styles. Home.tsx and the showcase both import from here —
// keeping styling in one place instead of duplicating ~430 lines of CSS.
import type { CSSProperties } from "react";
// Display face de la landing (solo titulares). Importada aquí — no en main.tsx —
// para que el CSS/woff2 caigan en el chunk lazy de Home y las rutas de la app
// no paguen la fuente. Cubre también /kova-showcase-video vía LandingStyleTag.
import "@fontsource-variable/bricolage-grotesque/wght.css";

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
      "--cta-blue": "var(--kova-blue)",
      "--ink-on-fg": "var(--kova-ink)",
      "--card-bg": "#1A1D28",
      "--chip-bg": "rgba(255,255,255,0.06)",
      "--invert-ink-bg": "#FBFBFD",
      "--invert-ink-fg": "var(--kova-ink)",
      // Ticket térmico — material (papel), no tema: mismos valores en claro/oscuro.
      "--ticket-paper": "#F3ECDD",
      "--ticket-paper-deep": "#E8DECB",
      "--ticket-ink": "#191713",
      "--ticket-muted": "rgba(25,23,19,0.55)",
      "--ticket-rule": "rgba(25,23,19,0.28)",
      "--ticket-ok": "#0E8A62",
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
    "--cta-blue": "var(--kova-blue)",
    "--ink-on-fg": "var(--kova-on-ink)",
    "--card-bg": "#FFFFFF",
    "--chip-bg": "rgba(15,17,23,0.05)",
    "--invert-ink-bg": "var(--kova-ink)",
    "--invert-ink-fg": "var(--kova-on-ink)",
    "--ticket-paper": "#F3ECDD",
    "--ticket-paper-deep": "#E8DECB",
    "--ticket-ink": "#191713",
    "--ticket-muted": "rgba(25,23,19,0.55)",
    "--ticket-rule": "rgba(25,23,19,0.28)",
    "--ticket-ok": "#0E8A62",
  } as CSSProperties;
}

/* ─── Landing-scoped CSS ─────────────────────────────────────────────────── */
export const LANDING_STYLES = `
  .lp-root {
    font-family: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
    --lp-font-display: 'Bricolage Grotesque Variable', 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
    --lp-blue-bg: var(--kova-ink);
    --lp-blue-display: var(--kova-on-ink);
    --lp-blue-fg: var(--kova-on-ink);
    --lp-blue-muted: color-mix(in srgb, var(--kova-on-ink) 66%, var(--kova-ink));
    --lp-blue-tertiary: var(--kova-blue-light);
    --lp-blue-border: var(--kova-ink-border);
    --lp-blue-border-strong: color-mix(in srgb, var(--kova-on-ink) 18%, var(--kova-ink));
    background: var(--page-bg);
    color: var(--page-fg);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    transition: background 280ms var(--kova-ease-entrance), color 280ms var(--kova-ease-entrance);
  }
  .lp-root .tabular { font-variant-numeric: tabular-nums; }
  .lp-root ::selection { background: var(--accent); color: #fff; }
  .lp-skip-link {
    position: fixed;
    z-index: 1000;
    top: 10px;
    left: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--ticket-paper);
    color: var(--ticket-ink);
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    transform: translateY(-150%);
    transition: transform 160ms var(--kova-ease-entrance);
  }
  .lp-skip-link:focus { transform: translateY(0); }
  .lp-root :target { scroll-margin-top: 84px; }

  .lp-section {
    padding: 72px 32px;
    border-top: 0.5px solid var(--hairline-color);
  }
  .lp-section-compact { padding: 72px 32px; }
  /* Tramo medio comprimido (funnel: la atrición vive entre el film y el
     precio) — aplica a #una-venta, #panel-dueno y #problema sin tocar el
     padding global de .lp-section. */
  .lp-section-tight { padding: 52px 32px; }
  .lp-section-inner {
    max-width: 1180px;
    margin: 0 auto;
  }
  .lp-section-label {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 22px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  /* Guión de acento del kicker: una sola regla que da ritmo a toda la página. */
  .lp-section-label::before {
    content: "";
    width: 22px;
    height: 1px;
    background: var(--accent);
    flex-shrink: 0;
  }
  .lp-section-title {
    font-family: var(--lp-font-display);
    font-size: clamp(32px, 4vw, 54px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.04;
    margin: 0;
    color: var(--page-fg);
  }
  /* Crescendo tipográfico: el valle utilitario (bento/comercios/diferencia/
     faq) baja la voz y #precio la sube — la página construye hacia la oferta. */
  .lp-section-title[data-scale="quiet"] { font-size: clamp(26px, 3vw, 40px); }
  .lp-section-title[data-scale="grand"] { font-size: clamp(38px, 5.2vw, 72px); letter-spacing: -0.02em; }
  .lp-section[data-density="tight"] { padding: 56px 32px; }
  .lp-section[data-density="grand"] { padding: 104px 32px 96px; }
  .lp-hero-title { font-family: var(--lp-font-display); }
  .lp-section-copy {
    margin: 16px 0 0;
    max-width: 620px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  /* Estado real dentro de previews heredados: marca lineal y estática, nunca
     un punto verde pulsante ni un adorno de marketing. */
  .lp-live-dot {
    width: 10px;
    height: 2px;
    display: inline-block;
    flex-shrink: 0;
    border-radius: 0;
    background: var(--accent);
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
  /* Hero visual = marco de producto (HeroProductFrame): una ventana de navegador
     que enmarca el POS real en tema claro. El frame nace visible (SSR/no-JS) y
     solo con .lp-motion-ready corre un one-shot de entrada — nunca queda oculto
     sin JS. */
  .lp-hero-visual {
    position: relative;
    min-width: 0;
    width: 100%;
    /* isolate: el glow (::before, z-index -1) queda detrás del frame pero
       nunca detrás del fondo del stage. */
    isolation: isolate;
  }
  /* Una sola luz de marca, contenida detrás de la evidencia del producto. */
  .lp-hero-visual::before {
    content: "";
    position: absolute;
    inset: -10% -16% -20%;
    z-index: -1;
    background: radial-gradient(52% 58% at 66% 36%, rgba(79, 126, 247, 0.14), transparent 72%);
    pointer-events: none;
  }
  /* En modo film, el glow se apaga junto con la salida del hero: solo LEE la
     var del engine (--pf-hero-exit), composite-only. */
  [data-pf-live="true"] .lp-hero-visual::before {
    opacity: calc(1 - var(--pf-hero-exit, 0));
  }
  .lp-hero-frame {
    position: relative;
    width: 100%;
    border-radius: 16px;
    border: 0.5px solid var(--hairline-strong);
    background: #FFFFFF;
    overflow: hidden;
    box-shadow:
      0 38px 80px -50px rgba(15,17,23,0.42),
      0 8px 24px -18px rgba(15,17,23,0.22);
  }
  .lp-root.lp-motion-ready .lp-hero-frame {
    animation: lp-hero-frame-in 700ms var(--kova-ease-entrance) both;
  }
  @keyframes lp-hero-frame-in {
    from { opacity: 0; transform: translate3d(0, 28px, 0) scale(0.985); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  /* Compatibilidad con la ruta interna de captura cinematográfica. El hero
     público no monta chrome ni leyendas sobre la evidencia del producto. */
  .lp-hero-frame-bar {
    min-height: 44px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 0.5px solid var(--hairline-color);
    background: #FFFFFF;
  }
  .lp-hero-frame-url {
    flex: 1;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 500;
    text-align: center;
  }
  .lp-hero-capture-label {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 2;
    padding: 6px 10px;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 6px;
    background: rgba(15,17,23,0.88);
    color: #F0F4FF;
    font-size: 10px;
    font-weight: 650;
  }
  .lp-hero-frame-screen {
    background: #F8FAFB;
    aspect-ratio: 16 / 10;
    overflow: hidden;
  }
  .lp-hero-product-capture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
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

  /* ── SaleStory ("Una venta lo mueve todo") ────────────────────────────────
     Filas alternadas copy | preview. La copy revela escalonada; el preview usa
     la variante "frame". Una spine vertical sutil (≥900px) refuerza la idea de
     que una sola venta fluye a través de los cuatro pasos. */
  .lp-story-rows {
    position: relative;
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .lp-sale-row {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.05fr);
    gap: clamp(28px, 5vw, 64px);
    align-items: center;
  }
  .lp-sale-row[data-reverse="1"] .lp-sale-copy { order: 2; }
  .lp-sale-row[data-reverse="1"] .lp-sale-visual { order: 1; }
  .lp-sale-step {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lp-sale-step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
    flex-shrink: 0;
  }
  .lp-sale-title {
    font-family: var(--lp-font-display);
    font-size: clamp(22px, 2.6vw, 30px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--page-fg);
    margin: 16px 0 0;
  }
  .lp-sale-body {
    margin: 12px 0 0;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-muted);
    max-width: 440px;
  }
  .lp-sale-visual {
    position: relative;
    min-width: 0;
  }
  .lp-sale-frame {
    border-radius: 14px;
    border: 0.5px solid var(--hairline-color);
    background: var(--page-bg);
    padding: 14px;
    box-shadow: 0 26px 64px -36px rgba(0,0,0,0.62);
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

  /* Viñeta tintada superior para secciones oscuras clave (pintura estática). */
  .lp-tint-top {
    background-image: radial-gradient(120% 60% at 50% 0%, rgba(123, 167, 255, 0.05), transparent 60%);
  }

  /* Carta Kova (#diferencia): border-glow que respira al hover (solo opacity,
     composite-only; el clamp global de reduced-motion lo cubre). */
  .lp-kova-card { position: relative; }
  .lp-kova-card::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow:
      0 0 0 4px var(--accent-soft),
      0 0 44px -8px rgba(79, 126, 247, 0.45),
      0 28px 70px -34px rgba(0, 0, 0, 0.7);
    opacity: 0.55;
    transition: opacity 220ms var(--kova-ease-entrance);
    pointer-events: none;
  }
  .lp-kova-card:hover::after { opacity: 1; }

  /* Divisor perforado (mordidas de recibo) — pinta DENTRO de su caja de 12px,
     seguro con content-visibility. La página termina como termina el ticket. */
  .lp-perf-divider {
    height: 12px;
    background-image: radial-gradient(circle at 12px -5px, var(--surface-2) 9px, transparent 9.6px);
    background-size: 24px 12px;
    background-repeat: repeat-x;
  }

  /* Focus visible consistente en toda la landing. */
  .lp-root :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* "¿Es para mí?" (#comercios): 6 giros en 3 columnas. */
  .lp-builtfor-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  /* Testimonios (#clientes): 1-3 tarjetas, columnas según cuántas haya. */
  .lp-testimonials-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
    max-width: 1060px;
  }

  /* Barra CTA fija de móvil (StickyCta): solo se monta cuando aplica, así que
     estas reglas nunca pintan en desktop ni en el prerender. */
  .lp-sticky-cta {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 55;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 0.5px solid var(--hairline-strong);
    animation: lp-sticky-in 240ms var(--kova-ease-entrance) both;
  }
  @keyframes lp-sticky-in {
    from { transform: translateY(100%); }
    to { transform: none; }
  }
  /* Con la barra montada, el FAB de WhatsApp sube para no encimarse
     (StickyCta va antes del FAB en el DOM — selector de hermanos). */
  .lp-sticky-cta ~ .lp-wa-fab {
    bottom: calc(78px + env(safe-area-inset-bottom, 0px));
  }

  /* Botón flotante de WhatsApp: oculto hasta pasar el hero-film (data-visible)
     y apagado por completo si no hay número configurado (lib/whatsapp.ts). */
  .lp-wa-fab {
    position: fixed;
    right: 20px;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    width: 52px;
    height: 52px;
    border-radius: 999px;
    background: #25d366;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.55);
    opacity: 0;
    transform: translateY(12px);
    pointer-events: none;
    transition:
      opacity 220ms var(--kova-ease-entrance),
      transform 220ms var(--kova-ease-entrance);
  }
  .lp-wa-fab[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  /* ── FAQ accordion ────────────────────────────────────────────────────────
     Respuestas siempre montadas; abren con grid-template-rows 0fr→1fr. La
     visibility gestiona foco/lectura (cerrada = fuera del orden de tabulación).
     El bloque de reduced-motion global colapsa la transición a instantánea. */
  .lp-faq-panel {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 280ms var(--kova-ease-entrance);
  }
  .lp-faq-panel[data-open="true"] { grid-template-rows: 1fr; }
  .lp-faq-panel-inner {
    min-height: 0;
    overflow: hidden;
    visibility: hidden;
    transition: visibility 0s linear 280ms;
  }
  .lp-faq-panel[data-open="true"] .lp-faq-panel-inner {
    visibility: visible;
    transition: visibility 0s;
  }
  .lp-faq-answer {
    padding: 0 4px 20px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-muted);
    max-width: 760px;
  }

  .lp-cta-band {
    --page-fg: #F4F6FB;
    --text-muted: #A8B0C0;
    --accent: #8EAFFF;
    --accent-soft: rgba(142,175,255,0.14);
    display: flex;
    flex-direction: column;
    gap: 30px;
    align-items: center;
    padding: 56px 40px;
    border-radius: 18px;
    border: 0.5px solid rgba(255,255,255,0.1);
    background: #11141B;
    box-shadow: 0 34px 74px -50px rgba(15,17,23,0.55);
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

  /* Variantes de reveal (data-lp-reveal-variant). "rise" = default (18px, blur).
     "rise-lg" para titulares/superficies grandes; "frame" para previews de
     producto (translate + micro-escala, sin blur — más barato en superficies
     grandes compuestas). Todas heredan el gate .lp-motion-ready + easing. */
  .lp-root.lp-motion-ready [data-lp-reveal="true"][data-lp-reveal-variant="rise-lg"] {
    transform: translate3d(0, 28px, 0);
    transition-duration: 700ms;
  }
  .lp-root.lp-motion-ready [data-lp-reveal="true"][data-lp-reveal-variant="frame"] {
    transform: translate3d(0, 20px, 0) scale(0.985);
    filter: none;
    transition:
      opacity 640ms var(--kova-ease-entrance),
      transform 640ms var(--kova-ease-entrance);
    transition-delay: var(--lp-reveal-delay, 0ms);
  }
  .lp-root.lp-motion-ready [data-lp-reveal="true"][data-lp-reveal-variant="frame"][data-lp-visible="true"] {
    transform: translate3d(0, 0, 0) scale(1);
  }

  /* ── Navbar ─────────────────────────────────────────────────────────────
     Estado base = tope de página (SSR/no-JS). data-scrolled lo agrega un efecto
     tras hidratar: fondo más sólido, sombra suave y padding más compacto. */
  .lp-nav {
    position: sticky;
    top: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--page-bg) 85%, transparent);
    backdrop-filter: saturate(140%) blur(12px);
    -webkit-backdrop-filter: saturate(140%) blur(12px);
    border-bottom: 0.5px solid var(--hairline-color);
    transition:
      background 220ms var(--kova-ease-entrance),
      border-color 220ms var(--kova-ease-entrance),
      box-shadow 220ms var(--kova-ease-entrance);
  }
  .lp-nav[data-scrolled="true"] {
    background: color-mix(in srgb, var(--page-bg) 94%, transparent);
    border-bottom-color: transparent;
    /* Hairline con desvanecido centrado: más fino que un borde plano. */
    border-image: linear-gradient(90deg, transparent, var(--hairline-strong) 18%, var(--hairline-strong) 82%, transparent) 1;
    box-shadow: 0 10px 30px -22px rgba(0,0,0,0.75);
  }
  .lp-nav-shell {
    max-width: 1280px;
    margin: 0 auto;
    padding: 14px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    transition: padding 220ms var(--kova-ease-entrance);
  }
  .lp-nav[data-scrolled="true"] .lp-nav-shell {
    padding-top: 10px;
    padding-bottom: 10px;
  }
  .lp-nav-link { transition: color 150ms var(--kova-ease-entrance); }
  .lp-nav-link:hover { color: var(--page-fg) !important; }
  .lp-nav-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 0.5px solid var(--hairline-color);
    background: var(--surface);
    color: var(--page-fg);
    cursor: pointer;
    padding: 0;
    transition:
      border-color 150ms var(--kova-ease-entrance),
      background 150ms var(--kova-ease-entrance);
  }
  .lp-nav-toggle:hover { border-color: var(--hairline-strong); background: var(--surface-2); }
  .lp-nav-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* Disclosure móvil: oculto en desktop (los anchors del desktop-nav ya sirven).
     En móvil colapsa con grid-template-rows 0fr→1fr; visibility gestiona el
     orden de tabulación (los links cerrados no son alcanzables por teclado). */
  .lp-mobile-menu { display: none; }

  .lp-hero-section {
    padding: 76px 32px 82px;
    background: var(--lp-blue-bg);
    border-bottom: 1px solid var(--lp-blue-border);
  }
  .lp-hero-shell {
    width: 100%;
  }
  .lp-hero-eyebrow {
    display: block;
    max-width: 540px;
    margin-bottom: 20px;
    color: var(--lp-blue-tertiary);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.12em;
    line-height: 1.5;
    text-transform: uppercase;
  }
  .lp-hero-pricing {
    margin: 18px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--lp-blue-muted);
    font-size: 13px;
  }
  .lp-hero-pricing strong {
    color: var(--lp-blue-fg);
    font-weight: 700;
  }
  .lp-hero-section .lp-hero-title { color: var(--lp-blue-display) !important; }
  .lp-hero-section .lp-hero-copy { color: var(--lp-blue-muted) !important; }
  .lp-hero-section .lp-hero-actions .lp-cta-fill:first-child {
    background: var(--kova-on-ink) !important;
    color: var(--kova-ink) !important;
  }
  .lp-hero-section .lp-hero-actions .lp-cta-fill:last-child {
    border-color: var(--lp-blue-border-strong) !important;
    background: var(--kova-ink-border) !important;
    color: var(--kova-on-ink) !important;
  }
  .lp-hero-section .lp-hero-visual::before {
    background: radial-gradient(52% 58% at 66% 36%, var(--lp-blue-border), transparent 72%);
  }
  .lp-human-note {
    width: fit-content;
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid var(--hairline-color);
    color: var(--text-muted);
    font-size: 11px;
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

  /* ── Ticket térmico (firma de la landing) ─────────────────────────────────
     Papel = material, no tema: vive solo en superficies lp-tkt sobre el ink.
     Perforado con radial-gradient (no mask-image) para soporte amplio; la
     sombra usa drop-shadow para seguir el contorno perforado. */
  .lp-tkt {
    position: relative;
    filter: drop-shadow(0 18px 30px rgba(0,0,0,0.38)) drop-shadow(0 3px 8px rgba(0,0,0,0.22));
    text-align: left;
  }
  .lp-tkt-edge {
    height: 10px;
    background-image: radial-gradient(circle at 9px -3px, transparent 7px, var(--ticket-paper) 7.6px);
    background-size: 18px 10px;
    background-repeat: repeat-x;
  }
  .lp-tkt-edge[data-side="bottom"] {
    background-image: radial-gradient(circle at 9px 13px, transparent 7px, var(--ticket-paper-deep) 7.6px);
  }
  .lp-tkt-body {
    background: linear-gradient(180deg, var(--ticket-paper), var(--ticket-paper-deep));
    color: var(--ticket-ink);
    padding: 24px 26px;
  }
  .lp-tkt-rule {
    border: none;
    border-top: 2px dotted var(--ticket-rule);
    margin: 0;
  }
  .lp-tkt-leader {
    flex: 1;
    min-width: 18px;
    border-bottom: 2px dotted var(--ticket-rule);
    transform: translateY(-4px);
    margin: 0 8px;
  }
  .lp-tkt-money {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .lp-tkt-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ticket-muted);
  }
  /* Pestaña desprendible: pieza aparte — el hueco entre perforados = el corte. */
  .lp-tkt-tab { margin-top: 7px; }
  .lp-tkt-tab .lp-tkt-body { padding: 18px 20px 14px; }

  /* Halo ambiental detrás del recibo de precio: más presencia en desktop sin
     tocar montos ni el material del papel. Decorativo (pointer-events: none). */
  .lp-ticket-print { position: relative; }
  .lp-ticket-print::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 46%;
    width: 170%;
    height: 130%;
    transform: translate(-50%, -50%);
    background: radial-gradient(closest-side, var(--accent-soft), transparent 72%);
    opacity: 0.9;
    z-index: 0;
    pointer-events: none;
  }
  .lp-ticket-print > * { position: relative; z-index: 1; }

  /* Impresión del recibo: las líneas aparecen en orden al entrar en viewport.
     Gateado en data-lp-reveal (solo se agrega post-hidratación) + lp-motion-ready,
     así el HTML prerenderizado y no-JS muestran el recibo completo. */
  .lp-root.lp-motion-ready .lp-ticket-print[data-lp-reveal="true"] {
    opacity: 1;
    transform: none;
    filter: none;
    transition: none;
  }
  .lp-root.lp-motion-ready .lp-ticket-print[data-lp-reveal="true"] .lp-tkt-line { opacity: 0; }
  .lp-root.lp-motion-ready .lp-ticket-print[data-lp-visible="true"] .lp-tkt-line {
    animation: lp-tkt-print 240ms var(--kova-ease-entrance) both;
    animation-delay: calc(var(--tkt-i, 0) * 90ms);
  }
  .lp-root.lp-motion-ready .lp-ticket-print[data-lp-reveal="true"] .lp-tkt-tab { opacity: 0; }
  .lp-root.lp-motion-ready .lp-ticket-print[data-lp-visible="true"] .lp-tkt-tab {
    animation: lp-tkt-tab-in 420ms var(--kova-ease-spring) both;
    animation-delay: calc(var(--tkt-i, 0) * 90ms);
  }
  @keyframes lp-tkt-print {
    from { opacity: 0; transform: translateY(-8px); clip-path: inset(0 0 85% 0); }
    to   { opacity: 1; transform: translateY(0);    clip-path: inset(0 0 -8px 0); }
  }
  @keyframes lp-tkt-tab-in {
    from { opacity: 0; transform: translateY(-10px) rotate(-1deg); }
    to   { opacity: 1; transform: translateY(0) rotate(0deg); }
  }

  /* Recortes del problema: libreta/Excel/WhatsApp como papeles sueltos. */
  .lp-scraps {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-content: flex-start;
  }
  .lp-scrap {
    position: relative;
    padding: 13px 18px 16px;
    font-size: 14px;
    font-weight: 600;
    color: rgba(240,244,255,0.72);
    background: var(--surface);
    border: 0.5px solid var(--hairline-color);
    border-radius: 2px;
    transform: rotate(var(--scrap-rot, 0deg));
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - 6px), 88% 100%, 74% calc(100% - 5px), 58% 100%, 45% calc(100% - 7px), 28% 100%, 13% calc(100% - 4px), 0 100%);
  }
  .lp-scrap[data-kind="ruled"] {
    background-image: repeating-linear-gradient(180deg, transparent 0 10px, rgba(123,167,255,0.12) 10px 11px);
  }
  .lp-scrap[data-kind="grid"] {
    background-image:
      repeating-linear-gradient(180deg, transparent 0 11px, rgba(123,167,255,0.10) 11px 12px),
      repeating-linear-gradient(90deg, transparent 0 14px, rgba(123,167,255,0.10) 14px 15px);
  }
  .lp-scrap[data-kind="bubble"] {
    clip-path: none;
    border-radius: 12px 12px 12px 3px;
  }
  .lp-scrap[data-kind="dotted"] {
    background-image: repeating-linear-gradient(180deg, transparent 0 9px, rgba(240,244,255,0.10) 9px 10px);
  }

  @media (prefers-reduced-motion: reduce) {
    .lp-live-dot { animation: none !important; }
    .lp-root.lp-motion-ready [data-lp-reveal="true"] {
      opacity: 1 !important;
      transform: none !important;
      filter: none !important;
    }
    .lp-root .lp-tkt-line, .lp-root .lp-tkt-tab {
      opacity: 1 !important;
      animation: none !important;
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
  /* Keep the full prerendered marketing story available to crawlers and
     assistive technology, while letting the browser skip layout/paint work
     for sections that are still far below the first viewport. */
  .lp-root main > section:not(.lp-hero-section),
  .lp-root > footer {
    content-visibility: auto;
    contain-intrinsic-size: auto 760px;
  }
  .lp-root *, .lp-root *::before, .lp-root *::after {
    box-sizing: border-box;
  }
  .lp-pos-preview {
    max-width: 100%;
  }
  .lp-pos-container {
    container-type: inline-size;
    width: 100%;
  }
  .lp-pos-preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .lp-pos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 8px;
  }
  @container (min-width: 560px) and (max-width: 879px) {
    .lp-pos-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container (min-width: 880px) {
    .lp-pos-preview { grid-template-columns: minmax(0, 1fr) minmax(320px, 38%); }
  }
  @media (max-width: 900px) {
    .lp-section { padding: 64px 24px !important; }
    .lp-section-compact { padding: 60px 24px !important; }
    .lp-section-tight { padding: 48px 24px !important; }
    .lp-section[data-density="tight"] { padding: 52px 24px !important; }
    .lp-section[data-density="grand"] { padding: 84px 24px 76px !important; }
    .lp-section-inner { max-width: 100% !important; }
    .lp-hero-grid {
      grid-template-columns: 1fr !important;
    }
    .lp-3cols { grid-template-columns: 1fr !important; }
    .lp-builtfor-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-benefit-strip { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 28px !important; }
    .lp-bento { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-own-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-own-bottom { grid-template-columns: 1fr !important; }
    .lp-footer-grid { grid-template-columns: 1fr 1fr !important; }
    .lp-hero-section { min-height: auto !important; padding: 38px 24px 48px !important; }
    .lp-hero-grid { gap: 32px !important; margin-top: 16px !important; }
    .lp-hero-title {
      font-size: 38px !important;
      letter-spacing: 0 !important;
      line-height: 1 !important;
    }
    .lp-hero-copy { font-size: 17px !important; max-width: 100% !important; }
    .lp-hero-visual { max-width: 560px !important; margin: 0 auto !important; width: 100% !important; }
    .lp-cash-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-rep-bottom { grid-template-columns: 1fr !important; }
    .lp-problem-grid { grid-template-columns: 1fr !important; }
    .lp-problem-ticket { max-width: 340px !important; }
    /* SaleStory: copy siempre antes del preview (orden de lectura natural). */
    .lp-sale-row {
      grid-template-columns: 1fr !important;
      gap: 22px !important;
    }
    .lp-sale-row .lp-sale-copy { order: 1 !important; }
    .lp-sale-row .lp-sale-visual { order: 2 !important; }
    .lp-sale-body { max-width: 100% !important; }
  }
  @media (max-width: 640px) {
    /* Prevent mobile font downloads and late swaps from redefining the LCP. */
    .lp-root,
    .lp-root * {
      font-family: ui-sans-serif, system-ui, sans-serif !important;
    }
    .lp-section { padding: 52px 20px !important; }
    .lp-section-compact { padding: 48px 20px !important; }
    .lp-section-tight { padding: 40px 20px !important; }
    .lp-section[data-density="tight"] { padding: 44px 20px !important; }
    .lp-section[data-density="grand"] { padding: 68px 20px 60px !important; }
    /* Compresión móvil: los previews casi full-bleed son el mayor costo de
       altura del tramo medio; un cap de ancho reduce su altura intrínseca. */
    .lp-sale-visual { max-width: 480px !important; margin-left: auto !important; margin-right: auto !important; width: 100%; }
    /* El ticket del corte duplica en móvil al ticket térmico de #precio; el
       argumento del descuadre lo cargan los recortes + el punch. */
    .lp-problem-ticket-wrap { display: none !important; }
    .lp-section-title { font-size: 32px !important; line-height: 1.06 !important; }
    .lp-section-title[data-scale="quiet"] { font-size: 27px !important; }
    .lp-section-title[data-scale="grand"] { font-size: 37px !important; }
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
    .lp-nav-toggle { display: inline-flex !important; }
    .lp-mobile-menu {
      display: grid !important;
      grid-template-rows: 0fr;
      transition: grid-template-rows 260ms var(--kova-ease-entrance);
      background: color-mix(in srgb, var(--page-bg) 96%, transparent);
      border-top: 0.5px solid transparent;
    }
    .lp-mobile-menu[data-open="true"] {
      grid-template-rows: 1fr;
      border-top-color: var(--hairline-color);
    }
    .lp-mobile-menu-inner {
      min-height: 0;
      overflow: hidden;
      visibility: hidden;
      transition: visibility 0s linear 260ms;
      display: flex;
      flex-direction: column;
      padding: 0 20px;
    }
    .lp-mobile-menu[data-open="true"] .lp-mobile-menu-inner {
      visibility: visible;
      transition: visibility 0s;
    }
    .lp-mobile-link {
      padding: 14px 4px;
      font-size: 15px;
      font-weight: 500;
      color: var(--page-fg);
      text-decoration: none;
      border-bottom: 0.5px solid var(--hairline-color);
    }
    .lp-mobile-menu-inner .lp-mobile-link:last-child { border-bottom: none; }
    .lp-hero-section { padding: 24px 20px 38px !important; }
    .lp-hero-title { font-size: 31px !important; }
    .lp-hero-copy {
      font-size: 15px !important;
      margin-top: 14px !important;
    }
    .lp-hero-content { order: 1; }
    /* El marco de producto va debajo de la copy y se recorta a su porción
       superior (catálogo) con una máscara de desvanecido: muestra la Kova real
       sin ocupar toda la pantalla. */
    .lp-hero-visual { order: 2; max-width: 100% !important; margin-top: 6px !important; }
    .lp-hero-frame-screen { max-height: 320px !important; }
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
    .lp-pos-grid { grid-template-columns: minmax(0, 1fr) !important; }
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
    .lp-builtfor-grid { grid-template-columns: 1fr !important; }
    .lp-own-kpis { grid-template-columns: 1fr 1fr !important; }
    .lp-own-kpi[data-secondary="1"] { display: none !important; }
    .lp-own-secondary { display: none !important; }
    .lp-cta-band { padding: 40px 22px !important; }
    .lp-cta-steps { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .lp-tkt-body { padding: 20px 18px !important; }
    .lp-tkt-total-num { font-size: 48px !important; }
    .lp-tkt-edge { background-size: 14px 8px !important; height: 8px !important; }
    .lp-tkt-edge[data-side="bottom"] {
      background-image: radial-gradient(circle at 7px 10px, transparent 5.5px, var(--ticket-paper-deep) 6px) !important;
    }
    .lp-tkt-edge:not([data-side="bottom"]) {
      background-image: radial-gradient(circle at 7px -2px, transparent 5.5px, var(--ticket-paper) 6px) !important;
    }
    .lp-scrap { padding: 11px 14px 13px !important; font-size: 13px !important; }
  }
  @media (max-width: 360px) {
    .lp-nav-primary { padding: 9px 10px !important; font-size: 12px !important; }
    .lp-hero-title { font-size: 30px !important; }
    .lp-hero-copy { font-size: 16px !important; }
  }
  @media (min-width: 900px) {
    /* Spine conectora: una sola venta fluye por los 4 pasos. Vive en el gutter
       central; los rows/cards tienen fondo y la tapan salvo en los espacios. */
    .lp-story-rows::before {
      content: "";
      position: absolute;
      top: 32px;
      bottom: 32px;
      left: 50%;
      width: 1px;
      transform: translateX(-0.5px);
      background: linear-gradient(180deg, transparent, var(--hairline-strong) 12%, var(--hairline-strong) 88%, transparent);
      z-index: 0;
      pointer-events: none;
    }
  }
  @media (min-width: 901px) {
    /* Fold premium: el producto domina la composición. Especificidad
       .lp-root para ganarle al .pf-hero-grid del style-tag del film (que se
       inyecta después); el FLIP del engine mide rects en runtime, así que un
       cambio de proporción es seguro. */
    .lp-root .pf-hero-grid {
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
      gap: 44px;
    }
  }
  @media (min-width: 1024px) {
    /* Overflow controlado: el marco del hero sangra hacia el borde derecho
       (seguro: .lp-root tiene overflow-x: clip). */
    .lp-hero-visual { margin-right: clamp(-88px, -4.5vw, -24px); }
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
