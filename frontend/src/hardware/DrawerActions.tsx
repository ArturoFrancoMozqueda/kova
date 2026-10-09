import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useCashDrawer } from "./useCashDrawer";

export function DrawerActions({ drawer, canOpen }: {
  drawer: ReturnType<typeof useCashDrawer>; canOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  if (!drawer.device?.configured) return null;
  return <div className="mb-4 space-y-2 print:hidden">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={!canOpen || drawer.busy} onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        {drawer.busy ? "Enviando apertura…" : "Abrir cajón"}
      </Button>
      <span className="text-xs text-muted-foreground">{drawer.device.online ? "Conector conectado" : "Conector desconectado · revisa el equipo de caja"}</span>
    </div>
    {expanded && canOpen ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      if (!reason.trim() || drawer.busy) return;
      void drawer.open("manual", reason.trim());
      setExpanded(false);
      setReason("");
    }}>
      <div className="min-w-0 flex-1"><Label htmlFor="drawer-reason">Motivo de apertura</Label><Input id="drawer-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={200} required /></div>
      <Button type="submit" disabled={!reason.trim() || drawer.busy}>Confirmar apertura</Button>
    </form> : null}
    {drawer.message ? <p role="status" className="text-sm text-muted-foreground">{drawer.message}</p> : null}
  </div>;
}
