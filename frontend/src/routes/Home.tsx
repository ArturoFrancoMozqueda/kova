import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import IntroAnimation from "@/components/brand/IntroAnimation";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";

/* ─── Theme ──────────────────────────────────────────────────────────────── */
type Theme = "light" | "dark";
const THEME_KEY = "kova-landing-theme";

function useLandingTheme(): [Theme, (t: Theme) => void, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* quota / private mode */ }
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return [theme, setTheme, toggle];
}

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

/* ─── Money formatter ────────────────────────────────────────────────────── */
function formatMXN(n: number, opts: { hideCurrency?: boolean } = {}) {
  return (opts.hideCurrency ? "" : "$") +
    Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── ThemeToggle ────────────────────────────────────────────────────────── */
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
      style={{
        width: 34, height: 34, borderRadius: 8,
        border: "0.5px solid var(--hairline-color)",
        background: "var(--surface)",
        color: "var(--page-fg)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        transition: "all 150ms var(--kova-ease-entrance)",
      }}
    >
      {theme === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

/* ─── Navbar ─────────────────────────────────────────────────────────────── */
function Navbar({
  primaryTarget,
  isAuthenticated,
  theme,
  onToggleTheme,
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
  theme: Theme;
  onToggleTheme: () => void;
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

        <div style={{ display: "flex", gap: 28, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }} className="hidden md:flex">
          {[
            { label: "Producto", href: "#producto" },
            { label: "Cómo funciona", href: "#como-funciona" },
            { label: "Precio", href: "#precio" },
            { label: "Comercios", href: "#comercios" },
          ].map((l) => (
            <a key={l.label} href={l.href} style={{ color: "inherit", textDecoration: "none", transition: "color 150ms" }}
               onMouseEnter={(e) => (e.currentTarget.style.color = "var(--page-fg)")}
               onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {l.label}
            </a>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {!isAuthenticated && (
            <Link
              to="/login"
              style={{
                fontSize: 13, fontWeight: 500, color: "var(--page-fg)",
                padding: "8px 12px", textDecoration: "none",
              }}
              className="hidden sm:inline-flex"
            >
              Iniciar sesión
            </Link>
          )}
          <Link
            to={primaryTarget}
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "9px 14px", borderRadius: 8, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {isAuthenticated ? "Ir al dashboard" : "Crear cuenta"}
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
function MxnTicker() {
  const [v, setV] = useState(847_392);
  useEffect(() => {
    const start = Date.now();
    const base = 847_392;
    const id = setInterval(() => {
      const dt = (Date.now() - start) / 1000;
      setV(Math.floor(base + dt * 1847 + Math.sin(dt) * 12));
    }, 80);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular">${v.toLocaleString("es-MX")}</span>;
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero({ primaryTarget }: { primaryTarget: string }) {
  return (
    <section style={{ position: "relative", padding: "72px 32px 100px", overflow: "hidden" }}>
      <div className="lp-grid-bg" />
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto" }}>
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
            borderRadius: 999, padding: "6px 12px 6px 8px",
            fontSize: 12, fontWeight: 500, color: "var(--text-muted)",
          }}
        >
          <span className="lp-live-dot" />
          <span style={{ color: "var(--page-fg)" }}><MxnTicker /> MXN</span>
          procesados hoy en kova
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
            gap: 64, alignItems: "center", marginTop: 40,
          }}
          className="lp-hero-grid"
        >
          <div>
            <h1
              style={{
                fontSize: "clamp(48px, 7vw, 96px)",
                fontWeight: 600,
                letterSpacing: "-0.035em",
                lineHeight: 0.96,
                margin: 0,
                color: "var(--page-fg)",
              }}
            >
              Tu negocio,<br />
              en flujo{" "}
              <span style={{ position: "relative", whiteSpace: "nowrap" }}>
                constante
                <svg
                  viewBox="0 0 200 14" preserveAspectRatio="none"
                  style={{ position: "absolute", bottom: "-0.06em", left: 0, width: "100%", height: "0.18em" }}
                  aria-hidden="true"
                >
                  <path d="M2 8 Q 50 2, 100 7 T 198 6" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </span>.
            </h1>

            <p style={{ fontSize: 19, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 24, maxWidth: 480 }}>
              El punto de venta para PyMEs en México. Ventas, inventario y pagos
              orquestados desde un solo lugar — incluso sin internet.
            </p>

            <div style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
              <Link
                to={primaryTarget}
                style={{
                  background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 600, fontSize: 14, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                Empezar gratis
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
                Ver el POS en vivo →
              </a>
            </div>

            <div
              style={{
                marginTop: 56, display: "flex", alignItems: "center", gap: 24,
                fontSize: 12, color: "var(--text-muted)", paddingTop: 24,
                borderTop: "0.5px solid var(--hairline-color)", flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                Hecho en México · es-MX
              </span>
              <span>·</span>
              <span><strong style={{ color: "var(--page-fg)" }}>247</strong> negocios activos ahora mismo</span>
              <span>·</span>
              <span>Offline-first real</span>
            </div>
          </div>

          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IntroAnimation embedded skippable={false} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── ThreeNodes ─────────────────────────────────────────────────────────── */
function ThreeNodes() {
  const items = [
    {
      label: "Negocio",
      title: "Tu catálogo, tus reglas.",
      body: "Configura productos, modificadores, impuestos y sucursales sin tocar código. Lo que vendes y cómo lo vendes — tú decides.",
      meta: ["Catálogo", "Modificadores", "Inventario", "Sucursales"],
    },
    {
      label: "Cliente",
      title: "Cobra como ellos pagan.",
      body: "Efectivo, transferencia, tarjeta o split. Cobra una venta en menos de 4 toques. Recibos por correo o WhatsApp.",
      meta: ["Efectivo", "Transferencia", "Tarjeta", "Split"],
    },
    {
      label: "Dinero",
      title: "El flujo, en tiempo real.",
      body: "KPIs en vivo, cierres de turno automáticos, reportes por sucursal. Lo que entró y lo que falta, sin esperar al cierre.",
      meta: ["KPIs", "Turnos", "Reportes", "Reembolsos"],
    },
  ];
  return (
    <section id="como-funciona" style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 56 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Cómo funciona
          </span>
        </div>
        <h2 style={{ fontSize: "clamp(36px, 4.4vw, 60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 760 }}>
          Tres nodos. Un circuito. Cero fricción.
        </h2>
        <p style={{ marginTop: 20, fontSize: 18, color: "var(--text-muted)", maxWidth: 580, lineHeight: 1.5 }}>
          Cada venta es un pulso que viaja entre tu <em>negocio</em>, tu{" "}
          <em>cliente</em> y tu <em>dinero</em>. Kova mantiene los tres
          conectados, incluso cuando se cae el internet.
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
            Nodo · {label}
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
  { id: "p1", name: "Café americano", price: 38, cat: "cafés", icon: "☕" },
  { id: "p2", name: "Latte 12 oz", price: 52, cat: "cafés", icon: "🥛" },
  { id: "p3", name: "Capuchino", price: 48, cat: "cafés", icon: "☕" },
  { id: "p4", name: "Concha", price: 22, cat: "panadería", icon: "🥐" },
  { id: "p5", name: "Cuernito", price: 28, cat: "panadería", icon: "🥖" },
  { id: "p6", name: "Galleta avena", price: 18, cat: "panadería", icon: "🍪" },
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
  const [filter, setFilter] = useState("todos");
  const [pulseId, setPulseId] = useState<string | null>(null);

  const items = Object.entries(cart)
    .map(([id, qty]) => {
      const p = CATALOG.find((x) => x.id === id);
      return p ? { ...p, qty } : null;
    })
    .filter((x): x is Product & { qty: number } => !!x && x.qty > 0);
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const filtered = filter === "todos" ? CATALOG : CATALOG.filter((p) => p.cat === filter);

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
      style={{
        background: "var(--card-bg)", borderRadius: 10,
        border: "0.5px solid var(--hairline-color)", overflow: "hidden",
        boxShadow: "0 24px 60px -20px rgba(15,17,23,0.25)",
        display: "grid", gridTemplateColumns: "1fr 280px",
        height: 420, color: "var(--page-fg)",
      }}
    >
      <div style={{ borderRight: "0.5px solid var(--hairline-color)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LogoMark size={18} circuitColor="var(--page-fg)" coreColor="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Café Lupita · Caja 1</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <span className="lp-live-dot" /> En línea
          </div>
        </div>

        <div style={{ padding: "10px 20px", display: "flex", gap: 6, borderBottom: "0.5px solid var(--hairline-color)" }}>
          {["todos", "cafés", "panadería"].map((c) => (
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

        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1, alignContent: "start" }}>
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
                  {formatMXN(p.price)}
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

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface-2)" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "0.5px solid var(--hairline-color)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", fontWeight: 500 }}>
            Venta actual
          </div>
          <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-muted)" }}>
            {items.length} {items.length === 1 ? "artículo" : "artículos"}
          </div>
        </div>
        <div style={{ flex: 1, padding: "8px 16px", overflow: "auto" }}>
          {items.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>
              Agrega un producto del catálogo.
            </div>
          )}
          {items.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid var(--hairline-color)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
                <div className="tabular" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatMXN(i.price)} c/u</div>
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
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total</span>
            <span className="tabular" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{formatMXN(total)}</span>
          </div>
          <button
            style={{
              width: "100%", background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              border: "none", borderRadius: 8, padding: "10px 12px",
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            Cobrar {formatMXN(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── TabletPreview ──────────────────────────────────────────────────────── */
function TabletPreview() {
  const bars = [10, 8, 6, 4, 3, 12, 24, 38, 42, 30, 26, 28, 36, 48, 40, 32, 28, 38, 44, 50, 38, 22, 16, 10];
  return (
    <div
      style={{
        background: "var(--kova-ink)", borderRadius: 24, padding: 10,
        boxShadow: "0 24px 60px -20px rgba(15,17,23,0.35)",
        width: 280, height: 420, position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#2a2d38", zIndex: 2 }} />
      <div style={{ background: "var(--kova-paper, #FBFBFD)", borderRadius: 16, height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", color: "var(--kova-ink)" }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "0.5px solid var(--kova-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 10, color: "var(--kova-muted)", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500 }}>
              Hoy · May 17
            </div>
            <div style={{ fontSize: 10, color: "var(--kova-muted)", display: "flex", gap: 4, alignItems: "center" }}>
              <span className="lp-live-dot" /> Vivo
            </div>
          </div>
          <div className="tabular" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.04em", marginTop: 4 }}>
            $8,432<span style={{ fontSize: 14, color: "var(--kova-muted)", marginLeft: 6 }}>MXN</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--kova-growth)", marginTop: 2 }}>↑ 12% vs. ayer</div>
        </div>
        <div style={{ padding: "14px 14px 8px" }}>
          <div style={{ fontSize: 10, color: "var(--kova-muted)", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>
            Ventas por hora
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
            {bars.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 19 ? "var(--kova-blue)" : "#CDD4E3", borderRadius: 1, minHeight: 2 }} />
            ))}
          </div>
        </div>
        <div style={{ padding: "8px 14px", flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--kova-muted)", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>
            Órdenes recientes
          </div>
          {[
            { id: "#A-247", item: "Latte 12 oz · concha", amt: 74, time: "ahora" },
            { id: "#A-246", item: "2× americano", amt: 76, time: "2 min" },
            { id: "#A-245", item: "Capuchino · galleta", amt: 66, time: "8 min" },
          ].map((o, i) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid var(--kova-border)", animation: i === 0 ? "lp-feed-in 280ms var(--kova-ease-entrance)" : undefined }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--kova-muted)" }}>{o.id}</div>
                <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.item}</div>
              </div>
              <div style={{ textAlign: "right", marginLeft: 8 }}>
                <div className="tabular" style={{ fontSize: 12, fontWeight: 600 }}>{formatMXN(o.amt)}</div>
                <div style={{ fontSize: 9, color: "var(--kova-muted)" }}>{o.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── POSShowcase ────────────────────────────────────────────────────────── */
function POSShowcase() {
  return (
    <section id="producto" style={{ padding: "120px 32px", background: "var(--surface)", borderTop: "0.5px solid var(--hairline-color)", borderBottom: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 56 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>El producto</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.6fr)", gap: 56, alignItems: "end", marginBottom: 56 }} className="lp-showcase-head">
          <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0 }}>
            Hecho para vender,<br />no para configurar.
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, paddingBottom: 8 }}>
            Abre la caja, escanea, cobra. Funciona idéntico en laptop, tablet o
            teléfono — y sigue funcionando sin internet. Cuando vuelve la señal,
            todo se sincroniza solo.
          </p>
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 32, alignItems: "center" }} className="lp-showcase-row">
          <DesktopPreview />
          <TabletPreview />
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
  const feats: { kicker: string; title: string; body: string; kind: FeatKind }[] = [
    { kicker: "Offline-first", title: "Vende aunque se caiga el WiFi.", body: "Cola local en IndexedDB. Cuando vuelve la conexión, todo se sincroniza al backend sin que tú hagas nada.", kind: "offline" },
    { kicker: "Multi-tenant", title: "Un kova por cada negocio.", body: "Catálogo, impuestos, modificadores, usuarios — aislados por negocio. Multi-sucursal incluida.", kind: "tenant" },
    { kicker: "Pagos · MX", title: "Efectivo, transferencia, tarjeta.", body: "Cobra como tu cliente prefiera. Split entre métodos. Referencias automáticas para transferencias.", kind: "pay" },
    { kicker: "Tiempo real", title: "Métricas que laten contigo.", body: "KPIs, top productos, breakdown por método. Sin esperar al cierre del día.", kind: "live" },
    { kicker: "Turnos & caja", title: "Apertura, cierre, sin Excel.", body: "Movimientos de caja, diferencias, reportes por turno. Tu cajero abre, vende, cierra.", kind: "shift" },
    { kicker: "PWA instalable", title: "Se siente como app, vive en la web.", body: "Ícono en el escritorio o pantalla de inicio. Sin App Store, sin Play Store, sin instalador.", kind: "pwa" },
  ];
  return (
    <section style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Capacidades</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 700 }}>
          Lo que hace posible el flujo.
        </h2>

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

/* ─── BuiltFor ───────────────────────────────────────────────────────────── */
function BuiltFor() {
  const types = [
    { name: "Cafeterías", body: "Latte, americano, modificadores de leche, splits con el cliente. Línea rápida.", tag: "Café Lupita · CDMX" },
    { name: "Restaurantes", body: "Mesas, comandas, propinas, cocina. Modificadores por platillo.", tag: "Cocina La Doña · Monterrey" },
    { name: "Tiendas de barrio", body: "SKUs por código de barras, fiado opcional, refresco más cigarro en un toque.", tag: "Abarrotes Don Beto · Puebla" },
    { name: "Panaderías", body: "Por pieza, por kilo, charolas mixtas. Inventario que respira con el horno.", tag: "Panadería Mateo · Guadalajara" },
    { name: "Food trucks", body: "Sin internet, sin drama. Vende todo el día, sincroniza al volver a casa.", tag: "Tacos Sobre Ruedas · Tijuana" },
    { name: "Salones de belleza", body: "Servicios + productos. Comisiones por estilista, propinas, paquetes.", tag: "Salón Aurora · Mérida" },
  ];
  return (
    <section id="comercios" style={{ padding: "120px 32px", background: "var(--kova-ink)", color: "var(--kova-on-ink)", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>Para quién</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, maxWidth: 800, color: "var(--kova-on-ink)" }}>
          De la caja al cierre,<br />sin importar qué vendas.
        </h2>

        <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.08)" }} className="lp-3cols">
          {types.map((t, i) => (
            <div
              key={t.name}
              style={{ background: "var(--kova-ink)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 12, minHeight: 200, transition: "background 220ms", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1A1D28")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--kova-ink)")}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>0{i + 1}</span>
                <LogoMark size={22} circuitColor="rgba(255,255,255,0.4)" coreColor="var(--kova-blue-light)" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", margin: 0, color: "#fff" }}>{t.name}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "rgba(240,244,255,0.6)" }}>{t.body}</p>
              <div className="mono" style={{ marginTop: "auto", fontSize: 11, color: "var(--kova-blue-light)" }}>↳ {t.tag}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ────────────────────────────────────────────────────────────── */
function Pricing({ primaryTarget }: { primaryTarget: string }) {
  const feats = [
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
    <section id="precio" style={{ padding: "120px 32px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 32, justifyContent: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Precio</span>
        </div>
        <h2 style={{ fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.02, margin: 0, textAlign: "center" }}>
          Un solo plan. Sin letra chica.
        </h2>
        <p style={{ marginTop: 16, fontSize: 17, color: "var(--text-muted)", maxWidth: 540, textAlign: "center", marginLeft: "auto", marginRight: "auto" }}>
          Todo incluido. Sin comisiones por venta. Sin cobro por empleado. Cancela cuando quieras.
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
              <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-blue-light)" }}>Estándar</div>
              <div style={{ fontSize: 13, marginTop: 6, color: "rgba(240,244,255,0.6)" }}>Para PyMEs en operación</div>
            </div>

            <div className="tabular" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 16, opacity: 0.7 }}>$</span>
              <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1 }}>299</span>
              <span style={{ fontSize: 14, opacity: 0.7 }}>MXN / mes</span>
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
              Empieza 3 días gratis →
            </Link>
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(240,244,255,0.55)", marginTop: -10 }}>
              Sin tarjeta para empezar. Cancela cuando quieras.
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
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", gap: 48 }} className="lp-footer-grid">
          <div>
            <span style={{ color: "var(--page-fg)", display: "inline-flex" }}>
              <Logo size={24} circuitColor="currentColor" wordmarkColor="currentColor" coreColor="var(--accent)" />
            </span>
            <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 280, marginTop: 16, lineHeight: 1.55 }}>
              Punto de venta multi-tenant, offline-first, para PyMEs en México.
            </p>
            <div style={{ marginTop: 24, display: "flex", gap: 6, alignItems: "center" }}>
              <span className="lp-live-dot" />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Todos los sistemas operando con normalidad</span>
            </div>
          </div>
          <FooterCol title="Producto" links={["Punto de venta", "Catálogo", "Inventario", "Reportes", "PWA"]} />
          <FooterCol title="Soluciones" links={["Cafeterías", "Restaurantes", "Tiendas", "Panaderías", "Food trucks"]} />
          <FooterCol title="Compañía" links={["Sobre kova", "Blog", "Empleo", "Contacto"]} />
          <FooterCol title="Recursos" links={["Documentación", "API", "Estatus", "Seguridad"]} />
        </div>
        <div style={{ marginTop: 64, paddingTop: 24, borderTop: "0.5px solid var(--hairline-color)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap", gap: 16 }}>
          <span>© 2026 kova · hecho en México 🇲🇽</span>
          <div style={{ display: "flex", gap: 24 }}>
            <a href="#" style={footerLinkStyle}>Privacidad</a>
            <a href="#" style={footerLinkStyle}>Términos</a>
            <a href="mailto:posprojectsupport@gmail.com" style={footerLinkStyle}>Soporte</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
const footerLinkStyle: CSSProperties = { color: "var(--text-tertiary)", textDecoration: "none" };

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>{title}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {links.map((l) => (
          <li key={l}>
            <a href="#" style={{ fontSize: 14, color: "var(--text-muted)", textDecoration: "none", transition: "color 150ms" }}
               onMouseEnter={(e) => (e.currentTarget.style.color = "var(--page-fg)")}
               onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Responsive helper ──────────────────────────────────────────────────── */
const RESPONSIVE_STYLES = `
  @media (max-width: 900px) {
    .lp-hero-grid, .lp-showcase-row, .lp-showcase-head, .lp-2cols {
      grid-template-columns: 1fr !important;
    }
    .lp-3cols { grid-template-columns: 1fr !important; }
    .lp-footer-grid { grid-template-columns: 1fr 1fr !important; }
  }
  @media (max-width: 640px) {
    .lp-footer-grid { grid-template-columns: 1fr !important; }
  }
`;

/* ─── Home ───────────────────────────────────────────────────────────────── */
export default function Home(): ReactNode {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated";
  const primaryTarget = isAuthenticated ? "/dashboard" : "/signup";
  const [theme, , toggleTheme] = useLandingTheme();

  const rootStyle = useMemo(() => themeVars(theme), [theme]);

  return (
    <div className="lp-root" style={rootStyle}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_STYLES + RESPONSIVE_STYLES }} />
      <Navbar primaryTarget={primaryTarget} isAuthenticated={isAuthenticated} theme={theme} onToggleTheme={toggleTheme} />
      <main>
        <Hero primaryTarget={primaryTarget} />
        <ThreeNodes />
        <POSShowcase />
        <Features />
        <BuiltFor />
        <Pricing primaryTarget={primaryTarget} />
      </main>
      <Footer />
    </div>
  );
}
