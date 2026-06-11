import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import {
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_PRICE_LABEL_ES,
  STANDARD_PLAN_PRICE_CADENCE_ES,
} from "@/billing/standardPlan";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";
import HeroProductPreview from "@/landing/HeroProductPreview";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
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
    font-family: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
    background: var(--page-bg);
    color: var(--page-fg);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    transition: background 280ms var(--kova-ease-entrance), color 280ms var(--kova-ease-entrance);
  }
  .lp-root .tabular { font-variant-numeric: tabular-nums; }
  .lp-root ::selection { background: var(--accent); color: #fff; }

  .lp-section {
    padding: 88px 32px;
    border-top: 0.5px solid var(--hairline-color);
  }
  .lp-section-compact { padding: 72px 32px; }
  .lp-section-inner {
    max-width: 1180px;
    margin: 0 auto;
  }
  .lp-section-label {
    display: inline-flex;
    margin-bottom: 22px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lp-section-title {
    font-size: clamp(32px, 4vw, 54px);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.04;
    margin: 0;
    color: var(--page-fg);
  }
  .lp-section-copy {
    margin: 16px 0 0;
    max-width: 620px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--text-muted);
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
  @keyframes lp-cart-pop {
    0%   { transform: scale(0.85); opacity: 0; }
    70%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
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

  .lp-hero-section {
    padding: 74px 32px 60px;
  }
  .lp-hero-shell {
    width: 100%;
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

  @media (prefers-reduced-motion: reduce) {
    .lp-live-dot { animation: none !important; }
    .lp-root.lp-motion-ready [data-lp-reveal="true"] {
      opacity: 1 !important;
      transform: none !important;
      filter: none !important;
    }
    .lp-root *, .lp-root *::before, .lp-root *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

function useLandingRevealMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp-root");
    if (!root) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          ".lp-reveal-block",
          ".lp-hero-grid",
          ".lp-benefit-strip",
          ".lp-showcase-row",
          ".lp-footer-grid",
        ].join(",")
      )
    );

    const seen = new Set<HTMLElement>();
    revealTargets.forEach((target, index) => {
      if (seen.has(target)) return;
      seen.add(target);
      target.dataset.lpReveal = "true";
      target.style.setProperty("--lp-reveal-delay", `${Math.min(index % 3, 2) * 80}ms`);
      if (reduceMotion) target.dataset.lpVisible = "true";
    });

    root.classList.add("lp-motion-ready");

    if (reduceMotion || !("IntersectionObserver" in window)) {
      seen.forEach((target) => {
        target.dataset.lpVisible = "true";
      });
      return () => {
        root.classList.remove("lp-motion-ready");
        seen.forEach((target) => {
          target.removeAttribute("data-lp-reveal");
          target.removeAttribute("data-lp-visible");
          target.style.removeProperty("--lp-reveal-delay");
        });
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.dataset.lpVisible = "true";
          observer.unobserve(target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );

    seen.forEach((target) => observer.observe(target));

    return () => {
      observer.disconnect();
      root.classList.remove("lp-motion-ready");
      seen.forEach((target) => {
        target.removeAttribute("data-lp-reveal");
        target.removeAttribute("data-lp-visible");
        target.style.removeProperty("--lp-reveal-delay");
      });
    };
  }, []);
}

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
            className="lp-nav-primary lp-cta-fill"
            to={primaryTarget}
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "9px 14px", borderRadius: 8, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <span>{isAuthenticated ? t.nav.goToDashboard : t.nav.createAccount}</span>
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
  const benefits = [
    {
      title: t.threeNodes.items[0].label,
      body: t.threeNodes.items[0].title,
    },
    {
      title: t.threeNodes.items[1].label,
      body: t.threeNodes.items[1].title,
    },
    {
      title: t.threeNodes.items[2].label,
      body: t.threeNodes.items[2].title,
    },
    {
      title: t.features.items[0].kicker,
      body: t.features.items[0].title,
    },
  ];

  return (
    <section className="lp-hero-section" style={{ position: "relative", overflow: "hidden" }}>
      <div className="lp-hero-shell lp-section-inner" style={{ position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.82fr) minmax(360px, 1fr)",
            gap: 48,
            alignItems: "center",
          }}
          className="lp-hero-grid"
        >
          <div>
            <span
              className="lp-section-label"
              style={{ marginBottom: 18, color: "var(--accent)" }}
            >
              {t.hero.eyebrow}
            </span>
            <h1
              className="lp-hero-title"
              style={{
                fontSize: "clamp(36px, 4.6vw, 60px)",
                fontWeight: 600,
                letterSpacing: "-0.025em",
                lineHeight: 1,
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

            <p className="lp-hero-copy" style={{ fontSize: 17, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 20, maxWidth: 560 }}>
              {t.hero.subtitle}
            </p>

            <div className="lp-hero-actions" style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
              <Link
                to={primaryTarget}
                className="lp-cta-fill"
                style={{
                  background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 600, fontSize: 14, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <span>{t.hero.ctaPrimary}</span>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#producto"
                className="lp-cta-fill"
                style={{
                  background: "var(--surface)", color: "var(--page-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 500, fontSize: 14, textDecoration: "none",
                  border: "0.5px solid var(--hairline-color)",
                }}
              >
                <span>{t.hero.ctaSecondary}</span>
              </a>
            </div>

            <p
              className="lp-hero-pricing"
              style={{
                marginTop: 16, fontSize: 13, color: "var(--text-muted)",
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 999,
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                fontWeight: 600, color: "var(--page-fg)",
              }}>
                {STANDARD_PLAN_PRICE_LABEL_ES}
              </span>
              <span>{t.hero.trialBadge}</span>
            </p>
          </div>

          <div className="lp-hero-visual" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
            <HeroProductPreview />
          </div>
        </div>

        <div className="lp-benefit-strip lp-reveal-block">
          {benefits.map((benefit) => (
            <div className="lp-benefit-card" key={benefit.title}>
              <strong>{benefit.title}</strong>
              <span>{benefit.body}</span>
            </div>
          ))}
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

/* ─── POSShowcase ────────────────────────────────────────────────────────── */
function POSShowcase() {
  return (
    <section id="producto" className="lp-product-section lp-section lp-reveal-block" style={{ background: "var(--surface)", borderBottom: "0.5px solid var(--hairline-color)" }}>
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 28 }}>
          <span className="lp-section-label">{t.posShowcase.eyebrow}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.6fr)", gap: 40, alignItems: "end", marginBottom: 36 }} className="lp-showcase-head">
          <h2 className="lp-section-title">
            {t.posShowcase.titleLine1}<br />{t.posShowcase.titleLine2}
          </h2>
          <p className="lp-section-copy" style={{ margin: 0, paddingBottom: 4 }}>
            {t.posShowcase.body}
          </p>
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 32, alignItems: "center" }} className="lp-showcase-row">
          <SweetHomePOSPreview />
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
    <section id="como-funciona" className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label">{t.features.eyebrow}</span>
        </div>
        <h2 className="lp-section-title" style={{ maxWidth: 720 }}>
          {t.features.title}
        </h2>
        <p className="lp-section-copy">
          {t.features.lead}
        </p>

        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "0.5px solid var(--hairline-color)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }} className="lp-3cols">
          {feats.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "26px 24px",
                borderRight: i % 3 !== 2 ? "0.5px solid var(--hairline-color)" : "none",
                borderBottom: i < 3 ? "0.5px solid var(--hairline-color)" : "none",
                display: "flex", flexDirection: "column", gap: 10, minHeight: 205,
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
    <section className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label">
            {t.firstDay.eyebrow}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.72fr)", gap: 40, alignItems: "end", marginBottom: 36 }} className="lp-showcase-head">
          <h2 className="lp-section-title">
            {t.firstDay.titleLine1}<br />{t.firstDay.titleLine2}
          </h2>
          <p className="lp-section-copy" style={{ margin: 0, paddingBottom: 4 }}>
            {t.firstDay.body}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0,
            border: "0.5px solid var(--hairline-color)",
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--surface)",
          }}
          className="lp-4cols"
        >
          {steps.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "24px 22px",
                borderRight: i < steps.length - 1 ? "0.5px solid var(--hairline-color)" : "none",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 178,
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)", letterSpacing: "0.08em" }}>
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
            marginTop: 28,
            padding: "20px 24px",
            borderRadius: 12,
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
            className="lp-cta-fill"
            style={{
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "12px 20px", borderRadius: 10,
              fontWeight: 600, fontSize: 14, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            <span>{t.firstDay.ctaButton}</span>
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
    <section id="comercios" className="lp-section lp-reveal-block" style={{ background: "var(--kova-ink)", color: "var(--kova-on-ink)" }}>
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label" style={{ color: "var(--kova-tertiary)" }}>{t.builtFor.eyebrow}</span>
        </div>
        <h2 className="lp-section-title" style={{ maxWidth: 760, color: "var(--kova-on-ink)" }}>
          {t.builtFor.title}
        </h2>
        <p className="lp-section-copy" style={{ color: "rgba(240,244,255,0.65)" }}>
          {t.builtFor.body}
        </p>

        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.08)" }} className="lp-3cols">
          {types.map((type, i) => (
            <div
              key={type.name}
              style={{ background: "var(--kova-ink)", padding: "24px 22px", display: "flex", flexDirection: "column", gap: 10, minHeight: 170, transition: "background 220ms", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1A1D28")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--kova-ink)")}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>0{i + 1}</span>
                <LogoMark size={22} circuitColor="rgba(255,255,255,0.4)" coreColor="var(--kova-blue-light)" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", margin: 0, color: "#fff" }}>{type.name}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "rgba(240,244,255,0.6)" }}>{type.body}</p>
              <div style={{ marginTop: "auto", fontSize: 11, color: "var(--kova-blue-light)" }}>↳ {type.tag}</div>
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
    <section id="faq" className="lp-section lp-section-compact lp-reveal-block">
      <div className="lp-section-inner" style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label">
            {t.faq.eyebrow}
          </span>
        </div>
        <h2 className="lp-section-title" style={{ maxWidth: 720 }}>
          {t.faq.title}
        </h2>

        <div style={{ marginTop: 34, borderTop: "0.5px solid var(--hairline-color)" }}>
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
                    padding: "18px 4px",
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
                      padding: "0 4px 20px",
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
    <section id="precio" className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24, justifyContent: "center" }}>
          <span className="lp-section-label">{t.pricing.eyebrow}</span>
        </div>
        <h2 className="lp-section-title" style={{ textAlign: "center" }}>
          {t.pricing.titleLine1}<br />{t.pricing.titleLine2}
        </h2>
        <p className="lp-section-copy" style={{ maxWidth: 620, textAlign: "center", marginLeft: "auto", marginRight: "auto" }}>
          {t.pricing.leadStart}
          <strong style={{ color: "var(--page-fg)", fontWeight: 600 }}>{t.pricing.leadEmphasis}</strong>
          {t.pricing.leadEnd}
        </p>

        <div style={{ marginTop: 34, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
          <div
            style={{
              borderRadius: 12, padding: 30,
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
              className="lp-cta-fill"
              style={{
                width: "100%", background: "var(--kova-blue)", color: "#fff",
                padding: "14px 16px", borderRadius: 10, border: "none",
                fontWeight: 600, fontSize: 14, fontFamily: "inherit",
                textAlign: "center", textDecoration: "none", display: "block",
              }}
            >
              <span>{t.pricing.ctaButton}</span>
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
    min-width: 100%;
    max-width: 100%;
    overflow-x: clip;
    background: var(--page-bg);
  }
  .lp-root > section { width: 100%; }
  .lp-root *, .lp-root *::before, .lp-root *::after {
    box-sizing: border-box;
  }
  .lp-pos-preview,
  .lp-hero-preview {
    max-width: 100%;
  }
  @media (max-width: 900px) {
    .lp-section { padding: 72px 24px !important; }
    .lp-section-compact { padding: 60px 24px !important; }
    .lp-section-inner { max-width: 100% !important; }
    .lp-hero-grid, .lp-showcase-row, .lp-showcase-head, .lp-2cols {
      grid-template-columns: 1fr !important;
    }
    .lp-3cols { grid-template-columns: 1fr !important; }
    .lp-4cols { grid-template-columns: 1fr 1fr !important; }
    .lp-benefit-strip { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 28px !important; }
    .lp-4cols > div { border-right: none !important; border-bottom: 0.5px solid var(--hairline-color) !important; }
    .lp-4cols > div:nth-child(2n) { border-right: none !important; }
    .lp-4cols > div:last-child { border-bottom: none !important; }
    .lp-4cols > div:nth-last-child(2) { border-bottom: none !important; }
    .lp-4cols > div:nth-child(odd) { border-right: 0.5px solid var(--hairline-color) !important; }
    .lp-footer-grid { grid-template-columns: 1fr 1fr !important; }
    .lp-hero-section { min-height: auto !important; padding: 44px 24px 56px !important; }
    .lp-hero-grid { gap: 32px !important; margin-top: 16px !important; }
    .lp-hero-title {
      font-size: 38px !important;
      letter-spacing: 0 !important;
      line-height: 1 !important;
    }
    .lp-hero-copy { font-size: 17px !important; max-width: 100% !important; }
    .lp-hero-visual { order: -1; max-width: 100% !important; }
    .lp-product-section { padding: 88px 24px !important; }
    .lp-showcase-row { gap: 24px !important; }
    .lp-pos-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  }
  @media (max-width: 640px) {
    .lp-section { padding: 58px 20px !important; }
    .lp-section-compact { padding: 52px 20px !important; }
    .lp-section-title { font-size: 32px !important; line-height: 1.06 !important; }
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
    .lp-hero-section { padding: 28px 20px 44px !important; }
    .lp-hero-title { font-size: 31px !important; }
    .lp-hero-copy { font-size: 15px !important; margin-top: 14px !important; }
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
    .lp-product-section { padding: 72px 20px !important; }
    .lp-pos-preview { grid-template-columns: 1fr !important; }
    .lp-pos-main {
      border-right: none !important;
      border-bottom: 0.5px solid var(--hairline-color) !important;
    }
    .lp-pos-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
    .lp-pos-lines { max-height: 132px !important; }
    .lp-pos-methods { display: none !important; }
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
  useLandingRevealMotion();

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
        <POSShowcase />
        <Features />
        <FirstDay primaryTarget={primaryTarget} />
        <BuiltFor />
        <Pricing primaryTarget={primaryTarget} />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
