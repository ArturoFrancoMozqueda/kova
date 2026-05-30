import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import {
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_PRICE_LABEL_ES,
  STANDARD_PLAN_PRICE_CADENCE_ES,
} from "@/billing/standardPlan";
import IntroAnimation from "@/components/brand/IntroAnimation";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";

const t = copy.landing;

/* ─── Theme ──────────────────────────────────────────────────────────────── */
type Theme = "light" | "dark";

function themeVars(theme: Theme): CSSProperties {
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
      "--text-tertiary": "#6B7A99",
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
    "--ink-on-fg": "var(--kova-on-ink)",
    "--card-bg": "#FFFFFF",
    "--chip-bg": "rgba(15,17,23,0.05)",
    "--invert-ink-bg": "var(--kova-ink)",
    "--invert-ink-fg": "var(--kova-on-ink)",
  } as CSSProperties;
}

/* ─── Landing-scoped CSS ─────────────────────────────────────────────────── */
const LANDING_STYLES = `
  .lp-root {
    font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
    background: var(--page-bg);
    color: var(--page-fg);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    transition: background 280ms var(--kova-ease-entrance), color 280ms var(--kova-ease-entrance);
  }
  .lp-root .tabular { font-variant-numeric: tabular-nums; }
  .lp-root .mono { font-family: "DM Mono", ui-monospace, monospace; }
  .lp-root ::selection { background: var(--accent); color: #fff; }

  .lp-grid-bg {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(to right, var(--hairline-color) 0.5px, transparent 0.5px),
      linear-gradient(to bottom, var(--hairline-color) 0.5px, transparent 0.5px);
    background-size: 80px 80px;
    opacity: 0.5;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
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
  @keyframes lp-core-pulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.18); }
  }

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

  @media (prefers-reduced-motion: reduce) {
    .lp-live-dot { animation: none !important; }
    .lp-root *, .lp-root *::before, .lp-root *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/* ─── ThemeToggle ────────────────────────────────────────────────────────── */
/* ─── Navbar ─────────────────────────────────────────────────────────────── */
function Navbar({
  primaryTarget,
  isAuthenticated,
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
}) {
  return (
    <nav
      style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "color-mix(in srgb, var(--page-bg) 85%, transparent)",
        backdropFilter: "saturate(140%) blur(12px)",
        WebkitBackdropFilter: "saturate(140%) blur(12px)",
        borderBottom: "0.5px solid var(--hairline-color)",
      }}
    >
      <div
        className="lp-nav-shell"
        style={{
          maxWidth: 1280, margin: "0 auto",
          padding: "14px 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32,
        }}
      >
        <span style={{ color: "var(--page-fg)", display: "inline-flex" }}>
          <Logo
            variant="horizontal"
            size={24}
            circuitColor="currentColor"
            wordmarkColor="currentColor"
            coreColor="var(--accent)"
            title="kova"
          />
        </span>

        <div className="lp-desktop-nav" style={{ display: "flex", gap: 28, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
          {[
            { label: t.nav.howItWorks, href: "#como-funciona" },
            { label: t.nav.whatItLooksLike, href: "#producto" },
            { label: t.nav.isItForMe, href: "#comercios" },
            { label: t.nav.questions, href: "#faq" },
            { label: t.nav.price, href: "#precio" },
          ].map((l) => (
            <a key={l.label} href={l.href} style={{ color: "inherit", textDecoration: "none", transition: "color 150ms" }}
               onMouseEnter={(e) => (e.currentTarget.style.color = "var(--page-fg)")}
               onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {l.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isAuthenticated && (
            <Link
              to="/login"
              style={{
                fontSize: 13, fontWeight: 500, color: "var(--page-fg)",
                padding: "8px 12px", textDecoration: "none",
              }}
              className="hidden sm:inline-flex"
            >
              {t.nav.login}
            </Link>
          )}
          <Link
            className="lp-nav-primary"
            to={primaryTarget}
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "9px 14px", borderRadius: 8, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {isAuthenticated ? t.nav.goToDashboard : t.nav.createAccount}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─── MXN Ticker ─────────────────────────────────────────────────────────── */
/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero({ primaryTarget }: { primaryTarget: string }) {
  return (
    <section className="lp-hero-section" style={{ position: "relative", padding: "56px 32px 56px", overflow: "hidden" }}>
      <div className="lp-grid-bg" />
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
            gap: 64, alignItems: "start", marginTop: 16,
          }}
          className="lp-hero-grid"
        >
          <div>
            <h1
              className="lp-hero-title"
              style={{
                fontSize: "clamp(36px, 5.2vw, 72px)",
                fontWeight: 600,
                letterSpacing: "-0.035em",
                lineHeight: 0.98,
                margin: 0,
                color: "var(--page-fg)",
              }}
            >
              {t.hero.titlePart1}<br />
              <span style={{ position: "relative", whiteSpace: "nowrap" }}>
                {t.hero.titleEmphasis}
                <svg
                  viewBox="0 0 200 14" preserveAspectRatio="none"
                  style={{ position: "absolute", bottom: "-0.06em", left: 0, width: "100%", height: "0.18em" }}
                  aria-hidden="true"
                >
                  <path d="M2 8 Q 50 2, 100 7 T 198 6" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              {t.hero.titlePart2}
            </h1>

            <p className="lp-hero-copy" style={{ fontSize: 19, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 24, maxWidth: 520 }}>
              {t.hero.subtitle}
            </p>

            <div className="lp-hero-actions" style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
              <Link
                to={primaryTarget}
                style={{
                  background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 600, fontSize: 14, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                {t.hero.ctaPrimary}
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#producto"
                style={{
                  background: "var(--surface)", color: "var(--page-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 500, fontSize: 14, textDecoration: "none",
                  border: "0.5px solid var(--hairline-color)",
                }}
              >
                {t.hero.ctaSecondary}
              </a>
            </div>

            <p
              className="lp-hero-pricing"
              style={{
                marginTop: 18, fontSize: 13, color: "var(--text-muted)",
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 999,
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                fontWeight: 600, color: "var(--page-fg)",
              }}>
                {STANDARD_PLAN_PRICE_LABEL_ES}{t.hero.priceBadgeSuffix}
              </span>
              <span>{t.hero.priceFineprint}</span>
            </p>

            <div
              className="lp-hero-stats"
              style={{
                marginTop: 32, display: "flex", alignItems: "center", gap: 24,
                fontSize: 12, color: "var(--text-muted)", paddingTop: 24,
                borderTop: "0.5px solid var(--hairline-color)", flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                {t.hero.madeInMexico}
              </span>
              <span>·</span>
              <span>{t.hero.noCommission}</span>
              <span>·</span>
              <span>{t.hero.worksOffline}</span>
            </div>
          </div>

          <div className="lp-hero-visual" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IntroAnimation embedded skippable={false} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── HeroDemo ───────────────────────────────────────────────────────────── */
function HeroDemo() {
  const d = t.hero.demo;
  const steps: Array<{ label: string; primary: string; meta: string; icon: ReactNode; accent?: boolean }> = [
    {
      label: d.step1Label,
      primary: d.step1Primary,
      meta: d.step1Meta,
      accent: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: d.step2Label,
      primary: d.step2Primary,
      meta: d.step2Meta,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4m8-4l-8 4m0 0v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: d.step3Label,
      primary: d.step3Primary,
      meta: d.step3Meta,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 19V5m0 14h16M8 15v-4m4 4V8m4 7v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];
  return (
    <div
      className="lp-hero-demo"
      style={{
        width: "100%",
        maxWidth: 320,
        justifySelf: "center",
        background: "var(--card-bg)",
        border: "0.5px solid var(--hairline-color)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingBottom: 12, borderBottom: "0.5px solid var(--hairline-color)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10, fontWeight: 500, letterSpacing: "0.16em",
            textTransform: "uppercase", color: "var(--text-tertiary)",
          }}
        >
          {d.eyebrow}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <span
            aria-hidden="true"
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--kova-growth, #1EBF8A)",
              boxShadow: "0 0 0 4px rgba(30,191,138,0.18)",
            }}
          />
          {d.livePulse}
        </span>
      </div>
      {steps.map((s, i) => (
        <div
          key={i}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 14px", borderRadius: 12,
            background: "var(--surface-2)",
            border: "0.5px solid var(--hairline-color)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 32, height: 32, borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: s.accent ? "var(--accent-soft)" : "var(--chip-bg)",
              color: s.accent ? "var(--accent)" : "var(--page-fg)",
              flexShrink: 0,
            }}
          >
            {s.icon}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontSize: 10, fontWeight: 500, letterSpacing: "0.14em",
                textTransform: "uppercase", color: "var(--text-tertiary)",
              }}
            >
              {s.label}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--page-fg)", fontVariantNumeric: "tabular-nums" }}>
              {s.primary}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.meta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── SocialProof ────────────────────────────────────────────────────────── */
function SocialProof() {
  const sp = t.socialProof;
  return (
    <section
      aria-label={sp.eyebrow}
      style={{
        padding: "28px 32px",
        borderTop: "0.5px solid var(--hairline-color)",
        borderBottom: "0.5px solid var(--hairline-color)",
        background: "var(--surface-2)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          {sp.eyebrow}
        </span>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {sp.categories.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 13,
                fontWeight: 500,
                padding: "6px 12px",
                borderRadius: 999,
                background: "var(--surface)",
                border: "0.5px solid var(--hairline-color)",
                color: "var(--page-fg)",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── ThreeNodes ─────────────────────────────────────────────────────────── */
function ThreeNodes() {
  const items = t.threeNodes.items;
  return (
    <section id="como-funciona" style={{ padding: "80px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 56 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {t.threeNodes.eyebrow}
          </span>
        </div>
        <h2 style={{ fontSize: "clamp(36px, 4.4vw, 60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 760 }}>
          {t.threeNodes.title}
        </h2>
        <p style={{ marginTop: 20, fontSize: 18, color: "var(--text-muted)", maxWidth: 620, lineHeight: 1.5 }}>
          {t.threeNodes.leadStart}
          <strong style={{ color: "var(--page-fg)", fontWeight: 600 }}>{t.threeNodes.leadEmphasis}</strong>
          {t.threeNodes.leadEnd}
        </p>

        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24, marginTop: 64, position: "relative",
          }}
          className="lp-3cols"
        >
          {items.map((it, i) => (
            <NodeCard key={i} index={i} {...it} />
          ))}
        </div>
      </div>
    </section>
  );
}

function NodeCard({ index, label, title, body, meta }: { index: number; label: string; title: string; body: string; meta: string[] }) {
  return (
    <div
      style={{
        position: "relative", borderRadius: 14, padding: 28,
        background: "var(--card-bg)", border: "0.5px solid var(--hairline-color)",
        display: "flex", flexDirection: "column", gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 10, height: 10, borderRadius: "50%",
              background: index === 1 ? "var(--accent)" : "var(--page-fg)",
              outline: index === 1 ? "4px solid var(--accent-soft)" : "none",
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {label}
          </span>
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>0{index + 1}</span>
      </div>

      <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.15, margin: 0 }}>{title}</h3>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text-muted)", margin: 0 }}>{body}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto", paddingTop: 16, borderTop: "0.5px solid var(--hairline-color)" }}>
        {meta.map((m) => (
          <span key={m} style={{ fontSize: 11, fontWeight: 500, padding: "4px 8px", borderRadius: 6, background: "var(--chip-bg)", color: "var(--page-fg)" }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── DesktopPreview ─────────────────────────────────────────────────────── */
type Product = { id: string; name: string; price: number; cat: string; icon: string };
const CATALOG: Product[] = [
  { id: "p1", name: t.desktopPreview.products.americano, price: 38, cat: t.desktopPreview.categoryCoffee, icon: "☕" },
  { id: "p2", name: t.desktopPreview.products.latte, price: 52, cat: t.desktopPreview.categoryCoffee, icon: "🥛" },
  { id: "p3", name: t.desktopPreview.products.cappuccino, price: 48, cat: t.desktopPreview.categoryCoffee, icon: "☕" },
  { id: "p4", name: t.desktopPreview.products.concha, price: 22, cat: t.desktopPreview.categoryBakery, icon: "🥐" },
  { id: "p5", name: t.desktopPreview.products.croissant, price: 28, cat: t.desktopPreview.categoryBakery, icon: "🥖" },
  { id: "p6", name: t.desktopPreview.products.oatCookie, price: 18, cat: t.desktopPreview.categoryBakery, icon: "🍪" },
];

const qtyBtnStyle: CSSProperties = {
  width: 22, height: 22, borderRadius: 6,
  border: "0.5px solid var(--hairline-color)",
  background: "var(--surface)",
  fontSize: 12, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "inherit", color: "var(--page-fg)", padding: 0,
};

function DesktopPreview() {
  const [cart, setCart] = useState<Record<string, number>>({ p2: 2, p4: 1 });
  const [filter, setFilter] = useState(t.desktopPreview.categoryAll);
  const [pulseId, setPulseId] = useState<string | null>(null);

  const items = Object.entries(cart)
    .map(([id, qty]) => {
      const p = CATALOG.find((x) => x.id === id);
      return p ? { ...p, qty } : null;
    })
    .filter((x): x is Product & { qty: number } => !!x && x.qty > 0);
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const filtered = filter === t.desktopPreview.categoryAll ? CATALOG : CATALOG.filter((p) => p.cat === filter);

  const add = (id: string) => {
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    setPulseId(id);
    window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 280);
  };
  const adj = (id: string, d: number) =>
    setCart((c) => {
      const next = Math.max(0, (c[id] || 0) + d);
      const out = { ...c };
      if (next === 0) delete out[id]; else out[id] = next;
      return out;
    });

  return (
    <div
      className="lp-desktop-preview"
      style={{
        background: "var(--card-bg)", borderRadius: 10,
        border: "0.5px solid var(--hairline-color)", overflow: "hidden",
        boxShadow: "0 24px 60px -20px rgba(15,17,23,0.25)",
        display: "grid", gridTemplateColumns: "1fr 280px",
        height: 420, color: "var(--page-fg)",
      }}
    >
      <div className="lp-preview-main" style={{ borderRight: "0.5px solid var(--hairline-color)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LogoMark size={18} circuitColor="var(--page-fg)" coreColor="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{t.desktopPreview.shopName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <span className="lp-live-dot" /> {t.desktopPreview.online}
          </div>
        </div>

        <div style={{ padding: "10px 20px", display: "flex", gap: 6, borderBottom: "0.5px solid var(--hairline-color)" }}>
          {[t.desktopPreview.categoryAll, t.desktopPreview.categoryCoffee, t.desktopPreview.categoryBakery].map((c) => (
            <button
              key={c} onClick={() => setFilter(c)}
              style={{
                border: "0.5px solid var(--hairline-color)",
                background: filter === c ? "var(--invert-ink-bg)" : "var(--surface)",
                color: filter === c ? "var(--invert-ink-fg)" : "var(--page-fg)",
                fontSize: 11, padding: "5px 10px", borderRadius: 999, fontWeight: 500,
                fontFamily: "inherit", cursor: "pointer", textTransform: "capitalize",
                transition: "all 150ms var(--kova-ease-entrance)",
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="lp-product-grid" style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1, alignContent: "start" }}>
          {filtered.map((p) => {
            const inCart = (cart[p.id] || 0) > 0;
            const pulsing = pulseId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p.id)}
                className="lp-product-tile"
                data-active={inCart ? "1" : "0"}
                style={{
                  background: "var(--card-bg)",
                  border: "0.5px solid var(--hairline-color)",
                  borderRadius: 10, padding: 12, textAlign: "left",
                  cursor: "pointer", fontFamily: "inherit", color: "inherit",
                  display: "flex", flexDirection: "column", gap: 4,
                  transition: "border-color 150ms var(--kova-ease-entrance), transform 150ms var(--kova-ease-entrance), box-shadow 150ms var(--kova-ease-entrance)",
                  transform: pulsing ? "scale(0.97)" : "scale(1)",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 18, lineHeight: 1 }}>{p.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>{p.name}</div>
                <div className="tabular" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", marginTop: "auto" }}>
                  {formatMoney(p.price)}
                </div>
                {inCart && (
                  <span
                    className="tabular"
                    style={{
                      position: "absolute", top: 8, right: 8,
                      minWidth: 18, height: 18, borderRadius: 999,
                      background: "var(--accent)", color: "#fff",
                      fontSize: 10, fontWeight: 600,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: "0 5px",
                    }}
                  >
                    {cart[p.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lp-preview-cart" style={{ display: "flex", flexDirection: "column", background: "var(--surface-2)" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "0.5px solid var(--hairline-color)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", fontWeight: 500 }}>
            {t.desktopPreview.currentSale}
          </div>
          <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-muted)" }}>
            {t.desktopPreview.itemCount(items.length)}
          </div>
        </div>
        <div style={{ flex: 1, padding: "8px 16px", overflow: "auto" }}>
          {items.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>
              {t.desktopPreview.emptyCart}
            </div>
          )}
          {items.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid var(--hairline-color)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
                <div className="tabular" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatMoney(i.price)} c/u</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => adj(i.id, -1)} style={qtyBtnStyle}>−</button>
                <span className="tabular" style={{ fontSize: 12, fontWeight: 600, width: 16, textAlign: "center" }}>{i.qty}</span>
                <button onClick={() => adj(i.id, 1)} style={qtyBtnStyle}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 16, borderTop: "0.5px solid var(--hairline-color)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.desktopPreview.total}</span>
            <span className="tabular" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{formatMoney(total)}</span>
          </div>
          <button
            style={{
              width: "100%", background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              border: "none", borderRadius: 8, padding: "10px 12px",
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            {t.desktopPreview.charge(formatMoney(total))}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── WhyKova ────────────────────────────────────────────────────────────── */
function WhyKova() {
  return (
    <section style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          {t.whyKova.eyebrow}
        </span>
        <h2
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            margin: "20px 0 0",
            color: "var(--page-fg)",
          }}
        >
          {t.whyKova.title}
        </h2>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--text-muted)", marginTop: 24 }}>
          {t.whyKova.body}
        </p>
        <blockquote
          style={{
            marginTop: 48,
            padding: "32px 32px 32px 28px",
            borderLeft: "2px solid var(--accent)",
            background: "var(--surface)",
            borderRadius: "0 14px 14px 0",
            textAlign: "left",
            fontSize: 18,
            lineHeight: 1.55,
            color: "var(--page-fg)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {t.whyKova.quote}
        </blockquote>
      </div>
    </section>
  );
}

/* ─── POSShowcase ────────────────────────────────────────────────────────── */
function POSShowcase() {
  return (
    <section id="producto" className="lp-product-section" style={{ padding: "120px 32px", background: "var(--surface)", borderTop: "0.5px solid var(--hairline-color)", borderBottom: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 56 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.posShowcase.eyebrow}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.6fr)", gap: 56, alignItems: "end", marginBottom: 56 }} className="lp-showcase-head">
          <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0 }}>
            {t.posShowcase.titleLine1}<br />{t.posShowcase.titleLine2}
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, paddingBottom: 8 }}>
            {t.posShowcase.body}
          </p>
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 32, alignItems: "center" }} className="lp-showcase-row">
          <DesktopPreview />
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}

/* ─── Features ───────────────────────────────────────────────────────────── */
type FeatKind = "offline" | "tenant" | "pay" | "live" | "shift" | "pwa";
function FeatIcon({ kind }: { kind: FeatKind }) {
  const sx: CSSProperties = { width: 32, height: 32, color: "var(--page-fg)" };
  switch (kind) {
    case "offline":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <path d="M4 16 Q 16 4, 28 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="3 3" />
          <path d="M9 20 Q 16 14, 23 20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="16" cy="24" r="2" fill="var(--accent)" />
        </svg>
      );
    case "tenant":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="23" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="16" cy="22" r="3" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 12 L 16 19 M 23 12 L 16 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "pay":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <rect x="5" y="9" width="22" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 13 H 27" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="22" cy="18" r="1.5" fill="var(--accent)" />
        </svg>
      );
    case "live":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <path d="M3 18 H 9 L 12 10 L 15 24 L 19 14 L 22 18 H 29" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="29" cy="18" r="2" fill="var(--accent)" />
        </svg>
      );
    case "shift":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.4" />
          <path d="M16 9 V 16 L 21 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="16" cy="16" r="1.6" fill="var(--accent)" />
        </svg>
      );
    case "pwa":
      return (
        <svg viewBox="0 0 32 32" fill="none" style={sx}>
          <rect x="9" y="4" width="14" height="24" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="16" cy="24" r="1" fill="currentColor" />
          <path d="M13 9 H 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="22" cy="6" r="1.6" fill="var(--accent)" />
        </svg>
      );
  }
}

function Features() {
  const featureKinds: FeatKind[] = ["offline", "tenant", "pay", "live", "shift", "pwa"];
  const feats = t.features.items.map((it, i) => ({ ...it, kind: featureKinds[i] }));
  return (
    <section style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.features.eyebrow}</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 760 }}>
          {t.features.title}
        </h2>
        <p style={{ marginTop: 20, fontSize: 18, color: "var(--text-muted)", maxWidth: 620, lineHeight: 1.5 }}>
          {t.features.lead}
        </p>

        <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "0.5px solid var(--hairline-color)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }} className="lp-3cols">
          {feats.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "32px 28px",
                borderRight: i % 3 !== 2 ? "0.5px solid var(--hairline-color)" : "none",
                borderBottom: i < 3 ? "0.5px solid var(--hairline-color)" : "none",
                display: "flex", flexDirection: "column", gap: 12, minHeight: 240,
              }}
            >
              <div style={{ marginBottom: 8 }}><FeatIcon kind={f.kind} /></div>
              <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>{f.kicker}</span>
              <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.2, margin: 0 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── FirstDay ───────────────────────────────────────────────────────────── */
function FirstDay({ primaryTarget }: { primaryTarget: string }) {
  const steps = t.firstDay.steps;
  return (
    <section style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {t.firstDay.eyebrow}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.7fr)", gap: 56, alignItems: "end", marginBottom: 64 }} className="lp-showcase-head">
          <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0 }}>
            {t.firstDay.titleLine1}<br />{t.firstDay.titleLine2}
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, paddingBottom: 8 }}>
            {t.firstDay.body}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0,
            border: "0.5px solid var(--hairline-color)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--surface)",
          }}
          className="lp-4cols"
        >
          {steps.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "28px 24px",
                borderRight: i < steps.length - 1 ? "0.5px solid var(--hairline-color)" : "none",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 220,
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)", letterSpacing: "0.08em" }}>
                  {s.n}
                </span>
                <span style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 999, background: "var(--chip-bg)", color: "var(--text-muted)", letterSpacing: "0.06em" }}>
                  {s.time}
                </span>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.25, margin: "8px 0 0" }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", margin: 0 }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 40,
            padding: "24px 28px",
            borderRadius: 14,
            background: "var(--accent-soft)",
            border: "0.5px solid var(--hairline-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 360px" }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>
              {t.firstDay.ctaEyebrow}
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.5, margin: "6px 0 0", color: "var(--page-fg)" }}>
              {t.firstDay.ctaBody}
            </p>
          </div>
          <Link
            to={primaryTarget}
            style={{
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "12px 20px", borderRadius: 10,
              fontWeight: 600, fontSize: 14, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            {t.firstDay.ctaButton}
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── BuiltFor ───────────────────────────────────────────────────────────── */
function BuiltFor() {
  const types = t.builtFor.types;
  return (
    <section id="comercios" style={{ padding: "120px 32px", background: "var(--kova-ink)", color: "var(--kova-on-ink)", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>{t.builtFor.eyebrow}</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 820, color: "var(--kova-on-ink)" }}>
          {t.builtFor.title}
        </h2>
        <p style={{ marginTop: 20, fontSize: 17, color: "rgba(240,244,255,0.65)", maxWidth: 620, lineHeight: 1.55 }}>
          {t.builtFor.body}
        </p>

        <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.08)" }} className="lp-3cols">
          {types.map((type, i) => (
            <div
              key={type.name}
              style={{ background: "var(--kova-ink)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 12, minHeight: 200, transition: "background 220ms", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1A1D28")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--kova-ink)")}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>0{i + 1}</span>
                <LogoMark size={22} circuitColor="rgba(255,255,255,0.4)" coreColor="var(--kova-blue-light)" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", margin: 0, color: "#fff" }}>{type.name}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "rgba(240,244,255,0.6)" }}>{type.body}</p>
              <div className="mono" style={{ marginTop: "auto", fontSize: 11, color: "var(--kova-blue-light)" }}>↳ {type.tag}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ────────────────────────────────────────────────────────────────── */
function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const items = t.faq.items;

  return (
    <section id="faq" style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {t.faq.eyebrow}
          </span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 760 }}>
          {t.faq.title}
        </h2>

        <div style={{ marginTop: 56, borderTop: "0.5px solid var(--hairline-color)" }}>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderBottom: "0.5px solid var(--hairline-color)" }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: "22px 4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--page-fg)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
                    {it.q}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 22, height: 22, borderRadius: 999,
                      border: "0.5px solid var(--hairline-color)",
                      background: isOpen ? "var(--accent)" : "var(--surface)",
                      color: isOpen ? "#fff" : "var(--page-fg)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      transition: "all 180ms var(--kova-ease-entrance)",
                      transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      padding: "0 4px 24px",
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "var(--text-muted)",
                      maxWidth: 760,
                      animation: "lp-feed-in 240ms var(--kova-ease-entrance)",
                    }}
                  >
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p style={{ marginTop: 40, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>
          {t.faq.contactPrefix}
          <a
            href="mailto:posprojectsupport@gmail.com"
            style={{ color: "var(--accent)", fontWeight: 500, textDecoration: "none", borderBottom: "1px solid var(--accent-soft)" }}
          >
            {t.faq.contactLink}
          </a>
          {t.faq.contactSuffix}
        </p>
      </div>
    </section>
  );
}

/* ─── Pricing ────────────────────────────────────────────────────────────── */
function Pricing({ primaryTarget }: { primaryTarget: string }) {
  const feats = t.pricing.features;
  return (
    <section id="precio" style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32, justifyContent: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.pricing.eyebrow}</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, textAlign: "center" }}>
          {t.pricing.titleLine1}<br />{t.pricing.titleLine2}
        </h2>
        <p style={{ marginTop: 16, fontSize: 17, color: "var(--text-muted)", maxWidth: 580, textAlign: "center", marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          {t.pricing.leadStart}
          <strong style={{ color: "var(--page-fg)", fontWeight: 600 }}>{t.pricing.leadEmphasis}</strong>
          {t.pricing.leadEnd}
        </p>

        <div style={{ marginTop: 56, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
          <div
            style={{
              borderRadius: 14, padding: 36,
              background: "var(--kova-ink)", color: "var(--kova-on-ink)",
              border: "0.5px solid var(--kova-ink)",
              boxShadow: "0 24px 60px -20px rgba(15,17,23,0.3)",
              display: "flex", flexDirection: "column", gap: 22, position: "relative",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-blue-light)" }}>{t.pricing.planName}</div>
              <div style={{ fontSize: 13, marginTop: 6, color: "rgba(240,244,255,0.6)" }}>{t.pricing.planSubtitle}</div>
            </div>

            <div className="tabular" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 16, opacity: 0.7 }}>$</span>
              <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1 }}>{STANDARD_PLAN_AMOUNT}</span>
              <span style={{ fontSize: 14, opacity: 0.7 }}>{STANDARD_PLAN_PRICE_CADENCE_ES}</span>
            </div>

            <Link
              to={primaryTarget}
              style={{
                width: "100%", background: "var(--kova-blue)", color: "#fff",
                padding: "14px 16px", borderRadius: 10, border: "none",
                fontWeight: 600, fontSize: 14, fontFamily: "inherit",
                textAlign: "center", textDecoration: "none", display: "block",
              }}
            >
              {t.pricing.ctaButton}
            </Link>
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(240,244,255,0.55)", marginTop: -10 }}>
              {t.pricing.ctaFineprint}
            </div>

            <div style={{ height: "0.5px", background: "rgba(255,255,255,0.1)" }} />

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {feats.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(240,244,255,0.85)" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M2 6L5 9L10 3" stroke="var(--kova-blue-light)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer style={{ padding: "80px 32px 56px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 48, alignItems: "start" }} className="lp-footer-grid">
          <div>
            <span style={{ color: "var(--page-fg)", display: "inline-flex" }}>
              <Logo size={24} circuitColor="currentColor" wordmarkColor="currentColor" coreColor="var(--accent)" />
            </span>
            <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 340, marginTop: 16, lineHeight: 1.55 }}>
              {t.footer.tagline}
            </p>
            <div style={{ marginTop: 24, display: "flex", gap: 6, alignItems: "center" }}>
              <span className="lp-live-dot" />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.footer.humansBadge}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
              {t.footer.contactHeading}
            </div>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.55, maxWidth: 360 }}>
              {t.footer.contactBody}
            </p>
            <a
              href="mailto:posprojectsupport@gmail.com"
              style={{ display: "inline-flex", marginTop: 16, fontSize: 14, fontWeight: 500, color: "var(--page-fg)", textDecoration: "none", borderBottom: "1px solid var(--hairline-color)" }}
            >
              posprojectsupport@gmail.com
            </a>
          </div>
        </div>
        <div style={{ marginTop: 64, paddingTop: 24, borderTop: "0.5px solid var(--hairline-color)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap", gap: 16 }}>
          <span>{t.footer.copyright}</span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link to="/privacy" style={footerLinkStyle}>{t.footer.privacy}</Link>
            <Link to="/terms" style={footerLinkStyle}>{t.footer.terms}</Link>
            <Link to="/seguridad" style={footerLinkStyle}>{t.footer.security}</Link>
            <a href="mailto:posprojectsupport@gmail.com" style={footerLinkStyle}>{t.footer.support}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
const footerLinkStyle: CSSProperties = { color: "var(--text-tertiary)", textDecoration: "none" };

/* ─── Responsive helper ──────────────────────────────────────────────────── */
const RESPONSIVE_STYLES = `
  .lp-root {
    width: 100%;
    min-width: 100vw;
    max-width: 100%;
    overflow-x: clip;
    background: var(--page-bg);
  }
  .lp-root > section { width: 100%; }
  .lp-root *, .lp-root *::before, .lp-root *::after {
    box-sizing: border-box;
  }
  .lp-desktop-preview,
  .lp-tablet-preview {
    max-width: 100%;
  }
  @media (max-width: 900px) {
    .lp-hero-grid, .lp-showcase-row, .lp-showcase-head, .lp-2cols {
      grid-template-columns: 1fr !important;
    }
    .lp-3cols { grid-template-columns: 1fr !important; }
    .lp-4cols { grid-template-columns: 1fr 1fr !important; }
    .lp-4cols > div { border-right: none !important; border-bottom: 0.5px solid var(--hairline-color) !important; }
    .lp-4cols > div:nth-child(2n) { border-right: none !important; }
    .lp-4cols > div:last-child { border-bottom: none !important; }
    .lp-4cols > div:nth-last-child(2) { border-bottom: none !important; }
    .lp-4cols > div:nth-child(odd) { border-right: 0.5px solid var(--hairline-color) !important; }
    .lp-footer-grid { grid-template-columns: 1fr 1fr !important; }
    .lp-hero-section { padding: 48px 24px 48px !important; }
    .lp-hero-grid { gap: 32px !important; margin-top: 16px !important; }
    .lp-hero-title {
      font-size: 38px !important;
      letter-spacing: 0 !important;
      line-height: 1 !important;
    }
    .lp-hero-copy { font-size: 17px !important; max-width: 100% !important; }
    .lp-hero-visual { max-width: 100% !important; overflow: hidden !important; }
    .lp-hero-visual > * { max-width: min(100%, 360px) !important; }
    .lp-product-section { padding: 88px 24px !important; }
    .lp-showcase-row { gap: 24px !important; }
    .lp-desktop-preview {
      grid-template-columns: 1fr !important;
      height: auto !important;
      min-width: 0 !important;
    }
    .lp-preview-main {
      border-right: none !important;
      border-bottom: 0.5px solid var(--hairline-color) !important;
      min-width: 0 !important;
    }
    .lp-preview-cart { min-width: 0 !important; }
    .lp-tablet-preview {
      width: min(280px, 100%) !important;
      justify-self: center !important;
    }
  }
  @media (max-width: 640px) {
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
    .lp-hero-section { padding: 36px 20px 40px !important; }
    .lp-hero-title { font-size: 34px !important; }
    .lp-hero-actions {
      display: grid !important;
      grid-template-columns: 1fr !important;
    }
    .lp-hero-actions > * {
      width: 100% !important;
      justify-content: center !important;
      text-align: center !important;
    }
    .lp-hero-stats {
      gap: 10px !important;
      align-items: flex-start !important;
      flex-direction: column !important;
      margin-top: 40px !important;
    }
    .lp-hero-stats > span:nth-child(2),
    .lp-hero-stats > span:nth-child(4) {
      display: none !important;
    }
    .lp-product-section { padding: 72px 20px !important; }
    .lp-product-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      padding: 12px !important;
    }
    .lp-footer-grid { grid-template-columns: 1fr !important; }
    .lp-4cols { grid-template-columns: 1fr !important; }
    .lp-4cols > div { border-right: none !important; border-bottom: 0.5px solid var(--hairline-color) !important; }
    .lp-4cols > div:last-child { border-bottom: none !important; }
  }
  @media (max-width: 360px) {
    .lp-nav-primary { padding: 9px 10px !important; font-size: 12px !important; }
    .lp-hero-title { font-size: 30px !important; }
    .lp-hero-copy { font-size: 16px !important; }
  }
`;

/* ─── Home ───────────────────────────────────────────────────────────────── */
export default function Home(): ReactNode {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated";
  const primaryTarget = isAuthenticated ? "/dashboard" : "/signup";
  const theme: Theme = "dark";

  const rootStyle = useMemo(() => themeVars(theme), [theme]);

  // Paint html/body with the same landing background while this view is mounted.
  // Prevents the white body bg from showing on viewports wider than the natural
  // .lp-root width (was the right-side white strip on >=1440px monitors).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const landingBg = "#0F1117"; // matches dark theme --page-bg
    html.style.background = landingBg;
    body.style.background = landingBg;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <div className="lp-root" style={rootStyle}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_STYLES + RESPONSIVE_STYLES }} />
      <Navbar primaryTarget={primaryTarget} isAuthenticated={isAuthenticated} />
      <main>
        <Hero primaryTarget={primaryTarget} />
        <SocialProof />
        <ThreeNodes />
        <WhyKova />
        <POSShowcase />
        <Features />
        <FirstDay primaryTarget={primaryTarget} />
        <BuiltFor />
        <FAQ />
        <Pricing primaryTarget={primaryTarget} />
      </main>
      <Footer />
    </div>
  );
}
