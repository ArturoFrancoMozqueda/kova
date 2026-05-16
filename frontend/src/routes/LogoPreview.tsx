import Logo, { LogoMark } from "@/components/brand/Logo";

type Row = { label: string; node: React.ReactNode };

function Section({
  title,
  background,
  textColor,
  rows,
}: {
  title: string;
  background: string;
  textColor: string;
  rows: Row[];
}) {
  return (
    <section
      style={{
        background,
        color: textColor,
        padding: "48px 32px",
        borderRadius: 14,
      }}
    >
      <h2
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity: 0.7,
          margin: 0,
          marginBottom: 32,
        }}
      >
        {title}
      </h2>
      <div style={{ display: "flex", gap: 48, alignItems: "flex-end", flexWrap: "wrap" }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ minHeight: 80, display: "flex", alignItems: "center" }}>{r.node}</div>
            <span style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.04em" }}>{r.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function LogoPreview() {
  const rows = (onDark: boolean): Row[] => [
    {
      label: "isotipo · 32px",
      node: <LogoMark size={32} circuitColor={onDark ? "#FFFFFF" : "var(--kova-ink)"} />,
    },
    {
      label: "isotipo · 48px",
      node: <LogoMark size={48} circuitColor={onDark ? "#FFFFFF" : "var(--kova-ink)"} />,
    },
    {
      label: "isotipo · 72px",
      node: <LogoMark size={72} circuitColor={onDark ? "#FFFFFF" : "var(--kova-ink)"} />,
    },
    {
      label: "horizontal · default (28px)",
      node: (
        <Logo
          variant="horizontal"
          circuitColor={onDark ? "#FFFFFF" : "var(--kova-ink)"}
          wordmarkColor={onDark ? "#FFFFFF" : "var(--kova-ink)"}
        />
      ),
    },
  ];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--kova-mist)",
        padding: 48,
        fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif",
        color: "var(--kova-ink)",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--kova-muted)",
          }}
        >
          Dev preview · not shipped to production
        </span>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.8px",
            margin: "8px 0 0",
          }}
        >
          Logo
        </h1>
        <p style={{ color: "var(--kova-muted)", fontSize: 14, marginTop: 8 }}>
          Brand mark for the Kova rebrand. Two variants, multiple sizes, on light and dark surfaces.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 }}>
        <Section
          title="On white"
          background="#FFFFFF"
          textColor="var(--kova-ink)"
          rows={rows(false)}
        />
        <Section
          title="On --kova-ink"
          background="var(--kova-ink)"
          textColor="#FFFFFF"
          rows={rows(true)}
        />
      </div>
    </main>
  );
}
