import { useState } from "react";
import IntroAnimation, { type IntroAnimationProps } from "@/components/brand/IntroAnimation";

type SlotProps = {
  title: string;
  description: string;
  props: Partial<IntroAnimationProps>;
  forceReduced: boolean;
  /** When true, the animation renders on a plain --kova-ink surface so the
   *  embedded variant can be evaluated without the default frame chrome. */
  inkSurface?: boolean;
};

function Slot({ title, description, props, forceReduced, inkSurface = false }: SlotProps) {
  const [replayKey, setReplayKey] = useState(0);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, width: 360 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "var(--kova-ink)" }}>
            {title}
          </h2>
          <p style={{ fontSize: 12, color: "var(--kova-muted)", margin: "4px 0 0" }}>
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReplayKey((k) => k + 1)}
          style={{
            border: "0.5px solid var(--kova-border)",
            background: "#FFFFFF",
            borderRadius: 8,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            color: "var(--kova-ink)",
            fontFamily: "inherit",
          }}
        >
          Replay
        </button>
      </header>

      {inkSurface ? (
        <div
          style={{
            background: "var(--kova-ink)",
            padding: 48,
            borderRadius: 14,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <IntroAnimation key={replayKey} {...props} forceReducedMotion={forceReduced} />
        </div>
      ) : (
        <IntroAnimation key={replayKey} {...props} forceReducedMotion={forceReduced} />
      )}
    </section>
  );
}

export default function IntroPreview() {
  const [forceReduced, setForceReduced] = useState(false);

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
      <header
        style={{
          marginBottom: 32,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
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
            Intro animation
          </h1>
          <p style={{ color: "var(--kova-muted)", fontSize: 14, marginTop: 8, maxWidth: 540 }}>
            Three usage contexts. Each card has a Replay button to re-trigger the sequence without
            reloading the page. The toggle below simulates <code>prefers-reduced-motion: reduce</code>
            so you can verify the collapsed final state.
          </p>
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--kova-ink)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={forceReduced}
            onChange={(e) => setForceReduced(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Simulate prefers-reduced-motion
        </label>
      </header>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <Slot
          title="Default"
          description="All props default: labels + wordmark + badge, dark tone."
          props={{}}
          forceReduced={forceReduced}
        />
        <Slot
          title="Sin labels"
          description="showLabels={false} — circuit, core and wordmark only."
          props={{ showLabels: false }}
          forceReduced={forceReduced}
        />
        <Slot
          title="Sin wordmark"
          description="showWordmark={false} showBadge={false} — animated isotipo as decoration."
          props={{ showWordmark: false, showBadge: false }}
          forceReduced={forceReduced}
        />
        <Slot
          title="Embedded"
          description="embedded={true} — no frame, no background, no internal decor. Hosted on a plain --kova-ink surface to validate the inline integration form."
          props={{ embedded: true }}
          forceReduced={forceReduced}
          inkSurface
        />
      </div>
    </main>
  );
}
