import { useId, useState } from "react";
import { HandCoins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { getCustomerOrderSettings, updateCustomerOrderSettings } from "./api";
import type { CustomerOrderSettings } from "./types";

/** Each business decides its minimum deposit and what happens to it when an order is cancelled. */
export function DepositSettingsButton() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CustomerOrderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const percentId = useId();
  const hintId = useId();

  const show = () => {
    setOpen(true);
    setSaved(false);
    setError(null);
    setSettings(null);
    void getCustomerOrderSettings()
      .then(setSettings)
      .catch((caught) => setError(resolveApiErrorMessage(caught, "No pudimos cargar la política de anticipos.")));
  };

  const percent = Number(settings?.deposit_minimum_percent ?? "0");
  const valid = settings !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100;

  const save = async () => {
    if (!settings || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      setSettings(await updateCustomerOrderSettings({
        ...settings,
        deposit_minimum_percent: percent.toFixed(2),
      }));
      setSaved(true);
    } catch (caught) {
      setError(resolveApiErrorMessage(caught, "No pudimos guardar la política. Revisa los datos e intenta de nuevo."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={show}><HandCoins className="mr-2 h-4 w-4" /> Política de anticipos</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>Política de anticipos</DialogTitle>
          <DialogDescription>Aplica a todos los pedidos del negocio. El anticipo entra a la caja el día que se recibe; la venta se registra al liquidar el pedido.</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
        {settings === null && !error ? <p role="status" className="text-sm text-muted-foreground">Cargando política…</p> : null}
        {settings ? (
          <div className="space-y-4 text-sm">
            <div>
              <Label htmlFor={percentId}>Anticipo mínimo para confirmar (%)</Label>
              <Input id={percentId} type="number" inputMode="decimal" min="0" max="100" step="1" value={settings.deposit_minimum_percent} aria-describedby={hintId}
                onChange={(event) => { setSaved(false); setSettings({ ...settings, deposit_minimum_percent: event.target.value }); }} />
              <p id={hintId} className="mt-1 text-xs text-muted-foreground">0 significa que el anticipo es opcional. Con 50, un pedido de $600 se confirma con al menos $300.</p>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-medium">Si el cliente cancela</legend>
              <label className="flex items-start gap-2"><input type="radio" name="cancelled-deposit-policy" checked={settings.cancelled_deposit_policy === "refund"} onChange={() => { setSaved(false); setSettings({ ...settings, cancelled_deposit_policy: "refund" }); }} /><span>Devolver el anticipo</span></label>
              <label className="flex items-start gap-2"><input type="radio" name="cancelled-deposit-policy" checked={settings.cancelled_deposit_policy === "retain"} onChange={() => { setSaved(false); setSettings({ ...settings, cancelled_deposit_policy: "retain" }); }} /><span>Conservar el anticipo (gerencia aún puede devolverlo). Se reporta como ingreso del día, aparte de las ventas.</span></label>
            </fieldset>
            {saved ? <p role="status" className="text-kova-growth-strong">Política guardada.</p> : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>Guardar política</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
