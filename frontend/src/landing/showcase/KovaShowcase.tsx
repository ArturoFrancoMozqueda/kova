// ─────────────────────────────────────────────────────────────────────────
// KovaShowcase — cinematic product showcase ("marketing video") component.
//
// Renders the real Kova product previews (the no-auth "$186 Sweet Home" demo
// UI, live React components — not screenshots) inside a CSS laptop/browser
// mockup on a dark branded backdrop, auto-playing through a story:
//
//   POS (con cursor que cobra)  →  Inventario  →  Caja  →  Reportes  →  CTA
//
// A tiny JS director (useShowcaseDirector: fixed 6s setInterval + key-remount
// of the active scene) drives WHICH scene is on; all motion is CSS: layer
// crossfades via [data-active], a roaming accent glow + subtle laptop tilt via
// [data-scene] on the stage, and the previews' own entry animations
// (count-ups, pops, growing bars) re-fire on each remount.
//
// Two surfaces use it:
//   • Embedded on the landing (`variant="embedded"`, landscape) — plays only
//     in-viewport and respects prefers-reduced-motion (static first frame).
//   • Standalone export route /kova-showcase-video (`variant="standalone"`) —
//     always animates so it can be screen-recorded for social video.
//
// ── HOW TO RECORD / EXPORT A VIDEO ─────────────────────────────────────────
// The loop is deterministic per cycle: a fixed 6000ms interval, five scenes,
// 30s total, every in-scene animation has fixed duration/delay/easing — each
// 30s pass is visually identical (there are JS timers now, but no randomness).
//
//   1. Run the app:  `npm run dev`  (inside /frontend).
//   2. Open the standalone route at the exact social size you want:
//        • Portrait  1080×1350 →  /kova-showcase-video            (default)
//                                  /kova-showcase-video?format=portrait
//        • Landscape 1600×1200 →  /kova-showcase-video?format=landscape
//      The route locks the page to those pixel dimensions (see
//      routes/KovaShowcaseVideo.tsx) so the stage fills the frame exactly.
//   3. Make sure the OS "reduce motion" accessibility setting is OFF (the
//      previews' internal micro-animations honor it and would freeze), set the
//      browser viewport to the same size and zoom to 100%.
//   4. Record one full loop = `SEQUENCE_SECONDS` (five 6s scenes = 30s). Start
//      the capture on a scene-1 entry (POS cursor coming in) for a clean trim.
//   5. For a perfectly seamless GIF/MP4 loop, trim to exactly 30.0s.
// ─────────────────────────────────────────────────────────────────────────
import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/brand/Logo";
import { copy } from "@/i18n/messages";
import CashRegisterPreview from "@/landing/previews/CashRegisterPreview";
import InventoryStatePreview from "@/landing/previews/InventoryStatePreview";
import ReportsPreview from "@/landing/previews/ReportsPreview";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
import ShowcaseAppFrame, { type ShowcaseAppNav } from "@/landing/showcase/ShowcaseAppFrame";
import ShowcaseCursor from "@/landing/showcase/ShowcaseCursor";
import { useInView, useShowcaseDirector } from "@/landing/showcase/useShowcaseDirector";

const sc = copy.landing.showcase;
const steps = copy.landing.story.steps;

// One scene per 6s slot; five slots → a 30s loop. SEQUENCE_SECONDS is the
// recording unit for the standalone route.
const SCENE_MS = 6000;
const SEQUENCE_SECONDS = 30;

// The POS scene's choreography: the fake cursor "clicks" the oat-cookie tile
// at POS_CLICK_MS (wired into the preview via entryDelayMs → the cookie pops
// into the ticket and the total counts $130→$186 right under the click), then
// travels to Cobrar, whose pulse fires at POS_CLICK_MS + POS_CHARGE_OFFSET_MS
// (wired via --lp-pulse-offset). Keep in sync with the ksw-cursor-* keyframes.
const POS_CLICK_MS = 2000;
const POS_CHARGE_OFFSET_MS = 1520;

// Story beats: the four live product previews, then the CTA. `render` gets
// `animate` — true only for the ACTIVE scene while the director is playing, so
// inactive layers show their static final state (what a crossfade-out should
// look like) and only one scene runs rAF count-ups at a time. `nav` is the
// sidebar item that ShowcaseAppFrame (la réplica del shell real) marca activo.
type PreviewScene = {
  id: "pos" | "inventory" | "cash" | "reports";
  caption: { title: string; callout: string };
  nav: ShowcaseAppNav;
  render: (animate: boolean) => ReactNode;
};
type CtaScene = { id: "cta"; caption: null; nav?: undefined; render?: undefined };
type Scene = PreviewScene | CtaScene;

const SCENES: Scene[] = [
  {
    id: "pos",
    caption: steps[0],
    nav: "register",
    render: (animate) => (
      <SweetHomePOSPreview interactive={false} animateEntry={animate} entryDelayMs={POS_CLICK_MS} />
    ),
  },
  { id: "inventory", caption: steps[1], nav: "inventory", render: (animate) => <InventoryStatePreview animate={animate} /> },
  { id: "cash", caption: steps[2], nav: "shifts", render: (animate) => <CashRegisterPreview animate={animate} /> },
  { id: "reports", caption: steps[3], nav: "reports", render: (animate) => <ReportsPreview animate={animate} /> },
  { id: "cta", caption: null },
];

export type KovaShowcaseProps = {
  format: "landscape" | "portrait";
  variant?: "embedded" | "standalone";
  ctaTarget?: string;
  onCtaClick?: () => void;
};

export default function KovaShowcase({
  format,
  variant = "embedded",
  ctaTarget = "/signup",
  onCtaClick,
}: KovaShowcaseProps) {
  const standalone = variant === "standalone";
  const stageRef = useRef<HTMLDivElement>(null);
  // Embedded: play only while the stage is on screen. Standalone: always.
  const inView = useInView(stageRef, { threshold: 0.35, disabled: standalone });
  const { scene, cycle, playing } = useShowcaseDirector({
    sceneCount: SCENES.length,
    sceneMs: SCENE_MS,
    inView,
    forceMotion: standalone,
  });

  const stage = (
    <div
      className="ksw-stage"
      ref={stageRef}
      data-format={format}
      data-variant={variant}
      data-scene={scene}
      aria-label={standalone ? undefined : sc.eyebrow}
    >
      <style dangerouslySetInnerHTML={{ __html: SHOWCASE_STYLES }} />

      {/* Backdrop gradients solo en standalone (el embedded ya flota sobre el
          fondo ink de la página); glow + wordmark en ambos. */}
      {standalone ? <div className="ksw-bg" /> : null}
      <div className="ksw-glow" />
      <div className="ksw-wordmark">kova</div>

      {/* Per-scene captions, cross-fading in sync with the screen below */}
      <div className="ksw-captions">
        {SCENES.map((s, i) => (
          <div className="ksw-layer ksw-caption" data-active={scene === i ? "true" : "false"} key={s.id}>
            {s.caption ? (
              <>
                <span className="ksw-caption-title">{s.caption.title}</span>
                <span className="ksw-caption-callout">{s.caption.callout}</span>
              </>
            ) : null}
          </div>
        ))}
      </div>

      {/* Laptop / browser mockup. Float (outer) and per-scene tilt (inner)
          live on separate elements so their transforms don't fight. */}
      <div className="ksw-laptop">
        <div className="ksw-laptop-tilt">
          <div className="ksw-lid">
            <div className="ksw-screen">
              <div className="ksw-browser">
                <span className="ksw-dots">
                  <i /><i /><i />
                </span>
                <span className="ksw-urlpill">
                  <LogoMark size={12} coreColor="var(--accent)" circuitColor="currentColor" />
                  {sc.urlBar}
                </span>
                <span className="ksw-browser-spacer" />
              </div>
              <div className="ksw-viewport">
                {SCENES.map((s, i) => {
                  const active = scene === i;
                  const animate = active && playing;
                  if (s.id === "cta") {
                    // Always mounted and always in the SSR HTML: the prerender
                    // asserts "Deja de adivinar" on "/" (scripts/prerender.mjs).
                    return (
                      <div className="ksw-layer ksw-screen-layer ksw-center" data-active={active ? "true" : "false"} key={s.id}>
                        <div className="ksw-cta" data-lp-anim={animate ? "on" : "off"} key={animate ? `cta-${cycle}` : "cta"}>
                          <span className="lp-story-fade" style={{ ["--lp-fade-delay" as string]: "80ms" }}>
                            <LogoMark size={44} coreColor="var(--accent)" circuitColor="var(--page-fg)" />
                          </span>
                          <h3 className="ksw-cta-title lp-story-fade" style={{ ["--lp-fade-delay" as string]: "220ms" }}>
                            {sc.ctaTitle}
                          </h3>
                          <p className="ksw-cta-line lp-story-fade" style={{ ["--lp-fade-delay" as string]: "380ms" }}>
                            {sc.ctaLine}
                          </p>
                          <Link
                            to={ctaTarget}
                            onClick={onCtaClick}
                            className="ksw-cta-btn lp-story-fade"
                            style={{ ["--lp-fade-delay" as string]: "540ms" }}
                          >
                            {sc.ctaButton}
                          </Link>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="ksw-layer ksw-screen-layer ksw-app-layer" data-active={active ? "true" : "false"} key={s.id}>
                      {/* Remount per cycle re-fires the preview's entry
                          animations; the inactive key renders the static
                          final state (identical pixels, no rAF). */}
                      <div
                        className="ksw-screen-fit"
                        key={animate ? `${s.id}-${cycle}` : s.id}
                        style={
                          s.id === "pos"
                            ? { ["--lp-pulse-offset" as string]: `${POS_CHARGE_OFFSET_MS}ms` }
                            : undefined
                        }
                      >
                        <ShowcaseAppFrame active={s.nav}>
                          {s.render(animate)}
                          {s.id === "pos" && animate ? <ShowcaseCursor /> : null}
                        </ShowcaseAppFrame>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="ksw-base" />
        </div>
      </div>
    </div>
  );

  if (standalone) {
    // The route wraps this in `.lp-root` + dark themeVars + LandingStyleTag and
    // sizes the page, so here we only emit the stage (it fills the frame).
    return stage;
  }

  // Embedded on the landing: a normal landing section with a heading.
  return (
    <section id="producto" className="lp-section ksw-section">
      <div className="lp-section-inner">
        <h2 className="lp-section-label">{sc.eyebrow}</h2>
        <h3 className="lp-section-title ksw-heading">{sc.title}</h3>
        <p className="lp-section-copy">{sc.line}</p>
        {stage}
      </div>
    </section>
  );
}

/* ─── Showcase CSS ───────────────────────────────────────────────────────────
   Self-contained, prefixed `ksw-`. Relies on the page-level landing vars
   (--page-bg / --accent / --card-bg …) provided by the surrounding `.lp-root`.

   MOTION MODEL: the JS director flips [data-active] per layer and [data-scene]
   on the stage; everything visual is CSS transitions/keyframes reacting to
   those attributes (crossfades, glow travel, laptop tilt, cursor path), so
   motion stays GPU-composited and deterministic per loop.
   ─────────────────────────────────────────────────────────────────────────── */
const SHOWCASE_STYLES = `
  .ksw-stage {
    position: relative;
    width: 100%;
    overflow: hidden;
    isolation: isolate;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
  }
  .ksw-section .lp-section-copy {
    max-width: 680px;
  }
  .ksw-heading {
    max-width: 760px;
    font-size: clamp(34px, 3.8vw, 48px);
  }
  /* Embedded on the landing: sin recuadro — caption + laptop flotan sobre el
     fondo de la página y la sección mide lo que mide su contenido. */
  .ksw-stage[data-variant="embedded"] {
    margin-top: 34px;
    flex-direction: column;
    justify-content: flex-start;
    gap: clamp(22px, 3vw, 34px);
    padding-bottom: 18px; /* aire para el drop-shadow del laptop bajo el clip */
  }
  /* Standalone export route: fill the exact pixel frame set by the route. The
     screen layers center vertically ahí — el viewport 16/10 es más alto que el
     preview y el hueco repartido se ve mejor en cámara que un void abajo. */
  .ksw-stage[data-variant="standalone"] { height: 100%; min-height: 100%; background: var(--kova-ink); }

  /* Branded backdrop: deep ink + soft accent glow top-left, vignette edges. */
  .ksw-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    background:
      radial-gradient(120% 90% at 18% 8%, rgba(123,167,255,0.14), transparent 55%),
      radial-gradient(120% 120% at 85% 110%, rgba(30,191,138,0.10), transparent 55%),
      linear-gradient(180deg, #11131b 0%, #0B0D13 100%);
  }

  /* Roaming accent glow: one blurred blob that drifts + recolors per scene.
     transform/opacity only → composited; the 1400ms travel reads as the
     "camera light" following the story. */
  .ksw-glow {
    position: absolute;
    z-index: 1;
    left: 50%;
    top: 45%;
    width: 56%;
    aspect-ratio: 1;
    border-radius: 999px;
    filter: blur(90px);
    opacity: 0.4;
    pointer-events: none;
    background: rgba(74, 111, 255, 0.42);
    transform: translate(-95%, -80%);
    transition: transform 1400ms var(--kova-ease-entrance), background-color 1400ms linear;
  }
  .ksw-stage[data-scene="1"] .ksw-glow { background: rgba(30, 191, 138, 0.36); transform: translate(-8%, -85%); }
  .ksw-stage[data-scene="2"] .ksw-glow { background: rgba(30, 191, 138, 0.32); transform: translate(-92%, -18%); }
  .ksw-stage[data-scene="3"] .ksw-glow { background: rgba(123, 167, 255, 0.4); transform: translate(-10%, -15%); }
  .ksw-stage[data-scene="4"] .ksw-glow { background: rgba(74, 111, 255, 0.48); transform: translate(-50%, -55%) scale(1.18); }

  /* Giant faint wordmark behind the laptop. */
  .ksw-wordmark {
    position: absolute;
    z-index: 1;
    left: 50%;
    top: 47%;
    transform: translate(-50%, -50%);
    font-weight: 600;
    letter-spacing: -0.04em;
    line-height: 1;
    color: rgba(240, 244, 255, 0.045);
    user-select: none;
    pointer-events: none;
    white-space: nowrap;
  }
  .ksw-stage[data-format="landscape"] .ksw-wordmark { font-size: 34vmin; }
  .ksw-stage[data-format="portrait"] .ksw-wordmark { font-size: 30vmin; top: 50%; }
  /* Sin recuadro, el wordmark se esconde tras el laptop (que asome sobre el
     borde superior leía como glitch, no como marca de agua). */
  .ksw-stage[data-variant="embedded"] .ksw-wordmark { top: 62%; }

  /* Captions above the laptop. */
  .ksw-captions {
    position: absolute;
    z-index: 3;
    left: 0;
    right: 0;
    top: 7%;
    height: 16%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 6%;
    pointer-events: none;
  }
  .ksw-stage[data-variant="embedded"] .ksw-captions {
    position: relative;
    inset: auto;
    z-index: 3;
    width: 100%;
    height: clamp(64px, 8vw, 92px);
    padding: 0;
    flex-shrink: 0;
  }
  .ksw-stage[data-variant="embedded"] .ksw-caption {
    justify-content: center;
  }
  .ksw-stage[data-format="portrait"] .ksw-captions { top: 8%; height: 12%; }
  .ksw-caption {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  }
  .ksw-caption-title {
    color: var(--kova-on-ink);
    font-weight: 600;
    letter-spacing: -0.02em;
    font-size: clamp(20px, 3.4vmin, 40px);
  }
  .ksw-caption-callout {
    color: var(--kova-blue-light);
    font-weight: 600;
    font-size: clamp(12px, 1.7vmin, 20px);
  }

  /* Laptop mockup. */
  .ksw-laptop {
    position: relative;
    z-index: 2;
    width: 72%;
    max-width: 1180px;
    animation: ksw-float 9s ease-in-out infinite;
    filter: drop-shadow(0 40px 80px rgba(0,0,0,0.55));
  }
  /* Sin recuadro, el laptop puede ocupar más de la sección. */
  .ksw-stage[data-variant="embedded"] .ksw-laptop { width: 82%; }
  .ksw-stage[data-format="portrait"] .ksw-laptop { width: 88%; }

  /* Per-scene tilt: separate element so the float keyframe (translate) and the
     tilt transform (perspective/rotate) compose instead of overwriting. */
  .ksw-laptop-tilt {
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: transform 1200ms var(--kova-ease-entrance);
    transform: perspective(1400px) rotateX(1.1deg) rotateY(-1.3deg);
  }
  .ksw-stage[data-scene="1"] .ksw-laptop-tilt { transform: perspective(1400px) rotateX(0.5deg) rotateY(1.2deg); }
  .ksw-stage[data-scene="2"] .ksw-laptop-tilt { transform: perspective(1400px) rotateX(-0.6deg) rotateY(-1deg); }
  .ksw-stage[data-scene="3"] .ksw-laptop-tilt { transform: perspective(1400px) rotateX(1deg) rotateY(1.3deg) scale(1.01); }
  .ksw-stage[data-scene="4"] .ksw-laptop-tilt { transform: perspective(1400px) scale(1.02); }

  .ksw-lid {
    width: 100%;
    border-radius: 16px;
    padding: 10px;
    background: linear-gradient(180deg, #2A2F3C, #1B1F29);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .ksw-screen {
    width: 100%;
    border-radius: 9px;
    overflow: hidden;
    background: var(--card-bg);
    border: 1px solid rgba(255,255,255,0.05);
  }
  /* Laptop base / hinge. */
  .ksw-base {
    width: 116%;
    height: 14px;
    border-radius: 0 0 14px 14px;
    background: linear-gradient(180deg, #20242F, #11141C);
    border: 1px solid rgba(255,255,255,0.06);
    border-top: none;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.4);
  }
  .ksw-base::after {
    content: "";
    display: block;
    width: 16%;
    height: 5px;
    margin: 0 auto;
    border-radius: 0 0 6px 6px;
    background: rgba(255,255,255,0.07);
  }

  /* Browser chrome. */
  .ksw-browser {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface-2);
    border-bottom: 0.5px solid var(--hairline-color);
  }
  .ksw-dots { display: inline-flex; gap: 6px; flex-shrink: 0; }
  .ksw-dots i {
    width: 10px; height: 10px; border-radius: 999px; display: block;
    background: #C9CED9;
  }
  .ksw-dots i:nth-child(1) { background: #ED6A5E; }
  .ksw-dots i:nth-child(2) { background: #F4BF50; }
  .ksw-dots i:nth-child(3) { background: #61C554; }
  .ksw-urlpill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--card-bg);
    border: 0.5px solid var(--hairline-color);
    color: var(--text-muted);
    font-size: clamp(11px, 1.3vmin, 15px);
    font-weight: 500;
    max-width: 60%;
  }
  .ksw-browser-spacer { flex: 1; }

  /* Stacked screen layers inside the viewport. */
  .ksw-viewport {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
  }
  .ksw-stage[data-format="portrait"] .ksw-viewport { aspect-ratio: 4 / 3.1; }
  .ksw-screen-layer {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: hidden;
  }
  .ksw-screen-layer.ksw-center { align-items: center; } /* CTA screen */
  /* Escenas de app: la réplica del shell llena el browser edge-to-edge, como
     la app real (sin padding ni max-width — esos viven dentro del frame). */
  .ksw-app-layer { align-items: stretch; padding: 0; }
  .ksw-screen-fit {
    width: 100%;
    height: 100%;
  }

  /* ── Réplica del AppShell real (ShowcaseAppFrame) ──────────────────────────
     Tokens del sidebar real (styles.css): #0F1117 / #F0F4FF / #23283A /
     #1E2330 / #8892A4; contenido claro #F8FAFB. Tamaños a escala del laptop. */
  .ksw-app {
    display: grid;
    grid-template-columns: clamp(128px, 17%, 172px) minmax(0, 1fr);
    width: 100%;
    height: 100%;
    text-align: left;
  }
  .ksw-app-sidebar {
    background: #0F1117;
    color: #F0F4FF;
    border-right: 1px solid #1E2330;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .ksw-app-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 13px;
    border-bottom: 1px solid #1E2330;
  }
  .ksw-app-eyebrow {
    display: block;
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #8892A4;
    line-height: 1.2;
  }
  .ksw-app-tenant {
    display: block;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ksw-app-nav {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 9px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ksw-app-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5.5px 9px;
    border-radius: 8px;
    font-size: 10.5px;
    font-weight: 500;
    color: rgba(240, 244, 255, 0.8);
    white-space: nowrap;
  }
  .ksw-app-nav-item[data-active="true"] {
    background: #23283A;
    color: #F0F4FF;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .ksw-app-nav-item svg { flex-shrink: 0; }
  .ksw-app-user {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid #1E2330;
  }
  .ksw-app-avatar {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #23283A;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .ksw-app-username { display: block; font-size: 10px; font-weight: 600; line-height: 1.25; }
  .ksw-app-userrole { display: block; font-size: 9px; color: #8892A4; line-height: 1.25; }
  .ksw-app-content {
    background: #F8FAFB;
    color: var(--page-fg);
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: clamp(12px, 2.2vmin, 26px);
    min-width: 0;
  }
  .ksw-app-preview {
    position: relative; /* ancla del cursor decorativo */
    width: 100%;
    max-width: 600px;
  }

  /* CTA screen (last scene). */
  .ksw-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    padding: 8px 16px;
  }
  .ksw-cta-title {
    margin: 6px 0 0;
    color: var(--page-fg);
    font-family: var(--lp-font-display);
    font-weight: 600;
    letter-spacing: -0.01em;
    font-size: clamp(24px, 4vmin, 46px);
    line-height: 1.05;
  }
  .ksw-cta-line {
    margin: 0;
    color: var(--text-muted);
    font-size: clamp(14px, 2vmin, 22px);
    max-width: 30ch;
    line-height: 1.35;
  }
  .ksw-cta-btn {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    padding: 12px 26px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: clamp(14px, 1.8vmin, 19px);
    text-decoration: none;
  }

  /* ── Layer crossfade (director-driven) ─────────────────────────────────── */
  .ksw-layer {
    position: absolute;
    inset: 0;
    opacity: 0;
    transform: translateY(14px) scale(0.985);
    transition: opacity 620ms var(--kova-ease-entrance), transform 720ms var(--kova-ease-entrance);
    pointer-events: none;
  }
  .ksw-layer[data-active="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  /* Captions are flex-centered; keep that while stacked. */
  .ksw-caption.ksw-layer { display: flex; }

  @keyframes ksw-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-10px); }
  }

  /* ── Cursor falso de la escena POS ─────────────────────────────────────────
     5600ms, both: entra abajo-derecha, click en la galleta al ~36% (≈2016ms —
     sincronizado con POS_CLICK_MS/--lp-entry-delay del preview), viaja a
     Cobrar y hace un segundo click al ~63% (≈3530ms — --lp-pulse-offset),
     luego se desvanece. Coordenadas en % del .ksw-screen-fit; son estéticas y
     acopladas a la geometría del mini-POS (grid 4 col + ticket 250px) — si esa
     retícula cambia, recalibrar aquí. */
  .ksw-cursor {
    position: absolute;
    z-index: 5;
    left: 0;
    top: 0;
    width: 26px;
    height: 26px;
    pointer-events: none;
    animation: ksw-cursor-path 5600ms cubic-bezier(0.5, 0.06, 0.18, 1) both;
  }
  .ksw-cursor-pointer {
    display: block;
    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.45));
    animation: ksw-cursor-click 5600ms linear both;
  }
  .ksw-cursor-ring {
    position: absolute;
    inset: -7px;
    border-radius: 999px;
    border: 2px solid var(--kova-blue-light);
    opacity: 0;
    animation: ksw-cursor-ping 5600ms linear both;
  }
  @keyframes ksw-cursor-path {
    0%   { left: 94%; top: 108%; opacity: 0; }
    7%   { opacity: 1; }
    30%  { left: 23.5%; top: 62%; }   /* llega al tile de la galleta */
    40%  { left: 23.5%; top: 62%; }   /* pausa para el click */
    60%  { left: 79%; top: 86%; }   /* viaja al botón Cobrar */
    72%  { left: 79%; top: 86%; opacity: 1; }
    86%  { left: 82%; top: 96%; opacity: 0; }
    100% { left: 82%; top: 96%; opacity: 0; }
  }
  @keyframes ksw-cursor-click {
    0%, 34%  { transform: scale(1); }
    36%      { transform: scale(0.8); }
    40%      { transform: scale(1); }
    61%      { transform: scale(1); }
    63%      { transform: scale(0.8); }
    67%, 100% { transform: scale(1); }
  }
  @keyframes ksw-cursor-ping {
    0%, 35%  { opacity: 0; transform: scale(0.45); }
    38%      { opacity: 0.85; transform: scale(0.7); }
    48%      { opacity: 0; transform: scale(1.5); }
    62%      { opacity: 0; transform: scale(0.45); }
    65%      { opacity: 0.85; transform: scale(0.7); }
    75%, 100% { opacity: 0; transform: scale(1.5); }
  }

  @media (max-width: 900px) {
    .ksw-stage[data-variant="embedded"] {
      gap: 22px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-captions {
      height: 86px;
      align-items: flex-start;
    }
    .ksw-stage[data-variant="embedded"] .ksw-caption-title {
      font-size: clamp(22px, 4vw, 34px);
      line-height: 1.02;
    }
    .ksw-stage[data-variant="embedded"] .ksw-caption-callout {
      font-size: clamp(12px, 1.8vw, 16px);
    }
    .ksw-stage[data-variant="embedded"] .ksw-laptop {
      width: min(96%, 760px);
    }
    .ksw-stage[data-variant="embedded"] .ksw-wordmark {
      top: 60%;
    }
    /* Sin cursor en pantallas táctiles/estrechas: la metáfora de mouse no
       aplica y el POS recortado invalida sus coordenadas. */
    .ksw-cursor { display: none; }
  }

  @media (max-width: 640px) {
    .ksw-heading {
      max-width: 12ch;
    }
    .ksw-stage[data-variant="embedded"] {
      margin-top: 28px;
      gap: 18px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-captions {
      height: 82px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-caption {
      gap: 4px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-caption-title {
      font-size: 22px;
      line-height: 1;
    }
    .ksw-stage[data-variant="embedded"] .ksw-caption-callout {
      font-size: 12px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-laptop {
      width: 100%;
      filter: drop-shadow(0 24px 46px rgba(0,0,0,0.5));
    }
    .ksw-stage[data-variant="embedded"] .ksw-lid {
      border-radius: 12px;
      padding: 6px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-screen {
      border-radius: 8px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-browser {
      gap: 8px;
      padding: 7px 9px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-dots {
      gap: 5px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-dots i {
      width: 8px;
      height: 8px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-urlpill {
      padding: 4px 9px;
      max-width: 68%;
      font-size: 10px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-viewport {
      /* Más alto que el 16/10 de desktop: en móvil el POS es solo-ticket
         (líneas + total + Cobrar) y a 4/3.35 se recortaba el encabezado. */
      aspect-ratio: 4 / 4.6;
    }
    /* En móvil el shell real oculta su sidebar; la réplica también. El POS
       recortado (solo ticket) se centra en el contenido claro. */
    .ksw-app { grid-template-columns: 1fr; }
    .ksw-app-sidebar { display: none; }
    .ksw-app-content { padding: 10px; align-items: center; }
    .ksw-stage[data-variant="embedded"] .ksw-base {
      height: 10px;
      border-radius: 0 0 10px 10px;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-preview {
      grid-template-columns: 1fr !important;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-main {
      display: none !important;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-ticket {
      min-height: 0;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-lines {
      max-height: none !important;
      overflow: visible !important;
      flex: 0 0 auto !important;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-methods {
      display: none !important;
    }
    .ksw-stage[data-variant="embedded"] .lp-pos-ticket > div:last-child {
      padding-top: 8px !important;
      gap: 8px !important;
    }
  }

  /* Embedded + reduced motion: el director nunca arranca (queda la escena 1
     estática vía data-active) y la regla global de .lp-root ya anula las
     transiciones; aquí solo se congela el float y se oculta el cursor. */
  @media (prefers-reduced-motion: reduce) {
    .ksw-stage[data-variant="embedded"] .ksw-laptop { animation: none !important; }
    .ksw-stage[data-variant="embedded"] .ksw-cursor { display: none !important; }
  }
  /* Standalone export must ALWAYS animate — override the app-wide reduced-motion
     reset in styles.css (higher specificity than its star rule, so this wins). */
  .ksw-stage[data-variant="standalone"] .ksw-layer {
    transition: opacity 620ms var(--kova-ease-entrance), transform 720ms var(--kova-ease-entrance) !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-glow {
    transition: transform 1400ms var(--kova-ease-entrance), background-color 1400ms linear !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-laptop-tilt {
    transition: transform 1200ms var(--kova-ease-entrance) !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-laptop {
    animation: ksw-float 9s ease-in-out infinite !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-cursor {
    animation: ksw-cursor-path 5600ms cubic-bezier(0.5, 0.06, 0.18, 1) both !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-cursor-pointer {
    animation: ksw-cursor-click 5600ms linear both !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-cursor-ring {
    animation: ksw-cursor-ping 5600ms linear both !important;
  }
`;

export { SEQUENCE_SECONDS };
