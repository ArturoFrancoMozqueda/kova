import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { formatStockQuantity } from "@/catalog/units";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { copy } from "@/i18n/messages";
import { resolveUserFacingError } from "@/lib/apiError";
import { formatMoney } from "@/orders/format";
import { useOptionalAuth } from "@/auth/useAuth";
import { useTaskMeasurement } from "@/telemetry/useTaskMeasurement";
import { getBatchRecipe, recordProduction, type BatchRecipe, type ProductionBatch, type WasteReason } from "./api";

const reasons: WasteReason[] = ["merma", "daño", "caducidad", "autoconsumo", "otro"];

/** Record a production run from the product's batch recipe; costs come from the server. */
export function ProductionDialog({
  productId,
  productName,
  onClose,
  onRecorded,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
  onRecorded: (batch: ProductionBatch) => void;
}) {
  const [recipe, setRecipe] = useState<BatchRecipe | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [batches, setBatches] = useState("1");
  const [actual, setActual] = useState("");
  const [actualTouched, setActualTouched] = useState(false);
  const [reason, setReason] = useState<WasteReason | "">("");
  const [updateCost, setUpdateCost] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const id = useId();
  // Active time to record a batch (task telemetry: no product, quantity or cost leaves the device).
  const auth = useOptionalAuth();
  const owner = auth?.state.status === "authenticated" && auth.state.user?.id
    ? { tenantId: auth.state.tenantId, userId: auth.state.user.id } : null;
  const measurement = useTaskMeasurement("production_batch", owner ? `${owner.tenantId}:${owner.userId}:${productId}` : "", owner);

  useEffect(() => {
    let alive = true;
    getBatchRecipe(productId).then(
      (data) => { if (alive) { setRecipe(data); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [productId]);

  const batchCount = Number(batches);
  const validBatches = Number.isInteger(batchCount) && batchCount >= 1 && batchCount <= 1000;
  const expected = recipe?.batch_yield && validBatches ? recipe.batch_yield * batchCount : 0;
  const actualValue = actualTouched ? Number(actual) : expected;
  const validActual = Number.isInteger(actualValue) && actualValue >= 0;
  const shortfall = validActual ? Math.max(0, expected - actualValue) : 0;
  const hasRecipe = Boolean(recipe?.batch_yield && recipe.lines.length);
  const canSubmit = hasRecipe && validBatches && validActual && (shortfall === 0 || reason !== "") && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    measurement.start();
    measurement.pause();
    key.current ??= crypto.randomUUID();
    try {
      const batch = await recordProduction({
        product_id: productId,
        batches: batchCount,
        actual_quantity: actualValue,
        ...(shortfall > 0 && reason ? { waste_reason_code: reason } : {}),
        update_catalog_cost: updateCost,
      }, key.current);
      key.current = null;
      measurement.finish("completed");
      onRecorded(batch);
    } catch (caught) {
      measurement.finish("failed");
      setError(resolveUserFacingError(caught, copy.production.saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? () => undefined : () => { measurement.finish("cancelled"); onClose(); }}>
      <DialogHeader>
        <DialogTitle>{copy.production.title(productName)}</DialogTitle>
        <DialogDescription>{copy.production.description}</DialogDescription>
      </DialogHeader>
      {state === "loading" && <p className="text-sm text-muted-foreground" role="status">{copy.recipes.loading}</p>}
      {state === "error" && <p className="text-sm text-destructive" role="alert">{copy.recipes.loadError}</p>}
      {state === "ready" && !hasRecipe && (
        <p className="rounded-lg border p-3 text-sm">
          {copy.production.noRecipe} <Link className="underline" to="/catalog">{copy.production.goToCatalog}</Link>
        </p>
      )}
      {state === "ready" && hasRecipe && recipe && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-batches`}>{copy.production.batches}</Label>
              <Input id={`${id}-batches`} type="number" inputMode="numeric" min={1} max={1000} step={1} value={batches} disabled={saving} onChange={(e) => { measurement.start(); setBatches(e.target.value); }} />
              <p className="text-xs text-muted-foreground">{copy.production.yieldHint(recipe.batch_yield ?? 0)}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-actual`}>{copy.production.actual}</Label>
              <Input id={`${id}-actual`} type="number" inputMode="numeric" min={0} step={1} value={actualTouched ? actual : String(expected)} disabled={saving} onChange={(e) => { measurement.start(); setActualTouched(true); setActual(e.target.value); }} />
              <p className="text-xs text-muted-foreground">{copy.production.expected(expected)}</p>
            </div>
          </div>
          {shortfall > 0 && (
            <div className="space-y-1">
              <Label htmlFor={`${id}-reason`}>{copy.production.reason(shortfall)}</Label>
              <Select id={`${id}-reason`} value={reason} disabled={saving} onChange={(e) => { measurement.start(); setReason(e.target.value as WasteReason | ""); }}>
                <option value="">{copy.production.chooseReason}</option>
                {reasons.map((code) => <option key={code} value={code}>{copy.inventoryModal.reasonCodes[code]}</option>)}
              </Select>
            </div>
          )}
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{copy.production.consumes}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {recipe.lines.map((line) => (
                <li key={line.ingredient_product_id}>
                  {line.ingredient_name}: {formatStockQuantity(line.quantity * (validBatches ? batchCount : 0), line.stock_unit)}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              {recipe.cost_per_piece !== null ? copy.production.expectedCost(formatMoney(recipe.cost_per_piece)) : copy.production.unknownCost}
            </p>
          </div>
          <label className="flex min-h-11 items-start gap-2 text-sm" htmlFor={`${id}-cost`}>
            <input id={`${id}-cost`} type="checkbox" className="mt-1 h-4 w-4" checked={updateCost} disabled={saving} onChange={(e) => setUpdateCost(e.target.checked)} />
            <span>{copy.production.updateCost}</span>
          </label>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => { measurement.finish("cancelled"); onClose(); }}>{copy.recipes.close}</Button>
        <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>{saving ? copy.recipes.saving : copy.production.submit}</Button>
      </DialogFooter>
    </Dialog>
  );
}
