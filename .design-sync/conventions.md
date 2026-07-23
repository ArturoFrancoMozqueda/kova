# Kova UI — build conventions

Kova is a POS + business-analytics SaaS for Mexican SMBs. Screens must feel
premium, calm, and trustworthy — white surfaces, thin borders, one accent color,
strong tabular numbers. **All user-facing copy is Spanish (es-MX)**: real POS
language ("Cobrar", "Corte de caja", "Ventas de hoy"), realistic MXN amounts
(`$1,234.00`), never lorem/demo filler.

## Setup

No theme provider is needed — tokens are global CSS. Two wrappers matter:

- `ToastProvider` around any screen that calls `useToast()` (returns
  `{ toast(message, "success" | "error" | "warning" | "info" | { variant, action, durationMs }) }`).
- `MemoryRouter` (exported from this DS) around anything that renders router
  links — `ViewPermissionDenied`, `ViewEmpty` with a `{ label, to }` CTA.

## Styling idiom: Tailwind utilities with Kova vocabulary

Style layout glue with Tailwind classes. Prefer the Kova names — they carry the
brand:

| Family | Real names |
|---|---|
| Brand colors | `bg/text/border-kova-ink` (near-black, primary buttons), `kova-blue` (#4F7EF7 accent, focus rings), `kova-mist` (light grey surface), `kova-growth` (positive green), `kova-danger`, `kova-muted` / `kova-tertiary` (secondary text), `kova-border` |
| Semantic | `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-destructive`, `bg-success`, `bg-warning`, `text-warning-strong` (WCAG-safe amber for text on light) |
| Tints | Only the semantic (HSL) colors take alpha modifiers: `bg-warning/20`, `bg-destructive/10`, `bg-success/15`, `bg-primary/10`. **`kova-*` colors do NOT support `/N` tints** (plain `var()` values — the class won't compile); use a semantic tint or a `bg-kova-grad-*` wash instead. |
| Radii | `rounded-kova-sm` (8px) `-md` (12px) `-lg` (16px) `-xl` (20px) — cards use `rounded-kova-lg` |
| Shadows | `shadow-kova-card`, `shadow-kova-card-hover`, `shadow-kova-hero` |
| Gradients | `bg-kova-grad-blue`, `bg-kova-grad-mint`, `bg-kova-grad-sky` (pastel KPI washes) |
| Motion | `animate-fade-in`, `animate-scale-in`, `animate-slide-in-right`, `animate-slide-up`, `animate-pulse-soft` |

House patterns: cards are `bg-white` + `border-[0.5px] border-kova-border` +
`rounded-kova-lg` + `shadow-kova-card`; money/quantity text takes
`tabular-nums`; section kickers use `ArcKicker`; KPI numbers are
`text-2xl font-bold text-kova-ink`. Typography is Inter Variable (default
`font-sans` — already loaded; don't add font families).

## Where the truth lives

- `styles.css` → `_ds_bundle.css` holds every token (`--kova-*`, semantic HSL
  vars, `--ticket-*`) and all compiled utilities — read it before inventing a
  class; **a Tailwind class not present there will silently not resolve**.
- Per-component API + usage: `components/<group>/<Name>/<Name>.d.ts` and
  `<Name>.prompt.md`.

## Idiomatic example

```tsx
import { StatTile, DeltaChip, Button } from "pos-frontend";
import { Banknote } from "lucide-react";

<div className="grid gap-4 sm:grid-cols-3 p-6 bg-background">
  <StatTile label="Ventas de hoy" value="$8,420.00" icon={<Banknote className="h-4 w-4" />}>
    <DeltaChip growth={{ kind: "pct", value: 12.4 }} current={8420} previous={7490}
      format="money" compareLabel="vs ayer" />
  </StatTile>
  <Button size="xl">Cobrar $245.50</Button>
</div>
```

Compound pieces compose, not configure: `Card`+`CardHeader`+`CardTitle`+
`CardContent`+`CardFooter`; `Dialog`+`DialogHeader`+`DialogTitle`+
`DialogDescription`+`DialogFooter` (render open with `open` + `onClose`);
receipts are `TicketPaper` wrapping `TicketLeaderRow`s.
