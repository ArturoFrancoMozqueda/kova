import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Product } from "@/catalog/types";
import { formatStockQuantity, stockUnitOf } from "@/catalog/units";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { copy } from "@/i18n/messages";
import { resolveUserFacingError } from "@/lib/apiError";
import { formatMoney } from "@/orders/format";
import { centsToMoney, moneyToCents } from "@/lib/money";
import type { CostedLine, IngredientLine } from "./api";

type Loaded = { lines: CostedLine[]; cost: string | null; batchYield?: number | null; costPerPiece?: string | null };
type Draft = { key: string; ingredientId: string; quantity: string };

/**
 * Edits the ingredients of a recipe (positive amounts) or of a modifier option
 * (signed amounts). Costs always come from the server; the form never guesses.
 */
export function IngredientLinesDialog({
  title,
  description,
  ingredients,
  signed = false,
  withYield = false,
  load,
  save,
  onClose,
  onSaved,
}: {
  title: string;
  description: string;
  ingredients: Product[];
  signed?: boolean;
  /** Production recipes state how many pieces one batch yields. */
  withYield?: boolean;
  load: () => Promise<Loaded>;
  save: (lines: IngredientLine[], idempotencyKey: string, batchYield?: number) => Promise<Loaded>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [yieldDraft, setYieldDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Reused until the server confirms, so a retry after a lost response is the same save.
  const saveKey = useRef<string | null>(null);
  const baseId = useId();
  const byId = new Map(ingredients.map((product) => [product.id, product]));

  const apply = (data: Loaded) => {
    setLoaded(data);
    setDrafts(data.lines.map((line) => ({ key: line.ingredient_product_id, ingredientId: line.ingredient_product_id, quantity: String(line.quantity) })));
    setYieldDraft(data.batchYield ? String(data.batchYield) : "");
  };

  useEffect(() => {
    let alive = true;
    load().then(
      (data) => { if (alive) { apply(data); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
    // Loads once per open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = drafts.map((draft) => ({ ...draft, value: Number(draft.quantity) }));
  const invalid = parsed.some((draft) => !draft.ingredientId || !Number.isInteger(draft.value) || draft.value === 0 || (!signed && draft.value < 0) || Math.abs(draft.value) > 1_000_000);
  const duplicate = new Set(parsed.map((draft) => draft.ingredientId)).size !== parsed.length;
  const yieldValue = Number(yieldDraft);
  const invalidYield = withYield && (!Number.isInteger(yieldValue) || yieldValue < 1 || yieldValue > 1_000_000);
  const changed = JSON.stringify(parsed.map((d) => [d.ingredientId, d.value])) !== JSON.stringify((loaded?.lines ?? []).map((l) => [l.ingredient_product_id, l.quantity]))
    || (withYield && yieldValue !== (loaded?.batchYield ?? 0));

  const submit = async () => {
    if (invalid || invalidYield || duplicate || saving) return;
    setSaving(true);
    setError("");
    saveKey.current ??= crypto.randomUUID();
    try {
      const data = await save(parsed.map((draft) => ({ ingredient_product_id: draft.ingredientId, quantity: draft.value })), saveKey.current, withYield ? yieldValue : undefined);
      saveKey.current = null;
      apply(data);
      onSaved(copy.recipes.saved);
    } catch (caught) {
      setError(resolveUserFacingError(caught, copy.recipes.saveError));
    } finally {
      setSaving(false);
    }
  };

  const unitFor = (ingredientId: string) => stockUnitOf(byId.get(ingredientId));

  return (
    <Dialog open onClose={saving ? () => undefined : onClose}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {state === "loading" && <p className="text-sm text-muted-foreground" role="status">{copy.recipes.loading}</p>}
      {state === "error" && <p className="text-sm text-destructive" role="alert">{copy.recipes.loadError}</p>}
      {state === "ready" && (
        <div className="space-y-4">
          {withYield && (
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-yield`}>{copy.production.batchYield}</Label>
              <Input id={`${baseId}-yield`} className="w-32" type="number" inputMode="numeric" min={1} step={1} value={yieldDraft} disabled={saving} onChange={(event) => setYieldDraft(event.target.value)} aria-invalid={invalidYield ? "true" : undefined} />
            </div>
          )}
          {ingredients.length === 0 ? (
            <p className="rounded-lg border p-3 text-sm">{copy.recipes.noIngredients}</p>
          ) : drafts.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{signed ? copy.recipes.emptyOption : copy.recipes.emptyRecipe}</p>
          ) : null}
          <ul className="space-y-3">
            {drafts.map((draft, index) => {
              const unit = unitFor(draft.ingredientId);
              const line = loaded?.lines.find((row) => row.ingredient_product_id === draft.ingredientId && String(row.quantity) === draft.quantity);
              const quantityId = `${baseId}-qty-${index}`;
              const ingredientId = `${baseId}-ing-${index}`;
              return (
                <li key={draft.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2 rounded-lg border p-3">
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor={ingredientId}>{copy.recipes.ingredient}</Label>
                    <Select id={ingredientId} value={draft.ingredientId} disabled={saving} onChange={(event) => setDrafts((rows) => rows.map((row) => row.key === draft.key ? { ...row, ingredientId: event.target.value } : row))}>
                      <option value="">{copy.recipes.chooseIngredient}</option>
                      {ingredients.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={quantityId}>{copy.recipes.quantity(unit)}</Label>
                    <Input id={quantityId} type="number" inputMode="numeric" step={1} min={signed ? -1_000_000 : 1} max={1_000_000} value={draft.quantity} disabled={saving} onChange={(event) => setDrafts((rows) => rows.map((row) => row.key === draft.key ? { ...row, quantity: event.target.value } : row))} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={saving} aria-label={copy.recipes.remove(byId.get(draft.ingredientId)?.name ?? copy.recipes.ingredient)} onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {line && (
                    <p className="col-span-3 text-xs text-muted-foreground">
                      {formatStockQuantity(line.quantity, unit)} · {line.cost === null ? copy.recipes.noCost : formatMoney(line.cost)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {ingredients.length > 0 && (
            <Button type="button" variant="outline" disabled={saving || drafts.length >= 50} onClick={() => setDrafts((rows) => [...rows, { key: crypto.randomUUID(), ingredientId: "", quantity: "" }])}>
              <Plus className="h-4 w-4" />
              {copy.recipes.addIngredient}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{signed ? copy.recipes.signedHint : copy.recipes.recipeHint}</p>
          {(duplicate || (invalid && drafts.length > 0)) && (
            <p className="text-sm text-destructive" role="alert">{duplicate ? copy.recipes.duplicate : copy.recipes.invalid(signed)}</p>
          )}
          {loaded && !changed && loaded.lines.length > 0 && (
            <p className="rounded-lg bg-kova-mist p-3 text-sm" aria-live="polite">
              {loaded.cost !== null
                ? (signed
                    ? copy.recipes.optionCost(formatMoney(loaded.cost))
                    : withYield && loaded.costPerPiece
                      ? copy.production.costPerPiece(formatMoney(loaded.costPerPiece))
                      : copy.recipes.recipeCost(formatMoney(loaded.cost)))
                : copy.recipes.incompleteCost(
                    formatMoney(centsToMoney(loaded.lines.reduce((sum, line) => sum + (line.cost === null ? 0 : moneyToCents(line.cost)), 0))),
                    loaded.lines.filter((line) => line.cost === null).length,
                  )}
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{copy.recipes.close}</Button>
        <Button type="button" disabled={state !== "ready" || saving || invalid || invalidYield || duplicate || !changed} onClick={() => void submit()}>
          {saving ? copy.recipes.saving : copy.recipes.save}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
