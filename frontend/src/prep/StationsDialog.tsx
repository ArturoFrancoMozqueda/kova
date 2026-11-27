import { useId, useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveApiErrorMessage, safeUserMessage } from "@/lib/apiError";
import { createPrepStation, listPrepStations, updatePrepStation, type PrepStation } from "./api";

/** Managers name their stations and when an order counts as late. */
export function StationsButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [stations, setStations] = useState<PrepStation[] | null>(null);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("8");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const minutesId = useId();

  const load = () => listPrepStations(true).then(setStations).catch((caught) => setError(resolveApiErrorMessage(caught, "No pudimos cargar las estaciones.")));

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
      return true;
    } catch (caught) {
      setError(resolveApiErrorMessage(caught, safeUserMessage((caught as Error).message, "No pudimos guardar la estación.")));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const minutesValue = Number(minutes);
  const valid = name.trim().length > 0 && Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= 240;

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); setError(null); void load(); }}><Settings2 className="mr-2 h-4 w-4" /> Estaciones</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>Estaciones de preparación</DialogTitle>
          <DialogDescription>Asigna cada producto a su estación en Catálogo. Una orden se marca tarde al pasar los minutos indicados sin estar lista.</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
        {stations === null && !error ? <p role="status" className="text-sm text-muted-foreground">Cargando estaciones…</p> : null}
        <ul className="space-y-2 text-sm" aria-label="Estaciones">
          {(stations ?? []).map((station) => (
            <li key={station.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <span className={station.is_active ? "font-medium" : "text-muted-foreground line-through"}>{station.name}<span className="ml-2 font-normal text-muted-foreground">· tarde a los {station.alert_minutes} min</span></span>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void run(() => updatePrepStation(station.id, { is_active: !station.is_active }))}>{station.is_active ? "Desactivar" : "Activar"}</Button>
            </li>
          ))}
        </ul>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" onSubmit={(event) => {
          event.preventDefault();
          if (!valid || saving) return;
          void run(() => createPrepStation(name.trim(), minutesValue)).then((saved) => { if (saved) { setName(""); setMinutes("8"); } });
        }}>
          <div><Label htmlFor={nameId}>Nueva estación</Label><Input id={nameId} value={name} maxLength={60} placeholder="Barra" onChange={(event) => setName(event.target.value)} /></div>
          <div><Label htmlFor={minutesId}>Tarde a los (min)</Label><Input id={minutesId} type="number" inputMode="numeric" min="1" max="240" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></div>
          <Button type="submit" disabled={!valid || saving}>Agregar</Button>
        </form>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button></DialogFooter>
      </Dialog>
    </>
  );
}
