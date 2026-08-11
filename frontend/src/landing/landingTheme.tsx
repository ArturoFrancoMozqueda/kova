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
  /* The landing is prerendered, so paint the document canvas before React
     hydrates. The Home effect remains as a fallback and handles restoration
     during client-side navigation. */
  html:has(.lp-root),
  body:has(.lp-root) {
    background: #0F1117;
  }
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
  /* One continuous ink canvas. Product screenshots and operational cards keep
     their own surfaces, while navigation, narrative sections and footer no
     longer alternate between white and dark bands. */
  .lp-root main > section,
  .lp-root > footer {
    background: var(--page-bg);
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
  .lp-hero-frame {
    position: relative;
    width: 100%;
    margin: 0;
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
    aspect-ratio: 3 / 2;
  }
  .lp-hero-product-capture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
  }
  /* Microinteracciones de la historia: solo corren dentro de un contenedor
     con data-lp-anim="on" (entrada del estado), una vez, sin loops. */
  [data-lp-anim="on"] .lp-story-fade {
    opacity: 0;
    animation: lp-feed-in 280ms var(--kova-ease-entrance) forwards;
    animation-delay: var(--lp-fade-delay, 0ms);
  }


  /* Focus visible consistente en toda la landing. */
  .lp-root :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
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

  /* Layered hero entrance inspired by 21st's cinematic product reveals. It is
     a one-shot orientation cue: no ambient loop and no layout properties. */
  @keyframes lp-hero-copy-in {
    from { opacity: 0; transform: translate3d(0, 18px, 0); }
    to { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  .lp-root.lp-motion-ready .lp-hero-content > * {
    animation: lp-hero-copy-in 620ms var(--kova-ease-entrance) both;
  }
  .lp-root.lp-motion-ready .lp-hero-content > :nth-child(2) { animation-delay: 70ms; }
  .lp-root.lp-motion-ready .lp-hero-content > :nth-child(3) { animation-delay: 130ms; }
  .lp-root.lp-motion-ready .lp-hero-content > :nth-child(4) { animation-delay: 190ms; }
  .lp-root.lp-motion-ready .lp-hero-content > :nth-child(5) { animation-delay: 250ms; }

  /* ── Navbar ─────────────────────────────────────────────────────────────
     Estado base = tope de página (SSR/no-JS). data-scrolled lo agrega un efecto
     tras hidratar: fondo más sólido, sombra suave y padding más compacto. */
  .lp-nav {
    position: sticky;
    top: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--page-bg) 92%, transparent);
    backdrop-filter: saturate(140%) blur(12px);
    -webkit-backdrop-filter: saturate(140%) blur(12px);
    border-bottom: 0.5px solid var(--hairline-color);
    transition:
      background 220ms var(--kova-ease-entrance),
      border-color 220ms var(--kova-ease-entrance),
      box-shadow 220ms var(--kova-ease-entrance);
  }
  .lp-nav[data-scrolled="true"] {
    background: color-mix(in srgb, var(--page-bg) 97%, transparent);
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
    .lp-section[data-density="tight"] { padding: 52px 24px !important; }
    .lp-section[data-density="grand"] { padding: 84px 24px 76px !important; }
    .lp-section-inner { max-width: 100% !important; }
    .lp-hero-grid {
      grid-template-columns: 1fr !important;
    }
    .lp-benefit-strip { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 28px !important; }
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
    .lp-problem-ticket { max-width: 340px !important; }
  }
  @media (max-width: 640px) {
    /* Prevent mobile font downloads and late swaps from redefining the LCP. */
    .lp-root,
    .lp-root * {
      font-family: ui-sans-serif, system-ui, sans-serif !important;
    }
    .lp-section { padding: 52px 20px !important; }
    .lp-section-compact { padding: 48px 20px !important; }
    .lp-section[data-density="tight"] { padding: 44px 20px !important; }
    .lp-section[data-density="grand"] { padding: 68px 20px 60px !important; }
    /* Compresión móvil: los previews casi full-bleed son el mayor costo de
       altura del tramo medio; un cap de ancho reduce su altura intrínseca. */
    /* El ticket del corte duplica en móvil al ticket térmico de #precio; el
       argumento del descuadre lo cargan los recortes + el punch. */
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
  }
  @media (max-width: 360px) {
    .lp-nav-primary { padding: 9px 10px !important; font-size: 12px !important; }
    .lp-hero-title { font-size: 30px !important; }
    .lp-hero-copy { font-size: 16px !important; }
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
