// HeroFilm: el hero y la película del producto fusionados. Entras y estás
// dentro de Kova — el titular vive sobre la pantalla del producto real y el
// scroll te lleva por Caja → Inventario → Turnos → Análisis (96 cuadros WebP
// grabados de una cuenta en operación; ver scripts/capture-film.mjs).
//
// Static-first: el CSS por defecto es un hero clásico completo (titular, CTAs,
// póster enmarcado, leyendas apiladas). El modo cinemático — track de 460vh,
// stage sticky, scrub sobre canvas — se activa SOLO post-hidratación vía
// data-pf-live, tras las mismas guardas de ProductFilm (reduced-motion,
// Save-Data, matchMedia). Así el prerender, no-JS, jsdom y reduced-motion ven
// una página completa, y nadie queda atrapado en un track muerto si scrollea
// durante la ventana de hidratación.
//
// Contratos que este componente satisface (Home.test + e2e):
//   - section#producto con .lp-hero-section (excluida de content-visibility)
//   - .lp-hero-grid SIN data-lp-reveal; .lp-hero-copy siempre visible
//   - .lp-hero-content antes de .lp-hero-visual (móvil: copy arriba, CTA en fold)
//   - .lp-hero-frame como marco del producto
//   - .pf-cta del outro con telemetría "showcase"
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { STANDARD_PLAN_PRICE_LABEL_ES } from "@/billing/standardPlan";
import { copy } from "@/i18n/messages";
import { prefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { trackAnonymousEventOnce } from "@/telemetry/funnel";

const t = copy.landing.hero;
const f = copy.landing.film;

const FRAME_COUNT = 96;
const FRAME_PAD = 4;
const LERP_FACTOR = 0.12;
const FOCUS_LERP = 0.1;
const DWELL_WIDTH = 0.05;
const DWELL_PEAK = 2.4;
const LUT_SIZE = 1200;
const NARROW_QUERY = "(max-width: 860px)";
const BACKDROP = "#101118";

// Capítulo 0 = el hero. La página "sostiene" el titular al inicio y el film
// arranca cuando el titular sale.
const HERO_HOLD = 0.06;
const HERO_EXIT = 0.12;
const HERO_DWELL_CENTER = 0.04;

// Alturas del track SOLO en modo live (estático es height:auto).
const TRACK_VH_WIDE = 460;
const TRACK_VH_NARROW = 400;

// El carrito con tres productos y $120.00, justo antes de cobrarse: la imagen
// de marketing más clara del producto trabajando. Es el único cuadro que viaja
// en el HTML prerenderizado y el candidato a LCP en desktop.
const POSTER_WIDE = "/film/desktop/frame-0023.webp";
const POSTER_NARROW = "/film/mobile/frame-0023.webp";

type ChapterKey = keyof typeof f.chapters;

type Chapter = {
  key: ChapterKey;
  /** Centro en progreso de película (0..1), medido cuadro a cuadro. */
  filmCenter: number;
  /** Recorte focal normalizado usado en viewports angostos. */
  focus: [number, number, number, number];
};

// Centros medidos leyendo qué ítem del sidebar está activo en cada cuadro.
const CHAPTERS: Chapter[] = [
  { key: "caja", filmCenter: 0.215, focus: [0.63, 0.06, 0.363, 0.52] },
  { key: "inventario", filmCenter: 0.437, focus: [0.345, 0.285, 0.31, 0.444] },
  { key: "turnos", filmCenter: 0.683, focus: [0.18, 0.06, 0.433, 0.62] },
  { key: "analisis", filmCenter: 0.868, focus: [0.2, 0.04, 0.433, 0.62] },
];

// Re-expresados en progreso efectivo de página: el tramo [0, HERO_EXIT] es del
// hero; la película vive en [HERO_EXIT, 1].
const CHAPTER_CENTERS = CHAPTERS.map((c) => HERO_EXIT + c.filmCenter * (1 - HERO_EXIT));
const CHAPTER_WINDOW = 0.088;

function frameUrl(index: number, narrow: boolean) {
  const dir = narrow ? "mobile" : "desktop";
  return `/film/${dir}/frame-${String(index + 1).padStart(FRAME_PAD, "0")}.webp`;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const u = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
}

/** Geometría de layout (ignora transforms) de `el` relativa a `ancestor`. */
function layoutRect(el: HTMLElement, ancestor: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

type HeroFilmProps = {
  primaryTarget: string;
  primaryCtaLabel: string;
  /** Handler del CTA principal; `extra` distingue el rail flotante del grid. */
  onPrimaryCta: (extra?: Record<string, unknown>) => void;
  ctaTarget?: string;
  onShowcaseCta?: () => void;
};

export default function HeroFilm({
  primaryTarget,
  primaryCtaLabel,
  onPrimaryCta,
  ctaTarget = "/signup",
  onShowcaseCta,
}: HeroFilmProps) {
  const [hydrated, setHydrated] = useState(false);
  const [railVisible, setRailVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const captionsRef = useRef<HTMLDivElement>(null);
  const captionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollToChapterRef = useRef<((index: number) => void) | null>(null);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return undefined;

    const section = sectionRef.current;
    const track = trackRef.current;
    const stage = stageRef.current;
    const visual = visualRef.current;
    const canvas = canvasRef.current;
    if (!section || !track || !stage || !visual || !canvas) return undefined;

    const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (prefersReducedMotion() || connection?.saveData) return undefined;
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
    let lastHeroExit = -1;
    let heroOff = false;
    let posterShown = true;
    let railShown = false;
    let rafId = 0;
    let running = false;
    let disposed = false;
    let focus: [number, number, number, number] = [...CHAPTERS[0]!.focus];
    let activeChapter = -1;
    // Transform FLIP del visual y tamaño del plate expandido para el canvas.
    let flip = { dx: 0, dy: 0, scale: 1 };
    let plateCss = { w: 1, h: 1 };

    // A partir de aquí el modo cinemático es real: el CSS de [data-pf-live]
    // convierte el track en 460vh/400vh y el stage en sticky.
    section.dataset.pfLive = "true";

    /* ---- dwell remap: zonas lentas legibles en hero + capítulos ---- */
    const DWELL_CENTERS = [HERO_DWELL_CENTER, ...CHAPTER_CENTERS];
    const rawAt = new Float64Array(LUT_SIZE + 1);
    {
      let total = 0;
      let previous = 0;
      for (let i = 0; i <= LUT_SIZE; i += 1) {
        const effective = i / LUT_SIZE;
        let density = 1;
        for (const center of DWELL_CENTERS) {
          const delta = (effective - center) / DWELL_WIDTH;
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

    /* ---- geometría ---- */
    function resize() {
      const stageW = stage!.clientWidth;
      const stageH = stage!.clientHeight;
      const headroom = narrow ? 76 : 84;

      // Geometría natural del visual (offset*, inmune a transforms).
      const natural = layoutRect(visual!, stage!);
      if (natural.w < 1 || natural.h < 1) return;

      // Destino: el visual centrado como pantalla de cine bajo el headroom,
      // dejando banda inferior para leyendas y rail (la leyenda de tres
      // líneas necesita ~170px antes de tocar el rail).
      const bottomBand = narrow ? Math.max(stageH * 0.34, 240) : 210;
      const maxW = narrow ? stageW - 24 : Math.min(stageW * 0.74, 1060);
      const maxH = Math.max(180, stageH - headroom - bottomBand);
      const scale = Math.min(maxW / natural.w, maxH / natural.h);

      const naturalCx = natural.x + natural.w / 2;
      const naturalCy = natural.y + natural.h / 2;
      const targetCx = stageW / 2;
      const targetCy = headroom + (natural.h * scale) / 2;

      flip = { dx: targetCx - naturalCx, dy: targetCy - naturalCy, scale };
      stage!.style.setProperty("--pf-flip-dx", `${flip.dx.toFixed(1)}px`);
      stage!.style.setProperty("--pf-flip-dy", `${flip.dy.toFixed(1)}px`);
      stage!.style.setProperty("--pf-flip-scale", flip.scale.toFixed(4));
      // Borde inferior del plate expandido: ancla de las leyendas.
      stage!.style.setProperty("--pf-plate-y", `${Math.round(targetCy + (natural.h * scale) / 2)}px`);

      // Canvas: respaldo al tamaño EXPANDIDO × DPR para que el film escalado
      // siga nítido; su caja CSS es el plate en reposo.
      const plate = canvas!.parentElement as HTMLElement;
      plateCss = { w: plate.clientWidth || 1, h: plate.clientHeight || 1 };
      const density = Math.min((window.devicePixelRatio || 1) * flip.scale, 2.5);
      const backingW = Math.round(plateCss.w * density);
      const backingH = Math.round(plateCss.h * density);
      if (canvas!.width !== backingW || canvas!.height !== backingH) {
        canvas!.width = backingW;
        canvas!.height = backingH;
        lastDrawn = -1;
      }
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

      ctx!.fillStyle = BACKDROP;
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      if (narrow) {
        // Recorte focal del capítulo: una UI de escritorio legible en teléfono.
        const fw = image.naturalWidth * focus[2];
        const fh = image.naturalHeight * focus[3];
        const scale = Math.max(canvas!.width / fw, canvas!.height / fh);
        const sw = Math.min(image.naturalWidth, canvas!.width / scale);
        const sh = Math.min(image.naturalHeight, canvas!.height / scale);
        const sx = Math.max(0, Math.min(image.naturalWidth - sw, image.naturalWidth * focus[0] + (fw - sw) / 2));
        const sy = Math.max(0, Math.min(image.naturalHeight - sh, image.naturalHeight * focus[1] + (fh - sh) / 2));
        ctx!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas!.width, canvas!.height);
      } else {
        ctx!.drawImage(image, 0, 0, canvas!.width, canvas!.height);
      }

      lastDrawn = resolved;
      lastFocusKey = focusKey;
    }

    function setPoster(visible: boolean) {
      if (posterShown === visible) return;
      posterShown = visible;
      if (posterRef.current) posterRef.current.dataset.hidden = String(!visible);
    }

    /* ---- carga ---- */
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
      const spread = Array.from({ length: 12 }, (_, i) => Math.round((i / 11) * (FRAME_COUNT - 1)));
      const critical = Array.from(
        new Set([...spread, ...CHAPTERS.map((c) => Math.round(c.filmCenter * (FRAME_COUNT - 1)))]),
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

      // Salida del hero: una sola var CSS por frame, composite-only.
      const heroExit = smoothstep(HERO_HOLD, HERO_EXIT, effective);
      if (Math.abs(heroExit - lastHeroExit) > 0.001) {
        lastHeroExit = heroExit;
        stage!.style.setProperty("--pf-hero-exit", heroExit.toFixed(4));
      }
      const off = heroExit >= 0.999;
      if (off !== heroOff) {
        heroOff = off;
        stage!.dataset.pfHeroOff = String(off);
      }

      // Rail CTA: aparece cuando el titular ya salió, se retira cerca del outro.
      const wantRail = off && effective < 0.94;
      if (wantRail !== railShown) {
        railShown = wantRail;
        setRailVisible(wantRail);
      }

      // Película: el tramo [HERO_EXIT, 1] mapea a los 96 cuadros.
      const filmProgress = Math.max(0, Math.min(1, (effective - HERO_EXIT) / (1 - HERO_EXIT)));
      const target = Math.round(filmProgress * (FRAME_COUNT - 1));
      currentFrame += (target - currentFrame) * LERP_FACTOR;

      // Handoff póster→canvas: el póster (cuadro 23, la imagen de marketing)
      // sostiene el hero; el film toma al salir y lo devuelve al regresar.
      setPoster(effective < HERO_HOLD || lastDrawn < 0);

      let nearestIndex = 0;
      let nearest = Infinity;
      CHAPTER_CENTERS.forEach((center, i) => {
        const distance = Math.abs(effective - center);
        if (distance < nearest) {
          nearest = distance;
          nearestIndex = i;
        }
        const node = captionRefs.current[i];
        if (node) {
          const visible = distance <= CHAPTER_WINDOW;
          if ((node.dataset.on === "true") !== visible) {
            node.dataset.on = String(visible);
            if (visible) {
              const chapter = CHAPTERS[i]!.key;
              trackAnonymousEventOnce(`landing_film_chapter:${chapter}`, "landing_film_chapter", { chapter });
            }
          }
        }
      });

      if (activeChapter !== nearestIndex) {
        activeChapter = nearestIndex;
        focus = [...CHAPTERS[nearestIndex]!.focus];
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

    // "Ver el recorrido": scroll programático al centro del primer capítulo.
    scrollToChapterRef.current = (index: number) => {
      const center = CHAPTER_CENTERS[index] ?? CHAPTER_CENTERS[0]!;
      const raw = rawAt[Math.round(center * LUT_SIZE)]!;
      const rect = track!.getBoundingClientRect();
      const trackTop = window.scrollY + rect.top;
      const distance = Math.max(1, rect.height - window.innerHeight);
      window.scrollTo({ top: trackTop + raw * distance, behavior: "smooth" });
    };

    resize();

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
      scrollToChapterRef.current = null;
      delete section.dataset.pfLive;
    };
  }, [hydrated]);

  const onSecondaryCta = () => {
    if (scrollToChapterRef.current) {
      scrollToChapterRef.current(0);
      return;
    }
    // Modo estático: las leyendas son la versión lineal del recorrido.
    captionsRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <section
      id="producto"
      className="lp-hero-section pf-section"
      aria-labelledby="hero-title"
      ref={sectionRef}
    >
      <style dangerouslySetInnerHTML={{ __html: HERO_FILM_STYLES }} />

      <div className="pf-track" ref={trackRef}>
        <div className="pf-stage" ref={stageRef}>
          <div className="lp-hero-shell lp-section-inner pf-hero-inner">
            <div className="lp-hero-grid pf-hero-grid">
              <div className="lp-hero-content pf-hero-copy-layer">
                <span className="lp-section-label" style={{ marginBottom: 18, color: "var(--accent)" }}>
                  {t.eyebrow}
                </span>
                <h1
                  className="lp-hero-title"
                  id="hero-title"
                  style={{
                    fontSize: "clamp(36px, 4.6vw, 60px)",
                    fontWeight: 600,
                    letterSpacing: "-0.015em",
                    lineHeight: 1,
                    margin: 0,
                    color: "var(--page-fg)",
                  }}
                >
                  {t.titlePart1}
                  <br />
                  <span style={{ position: "relative", whiteSpace: "nowrap" }}>
                    {t.titleEmphasis}
                    <svg
                      viewBox="0 0 200 14"
                      preserveAspectRatio="none"
                      style={{ position: "absolute", bottom: "-0.06em", left: 0, width: "100%", height: "0.18em" }}
                      aria-hidden="true"
                    >
                      <path d="M2 8 Q 50 2, 100 7 T 198 6" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />
                    </svg>
                  </span>
                  {t.titlePart2}
                </h1>

                <p
                  className="lp-hero-copy"
                  style={{ fontSize: 17, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 20, maxWidth: 560 }}
                >
                  {t.subtitle}
                </p>

                <div className="lp-hero-actions" style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
                  <Link
                    to={primaryTarget}
                    onClick={() => onPrimaryCta()}
                    className="lp-cta-fill"
                    style={{
                      background: "var(--invert-ink-bg)",
                      color: "var(--invert-ink-fg)",
                      padding: "14px 22px",
                      borderRadius: 10,
                      fontWeight: 600,
                      fontSize: 14,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span>{primaryCtaLabel}</span>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                      <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <button
                    type="button"
                    onClick={onSecondaryCta}
                    className="lp-cta-fill pf-enter"
                    style={{
                      background: "var(--surface)",
                      color: "var(--page-fg)",
                      padding: "14px 22px",
                      borderRadius: 10,
                      fontWeight: 500,
                      fontSize: 14,
                      border: "0.5px solid var(--hairline-color)",
                      cursor: "pointer",
                    }}
                  >
                    <span>{t.ctaSecondary}</span>
                  </button>
                </div>

                <p
                  className="lp-hero-pricing"
                  style={{
                    marginTop: 16,
                    fontSize: 13,
                    color: "var(--text-muted)",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "var(--surface)",
                      border: "0.5px solid var(--hairline-color)",
                      fontWeight: 600,
                      color: "var(--page-fg)",
                    }}
                  >
                    {STANDARD_PLAN_PRICE_LABEL_ES}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--page-fg)" }}>{t.dailyNote}</span>
                  <span>{t.trialBadge}</span>
                </p>
              </div>

              <div className="lp-hero-visual pf-visual" ref={visualRef}>
                <figure className="lp-hero-frame pf-frame">
                  <div className="lp-hero-frame-bar">
                    <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                      <span className="pf-dot" style={{ background: "#FF5F57" }} />
                      <span className="pf-dot" style={{ background: "#FEBC2E" }} />
                      <span className="pf-dot" style={{ background: "#28C840" }} />
                    </span>
                    <span className="lp-hero-frame-url">{copy.landing.showcase.urlBar}</span>
                    <span style={{ width: 44, flexShrink: 0 }} />
                  </div>
                  <div className="pf-plate">
                    <picture>
                      <source media="(max-width: 860px)" srcSet={POSTER_NARROW} />
                      <img
                        className="pf-poster"
                        ref={posterRef}
                        src={POSTER_WIDE}
                        alt={f.posterAlt}
                        width={1280}
                        height={716}
                        decoding="async"
                        // React 18 no tipa fetchPriority; en minúsculas pasa
                        // como atributo HTML real (el preload del prerender es
                        // quien gana el LCP; esto refuerza en navegación SPA).
                        {...({ fetchpriority: "high" } as Record<string, string>)}
                      />
                    </picture>
                    <canvas className="pf-canvas" ref={canvasRef} aria-hidden="true" />
                  </div>
                  <figcaption className="lp-hero-capture-label">{f.captureLabel}</figcaption>
                </figure>
              </div>
            </div>
          </div>

          <div className="pf-captions" ref={captionsRef}>
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

          {railVisible ? (
            <Link
              to={primaryTarget}
              onClick={() => onPrimaryCta({ placement: "rail" })}
              className="pf-mini-cta"
            >
              {primaryCtaLabel}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="lp-section-inner pf-outro">
        <p className="pf-note">{f.note}</p>
        <Link to={ctaTarget} onClick={onShowcaseCta} className="pf-cta">
          {copy.landing.showcase.ctaButton}
        </Link>
      </div>
    </section>
  );
}

const HERO_FILM_STYLES = `
/* ============================== ESTÁTICO (default) ==============================
   Prerender, no-JS, reduced-motion y jsdom ven esto: un hero clásico completo.
   El modo cinemático es opt-in vía [data-pf-live]. */

.pf-section { padding: 0; border-top: none; }

.pf-track { position: relative; }

.pf-stage { position: relative; background: var(--page-bg); }

.pf-hero-inner { padding: 74px 32px 40px; }

.pf-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.05fr);
  gap: 52px;
  align-items: center;
}

.pf-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }

.pf-plate {
  position: relative;
  aspect-ratio: 1280 / 716;
  overflow: hidden;
  background: #101118;
}

.pf-poster {
  position: absolute;
  inset: 0;
  /* Sobre el canvas: el póster (cuadro 23, el carrito en $120) es la imagen
     de marketing del hero; el canvas vive debajo y toma al salir del hero. */
  z-index: 2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 300ms ease;
}

.pf-poster[data-hidden="true"] { opacity: 0; }

.pf-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Estático: sin canvas ni rail; las leyendas son una lista de features. */
.pf-canvas { display: none; }
.pf-rail { display: none; }

.pf-captions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 28px;
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 32px 8px;
}

.pf-caption-eyebrow {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--kova-blue-light, #7ba7ff);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.pf-caption-title {
  margin: 0;
  color: var(--page-fg);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -.015em;
  line-height: 1.2;
}

.pf-caption-line {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 14.5px;
  line-height: 1.5;
}

.pf-outro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 28px;
  padding-bottom: 56px;
}

.pf-note { margin: 0; max-width: 44ch; color: var(--text-muted); font-size: 14px; }

.pf-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 999px;
  background: var(--invert-ink-bg);
  color: var(--invert-ink-fg);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 200ms var(--kova-ease-entrance), opacity 200ms ease;
}

.pf-cta:hover { transform: translateY(-1px); opacity: .92; }

/* ============================== LIVE (post-hidratación) ========================= */

[data-pf-live="true"] .pf-track { height: ${TRACK_VH_WIDE}vh; }

[data-pf-live="true"] .pf-stage {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: hidden;
}

[data-pf-live="true"] .pf-hero-inner {
  height: 100%;
  display: grid;
  align-content: center;
  padding-top: 84px;
  padding-bottom: 48px;
}

[data-pf-live="true"] .pf-canvas { display: block; }
[data-pf-live="true"] .pf-rail { display: block; }

/* Salida del hero: interpolada por --pf-hero-exit, composite-only. */
[data-pf-live="true"] .pf-hero-copy-layer {
  opacity: calc(1 - var(--pf-hero-exit, 0));
  transform: translateY(calc(var(--pf-hero-exit, 0) * -44px));
  will-change: opacity, transform;
}

[data-pf-live="true"] [data-pf-hero-off="true"] .pf-hero-copy-layer {
  visibility: hidden;
  pointer-events: none;
}

/* El visual viaja del slot del hero al centro del escenario (FLIP). */
[data-pf-live="true"] .pf-visual {
  transform:
    translate(
      calc(var(--pf-hero-exit, 0) * var(--pf-flip-dx, 0px)),
      calc(var(--pf-hero-exit, 0) * var(--pf-flip-dy, 0px))
    )
    scale(calc(1 + var(--pf-hero-exit, 0) * (var(--pf-flip-scale, 1) - 1)));
  will-change: transform;
}

/* El marco browser-chrome se disuelve al entrar al producto. */
[data-pf-live="true"] .pf-frame { transition: none; }
[data-pf-live="true"] .lp-hero-frame-bar,
[data-pf-live="true"] .lp-hero-capture-label {
  opacity: calc(1 - var(--pf-hero-exit, 0));
}

[data-pf-live="true"] .pf-captions {
  position: absolute;
  inset: var(--pf-plate-y, 62%) 0 0;
  display: grid;
  grid-template-columns: none;
  max-width: none;
  margin: 0;
  padding: clamp(18px, 2.4vw, 34px) clamp(20px, 5vw, 72px) 60px;
  pointer-events: none;
}

[data-pf-live="true"] .pf-caption {
  grid-area: 1 / 1;
  align-self: center;
  max-width: 44rem;
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 420ms ease, transform 420ms var(--kova-ease-entrance);
}

[data-pf-live="true"] .pf-caption[data-on="true"] { opacity: 1; transform: none; }

[data-pf-live="true"] .pf-caption-title {
  font-size: clamp(22px, 2.4vw, 32px);
  font-weight: 700;
}

.pf-rail {
  position: absolute;
  left: clamp(20px, 5vw, 72px);
  right: clamp(20px, 5vw, 72px);
  bottom: 26px;
  height: 1px;
  background: color-mix(in srgb, var(--page-fg) 18%, transparent);
}

.pf-rail-fill {
  display: block;
  height: 100%;
  background: var(--kova-blue-light, #7ba7ff);
  transform: scaleX(0);
  transform-origin: left;
  will-change: transform;
}

.pf-mini-cta {
  position: absolute;
  right: clamp(20px, 5vw, 72px);
  bottom: 48px;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--invert-ink-bg);
  color: var(--invert-ink-fg);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 10px 30px -12px rgba(0, 0, 0, .6);
  animation: pf-mini-in 320ms var(--kova-ease-entrance) both;
}

@keyframes pf-mini-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

/* ============================== ANGOSTO ========================================= */

@media (max-width: 900px) {
  .pf-hero-grid { grid-template-columns: 1fr; gap: 28px; }
  .pf-hero-inner { padding: 24px 24px 32px; }
}

@media (max-width: 860px) {
  /* El plate angosto usa el recorte focal (caja) como el canvas. */
  .pf-plate { aspect-ratio: 1.25; }
  .pf-poster { object-fit: cover; object-position: 81% 32%; }

  [data-pf-live="true"] .pf-track { height: ${TRACK_VH_NARROW}vh; }
  [data-pf-live="true"] .pf-hero-inner {
    align-content: start;
    padding-top: 72px;
    overflow: hidden;
  }
  [data-pf-live="true"] .pf-captions {
    padding: 16px 20px 56px;
  }
  [data-pf-live="true"] .pf-caption-title { font-size: clamp(19px, 5.4vw, 26px); }

  .pf-mini-cta {
    left: 20px;
    right: 20px;
    bottom: 44px;
    justify-content: center;
  }

  .pf-captions { padding: 16px 24px 8px; }
}

@media (max-width: 640px) {
  .pf-hero-inner { padding: 18px 20px 28px; }
  .pf-outro { padding-bottom: 44px; }
}

/* ====================== COMPOSICIÓN ESTÁTICA (append-only) ====================== */
/* Índice de capítulos del modo estático: numera las leyendas como un índice de
   film (01 —, 02 —…). Solo presentación del fold sin scrub — en modo live los
   overlays del film quedan limpios. Ninguna regla del engine se modifica. */
.pf-captions { counter-reset: pf-ch; }
.pf-caption { counter-increment: pf-ch; }
.pf-caption-eyebrow::before {
  content: "0" counter(pf-ch) " — ";
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}
[data-pf-live="true"] .pf-caption-eyebrow::before { content: none; }
`;
