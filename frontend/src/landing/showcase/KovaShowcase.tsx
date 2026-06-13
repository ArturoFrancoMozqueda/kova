// ─────────────────────────────────────────────────────────────────────────
// KovaShowcase — cinematic product showcase ("marketing video") component.
//
// Renders the real Kova product previews (the no-auth "$186 Sweet Home" demo
// UI) inside a CSS laptop/browser mockup on a dark branded backdrop with a
// large faint `kova` wordmark, auto-playing through a deterministic story:
//
//   POS  →  Inventario  →  Caja  →  Reportes  →  Final CTA
//
// Two surfaces use it:
//   • Embedded on the landing (`variant="embedded"`, landscape) — loops, and
//     respects prefers-reduced-motion (renders a single static frame).
//   • Standalone export route /kova-showcase-video (`variant="standalone"`) —
//     always animates so it can be screen-recorded for social video.
//
// ── HOW TO RECORD / EXPORT A VIDEO ─────────────────────────────────────────
// The animation is a single, fully deterministic CSS keyframe timeline (no JS
// timers, no Math.random) so every capture is frame-identical.
//
//   1. Run the app:  `npm run dev`  (inside /frontend).
//   2. Open the standalone route at the exact social size you want:
//        • Portrait  1080×1350 →  /kova-showcase-video            (default)
//                                  /kova-showcase-video?format=portrait
//        • Landscape 1600×1200 →  /kova-showcase-video?format=landscape
//      The route locks the page to those pixel dimensions (see
//      routes/KovaShowcaseVideo.tsx) so the stage fills the frame exactly.
//   3. Make sure the OS "reduce motion" accessibility setting is OFF, then set
//      the browser viewport to the same size (DevTools device toolbar, or just
//      maximize at that resolution) and zoom to 100%.
//   4. Record one full loop. ONE LOOP = `SEQUENCE_SECONDS` (see below) — five
//      6s sections = 30s total. Capture with OBS, the browser's built-in
//      recorder, QuickTime, or headless Puppeteer `page.screencast({...})`.
//   5. For a perfectly seamless GIF/MP4 loop, trim to exactly 30.0s — the last
//      section cross-fades back into the first at the loop boundary.
//
// Tip (Puppeteer): set viewport {width:1080,height:1350,deviceScaleFactor:2},
// goto the route, wait 500ms for fonts, then screencast for 30s.
// ─────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/brand/Logo";
import { copy } from "@/i18n/messages";
import CashRegisterPreview from "@/landing/previews/CashRegisterPreview";
import InventoryStatePreview from "@/landing/previews/InventoryStatePreview";
import ReportsPreview from "@/landing/previews/ReportsPreview";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";

const sc = copy.landing.showcase;
const steps = copy.landing.story.steps;

// One section per 6s slot; five slots → a 30s seamless loop. Keep this in sync
// with the `animation-delay` values + `ksw-seq` keyframe percentages below.
const SEQUENCE_SECONDS = 30;

type Section = {
  id: string;
  caption: { title: string; callout: string } | null;
  screen: ReactNode;
};

// animate={false}: previews render their final populated state. The section
// cross-fade (not the previews' own one-shot entry animations) drives motion,
// so static screens keep every loop identical and avoid layout jumps.
function buildSections(ctaTarget: string): Section[] {
  return [
    {
      id: "pos",
      caption: steps[0],
      screen: <SweetHomePOSPreview interactive={false} animateEntry={false} />,
    },
    { id: "inventory", caption: steps[1], screen: <InventoryStatePreview animate={false} /> },
    { id: "cash", caption: steps[2], screen: <CashRegisterPreview animate={false} /> },
    { id: "reports", caption: steps[3], screen: <ReportsPreview animate={false} /> },
    {
      id: "cta",
      caption: null,
      screen: (
        <div className="ksw-cta">
          <LogoMark size={44} coreColor="var(--accent)" circuitColor="var(--page-fg)" />
          <h3 className="ksw-cta-title">{sc.ctaTitle}</h3>
          <p className="ksw-cta-line">{sc.ctaLine}</p>
          <Link to={ctaTarget} className="ksw-cta-btn">
            {sc.ctaButton}
          </Link>
        </div>
      ),
    },
  ];
}

export type KovaShowcaseProps = {
  format: "landscape" | "portrait";
  variant?: "embedded" | "standalone";
};

export default function KovaShowcase({ format, variant = "embedded" }: KovaShowcaseProps) {
  const ctaTarget = "/signup";
  const sections = buildSections(ctaTarget);

  const stage = (
    <div className="ksw-stage" data-format={format} data-variant={variant} aria-hidden="true">
      <style dangerouslySetInnerHTML={{ __html: SHOWCASE_STYLES }} />

      {/* Branded backdrop + giant faint wordmark behind the laptop */}
      <div className="ksw-bg" />
      <div className="ksw-wordmark">kova</div>

      {/* Per-section captions, cross-fading in sync with the screen below */}
      <div className="ksw-captions">
        {sections.map((s) => (
          <div className="ksw-layer ksw-caption" key={s.id}>
            {s.caption ? (
              <>
                <span className="ksw-caption-title">{s.caption.title}</span>
                <span className="ksw-caption-callout">{s.caption.callout}</span>
              </>
            ) : null}
          </div>
        ))}
      </div>

      {/* Laptop / browser mockup */}
      <div className="ksw-laptop">
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
              {sections.map((s) => (
                <div
                  className={`ksw-layer ksw-screen-layer${s.id === "cta" ? " ksw-center" : ""}`}
                  key={s.id}
                >
                  <div className="ksw-screen-fit">{s.screen}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ksw-base" />
      </div>
    </div>
  );

  if (variant === "standalone") {
    // The route wraps this in `.lp-root` + dark themeVars + LandingStyleTag and
    // sizes the page, so here we only emit the stage (it fills the frame).
    return stage;
  }

  // Embedded on the landing: a normal landing section with a heading.
  return (
    <section className="lp-section ksw-section">
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

   DETERMINISTIC TIMELINE: every `.ksw-layer` shares ONE keyframe (`ksw-seq`,
   30s, infinite) and is offset by a positive `animation-delay` of i×6s via
   :nth-child. The keyframe lights a layer for its 6s slot then hides it, so the
   five sections fade through in order and loop seamlessly. No JS, no randomness.
   ─────────────────────────────────────────────────────────────────────────── */
const SHOWCASE_STYLES = `
  .ksw-stage {
    position: relative;
    width: 100%;
    overflow: hidden;
    isolation: isolate;
    background: var(--kova-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
  }
  /* Embedded on the landing: responsive band with a fixed aspect ratio. */
  .ksw-stage[data-variant="embedded"] {
    margin-top: 34px;
    border-radius: 18px;
    border: 0.5px solid var(--hairline-color);
  }
  .ksw-stage[data-variant="embedded"][data-format="landscape"] { aspect-ratio: 16 / 10; }
  .ksw-stage[data-variant="embedded"][data-format="portrait"] { aspect-ratio: 4 / 5; }
  /* Standalone export route: fill the exact pixel frame set by the route. */
  .ksw-stage[data-variant="standalone"] { height: 100%; min-height: 100%; }

  /* Branded backdrop: deep ink + soft accent glow top-left, vignette edges. */
  .ksw-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    background:
      radial-gradient(120% 90% at 18% 8%, rgba(123,167,255,0.22), transparent 55%),
      radial-gradient(120% 120% at 85% 110%, rgba(30,191,138,0.12), transparent 55%),
      linear-gradient(180deg, #11131b 0%, #0B0D13 100%);
  }

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
    display: flex;
    flex-direction: column;
    align-items: center;
    animation: ksw-float 9s ease-in-out infinite;
    filter: drop-shadow(0 40px 80px rgba(0,0,0,0.55));
  }
  .ksw-stage[data-format="portrait"] .ksw-laptop { width: 88%; }

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
    /* Top-align data screens so short previews (reports/caja) sit under the
       browser chrome like a real app, instead of floating dead-centre. */
    align-items: flex-start;
    justify-content: center;
    padding: clamp(16px, 3vmin, 40px);
    overflow: hidden;
  }
  .ksw-screen-layer.ksw-center { align-items: center; } /* CTA screen */
  .ksw-screen-fit {
    width: 100%;
    max-width: 620px;
    max-height: 100%;
  }

  /* CTA screen (last section). */
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
    font-weight: 600;
    letter-spacing: -0.02em;
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

  /* ── The deterministic layer timeline ──────────────────────────────────── */
  .ksw-layer {
    position: absolute;
    inset: 0;
    opacity: 0;
    animation: ksw-seq ${SEQUENCE_SECONDS}s linear infinite both;
    will-change: opacity, transform;
  }
  /* Captions are flex-centered; keep that while stacked. */
  .ksw-caption.ksw-layer { display: flex; }
  .ksw-layer:nth-child(1) { animation-delay: 0s; }
  .ksw-layer:nth-child(2) { animation-delay: 6s; }
  .ksw-layer:nth-child(3) { animation-delay: 12s; }
  .ksw-layer:nth-child(4) { animation-delay: 18s; }
  .ksw-layer:nth-child(5) { animation-delay: 24s; }

  @keyframes ksw-seq {
    0%   { opacity: 0; transform: translateY(14px) scale(0.985); }
    2.5% { opacity: 1; transform: translateY(0) scale(1); }
    17%  { opacity: 1; transform: translateY(0) scale(1); }
    20%  { opacity: 0; transform: translateY(-10px) scale(0.99); }
    100% { opacity: 0; transform: translateY(14px) scale(0.985); }
  }
  @keyframes ksw-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-10px); }
  }

  @media (max-width: 900px) {
    .ksw-stage[data-variant="embedded"] {
      aspect-ratio: auto !important;
      height: clamp(440px, 62vw, 620px);
    }
    .ksw-stage[data-variant="embedded"] .ksw-captions {
      top: 24px;
      height: 86px;
      padding: 0 8%;
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
      width: min(92%, 760px);
      margin-top: 106px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-screen-layer {
      padding: clamp(14px, 2.4vw, 24px);
    }
    .ksw-stage[data-variant="embedded"] .ksw-screen-fit {
      max-width: min(100%, 640px);
    }
    .ksw-stage[data-variant="embedded"] .ksw-wordmark {
      top: 60%;
    }
  }

  @media (max-width: 640px) {
    .ksw-heading {
      max-width: 12ch;
    }
    .ksw-stage[data-variant="embedded"] {
      height: 430px;
      margin-top: 28px;
      border-radius: 14px;
    }
    .ksw-stage[data-variant="embedded"] .ksw-captions {
      top: 18px;
      height: 82px;
      padding: 0 18px;
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
      width: calc(100% - 32px);
      margin-top: 118px;
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
      aspect-ratio: 4 / 3.35;
    }
    .ksw-stage[data-variant="embedded"] .ksw-screen-layer {
      padding: 10px;
      align-items: center;
    }
    .ksw-stage[data-variant="embedded"] .ksw-screen-fit {
      max-width: 100%;
      max-height: none;
    }
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

  /* Embedded: honor reduced motion — freeze on the first section. */
  @media (prefers-reduced-motion: reduce) {
    .ksw-stage[data-variant="embedded"] .ksw-layer { animation: none !important; opacity: 0 !important; }
    .ksw-stage[data-variant="embedded"] .ksw-layer:nth-child(1) { opacity: 1 !important; transform: none !important; }
    .ksw-stage[data-variant="embedded"] .ksw-laptop { animation: none !important; }
  }
  /* Standalone export must ALWAYS animate — override the app-wide reduced-motion
     reset in styles.css (higher specificity than its star rule, so this wins). */
  .ksw-stage[data-variant="standalone"] .ksw-layer {
    animation: ksw-seq ${SEQUENCE_SECONDS}s linear infinite both !important;
  }
  .ksw-stage[data-variant="standalone"] .ksw-layer:nth-child(1) { animation-delay: 0s !important; }
  .ksw-stage[data-variant="standalone"] .ksw-layer:nth-child(2) { animation-delay: 6s !important; }
  .ksw-stage[data-variant="standalone"] .ksw-layer:nth-child(3) { animation-delay: 12s !important; }
  .ksw-stage[data-variant="standalone"] .ksw-layer:nth-child(4) { animation-delay: 18s !important; }
  .ksw-stage[data-variant="standalone"] .ksw-layer:nth-child(5) { animation-delay: 24s !important; }
  .ksw-stage[data-variant="standalone"] .ksw-laptop {
    animation: ksw-float 9s ease-in-out infinite !important;
  }
`;
