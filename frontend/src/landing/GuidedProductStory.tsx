// El corazón de la landing (brief §1.2/§2.3): la venta de $186 contada en
// 4 estados — POS → Inventario → Caja → Reportes — con el producto mismo.
// Desktop: riel tablist + stage con auto-avance (se pausa con hover/focus,
// muere al primer click, no existe con prefers-reduced-motion).
// Mobile (≤900px): 4 cards apiladas, micro disparada al entrar al viewport.
import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { copy } from "@/i18n/messages";
import CashRegisterPreview from "@/landing/previews/CashRegisterPreview";
import InventoryStatePreview from "@/landing/previews/InventoryStatePreview";
import ReportsPreview from "@/landing/previews/ReportsPreview";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
import { usePrefersReducedMotion } from "@/landing/previews/useCountUp";

const t = copy.landing.story;
const STEP_MS = 6000;

const STEP_PREVIEWS: Array<{ id: string; render: (animate: boolean) => ReactNode }> = [
  { id: "pos", render: (animate) => <SweetHomePOSPreview interactive={false} animateEntry={animate} /> },
  { id: "inventory", render: (animate) => <InventoryStatePreview animate={animate} /> },
  { id: "cash", render: (animate) => <CashRegisterPreview animate={animate} /> },
  { id: "reports", render: (animate) => <ReportsPreview animate={animate} /> },
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

function useInViewOnce<T extends HTMLElement>(threshold = 0.3): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function StoryCard({ index }: { index: number }) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  const step = t.steps[index];
  return (
    <div ref={ref} className="lp-story-card" data-lp-anim={inView ? "on" : "off"}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span
          className="tabular"
          aria-hidden="true"
          style={{
            width: 22, height: 22, borderRadius: 999, flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 600,
            alignSelf: "center",
          }}
        >
          {index + 1}
        </span>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--page-fg)" }}>{step.title}</h3>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{step.line}</p>
        </div>
      </div>
      {STEP_PREVIEWS[index].render(inView)}
      <p style={{ margin: "12px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{step.callout}</p>
    </div>
  );
}

export default function GuidedProductStory() {
  const reduceMotion = usePrefersReducedMotion();
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [sectionRef, sectionInView] = useInViewOnce<HTMLElement>(0.25);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const autoplayEnabled = autoplay && !reduceMotion && !isMobile && sectionInView;

  useEffect(() => {
    if (!autoplayEnabled || paused) return;
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % t.steps.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [autoplayEnabled, paused, cycle]);

  const select = (index: number) => {
    setAutoplay(false);
    setActive(index);
  };

  const resume = () => {
    setPaused(false);
    setCycle((c) => c + 1); // reinicia barra de progreso e intervalo juntos
  };

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = t.steps.length;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (active + 1) % count;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (active + count - 1) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next !== null) {
      event.preventDefault();
      select(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <section
      id="producto"
      ref={sectionRef}
      className="lp-section lp-reveal-block"
      style={{ background: "var(--surface)", borderBottom: "0.5px solid var(--hairline-color)" }}
    >
      <div className="lp-section-inner">
        <h2 className="lp-section-label" style={{ marginBottom: 0 }}>{t.kicker}</h2>

        {isMobile ? (
          <div className="lp-story-mobile">
            {t.steps.map((_, i) => (
              <StoryCard key={STEP_PREVIEWS[i].id} index={i} />
            ))}
          </div>
        ) : (
          <div
            className="lp-story-grid"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={resume}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={resume}
            onPointerDownCapture={() => setAutoplay(false)}
          >
            <div role="tablist" aria-label={t.kicker} aria-orientation="vertical" className="lp-story-rail" onKeyDown={onTablistKeyDown}>
              {t.steps.map((step, i) => (
                <button
                  key={STEP_PREVIEWS[i].id}
                  type="button"
                  role="tab"
                  id={`lp-story-tab-${i}`}
                  aria-selected={active === i}
                  aria-controls={`lp-story-panel-${i}`}
                  tabIndex={active === i ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  onClick={() => select(i)}
                  className="lp-story-tab"
                  data-active={active === i ? "1" : "0"}
                >
                  <span className="lp-story-tab-num tabular" aria-hidden="true">{i + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong>{step.title}</strong>
                    <span className="lp-story-tab-line">{step.line}</span>
                  </span>
                  {autoplayEnabled && active === i && (
                    <span key={`progress-${i}-${cycle}`} className="lp-story-progress" data-paused={paused ? "1" : "0"} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>

            <div className="lp-story-stage">
              <div
                key={active}
                id={`lp-story-panel-${active}`}
                role="tabpanel"
                aria-labelledby={`lp-story-tab-${active}`}
                className="lp-story-panel"
                data-lp-anim="on"
              >
                {STEP_PREVIEWS[active].render(true)}
                <span className="lp-story-callout lp-story-fade" style={{ ["--lp-fade-delay" as string]: "650ms" }}>
                  {t.steps[active].callout}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
