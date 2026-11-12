// Recorrido del producto (#producto): sustituye al video narrado. La demo local
// de Caja es interactiva (no registra ventas) y los otros tres pasos muestran el
// efecto de esa misma venta de $186 con los componentes visuales de Kova.
//
// Avanza solo mientras está en pantalla; se pausa con hover o foco, se detiene
// en cuanto la persona elige un paso y no se mueve con prefers-reduced-motion.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Pause, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { prefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import SweetHomeRegisterDemo from "./demo/SweetHomeRegisterDemo";
import {
  REGISTER_DEMO_TOTAL,
  TOUR_INVENTORY,
  TOUR_SHIFT,
  demoProduct,
} from "./demo/registerDemoCatalog";
import { SWEET_HOME_REPORTS } from "./demo/sweetHome";
import styles from "./ProductTour.module.css";

export type LandingStoryStepId = "sale" | "inventory" | "cash" | "reports";
export type LandingStoryTrigger = "scroll" | "control";

const t = copy.landing.tour;
const STEP_MS = 7000;
const STEP_IDS = t.steps.map((step) => step.id as LandingStoryStepId);

function InventoryScene() {
  const c = t.inventory;
  const low = TOUR_INVENTORY.filter((item) => item.after <= item.threshold).length;
  return (
    <Card className={`${styles.scene} overflow-hidden`}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b p-4">
        <CardTitle className="text-base">{c.title}</CardTitle>
        <Badge variant="destructive" className={styles.pop}>{low} {c.lowStock.toLowerCase()}</Badge>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {TOUR_INVENTORY.map((item, index) => {
          const product = demoProduct(item.id);
          const sold = item.before - item.after;
          const isLow = item.after <= item.threshold;
          return (
            <div key={item.id} className={`${styles.row} flex items-center gap-3 px-4 py-3`} style={{ ["--i" as string]: index }}>
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                {product.image ? <img src={product.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">{c.threshold(item.threshold)}</p>
              </div>
              {sold > 0 ? <span className={`${styles.pop} rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive`}>{c.sold(sold)}</span> : null}
              {isLow ? <Badge variant="outline" className="border-destructive/40 text-destructive">{c.lowStock}</Badge> : null}
              <span className="w-16 text-right">
                <strong className={`${styles.tick} block text-lg tabular-nums`} data-changed={sold > 0 ? "true" : undefined}>{item.after}</strong>
                <span className="text-[11px] text-muted-foreground">{c.unit}</span>
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ShiftScene() {
  const c = t.shift;
  const s = TOUR_SHIFT;
  const cashSales = s.cashSalesBefore + REGISTER_DEMO_TOTAL;
  const expected = s.openingCash + cashSales - s.outflows;
  const tiles = [
    { label: c.openingCash, value: formatMoney(s.openingCash) },
    { label: c.cashSales, value: formatMoney(cashSales) },
    { label: c.outflows, value: `−${formatMoney(s.outflows)}` },
  ];
  return (
    <Card className={`${styles.scene} overflow-hidden`}>
      <CardHeader className="border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{c.title}</CardTitle>
          <Badge className={styles.okBadge}>{c.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{c.since(s.employee, s.openedAt)}</p>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((tile, index) => (
            <div key={tile.label} className={`${styles.row} rounded-lg border p-3`} style={{ ["--i" as string]: index }}>
              <p className="text-[11px] text-muted-foreground">{tile.label}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{tile.value}</p>
            </div>
          ))}
          <div className={`${styles.row} ${styles.glow} rounded-lg border border-primary/40 bg-primary/10 p-3`} style={{ ["--i" as string]: 3 }}>
            <p className="text-[11px] font-medium text-primary">{c.expected}</p>
            <p className={`${styles.tick} mt-1 text-base font-bold tabular-nums text-primary`} data-changed="true">{formatMoney(expected)}</p>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{c.movements}</p>
          <ul className="divide-y rounded-lg border">
            <li className={`${styles.newRow} flex items-center gap-3 px-3 py-2.5`}>
              <ArrowUp className="h-4 w-4 text-kova-growth" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium">{c.newSale}</span>
              <span className="text-xs text-muted-foreground">{s.saleTime}</span>
              <span className="w-20 text-right text-sm font-semibold tabular-nums text-kova-growth">+{formatMoney(REGISTER_DEMO_TOTAL)}</span>
            </li>
            {s.movements.map((movement) => (
              <li key={movement.label + movement.time} className="flex items-center gap-3 px-3 py-2.5">
                {movement.amount < 0
                  ? <ArrowDown className="h-4 w-4 text-destructive" aria-hidden="true" />
                  : <ArrowUp className="h-4 w-4 text-kova-growth" aria-hidden="true" />}
                <span className="flex-1 text-sm">{movement.label}</span>
                <span className="text-xs text-muted-foreground">{movement.time}</span>
                <span className="w-20 text-right text-sm tabular-nums">{movement.amount < 0 ? "−" : "+"}{formatMoney(Math.abs(movement.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportsScene() {
  const c = t.reports;
  const r = SWEET_HOME_REPORTS;
  const kpis = [
    { label: c.orders, value: String(r.orders) },
    { label: c.avgTicket, value: formatMoney(r.avgTicket) },
  ];
  return (
    <Card className={`${styles.scene} overflow-hidden`}>
      <CardHeader className="border-b p-4">
        <CardTitle className="text-base">{c.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3">
          <div className={`${styles.row} rounded-lg border p-3`} style={{ ["--i" as string]: 0 }}>
            <p className="text-[11px] text-muted-foreground">{c.netSales}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{formatMoney(r.netSales)}</span>
              <span className={`${styles.pop} rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles.okPill}`}>{c.vsYesterday(r.deltaVsYesterdayPct)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {kpis.map((kpi, index) => (
              <div key={kpi.label} className={`${styles.row} rounded-lg border p-3`} style={{ ["--i" as string]: index + 1 }}>
                <p className="text-[11px] text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{kpi.value}</p>
              </div>
            ))}
          </div>
          <div className={`${styles.row} rounded-lg border p-3`} style={{ ["--i" as string]: 3 }}>
            <p className="text-[11px] text-muted-foreground">{c.payments}</p>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              <span className={`${styles.grow} bg-kova-ink`} style={{ width: `${r.cashSharePct}%` }} />
              <span className={`${styles.grow} bg-primary`} style={{ width: `${r.cardSharePct}%`, ["--i" as string]: 1 }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>{c.cash} {r.cashSharePct}%</span>
              <span>{c.card} {r.cardSharePct}%</span>
            </div>
          </div>
        </div>
        <div className={`${styles.row} rounded-lg border p-3`} style={{ ["--i" as string]: 2 }}>
          <p className="text-[11px] text-muted-foreground">{c.bestHours}</p>
          <p className="text-sm font-semibold">{r.bestHoursLabel}</p>
          <div className="mt-3 flex h-32 items-end gap-1.5" aria-hidden="true">
            {r.hourly.map((bar, index) => (
              <div key={bar.label} className="flex h-full flex-1 flex-col justify-end gap-1">
                <span
                  className={`${styles.bar} block rounded-t ${bar.best ? "bg-primary" : "bg-muted-foreground/25"}`}
                  style={{ height: `${bar.pct}%`, ["--i" as string]: index }}
                />
                <span className="text-center text-[9px] text-muted-foreground">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductTour({
  primaryTarget,
  onCtaClick,
  onStepView,
}: {
  primaryTarget: string;
  onCtaClick: () => void;
  onStepView: (step: LandingStoryStepId, trigger: LandingStoryTrigger) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tablistRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [held, setHeld] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const running = autoplay && inView && !held && !reduceMotion;

  useEffect(() => {
    setReduceMotion(prefersReducedMotion());
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      onStepView("sale", "scroll");
      return;
    }
    let tracked = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && (entry.intersectionRatio ?? 1) >= 0.3;
        setInView(visible);
        if (visible && !tracked) {
          tracked = true;
          onStepView("sale", "scroll");
        }
      },
      { threshold: [0, 0.3, 0.6] },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [onStepView]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      const next = (active + 1) % STEP_IDS.length;
      setActive(next);
      onStepView(STEP_IDS[next], "scroll");
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, running, onStepView]);

  // En móvil las pestañas son un carrusel horizontal: lleva la activa a la
  // vista desplazando solo el carrusel, nunca la página.
  useEffect(() => {
    const list = tablistRef.current;
    const tab = tabRefs.current[active];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - 16;
    list.scrollTo?.({ left, behavior: reduceMotion ? "auto" : "smooth" });
  }, [active, reduceMotion]);

  const select = useCallback(
    (index: number, focus = false) => {
      setAutoplay(false);
      setActive(index);
      onStepView(STEP_IDS[index], "control");
      if (focus) tabRefs.current[index]?.focus();
    },
    [onStepView],
  );

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = STEP_IDS.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
          : event.key === "Home" ? 0
            : event.key === "End" ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <section
      id="producto"
      ref={sectionRef}
      className={styles.section}
      aria-labelledby="tour-title"
      data-running={running ? "true" : undefined}
    >
      <div className={styles.inner}>
        <div className={styles.heading} data-lp-stagger-group>
          <h2 id="tour-title" className={styles.title} data-lp-stagger-item>{t.title}</h2>
          <p className={styles.lead} data-lp-stagger-item>{t.body}</p>
        </div>

        <div
          className={styles.layout}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
          }}
        >
          <div className={styles.rail}>
            <div ref={tablistRef} role="tablist" aria-label={t.tablistLabel} className={styles.tabs}>
              {t.steps.map((step, index) => {
                const selected = index === active;
                return (
                  <button
                    key={step.id}
                    ref={(node) => { tabRefs.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`tour-tab-${step.id}`}
                    aria-selected={selected}
                    aria-controls={`tour-panel-${step.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={styles.tab}
                    onClick={() => select(index)}
                    onKeyDown={(event) => onTabKey(event, index)}
                  >
                    <span className={styles.tabIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.tabText}>
                      <strong>{step.title}</strong>
                      <span>{step.line}</span>
                    </span>
                    {selected && running ? (
                      <span key={`progress-${active}`} className={styles.progress} style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {!reduceMotion ? (
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setAutoplay((value) => !value)}
              >
                {autoplay ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                <span>{autoplay ? t.pause : t.play}</span>
              </button>
            ) : null}
          </div>

          <div className={styles.stage} data-lp-reveal-opt data-lp-reveal-variant="frame">
            <div className={styles.window}>
              <div className={styles.windowBar}>
                <picture>
                  <source srcSet="/customers/sweet-home.webp" type="image/webp" />
                  <img src="/customers/sweet-home.png" alt="" width={28} height={28} className={styles.windowLogo} />
                </picture>
                <span className={styles.windowName}>{copy.landing.sweetHome.shopName}</span>
              </div>
              {t.steps.map((step, index) => (
                <div
                  key={step.id}
                  role="tabpanel"
                  id={`tour-panel-${step.id}`}
                  aria-labelledby={`tour-tab-${step.id}`}
                  hidden={index !== active}
                  className={styles.panel}
                >
                  {index === active ? (
                    <div key={`scene-${active}`} className={styles.sceneWrap}>
                      {step.id === "sale" ? <SweetHomeRegisterDemo dense autoPlay={autoplay && inView && !reduceMotion} />
                        : step.id === "inventory" ? <InventoryScene />
                          : step.id === "cash" ? <ShiftScene />
                            : <ReportsScene />}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <p className={styles.note}>{t.demoNote}</p>
          <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
            {t.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
