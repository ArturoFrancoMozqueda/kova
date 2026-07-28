// Scroll-driven product film for the landing page.
//
// The frames come from a screen recording of a live Kova tenant (see
// scripts/capture-film.mjs). Scrolling the section scrubs a WebP frame
// sequence on a canvas, so the visitor drives a real walkthrough instead of
// watching an autoplaying loop.
//
// Constraints this component is built around:
//   - Home is prerendered with renderToString and hydrated, so nothing touches
//     window/document/canvas during render. The prerendered markup is the
//     poster image, which is also the no-JS and reduced-motion experience.
//   - Frames are ~3.7 MB, so nothing is fetched until the section is close to
//     the viewport, and never on reduced-motion or Save-Data.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { copy } from "@/i18n/messages";
import { prefersReducedMotion } from "@/lib/usePrefersReducedMotion";

const f = copy.landing.film;

const FRAME_COUNT = 96;
const FRAME_PAD = 4;
const LERP_FACTOR = 0.12;
const FOCUS_LERP = 0.1;
const DWELL_WIDTH = 0.05;
const DWELL_PEAK = 2.4;
const LUT_SIZE = 1200;
const FILM_ASPECT = 1280 / 716;
const NARROW_QUERY = "(max-width: 860px)";
const BACKDROP = "#101118";

// The cart holding three items at $120.00, just before it is charged: the
// clearest single image of the product working, and the only frame that ships
// in the prerendered HTML.
const POSTER = "/film/desktop/frame-0023.webp";

type Chapter = {
  key: keyof typeof f.chapters;
  center: number;
  /** Normalised source crop used on narrow viewports, cut to the plate ratio. */
  focus: [number, number, number, number];
};

// Centres were measured per frame from the recording by reading which sidebar
// item is active, not estimated by eye.
const CHAPTERS: Chapter[] = [
  // The cart is populated between frames 17 and 25; past that the sale has
  // gone through and the panel resets to an empty cart.
  { key: "caja", center: 0.215, focus: [0.63, 0.06, 0.363, 0.52] },
  { key: "inventario", center: 0.437, focus: [0.345, 0.285, 0.31, 0.444] },
  { key: "turnos", center: 0.683, focus: [0.18, 0.06, 0.433, 0.62] },
  { key: "analisis", center: 0.868, focus: [0.2, 0.04, 0.433, 0.62] },
];

const CHAPTER_WINDOW = 0.1;

function frameUrl(index: number, narrow: boolean) {
  const dir = narrow ? "mobile" : "desktop";
  return `/film/${dir}/frame-${String(index + 1).padStart(FRAME_PAD, "0")}.webp`;
}

type ProductFilmProps = {
  ctaTarget?: string;
  onCtaClick?: () => void;
};

export default function ProductFilm({ ctaTarget = "/signup", onCtaClick }: ProductFilmProps) {
  const [hydrated, setHydrated] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const captionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return undefined;

    const track = trackRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!track || !stage || !canvas) return undefined;

    const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (prefersReducedMotion() || connection?.saveData) return undefined;

    // matchMedia is checked before touching the canvas: jsdom implements
    // neither, and probing getContext there logs a noisy "Not implemented"
    // error even though the null return is handled.
    if (typeof window.matchMedia !== "function") return undefined;
    const narrowMedia = window.matchMedia(NARROW_QUERY);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return undefined;
    const images = new Array<HTMLImageElement | null>(FRAME_COUNT);
    const loaded = new Uint8Array(FRAME_COUNT);

    let narrow = narrowMedia.matches;
    let currentFrame = 0;
    let lastDrawn = -1;
    let lastFocusKey = "";
    let rafId = 0;
    let running = false;
    let disposed = false;
    let plate = { x: 0, y: 0, w: 0, h: 0 };
    let focus: [number, number, number, number] = [...CHAPTERS[0]!.focus];
    let activeChapter = -1;

    /* ---- dwell remap: readable slow zones around each caption ---- */
    const rawAt = new Float64Array(LUT_SIZE + 1);
    {
      let total = 0;
      let previous = 0;
      for (let i = 0; i <= LUT_SIZE; i += 1) {
        const effective = i / LUT_SIZE;
        let density = 1;
        for (const chapter of CHAPTERS) {
          const delta = (effective - chapter.center) / DWELL_WIDTH;
          density += DWELL_PEAK * Math.exp(-0.5 * delta * delta);
        }
        if (i > 0) total += (previous + density) * 0.5;
        previous = density;
        rawAt[i] = total;
      }
      for (let i = 0; i <= LUT_SIZE; i += 1) rawAt[i]! /= total;
    }

    function remap(raw: number) {
      let low = 0;
      let high = LUT_SIZE;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (rawAt[mid]! < raw) low = mid + 1;
        else high = mid;
      }
      const index = Math.max(1, low);
      const leftRaw = rawAt[index - 1]!;
      const span = rawAt[index]! - leftRaw || 1;
      return Math.max(0, Math.min(1, (index - 1 + (raw - leftRaw) / span) / LUT_SIZE));
    }

    /* ---- geometry ---- */
    function computePlate() {
      const w = stage!.clientWidth;
      const h = stage!.clientHeight;
      // The landing header stays pinned over the sticky stage, so the plate
      // starts below it instead of tucking its top edge underneath.
      const headroom = narrow ? 76 : 84;
      if (narrow) {
        const gutter = 20;
        const width = w - gutter * 2;
        const height = Math.min(width / 1.25, h * 0.44);
        return { x: gutter, y: headroom, w: width, h: height };
      }
      // 0.64 rather than filling the stage: the caption band below needs room
      // for a two-line title plus its supporting line without clipping.
      const width = Math.min(w * 0.9, 1100, (h - headroom) * 0.64 * FILM_ASPECT);
      const height = width / FILM_ASPECT;
      return { x: (w - width) / 2, y: headroom, w: width, h: height };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(stage!.clientWidth * dpr);
      const height = Math.round(stage!.clientHeight * dpr);
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
        lastDrawn = -1;
      }
      plate = computePlate();
      stage!.style.setProperty("--pf-plate-y", `${plate.y + plate.h}px`);
    }

    function nearestLoaded(index: number) {
      if (loaded[index]) return index;
      for (let distance = 1; distance < FRAME_COUNT; distance += 1) {
        if (index - distance >= 0 && loaded[index - distance]) return index - distance;
        if (index + distance < FRAME_COUNT && loaded[index + distance]) return index + distance;
      }
      return -1;
    }

    function draw(index: number) {
      const resolved = nearestLoaded(Math.max(0, Math.min(FRAME_COUNT - 1, index)));
      if (resolved < 0) return;
      const focusKey = narrow ? focus.map((v) => v.toFixed(3)).join() : "wide";
      if (resolved === lastDrawn && focusKey === lastFocusKey) return;
      const image = images[resolved];
      if (!image || !image.naturalWidth) return;

      const dpr = canvas!.width / Math.max(1, stage!.clientWidth);
      ctx!.fillStyle = BACKDROP;
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      const dx = plate.x * dpr;
      const dy = plate.y * dpr;
      const dw = plate.w * dpr;
      const dh = plate.h * dpr;

      if (narrow) {
        // Crop to the region that matters for this chapter, so a desktop UI
        // stays legible on a phone instead of shrinking to nothing.
        const fw = image.naturalWidth * focus[2];
        const fh = image.naturalHeight * focus[3];
        const scale = Math.max(dw / fw, dh / fh);
        const sw = Math.min(image.naturalWidth, dw / scale);
        const sh = Math.min(image.naturalHeight, dh / scale);
        const sx = Math.max(0, Math.min(image.naturalWidth - sw, image.naturalWidth * focus[0] + (fw - sw) / 2));
        const sy = Math.max(0, Math.min(image.naturalHeight - sh, image.naturalHeight * focus[1] + (fh - sh) / 2));
        ctx!.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      } else {
        ctx!.drawImage(image, dx, dy, dw, dh);
      }

      lastDrawn = resolved;
      lastFocusKey = focusKey;
      if (posterRef.current) posterRef.current.dataset.hidden = "true";
    }

    /* ---- loading ---- */
    function loadFrame(index: number) {
      if (loaded[index] || images[index]) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const image = new Image();
        images[index] = image;
        image.decoding = "async";
        image.onload = () => {
          loaded[index] = 1;
          resolve();
        };
        image.onerror = () => {
          images[index] = null;
          resolve();
        };
        image.src = frameUrl(index, narrow);
      });
    }

    async function loadAll() {
      // Chapter frames plus an even spread, so the very first scrub is
      // coherent instead of snapping between the few frames that exist.
      const spread = Array.from({ length: 12 }, (_, i) => Math.round((i / 11) * (FRAME_COUNT - 1)));
      const critical = Array.from(
        new Set([...spread, ...CHAPTERS.map((c) => Math.round(c.center * (FRAME_COUNT - 1)))]),
      ).sort((a, b) => a - b);
      await Promise.all(critical.map(loadFrame));
      if (disposed) return;
      draw(Math.round(currentFrame));
      const rest = Array.from({ length: FRAME_COUNT }, (_, i) => i).filter((i) => !critical.includes(i));
      for (let start = 0; start < rest.length; start += 8) {
        if (disposed) return;
        await Promise.all(rest.slice(start, start + 8).map(loadFrame));
      }
    }

    /* ---- loop ---- */
    function progress() {
      const rect = track!.getBoundingClientRect();
      const distance = Math.max(1, rect.height - window.innerHeight);
      return Math.max(0, Math.min(1, -rect.top / distance));
    }

    function frameLoop() {
      if (disposed) return;
      const effective = remap(progress());
      const target = Math.round(effective * (FRAME_COUNT - 1));
      currentFrame += (target - currentFrame) * LERP_FACTOR;

      let nearestIndex = 0;
      let nearest = Infinity;
      CHAPTERS.forEach((chapter, i) => {
        const distance = Math.abs(effective - chapter.center);
        if (distance < nearest) {
          nearest = distance;
          nearestIndex = i;
        }
        const node = captionRefs.current[i];
        if (node) {
          const visible = distance <= CHAPTER_WINDOW;
          if ((node.dataset.on === "true") !== visible) node.dataset.on = String(visible);
        }
      });

      if (activeChapter !== nearestIndex) {
        activeChapter = nearestIndex;
        const focusTarget = CHAPTERS[nearestIndex]!.focus;
        focus = [...focusTarget];
      } else if (narrow) {
        const focusTarget = CHAPTERS[nearestIndex]!.focus;
        for (let i = 0; i < 4; i += 1) {
          focus[i]! += (focusTarget[i]! - focus[i]!) * FOCUS_LERP;
        }
      }

      if (railRef.current) railRef.current.style.transform = `scaleX(${effective.toFixed(4)})`;
      draw(Math.round(currentFrame));
      rafId = requestAnimationFrame(frameLoop);
    }

    function start() {
      if (running || disposed) return;
      running = true;
      rafId = requestAnimationFrame(frameLoop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    resize();

    // Nothing is fetched until the section is within a screen of the viewport.
    let fetched = false;
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (fetched) return;
        fetched = true;
        preloadObserver.disconnect();
        void loadAll();
      },
      { rootMargin: "100% 0px" },
    );
    preloadObserver.observe(track);

    // The loop only runs while the section is actually on screen.
    const runObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      },
      { threshold: 0 },
    );
    runObserver.observe(track);

    const onResize = () => {
      resize();
      draw(Math.round(currentFrame));
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onNarrowChange = (event: MediaQueryListEvent) => {
      narrow = event.matches;
      images.fill(null);
      loaded.fill(0);
      lastDrawn = -1;
      lastFocusKey = "";
      resize();
      if (fetched) void loadAll();
    };

    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    narrowMedia.addEventListener("change", onNarrowChange);

    return () => {
      disposed = true;
      stop();
      preloadObserver.disconnect();
      runObserver.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      narrowMedia.removeEventListener("change", onNarrowChange);
    };
  }, [hydrated]);

  return (
    <section id="producto" className="lp-section pf-section" aria-labelledby="pf-title">
      <style dangerouslySetInnerHTML={{ __html: FILM_STYLES }} />

      <div className="lp-section-inner">
        <span className="lp-section-label">{f.eyebrow}</span>
        <h2 className="lp-section-title pf-heading" id="pf-title">
          {f.title}
        </h2>
        <p className="lp-section-copy">{f.line}</p>
      </div>

      <div className="pf-track" ref={trackRef}>
        <div className="pf-stage" ref={stageRef}>
          <canvas className="pf-canvas" ref={canvasRef} aria-hidden="true" />
          <img
            className="pf-poster"
            ref={posterRef}
            src={POSTER}
            alt={f.posterAlt}
            width={1280}
            height={716}
            decoding="async"
          />

          <div className="pf-captions">
            {CHAPTERS.map((chapter, index) => {
              const text = f.chapters[chapter.key];
              return (
                <div
                  className="pf-caption"
                  key={chapter.key}
                  data-on="false"
                  ref={(node) => {
                    captionRefs.current[index] = node;
                  }}
                >
                  <span className="pf-caption-eyebrow">{text.eyebrow}</span>
                  <p className="pf-caption-title">{text.title}</p>
                  <p className="pf-caption-line">{text.line}</p>
                </div>
              );
            })}
          </div>

          <div className="pf-rail" role="presentation">
            <span className="pf-rail-fill" ref={railRef} />
          </div>
        </div>
      </div>

      <div className="lp-section-inner pf-outro">
        <p className="pf-note">{f.note}</p>
        {/* Carries over the signup CTA the showcase used to own here. The
            telemetry label stays "showcase" so the funnel history is
            continuous across the swap. */}
        <Link to={ctaTarget} onClick={onCtaClick} className="pf-cta">
          {copy.landing.showcase.ctaButton}
        </Link>
      </div>
    </section>
  );
}

const FILM_STYLES = `
.pf-section { padding-bottom: 0; }
.pf-heading { max-width: 22ch; }

.pf-track { position: relative; height: 380vh; margin-top: clamp(28px, 4vw, 56px); }

.pf-stage {
  position: sticky;
  top: 0;
  display: block;
  width: 100%;
  height: 100svh;
  overflow: hidden;
  background: var(--kova-ink);
}

.pf-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

/* The poster is the prerendered, no-JS and reduced-motion view. It stays put
   until the canvas has painted its first frame. */
.pf-poster {
  position: absolute;
  left: 50%;
  top: max(6%, 24px);
  width: min(90%, 1100px);
  height: auto;
  transform: translateX(-50%);
  transition: opacity 300ms ease;
}

.pf-poster[data-hidden="true"] { opacity: 0; }

.pf-captions {
  position: absolute;
  inset: var(--pf-plate-y, 60%) 0 0;
  display: grid;
  padding: clamp(20px, 2.4vw, 32px) clamp(20px, 5vw, 72px) 56px;
  pointer-events: none;
}

.pf-caption {
  grid-area: 1 / 1;
  align-self: center;
  max-width: 34rem;
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 420ms ease, transform 420ms var(--kova-ease-entrance, cubic-bezier(.22,1,.36,1));
}

.pf-caption[data-on="true"] { opacity: 1; transform: none; }

.pf-caption-eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  color: var(--kova-blue-light, #7ba2f9);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.pf-caption-title {
  margin: 0;
  color: var(--kova-on-ink);
  font-size: clamp(22px, 2.6vw, 34px);
  font-weight: 700;
  letter-spacing: -.03em;
  line-height: 1.1;
}

.pf-caption-line {
  margin: 10px 0 0;
  max-width: 30rem;
  color: rgba(240, 244, 255, .68);
  font-size: clamp(15px, 1.1vw, 17px);
  line-height: 1.5;
}

.pf-rail {
  position: absolute;
  left: clamp(20px, 5vw, 72px);
  right: clamp(20px, 5vw, 72px);
  bottom: 28px;
  height: 1px;
  background: rgba(240, 244, 255, .18);
}

.pf-rail-fill {
  display: block;
  height: 100%;
  background: var(--kova-blue-light, #7ba2f9);
  transform: scaleX(0);
  transform-origin: left;
  will-change: transform;
}

.pf-outro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: clamp(24px, 3vw, 40px);
}

.pf-note { margin: 0; max-width: 44ch; color: var(--kova-muted); font-size: 14px; }

.pf-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 999px;
  background: var(--kova-ink);
  color: var(--kova-paper);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 200ms var(--kova-ease-entrance, ease), opacity 200ms ease;
}

.pf-cta:hover { transform: translateY(-1px); opacity: .92; }

@media (max-width: 860px) {
  .pf-track { height: 320vh; }
  .pf-poster { top: max(4%, 16px); width: calc(100% - 40px); }
  .pf-captions { padding: 20px 20px 56px; }
  .pf-caption-title { font-size: clamp(20px, 5.6vw, 28px); }
  .pf-caption-line { font-size: 14.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .pf-track { height: auto; }
  .pf-stage { position: relative; height: auto; padding: clamp(24px, 4vw, 48px) 0; }
  .pf-canvas { display: none; }
  .pf-poster { position: relative; left: auto; top: auto; transform: none; margin: 0 auto; display: block; }
  .pf-poster[data-hidden="true"] { opacity: 1; }
  .pf-captions { position: static; padding: 32px clamp(20px, 5vw, 72px) 0; }
  .pf-caption { grid-area: auto; opacity: 1; transform: none; max-width: none; padding-bottom: 20px; }
  .pf-rail { display: none; }
}
`;
