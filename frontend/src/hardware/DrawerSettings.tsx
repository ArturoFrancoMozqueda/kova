import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getDrawerStatus, openDrawer, pairDrawer, revokeDrawer, saveDrawerSettings, type DrawerSetup, type DrawerStatus } from "./api";

export function DrawerSettings() {
  const [device, setDevice] = useState<DrawerStatus | null>(null);
  const [form, setForm] = useState<DrawerSetup>({ name: "Caja principal", pin: 0, auto_open: false });
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [expiry, setExpiry] = useState("");
  const [message, setMessage] = useState("");
  const [revoke, setRevoke] = useState(false);
  const [renew, setRenew] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void getDrawerStatus().then(status => {
      if (cancelled) return;
      setDevice(status);
      if (status.configured) setForm({ name: status.name ?? "Caja principal", pin: status.pin ?? 0, auto_open: status.auto_open });
    }).catch(() => { if (!cancelled) setMessage("No se pudo consultar el conector. Intenta actualizar el estado."); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!code) return;
    const timer = window.setTimeout(() => { setCode(""); setExpiry(""); }, Math.max(0, Date.parse(expiry) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [code, expiry]);

  async function perform(action: "pair" | "save" | "test" | "refresh" | "revoke") {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (action === "pair") {
        const result = await pairDrawer(form);
        setDevice(result.device); setCode(result.pairing_code); setExpiry(result.pairing_expires_at);
        setMessage("Código generado. Vincula el conector en los próximos 10 minutos.");
      } else if (action === "save") {
        setDevice(await saveDrawerSettings(form));
        setMessage("Configuración del cajón guardada para esta sucursal.");
      } else if (action === "refresh") {
        const status = await getDrawerStatus(); setDevice(status);
        if (status.paired) { setCode(""); setExpiry(""); }
        setMessage(status.online ? "El conector está conectado." : "El conector no está conectado. Ejecuta run en el equipo de caja.");
      } else if (action === "revoke") {
        await revokeDrawer(); setDevice({ configured: false, online: false, auto_open: false }); setCode("");
        setMessage("Conector desvinculado. Ya no puede recibir órdenes.");
      } else {
        const status = await openDrawer("test", "Prueba de configuración");
        setMessage(status === "sent" ? "Orden enviada. Confirma que el cajón se abrió físicamente." : "No se confirmó la apertura. Revisa el conector, la impresora y el cable del cajón.");
      }
    } catch { setMessage("No se pudo completar la acción. Revisa la conexión y el conector; no se realizó ningún cobro."); }
    finally { running.current = false; setBusy(false); setRevoke(false); setRenew(false); }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Código copiado. Pégalo solo en el conector de Kova.");
    } catch { setMessage("No se pudo copiar el código. Usa un navegador con acceso al portapapeles."); }
  }
  return <Card>
    <CardHeader><h2 className="text-lg font-semibold leading-none tracking-tight">Cajón de dinero</h2><p className="text-sm text-muted-foreground">Abre el cajón desde tu computadora, celular o tablet con el conector de esta sucursal.</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="rounded-lg border border-kova-border bg-muted/40 p-4 text-sm leading-6">
        <p>Necesitas un cajón conectado a una impresora ESC/POS de red (Ethernet o Wi-Fi) y un equipo Windows, Mac o Linux con Python 3.12 o posterior que permanezca encendido junto a la caja y conectado a la misma red.</p>
        <p className="mt-2">Kova y el conector necesitan internet. La compatibilidad depende del modelo y el cable del cajón; realiza una prueba antes de activar la apertura al cobrar.</p>
        <a className="font-semibold text-primary underline" href="/api/v1/hardware/connector/download">Descargar conector de Kova</a>
      </div>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void perform(device?.configured ? "save" : "pair"); }}>
        <div><Label htmlFor="drawer-name">Nombre del equipo de caja</Label><Input id="drawer-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} maxLength={100} required /></div>
        <div><Label htmlFor="drawer-pin">Salida del cajón en la impresora</Label><Select id="drawer-pin" value={form.pin} onChange={event => setForm(current => ({ ...current, pin: Number(event.target.value) as 0 | 1 }))}>
          <option value="0">Salida 1 (pin 2)</option><option value="1">Salida 2 (pin 5)</option>
        </Select><p className="mt-1 text-xs text-muted-foreground">Elige la salida indicada en el manual de tu impresora. Pulso de 100 ms.</p></div>
        <Label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={form.auto_open} onChange={event => setForm(current => ({ ...current, auto_open: event.target.checked }))} />Abrir al cobrar efectivo (también en pagos divididos)</Label>
        <Button type="submit" disabled={busy || !form.name.trim()}>{device?.configured ? "Guardar configuración del cajón" : "Generar código de vinculación"}</Button>
      </form>
      {code ? <div className="space-y-3 rounded-lg border border-kova-border p-4">
        <p className="text-sm">En el equipo conectado a la impresora, ejecuta el siguiente comando. El programa solicitará el código; no lo compartas.</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">python kova-drawer-connector.py setup --host DIRECCION_DE_IMPRESORA</pre>
        <Label htmlFor="drawer-code">Código temporal (caduca en 10 minutos)</Label>
        <Input id="drawer-code" type="password" value={code} readOnly autoComplete="off" />
        <Button variant="outline" disabled={busy} onClick={() => void copyCode()}>Copiar código</Button>
        <p className="text-sm">Después de vincularlo, deja este comando en ejecución:</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">python kova-drawer-connector.py run</pre>
      </div> : null}
      {device?.configured ? <div className="space-y-3">
        <p className="text-sm">{device.online ? "Conector conectado" : device.paired ? "Conector vinculado, sin conexión" : "Pendiente de vincular"}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void perform("refresh")}>Actualizar estado</Button>
          <Button variant="outline" disabled={busy || !device.online} onClick={() => void perform("test")}>Probar apertura</Button>
          <Button variant="outline" disabled={busy} onClick={() => setRenew(true)}>Volver a vincular</Button>
          <Button variant="outline" disabled={busy} onClick={() => setRevoke(true)}>Desvincular conector</Button>
        </div>
        <p className="text-xs text-muted-foreground">La vinculación dura 90 días. Imprimir o reimprimir un ticket no abre el cajón.</p>
        {device.key_expires_at ? <p className="text-xs text-muted-foreground">Vuelve a vincular antes del {new Date(device.key_expires_at).toLocaleDateString("es-MX")} para mantener la conexión.</p> : null}
      </div> : <Button variant="outline" disabled={busy} onClick={() => void perform("refresh")}>Actualizar estado</Button>}
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      <ConfirmDialog open={revoke || renew} title={renew ? "Volver a vincular el conector" : "Desvincular el conector"} description="El conector anterior dejará de recibir órdenes. Las ventas y los cortes de caja se conservan." confirmLabel={renew ? "Generar nuevo código" : "Desvincular"} onConfirm={() => void perform(renew ? "pair" : "revoke")} onCancel={() => { setRevoke(false); setRenew(false); }} busy={busy} />
    </CardContent>
  </Card>;
}
