import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button size="sm" variant="default" onClick={() => toast("Operation succeeded", "success")}>
        success
      </Button>
      <Button size="sm" variant="outline" onClick={() => toast("Something went wrong", "error")}>
        error
      </Button>
      <Button size="sm" variant="outline" onClick={() => toast("Heads up", "warning")}>
        warning
      </Button>
      <Button size="sm" variant="outline" onClick={() => toast("FYI", "info")}>
        info
      </Button>
    </div>
  );
}

// Class names are written out in full, never interpolated: Tailwind's scanner is
// a static string match, so `duration-${name}` would compile to nothing.
const DURATION_TOKENS = [
  { name: "duration-press", cls: "duration-press", ms: "80ms", use: "hot controls, 100+ taps/day" },
  { name: "duration-quick", cls: "duration-quick", ms: "120ms", use: "chip toggle, icon swap" },
  { name: "duration-hover", cls: "duration-hover", ms: "180ms", use: "the default hover" },
  { name: "duration-panel", cls: "duration-panel", ms: "240ms", use: "toast, popover, inline reveal" },
  { name: "duration-modal", cls: "duration-modal", ms: "280ms", use: "dialog, sidebar, bottom sheet" },
  { name: "duration-celebrate", cls: "duration-celebrate", ms: "600ms", use: "rare moments only" },
  { name: "duration-panel-exit", cls: "duration-panel-exit", ms: "160ms", use: "~0.65x panel" },
  { name: "duration-modal-exit", cls: "duration-modal-exit", ms: "180ms", use: "~0.65x modal" },
] as const;

const EASING_TOKENS = [
  { name: "ease-standard", cls: "ease-standard", use: "the default; same curve as ease-out" },
  { name: "ease-entrance", cls: "ease-entrance", use: "entrances that travel" },
  { name: "ease-exit", cls: "ease-exit", use: "accelerating — reads as gone" },
  { name: "ease-spring", cls: "ease-spring", use: "overshoot, confirmation only" },
] as const;

/**
 * Hover swatches for the motion scale. Exists so timing arguments can be settled
 * by looking rather than by asserting — every duration in the system, side by
 * side, moving the same distance.
 */
function MotionSwatches() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <p style={{ fontSize: 12, color: "var(--kova-muted)", margin: "0 0 8px" }}>
          Durations — hover a row (all on ease-standard)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DURATION_TOKENS.map((token) => (
            <div key={token.name} className="group flex items-center gap-3">
              <code style={{ fontSize: 11, width: 130, color: "var(--kova-muted)" }}>
                {token.name}
              </code>
              <div className="h-6 flex-1 overflow-hidden rounded-kova-sm bg-kova-mist">
                <div
                  className={cn(
                    "h-full w-6 rounded-kova-sm bg-kova-blue transition-transform ease-standard group-hover:translate-x-[700%]",
                    token.cls,
                  )}
                />
              </div>
              <span style={{ fontSize: 11, width: 60, color: "var(--kova-ink)" }}>{token.ms}</span>
              <span style={{ fontSize: 11, color: "var(--kova-tertiary)" }}>{token.use}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p style={{ fontSize: 12, color: "var(--kova-muted)", margin: "0 0 8px" }}>
          Easings — hover a row (all at duration-modal)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {EASING_TOKENS.map((token) => (
            <div key={token.name} className="group flex items-center gap-3">
              <code style={{ fontSize: 11, width: 130, color: "var(--kova-muted)" }}>
                {token.name}
              </code>
              <div className="h-6 flex-1 overflow-hidden rounded-kova-sm bg-kova-mist">
                <div
                  className={cn(
                    "h-full w-6 rounded-kova-sm bg-kova-growth transition-transform duration-modal group-hover:translate-x-[700%]",
                    token.cls,
                  )}
                />
              </div>
              <span style={{ fontSize: 11, color: "var(--kova-tertiary)" }}>{token.use}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  surface,
  textColor,
  children,
}: {
  title: string;
  surface: string;
  textColor: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: surface,
        color: textColor,
        padding: 32,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <h2
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity: 0.7,
          margin: 0,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.04em" }}>{label}</span>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function PrimitivesGrid() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Row label="Button · variants (default size)">
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </Row>
      <Row label="Button · sizes">
        <Button size="sm">sm</Button>
        <Button size="default">default</Button>
        <Button size="lg">lg</Button>
        <Button size="xl">xl</Button>
        <Button size="icon" aria-label="icon">★</Button>
      </Row>
      <Row label="Button · disabled">
        <Button disabled>Default disabled</Button>
        <Button variant="outline" disabled>Outline disabled</Button>
      </Row>

      <Row label="Badge · variants">
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
      </Row>

      <Row label="Input / Select / Label">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <Label htmlFor="preview-input">Correo</Label>
          <Input id="preview-input" placeholder="tu@ejemplo.com" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <Label htmlFor="preview-select">Moneda</Label>
          <Select id="preview-select" defaultValue="mxn">
            <option value="mxn">MXN</option>
            <option value="usd">USD</option>
          </Select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <Label htmlFor="preview-input-disabled">Deshabilitado</Label>
          <Input id="preview-input-disabled" placeholder="deshabilitado" disabled />
        </div>
      </Row>

      <Row label="Skeleton">
        <Skeleton style={{ width: 220, height: 14 }} />
        <Skeleton style={{ width: 120, height: 14 }} />
        <Skeleton style={{ width: 80, height: 80, borderRadius: 8 }} />
      </Row>

      <Row label="Card">
        <Card style={{ width: 280 }}>
          <CardHeader>
            <CardTitle>Daily sales</CardTitle>
            <CardDescription>Real numbers, no demo data.</CardDescription>
          </CardHeader>
          <CardContent>
            <p style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>$1,248.50</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm">View report</Button>
          </CardFooter>
        </Card>
      </Row>

      <Row label="Dialog">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>This is the Kova-styled dialog preview.</DialogDescription>
          </DialogHeader>
          <p style={{ fontSize: 14 }}>Body content lives here.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
          </DialogFooter>
        </Dialog>
      </Row>

      <Row label="Toast (click to fire)">
        <ToastDemo />
      </Row>
    </>
  );
}

export default function ComponentsPreview() {
  return (
    <ToastProvider>
      <main
        style={{
          minHeight: "100vh",
          background: "var(--kova-mist)",
          padding: 48,
          fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
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
          <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.8px", margin: "8px 0 0" }}>
            UI primitives
          </h1>
          <p style={{ color: "var(--kova-muted)", fontSize: 14, marginTop: 8 }}>
            Every primitive in every variant, rendered on light and dark surfaces.
          </p>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1100 }}>
          <Section title="On white" surface="#FFFFFF" textColor="var(--kova-ink)">
            <PrimitivesGrid />
          </Section>
          <Section title="On --kova-ink" surface="var(--kova-ink)" textColor="#FFFFFF">
            <PrimitivesGrid />
          </Section>
          <Section title="Motion scale" surface="#FFFFFF" textColor="var(--kova-ink)">
            <MotionSwatches />
          </Section>
        </div>
      </main>
    </ToastProvider>
  );
}
