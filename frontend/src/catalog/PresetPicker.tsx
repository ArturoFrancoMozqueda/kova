import { useEffect, useId, useState } from "react";
import { Coffee, Croissant, Eye, EyeOff, Loader2, ShoppingBag, ShoppingBasket, ShoppingCart, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LivePreview } from "@/components/ui/live-preview";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RegisterProductCard } from "@/register/RegisterPresentation";
import { getPresetPreview, type PresetName, type PresetPreview } from "../onboarding/api";
import { cn } from "@/lib/utils";

const presets: { preset: PresetName; label: string; desc: string; icon: LucideIcon }[] = [
  { preset: "abarrotes", label: copy.onboarding.presetGroceries, desc: copy.onboarding.presetGroceriesDesc, icon: ShoppingBasket },
  { preset: "cafe", label: copy.onboarding.presetCafe, desc: copy.onboarding.presetCafeDesc, icon: Coffee },
  { preset: "bakery", label: copy.onboarding.presetBakery, desc: copy.onboarding.presetBakeryDesc, icon: Croissant },
  { preset: "retail", label: copy.onboarding.presetRetail, desc: copy.onboarding.presetRetailDesc, icon: ShoppingBag },
];

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; data: PresetPreview }
  | { status: "error" };

/**
 * Starter catalogs for an empty catalog. "Ver cómo queda" renders the real
 * preset products with the same tile Caja uses, before anything is created.
 * Presets carry no photos, so tiles show no image, exactly like Caja would.
 */
export function PresetPicker({ disabled, onApply }: { disabled: boolean; onApply: (preset: PresetName) => void }) {
  const [open, setOpen] = useState<PresetName | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<PresetName, PreviewState>>>({});
  const [attempt, setAttempt] = useState(0);
  const idBase = useId();
  const panelId = `${idBase}-preview`;

  useEffect(() => {
    if (!open) return;
    const current = previews[open];
    if (current && current.status !== "error") return;
    let cancelled = false;
    setPreviews(prev => ({ ...prev, [open]: { status: "loading" } }));
    getPresetPreview(open).then(
      data => { if (!cancelled) setPreviews(prev => ({ ...prev, [open]: { status: "ready", data } })); },
      () => { if (!cancelled) setPreviews(prev => ({ ...prev, [open]: { status: "error" } })); },
    );
    return () => { cancelled = true; };
    // `previews` is read only to skip cached presets; refetch on open/attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  const openPreset = presets.find(item => item.preset === open);
  const state = open ? previews[open] : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {presets.map(({ preset, label, desc, icon: Icon }) => {
          const labelId = `${idBase}-${preset}`;
          const expanded = open === preset;
          return (
            <div key={preset} className={cn(
              "flex flex-col overflow-hidden rounded-kova-lg border-2 bg-white transition-[border-color,box-shadow] duration-hover ease-standard",
              expanded ? "border-kova-blue/60 shadow-kova-card-hover" : "border-kova-border hover:border-kova-blue/40 hover:shadow-kova-card-hover",
            )}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onApply(preset)}
                className="flex flex-1 items-start gap-3 p-4 text-left disabled:opacity-60"
              >
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-kova-md bg-kova-blue/10 text-kova-blue">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span id={labelId} className="block font-semibold text-sm">{label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
                </span>
              </button>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-describedby={labelId}
                onClick={() => setOpen(expanded ? null : preset)}
                className="flex items-center justify-center gap-1.5 border-t border-kova-border px-4 py-2 text-xs font-medium text-kova-blue hover:bg-kova-blue/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kova-blue"
              >
                {expanded ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                {expanded ? "Ocultar vista previa" : "Ver cómo queda"}
              </button>
            </div>
          );
        })}
        <div className="flex flex-col rounded-kova-lg border-2 border-dashed border-kova-border bg-white p-4 text-left sm:col-span-2 xl:col-span-4">
          <p className="font-semibold text-sm text-muted-foreground">{copy.onboarding.presetBlank}</p>
          <p className="text-xs text-muted-foreground mt-1">{copy.onboarding.presetBlankDesc}</p>
        </div>
      </div>

      <div id={panelId}>
        {openPreset && state?.status === "loading" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando vista previa…
          </p>
        )}
        {openPreset && state?.status === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-kova-lg border border-kova-border bg-white p-4 text-sm">
            <span>No pudimos mostrar la vista previa de {openPreset.label}. Puedes intentarlo de nuevo o usar la plantilla igual.</span>
            <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
          </div>
        )}
        {openPreset && state?.status === "ready" && (
          <LivePreview
            label={`Vista previa de la plantilla ${openPreset.label}`}
            title="Vista previa · Aún no se crea nada"
            summary={`${state.data.products.length} productos: ${state.data.products.map(product => `${product.name} ${formatMoney(product.price_amount)}`).join(", ")}.`}
            frame={{ caption: "Así se verá tu Caja", icon: <ShoppingCart className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> }}
            note={<div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {state.data.products.length} productos en {state.data.categories.length} categorías: {state.data.categories.join(", ")}. Sin fotos ni costos; podrás cambiar nombres y precios después.
              </span>
              <Button size="sm" disabled={disabled} onClick={() => onApply(openPreset.preset)}>
                Usar {openPreset.label}
              </Button>
            </div>}
            className="lg:static"
          >
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {state.data.products.map((product, index) => (
                <RegisterProductCard
                  key={`${index}-${product.name}`}
                  gridTile
                  ariaLabel={product.name}
                  name={product.name}
                  price={product.price_amount}
                />
              ))}
            </div>
          </LivePreview>
        )}
      </div>
    </div>
  );
}
