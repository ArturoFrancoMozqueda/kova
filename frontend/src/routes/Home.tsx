import { useEffect, useRef, useState, SVGProps } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import IntroAnimation from "@/components/brand/IntroAnimation";
import Logo from "@/components/brand/Logo";

/* ─── Landing-scoped CSS ─────────────────────────────────────────────────── */
const LANDING_STYLES = `
  .lp-root {
    font-family: 'Geist', 'Inter', ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .lp-grain::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    opacity: .035; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>");
  }
  .lp-hairline { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
  .lp-hairline-strong { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10); }
  .lp-glow-radial {
    /* Kova hero glow. Applied at 12% per Phase 3 instinct (kept subtle so it
     * complements the IntroAnimation below without competing). If validation
     * shows it reads as too weak, swap to the 18% variant commented below.
     *   Version B (presente, 18%):
     *     radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--kova-blue) 18%, transparent) 0%, transparent 60%),
     */
    background:
      radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--kova-blue) 12%, transparent) 0%, transparent 60%),
      radial-gradient(40% 30% at 20% 30%, rgba(255,255,255,0.04) 0%, transparent 60%);
  }
  .lp-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent); }
  .lp-dotgrid {
    background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
    background-size: 22px 22px;
  }

  /* breathe */
  @keyframes lp-breathe {
    0%, 100% { opacity: .85; transform: translateY(0) scale(1); }
    50%       { opacity: 1;   transform: translateY(-6px) scale(1.04); }
  }
  .lp-breathe { animation: lp-breathe 11s ease-in-out infinite; will-change: transform, opacity; }

  /* float */
  @keyframes lp-float {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-4px); }
  }
  .lp-float { animation: lp-float 9s ease-in-out infinite; will-change: transform; }

  /* sync dot ping */
  @keyframes lp-ping {
    0%   { transform: scale(1);   opacity: .6; }
    80%  { transform: scale(2.4); opacity: 0; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  .lp-sync-dot { position: relative; }
  .lp-sync-dot::after {
    content: ""; position: absolute; inset: 0; border-radius: 9999px;
    background: currentColor;
    animation: lp-ping 2.4s cubic-bezier(0,0,.2,1) infinite;
  }

  /* button shimmer sweep */
  .lp-btn-accent { position: relative; overflow: hidden; }
  .lp-btn-accent::before {
    content: ""; position: absolute; inset: 0; z-index: 0;
    background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%);
    transform: translateX(-120%);
    transition: transform .9s cubic-bezier(.2,.7,.2,1);
    pointer-events: none;
  }
  .lp-btn-accent:hover::before { transform: translateX(120%); }
  .lp-btn-accent > * { position: relative; z-index: 1; }

  /* logo draw + pulse */
  @keyframes lp-logo-draw {
    from { stroke-dashoffset: 64; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes lp-logo-pulse {
    0%, 92%, 100% { filter: drop-shadow(0 0 0 transparent); }
    95%            { filter: drop-shadow(0 0 6px rgba(245,177,74,0.7)); }
  }
  .lp-logo-path {
    stroke-dasharray: 64; stroke-dashoffset: 64;
    animation:
      lp-logo-draw 1.1s cubic-bezier(.2,.7,.2,1) .15s forwards,
      lp-logo-pulse 6s ease-in-out 1.5s infinite;
  }

  /* word rise */
  @keyframes lp-word-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .lp-word  { display: inline-block; opacity: 0; animation: lp-word-rise .85s cubic-bezier(.2,.7,.2,1) forwards; }
  .lp-rise  { opacity: 0; animation: lp-word-rise .85s cubic-bezier(.2,.7,.2,1) forwards; }
  .lp-rise-in { animation: lp-word-rise .55s cubic-bezier(.2,.7,.2,1) both; }

  /* scroll reveal */
  .lp-reveal { opacity: 0; transform: translateY(14px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
  .lp-reveal.in { opacity: 1; transform: none; }

  /* card hover lift */
  .lp-card-lift { transition: transform .25s ease, background-color .25s ease, box-shadow .25s ease; }
  .lp-card-lift:hover { transform: translateY(-2px); background-color: rgba(255,255,255,0.025) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10), 0 20px 50px -20px rgba(0,0,0,.6); }

  /* border travel on hover (Linear-style) */
  @property --lp-ang { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
  @keyframes lp-border-spin { to { --lp-ang: 360deg; } }
  .lp-border-travel { position: relative; isolation: isolate; }
  .lp-border-travel::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
    background: conic-gradient(from var(--lp-ang), transparent 0deg, var(--lp-accent) 40deg, transparent 90deg, transparent 360deg);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    opacity: 0; transition: opacity .35s ease; pointer-events: none;
  }
  .lp-border-travel:hover::before { opacity: .9; animation: lp-border-spin 4s linear infinite; }

  /* feature row icon hover */
  .lp-feat-row .lp-feat-ico { transition: background .35s ease, box-shadow .35s ease, transform .35s ease; }
  .lp-feat-row:hover .lp-feat-ico {
    background: var(--lp-accent-soft) !important;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 30%, transparent) !important;
    transform: translateY(-1px);
  }

  /* step circle pop */
  @keyframes lp-step-pop {
    from { transform: scale(.6); opacity: 0; }
    to   { transform: scale(1);  opacity: 1; }
  }
  .lp-reveal.in .lp-step-circle { animation: lp-step-pop .7s cubic-bezier(.2,.9,.2,1.1) forwards; }
  .lp-step-circle { transform: scale(.6); opacity: 0; }

  /* timeline line draw */
  .lp-timeline-line { transform-origin: left center; transform: scaleX(0); transition: transform 1.4s cubic-bezier(.2,.7,.2,1) .1s; }
  .lp-timeline.in .lp-timeline-line { transform: scaleX(1); }

  /* POS cart: added item pulse */
  @keyframes lp-added-pulse {
    0%   { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 70%, transparent), 0 0 0 0 color-mix(in oklab, var(--lp-accent) 40%, transparent); }
    100% { box-shadow: inset 0 0 0 1px transparent, 0 0 0 12px transparent; }
  }
  .lp-added { animation: lp-added-pulse 1.6s ease-out; }

  /* POS cart: total digit roll */
  @keyframes lp-digit-bump {
    0%   { transform: translateY(0); }
    50%  { transform: translateY(-2px); }
    100% { transform: translateY(0); }
  }
  .lp-digit-bump { animation: lp-digit-bump .35s ease; }

  /* reduce motion */
  @media (prefers-reduced-motion: reduce) {
    .lp-breathe, .lp-float, .lp-sync-dot::after,
    .lp-added, .lp-digit-bump { animation: none !important; transition: none !important; }
    .lp-reveal { opacity: 1; transform: none; }
    .lp-step-circle { opacity: 1; transform: none; }
    .lp-timeline-line { transform: scaleX(1); }
    .lp-logo-path { stroke-dashoffset: 0; animation: none; }
    .lp-word, .lp-rise { opacity: 1; animation: none; }
  }
`;

/* ─── useReveal ──────────────────────────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = document.querySelectorAll(".lp-reveal");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.12 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/* ─── CountUp ────────────────────────────────────────────────────────────── */
interface CountUpProps {
  to: number;
  duration?: number;
  prefix?: string;
}
function CountUp({ to, duration = 1100, prefix = "" }: CountUpProps) {
  const hasIO = typeof IntersectionObserver !== "undefined";
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(hasIO ? 0 : to);
  const started = useRef(false);
  useEffect(() => {
    if (!hasIO) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const t0 = performance.now();
            const tick = (now: number) => {
              const p = Math.min(1, (now - t0) / duration);
              setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        });
      },
      { threshold: 0.4 },
    );
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [to, duration]);
  return <span ref={ref}>{prefix + v}</span>;
}

/* ─── SplitWords ─────────────────────────────────────────────────────────── */
function SplitWords({ text, baseDelay = 0, step = 70 }: { text: string; baseDelay?: number; step?: number }) {
  const parts = String(text).split(/(\s+)/);
  let i = 0;
  return (
    <span>
      {parts.map((p, idx) => {
        if (/^\s+$/.test(p)) return <span key={idx}>{p}</span>;
        const delay = baseDelay + i++ * step;
        return (
          <span key={idx} className="lp-word" style={{ animationDelay: delay + "ms" }}>
            {p}
          </span>
        );
      })}
    </span>
  );
}

/* Inline Logo() removed; navbar now consumes the Kova Logo component. The
 * lp-logo-path / lp-logo-draw / lp-logo-pulse rules in LANDING_STYLES are
 * now dead style declarations; they'll be cleaned up in Phase 6. */

/* ─── Icons ──────────────────────────────────────────────────────────────── */
type IcoProps = SVGProps<SVGSVGElement>;
const Ico = {
  eye:     (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>,
  wifiOff: (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" x2="12.01" y1="20" y2="20"/></svg>,
  tag:     (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.5"/></svg>,
  shield:  (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>,
  check:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5"/></svg>,
  arrow:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>,
  card:    (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>,
  sync:    (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M21 21v-5h-5"/></svg>,
  clock:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  box:     (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>,
  chart:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-5"/></svg>,
  users:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  brush:   (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02Z"/></svg>,
  history: (p: IcoProps) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>,
};

/* ─── PosMockup ──────────────────────────────────────────────────────────── */
const PRODUCTS = [
  { n: "Concha vainilla",  p: 22, c: "#f5b14a" },
  { n: "Concha choco",     p: 22, c: "#8b5a2b" },
  { n: "Cuernito",         p: 28, c: "#e0a96d" },
  { n: "Café americano",   p: 35, c: "#3a2a1a" },
  { n: "Café con leche",   p: 42, c: "#a87650" },
  { n: "Capuchino",        p: 48, c: "#c89d7a" },
  { n: "Agua mineral",     p: 25, c: "#6fb8d4" },
  { n: "Jugo de naranja",  p: 38, c: "#f59a3a" },
];
const BASE_CART = [
  { n: "Concha vainilla", q: 2, p: 22 },
  { n: "Café americano",  q: 1, p: 35 },
  { n: "Cuernito",        q: 1, p: 28 },
];
const ADDITIONS = [
  { n: "Capuchino",       p: 48, prodIdx: 5 },
  { n: "Jugo de naranja", p: 38, prodIdx: 7 },
  { n: "Café con leche",  p: 42, prodIdx: 4 },
];
const CATS = ["Todos", "Pan dulce", "Bebidas", "Café", "Postres", "Salados"];

function PosMockup() {
  const [step, setStep] = useState(0);
  const [bump, setBump] = useState(0);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % (ADDITIONS.length + 1));
      setBump((b) => b + 1);
    }, 3400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (step === 0) { setHighlightIdx(null); return; }
    const add = ADDITIONS[step - 1];
    setHighlightIdx(add.prodIdx);
    const t = setTimeout(() => setHighlightIdx(null), 1500);
    return () => clearTimeout(t);
  }, [step]);

  type CartItem = { n: string; q: number; p: number; added?: boolean };
  const cart: CartItem[] = step === 0
    ? BASE_CART
    : [...BASE_CART, { n: ADDITIONS[step - 1].n, q: 1, p: ADDITIONS[step - 1].p, added: true }];
  const subtotal = cart.reduce((s, i) => s + i.q * i.p, 0);
  const iva = Math.round(subtotal * 0.16);
  const total = subtotal + iva;

  const accentSoft = "rgba(245,177,74,0.14)";
  const accentInk = "#1a1300";

  return (
    <div
      className="rounded-2xl lp-hairline-strong overflow-hidden w-full"
      style={{ background: "linear-gradient(180deg, #101010 0%, #0a0a0a 100%)" }}
    >
      {/* top bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]"
        style={{ background: "rgba(255,255,255,0.015)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {[0,1,2].map((i) => <span key={i} className="w-2.5 h-2.5 rounded-full bg-white/10" />)}
          </div>
          <div className="text-[11px] text-[#7a7a7a] font-mono">
            pulso.app / panadería · turno #214
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#7a7a7a]">
          <span className="flex items-center gap-1.5">
            <span className="lp-sync-dot text-emerald-400 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Sincronizado
          </span>
          <span className="text-[#4a4a4a]">·</span>
          <span>Carolina · Cajera</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_280px] min-h-[440px]">
        {/* catalog */}
        <div className="p-4 border-r border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 lp-hairline"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#7a7a7a]">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <span className="text-[12px] text-[#7a7a7a]">Buscar producto o escanear código…</span>
            </div>
            <button
              className="text-[11px] px-2.5 py-2 rounded-lg text-[#a8a8a8] lp-hairline"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              F2
            </button>
          </div>
          <div className="flex items-center gap-1.5 mb-4 overflow-hidden">
            {CATS.map((c, i) => (
              <span
                key={c}
                className="text-[11px] px-2.5 py-1 rounded-md"
                style={i === 1
                  ? { background: accentSoft, color: "var(--lp-accent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 35%, transparent)" }
                  : { background: "rgba(255,255,255,0.03)", color: "#a8a8a8", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }
                }
              >
                {c}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PRODUCTS.map((prod, i) => (
              <div
                key={prod.n}
                className={`rounded-lg p-2.5 transition-shadow lp-hairline${i === highlightIdx ? " lp-added" : ""}`}
                style={{
                  background: "rgba(255,255,255,0.02)",
                  ...(i === 0 ? { boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 35%, transparent)" } : {}),
                }}
              >
                <div
                  className="aspect-square rounded-md mb-2 relative overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${prod.c}33, ${prod.c}11)` }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-7 h-7 rounded-full" style={{ background: prod.c, opacity: 0.55 }} />
                  </div>
                </div>
                <div className="text-[11px] font-medium leading-tight truncate text-white">{prod.n}</div>
                <div className="text-[11px] text-[#7a7a7a] mt-0.5 font-mono">${prod.p}.00</div>
              </div>
            ))}
          </div>
        </div>

        {/* cart */}
        <div className="flex flex-col">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#7a7a7a] uppercase tracking-wider">Venta actual</div>
              <div className="text-[13px] font-medium mt-0.5 text-white">#0241 · 14:32</div>
            </div>
            <button className="text-[11px] text-[#7a7a7a] hover:text-[#d9d9d9] transition-colors">Limpiar</button>
          </div>
          <div className="flex-1 px-4 py-3 space-y-2.5 overflow-hidden">
            {cart.map((it, idx) => (
              <div key={it.n + idx} className={`flex items-start gap-2${it.added ? " lp-rise-in" : ""}`}>
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-mono text-white lp-hairline"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  {it.q}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate text-white">{it.n}</div>
                  <div className="text-[10.5px] text-[#7a7a7a] font-mono">${it.p}.00 c/u</div>
                </div>
                <div className="text-[12px] font-mono text-white">${(it.q * it.p).toFixed(2)}</div>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-white/[0.06] space-y-1.5">
            <div className="flex justify-between text-[11px] text-[#7a7a7a]">
              <span>Subtotal</span><span className="font-mono">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-[#7a7a7a]">
              <span>IVA 16%</span><span className="font-mono">${iva.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[15px] font-semibold pt-1.5 border-t border-white/[0.06] text-white">
              <span>Total</span>
              <span key={bump} className="font-mono lp-digit-bump">${total.toFixed(2)}</span>
            </div>
            <button
              className="w-full mt-2 rounded-lg py-2.5 text-[13px] font-semibold lp-btn-accent"
              style={{
                background: "var(--lp-accent)", color: accentInk,
                boxShadow: "0 1px 0 rgba(255,255,255,0.35) inset, 0 10px 30px -8px color-mix(in oklab, var(--lp-accent) 60%, transparent)",
              }}
            >
              <span>Cobrar · <span className="opacity-70">F12</span></span>
            </button>
            <div className="grid grid-cols-3 gap-1.5 mt-1.5">
              {["Efectivo", "Transferencia", "Tarjeta"].map((m) => (
                <div
                  key={m}
                  className="text-[10px] text-center py-1.5 rounded-md text-[#a8a8a8] lp-hairline"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// PosMockup is preserved (with its PRODUCTS/BASE_CART/ADDITIONS/CATS) for
// quick revert during the Kova rebrand. Tracked for removal in the Phase 6
// landing cleanup. This void reference keeps `noUnusedLocals` happy without
// reintroducing the mockup into the rendered tree.
void PosMockup;

/* ─── Shared style helpers ───────────────────────────────────────────────── */
const accentBtnStyle = {
  background: "var(--kova-ink)" as const,
  color: "var(--kova-on-ink)" as const,
};

/* ─── Navbar ─────────────────────────────────────────────────────────────── */
function Navbar({ primaryTarget, isAuthenticated }: { primaryTarget: string; isAuthenticated: boolean }) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl border-b border-white/[0.05]" style={{ background: "rgba(7,7,7,0.7)" }}>
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Logo
          variant="horizontal"
          size={22}
          circuitColor="var(--kova-on-ink)"
          wordmarkColor="var(--kova-on-ink)"
          title="kova"
        />
        <nav className="hidden md:flex items-center gap-7 text-[13px] text-[#a8a8a8]">
          <a href="#producto" className="hover:text-white transition-colors">Producto</a>
          <a href="#precio"   className="hover:text-white transition-colors">Precio</a>
          <a href="#soporte"  className="hover:text-white transition-colors">Soporte</a>
        </nav>
        <Link
          to={primaryTarget}
          className="lp-btn-accent text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md"
          style={accentBtnStyle}
        >
          <span>{isAuthenticated ? "Ir al dashboard" : "Empieza gratis"}</span>
        </Link>
      </div>
    </header>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero({ primaryTarget }: { primaryTarget: string }) {
  return (
    <section className="relative overflow-hidden lp-grain">
      <div className="absolute inset-0 lp-glow-radial lp-breathe pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-3xl mx-auto text-center">
          <div
            className="lp-rise inline-flex items-center gap-2 px-3 py-1 rounded-full lp-hairline text-[11.5px] text-[#a8a8a8] mb-6"
            style={{ animationDelay: "0ms", background: "rgba(255,255,255,0.02)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--kova-blue)" }} />
            En beta · $199 MXN/mes · sin contrato
          </div>

          <h1 className="text-[44px] md:text-[68px] leading-[1.02] font-bold tracking-[-0.02em] text-balance text-white">
            <SplitWords text="Tu negocio," baseDelay={120} step={80} />
            <br className="hidden md:block" />
            <SplitWords text="bajo control." baseDelay={360} step={80} />
            <br />
            <span className="text-[#7a7a7a]">
              <SplitWords text="Desde el primer turno." baseDelay={680} step={80} />
            </span>
          </h1>

          <p
            className="mt-6 text-[16px] md:text-[18px] leading-[1.55] text-[#a8a8a8] max-w-2xl mx-auto text-balance lp-rise"
            style={{ animationDelay: "1000ms" }}
          >
            Registra ventas, gestiona tu catálogo, controla tu inventario y conoce tus números reales — desde cualquier dispositivo, aunque no tengas internet.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 lp-rise" style={{ animationDelay: "1150ms" }}>
            <Link
              to={primaryTarget}
              className="lp-btn-accent inline-flex items-center gap-2 px-5 py-3 rounded-lg font-semibold text-[14.5px]"
              style={accentBtnStyle}
            >
              <span className="inline-flex items-center gap-2">
                Empieza gratis 14 días <Ico.arrow width={16} height={16} />
              </span>
            </Link>
            <div className="text-[12.5px] text-[#7a7a7a]">
              $199 MXN/mes · Sin contrato · Cancela cuando quieras
            </div>
          </div>
        </div>

        {/* hero visual — Kova IntroAnimation (embedded, no chrome) */}
        <div className="relative mt-14 md:mt-20 lp-reveal max-w-lg mx-auto">
          <IntroAnimation embedded skippable={false} />
        </div>
      </div>
    </section>
  );
}

/* ─── SocialProof ────────────────────────────────────────────────────────── */
function SocialProof() {
  const items = [
    { icon: <Ico.wifiOff width={14} height={14} />, label: "Modo offline" },
    { icon: <Ico.shield  width={14} height={14} />, label: "Seguro y auditable" },
    { icon: <Ico.tag     width={14} height={14} />, label: "Un solo precio" },
  ];
  return (
    <section className="border-y border-white/[0.05]" style={{ background: "rgba(255,255,255,0.01)" }}>
      <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4 text-[12.5px] text-[#7a7a7a]">
        <div>En beta con negocios reales en México</div>
        <div className="flex items-center gap-6">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-2" style={{ color: "var(--lp-accent)" }}>
              {it.icon}
              <span className="text-[#7a7a7a]">{it.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Why ────────────────────────────────────────────────────────────────── */
function Why() {
  return (
    <section id="producto" className="relative">
      <div className="max-w-3xl mx-auto px-6 py-28 md:py-36 text-center lp-reveal">
        <div className="text-[11px] uppercase tracking-[0.18em] font-medium mb-5" style={{ color: "var(--lp-accent)" }}>
          El porqué
        </div>
        <h2 className="text-[32px] md:text-[44px] leading-[1.1] font-bold tracking-[-0.02em] mb-7 text-white">
          ¿Por qué existe esta app?
        </h2>
        <p className="text-[17px] md:text-[19px] leading-[1.6] text-[#a8a8a8] text-balance">
          La mayoría de los negocios pequeños no fracasan por falta de esfuerzo. Fracasan por falta de claridad.
          No saben qué productos les dejan más dinero. No saben si sus empleados están registrando bien las ventas.{" "}
          <span className="text-white">Este POS existe para cambiar eso.</span>
        </p>
      </div>
    </section>
  );
}

/* ─── ValueProps ─────────────────────────────────────────────────────────── */
function ValueProps() {
  const cards = [
    {
      icon: <Ico.eye width={20} height={20} />,
      title: "Sabes exactamente qué pasa en tu negocio, en tiempo real.",
      body: "Cada venta queda registrada. Cada turno tiene apertura y cierre. No más 'creo que vendimos bien hoy'.",
      tag: "Control operativo",
    },
    {
      icon: <Ico.wifiOff width={20} height={20} />,
      title: "Cuando el internet falla, tú no fallas.",
      body: "Tu POS sigue funcionando sin conexión. Las ventas se guardan localmente y sincronizan solas cuando vuelve la señal.",
      tag: "Resiliencia offline",
    },
    {
      icon: <Ico.tag width={20} height={20} />,
      title: "$199 al mes. Todo incluido. Para siempre.",
      body: "Sin plan básico que te limita. Sin cobro por empleado. Sin sorpresa al final del mes.",
      tag: "Precio sin trampa",
    },
  ];
  return (
    <section className="relative border-t border-white/[0.05]">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="grid md:grid-cols-3 gap-4 md:gap-5">
          {cards.map((c, i) => (
            <div
              key={i}
              className="lp-reveal lp-card-lift lp-border-travel lp-hairline rounded-2xl p-7 md:p-8 flex flex-col"
              style={{ transitionDelay: `${i * 60}ms`, background: "rgba(255,255,255,0.012)" }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-6"
                style={{
                  background: "var(--lp-accent-soft)",
                  boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 35%, transparent)",
                  color: "var(--lp-accent)",
                }}
              >
                {c.icon}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.16em] text-[#7a7a7a] font-medium mb-3">{c.tag}</div>
              <h3 className="text-[19px] leading-[1.25] font-semibold tracking-tight text-balance mb-3 text-white">{c.title}</h3>
              <p className="text-[13.5px] leading-[1.6] text-[#a8a8a8]">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── HowItWorks ─────────────────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    "Registra tu cuenta y verifica tu email",
    "Sube el logo de tu negocio",
    "Agrega tus categorías y productos",
    "Da acceso a tus empleados",
    "Abre tu primer turno y empieza a vender",
  ];
  return (
    <section className="relative border-t border-white/[0.05]" style={{ background: "rgba(10,10,10,0.4)" }}>
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="max-w-2xl mb-14 lp-reveal">
          <div className="text-[11px] uppercase tracking-[0.18em] font-medium mb-4" style={{ color: "var(--lp-accent)" }}>
            Cómo empezar
          </div>
          <h2 className="text-[32px] md:text-[44px] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-white">
            Configura tu negocio en menos de una hora
          </h2>
        </div>

        <div className="relative lp-reveal lp-timeline">
          <div
            className="lp-timeline-line absolute left-0 right-0 top-[18px] h-px hidden md:block"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)" }}
          />
          <ol className="grid md:grid-cols-5 gap-6 md:gap-4">
            {steps.map((s, i) => (
              <li key={i} className="lp-reveal" style={{ transitionDelay: `${i * 70}ms` }}>
                <div className="relative flex md:block items-center gap-4">
                  <div
                    className="lp-step-circle relative w-9 h-9 rounded-full lp-hairline-strong flex items-center justify-center text-[13px] font-semibold shrink-0"
                    style={{ background: "#0a0a0a", color: "var(--lp-accent)", animationDelay: `${i * 90}ms`, fontVariantNumeric: "tabular-nums" }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <p className="md:mt-5 text-[14px] leading-[1.45] text-[#d9d9d9] text-balance">{s}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ─── Features ───────────────────────────────────────────────────────────── */
function Features() {
  const feats = [
    { i: <Ico.card    width={18} height={18} />, f: "Ventas en efectivo, transferencia y tarjeta manual", b: "Cobras como tu cliente prefiere" },
    { i: <Ico.sync    width={18} height={18} />, f: "Modo offline con sincronización automática",          b: "Si se va el internet, tu negocio no para" },
    { i: <Ico.clock   width={18} height={18} />, f: "Control de turnos con apertura y cierre",             b: "Sabes cuánto entró en cada turno, sin depender de nadie" },
    { i: <Ico.box     width={18} height={18} />, f: "Inventario por movimiento",                           b: "Cada venta descuenta stock automáticamente" },
    { i: <Ico.chart   width={18} height={18} />, f: "Reportes de ventas y productos",                      b: "Decisiones con datos reales, no intuición" },
    { i: <Ico.users   width={18} height={18} />, f: "Gestión de empleados con roles",                      b: "Cada quien ve solo lo que debe ver" },
    { i: <Ico.brush   width={18} height={18} />, f: "Logo y personalización del POS",                      b: "Tu punto de venta tiene la cara de tu negocio" },
    { i: <Ico.history width={18} height={18} />, f: "Historial de auditoría",                              b: "Si algo no cuadra, puedes rastrear qué pasó y quién lo hizo" },
  ];
  return (
    <section className="relative border-t border-white/[0.05]">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="max-w-2xl mb-14 lp-reveal">
          <div className="text-[11px] uppercase tracking-[0.18em] font-medium mb-4" style={{ color: "var(--lp-accent)" }}>
            Lo que incluye
          </div>
          <h2 className="text-[32px] md:text-[44px] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-white">
            Todo lo que necesitas. Nada que no necesitas.
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-x-10 md:gap-x-16 gap-y-0 border-t border-white/[0.05]">
          {feats.map((it, i) => (
            <div
              key={i}
              className="lp-feat-row lp-reveal flex items-start gap-4 py-6 border-b border-white/[0.05]"
              style={{ transitionDelay: `${(i % 2) * 60}ms` }}
            >
              <div
                className="lp-feat-ico mt-0.5 w-9 h-9 rounded-md flex items-center justify-center shrink-0 lp-hairline"
                style={{ background: "rgba(255,255,255,0.025)", color: "var(--lp-accent)" }}
              >
                {it.i}
              </div>
              <div className="min-w-0">
                <div className="text-[14.5px] font-medium text-white leading-snug">{it.f}</div>
                <div className="text-[13px] text-[#7a7a7a] mt-1 leading-[1.55]">{it.b}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ────────────────────────────────────────────────────────────── */
function Pricing({ primaryTarget }: { primaryTarget: string }) {
  const features = [
    "Ventas en efectivo, transferencia y tarjeta manual",
    "Modo offline con sincronización automática",
    "Control de turnos con apertura y cierre",
    "Inventario por movimiento",
    "Reportes de ventas y productos",
    "Gestión de empleados con roles",
    "Logo y personalización del POS",
    "Historial de auditoría",
  ];
  return (
    <section id="precio" className="relative border-t border-white/[0.05] overflow-hidden" style={{ background: "rgba(10,10,10,0.4)" }}>
      <div className="absolute inset-0 lp-dotgrid opacity-40 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6 py-24">
        <div className="max-w-2xl mx-auto text-center mb-12 lp-reveal">
          <div className="text-[11px] uppercase tracking-[0.18em] font-medium mb-4" style={{ color: "var(--lp-accent)" }}>
            Precio
          </div>
          <h2 className="text-[32px] md:text-[44px] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-white">
            Un solo plan. Sin letra chica.
          </h2>
        </div>

        <div className="max-w-md mx-auto lp-reveal">
          <div className="relative rounded-2xl lp-hairline-strong overflow-hidden" style={{ background: "#0a0a0a" }}>
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--lp-accent) 60%, transparent), transparent)" }}
            />
            <div className="p-7 md:p-8">
              <div className="flex items-center justify-between mb-7">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--lp-accent)" }}>Plan</div>
                  <div className="text-[20px] font-semibold mt-1 text-white">Estándar</div>
                </div>
                <div
                  className="px-2.5 py-1 rounded-full text-[10.5px] font-medium uppercase tracking-wider"
                  style={{
                    background: "var(--lp-accent-soft)",
                    boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--lp-accent) 35%, transparent)",
                    color: "var(--lp-accent)",
                  }}
                >
                  Único
                </div>
              </div>

              <div className="flex items-baseline gap-2 mb-1">
                <div className="text-[52px] font-bold tracking-[-0.03em] leading-none text-white">
                  <CountUp to={199} duration={1100} prefix="$" />
                </div>
                <div className="text-[14px] text-[#7a7a7a] font-mono">MXN</div>
                <div className="text-[14px] text-[#7a7a7a]">/ mes</div>
              </div>
              <p className="text-[13.5px] text-[#7a7a7a] mb-7">Todo incluido. Sin cobro por empleado. Sin niveles.</p>

              <Link
                to={primaryTarget}
                className="block lp-btn-accent text-center font-semibold py-3 rounded-lg text-[14px]"
                style={accentBtnStyle}
              >
                <span>Empieza gratis 14 días →</span>
              </Link>
              <div className="text-center text-[12px] text-[#7a7a7a] mt-3">
                Cancela cuando quieras. Sin contratos.
              </div>

              <div className="lp-divider my-7" />

              <ul className="space-y-3">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-[#d9d9d9]">
                    <span className="mt-[3px] shrink-0" style={{ color: "var(--lp-accent)" }}>
                      <Ico.check width={14} height={14} />
                    </span>
                    <span className="leading-[1.5]">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer id="soporte" className="border-t border-white/[0.05]">
      <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <Logo />
          <div className="text-[12.5px] text-[#7a7a7a] mt-3">
            ¿Necesitas ayuda?{" "}
            <a
              href="mailto:posprojectsupport@gmail.com"
              className="text-[#d9d9d9] hover:text-white transition-colors underline decoration-white/15 underline-offset-4"
            >
              posprojectsupport@gmail.com
            </a>
          </div>
        </div>
        <div className="flex items-center gap-6 text-[13px] text-[#7a7a7a]">
          <a href="#" className="hover:text-white transition-colors">Privacidad</a>
          <a href="#" className="hover:text-white transition-colors">Términos</a>
          <a href="#soporte" className="hover:text-white transition-colors">Soporte</a>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-10 text-[11.5px] text-[#4a4a4a] font-mono">
        © 2026 Pulso. Hecho en México.
      </div>
    </footer>
  );
}

/* ─── Home ───────────────────────────────────────────────────────────────── */
export default function Home() {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated";
  const primaryTarget = isAuthenticated ? "/dashboard" : "/signup";

  useReveal();

  return (
    <div
      className="lp-root min-h-screen"
      style={{
        background: "#070707",
        color: "#f5f5f5",
        "--lp-accent": "#f5b14a",
        "--lp-accent-soft": "rgba(245,177,74,0.14)",
        "--lp-accent-strong": "#ffcc6b",
        "--lp-accent-ink": "#1a1300",
      } as React.CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: LANDING_STYLES }} />
      <Navbar primaryTarget={primaryTarget} isAuthenticated={isAuthenticated} />
      <main>
        <Hero primaryTarget={primaryTarget} />
        <SocialProof />
        <Why />
        <ValueProps />
        <HowItWorks />
        <Features />
        <Pricing primaryTarget={primaryTarget} />
      </main>
      <Footer />
    </div>
  );
}
