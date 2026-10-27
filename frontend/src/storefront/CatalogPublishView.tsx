import { resolveUserFacingError } from "@/lib/apiError";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OperationsSession, useOnline, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ProductPhoto, type ProductPhotoData } from "./ProductPhoto";

type Settings = { enabled: boolean; title: string; description: string | null; whatsapp_phone: string | null; product_ids: string[]; version: number; share_path: string | null };
type Product = ProductPhotoData & { id: string; name: string; price_amount: string; is_active: boolean };
const money = (amount: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(amount));

export default function CatalogPublishView() {
  useDocumentTitle("Catálogo público");
  return <OperationsSession>{identity => <PublishWorkspace identity={identity} />}</OperationsSession>;
}

function PublishWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1", identity);
  const online = useOnline();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const shareInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const load = useCallback(async () => {
    try {
      const [data, rows] = await Promise.all([request<Settings>("/storefront/settings"), request<Product[]>("/catalog/products")]);
      if (alive.current) { setSettings(data); setProducts(rows.filter(p => p.is_active)); setError(""); }
    } catch (e) { if (alive.current) setError(resolveUserFacingError(e, "No pudimos cargar el catálogo.")); }
  }, [request]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setQr(null);
    if (settings?.share_path) {
      void fetch("/api/v1/storefront/qr", { credentials: "include", cache: "no-store", signal: controller.signal,
        headers: { "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId },
      }).then(async response => { if (!response.ok) return null; return await response.blob(); })
        .then(blob => { if (blob && !controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setQr(objectUrl); } })
        .catch(() => { /* The published link remains available if image loading fails. */ });
    }
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [settings?.share_path, identity.tenantId, identity.userId, identity.branchId]);
  const copyLink = async () => {
    if (!settings?.share_path) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(new URL(settings.share_path, window.location.origin).href);
      if (alive.current) setCopyNotice("Enlace copiado. Ya puedes compartirlo con tus clientes.");
    } catch {
      shareInput.current?.focus();
      shareInput.current?.select();
      if (alive.current) setCopyNotice("El enlace está seleccionado. Cópialo para compartirlo con tus clientes.");
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || locked.current || !online) return;
    locked.current = true; setBusy(true); setError(""); setNotice(""); setCopyNotice("");
    try {
      const result = await request<Settings>("/storefront/settings", "PUT", {
        expected_version: settings.version, enabled: settings.enabled, title: settings.title,
        description: settings.description?.trim() || null, whatsapp_phone: settings.whatsapp_phone?.trim() || null,
        product_ids: settings.product_ids, rotate_link: false,
      }, crypto.randomUUID());
      if (alive.current) { setSettings(result); setNotice(result.enabled ? "Catálogo publicado. Los cambios ya están disponibles en el mismo enlace y código QR." : "Catálogo retirado. El enlace ya no permite consultarlo."); }
    } catch (e) { if (alive.current) setError(resolveUserFacingError(e, "No pudimos guardar.")); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return <ViewLayout className="space-y-6">
    <ViewHeader title="Tu menú digital, listo para compartir" eyebrow="Catálogo público" meta="Comparte tu menú por enlace o QR, en el negocio y a distancia." />
    <p className="max-w-2xl text-sm text-kova-muted">Tus clientes pueden elegir productos y cantidades, enviar una solicitud de pedido y seguir su avance. Revisa las solicitudes para confirmar disponibilidad y acordar el pago y la entrega. También puedes agregar WhatsApp para recibir consultas.</p>
    {!online && <p role="status">Conéctate para publicar cambios.</p>}
    {error && <ViewError message={error} onRetry={() => void load()} retryLabel="Cargar versión actual" />}
    {notice && <p role="status" className="rounded-xl bg-kova-growth/10 p-4 text-kova-growth-strong">{notice}</p>}
    {!settings && !error && <p role="status">Cargando publicación…</p>}
    {settings && <form onSubmit={event => void save(event)} className="space-y-6">
      <fieldset disabled={busy || !online} className="space-y-5 rounded-2xl border border-kova-border bg-white p-5 sm:p-7">
        <legend className="px-2 font-semibold">Información pública</legend>
        <div><Label htmlFor="public-title">Nombre del menú o negocio</Label><Input id="public-title" required maxLength={160} value={settings.title} onChange={e => setSettings({ ...settings, title: e.target.value })} /></div>
        <div><Label htmlFor="public-description">Descripción (opcional)</Label><Input id="public-description" maxLength={500} value={settings.description ?? ""} onChange={e => setSettings({ ...settings, description: e.target.value })} /></div>
        <div><Label htmlFor="public-whatsapp">WhatsApp público (opcional)</Label><Input id="public-whatsapp" inputMode="tel" pattern="[1-9][0-9]{9,14}" placeholder="52 y tu número de 10 dígitos" value={settings.whatsapp_phone ?? ""} onChange={e => setSettings({ ...settings, whatsapp_phone: e.target.value })} /><p className="mt-1 text-xs text-kova-muted">Este número será visible para cualquier persona con el enlace. Sin espacios ni signo +.</p></div>
        <label className="flex items-center gap-3"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} />Publicar catálogo</label>
        <p className="text-sm text-kova-muted">Al guardar, actualizas tu menú en el mismo enlace y código QR. No necesitas compartir otra dirección ni volver a imprimir el QR.</p>
      </fieldset>
      <fieldset disabled={busy || !online} className="rounded-2xl border border-kova-border bg-white p-5 sm:p-7">
        <legend className="px-2 font-semibold">Productos que quieres mostrar</legend>
        <p className="mb-4 text-sm text-kova-muted">Las fotos y precios se toman de <Link to="/catalog" className="text-kova-blue underline">Productos</Link>. Edita ahí las fotografías que verán tus clientes.</p>
        {products.length === 0 ? <p className="py-3 text-sm">Primero agrega productos activos en <Link to="/catalog" className="underline">Catálogo</Link>.</p> : <div className="grid gap-3 sm:grid-cols-2">{products.map(product => <label key={product.id} className="flex min-w-0 items-start gap-3 rounded-xl border p-3"><input className="mt-1" type="checkbox" checked={settings.product_ids.includes(product.id)} onChange={e => setSettings({ ...settings, product_ids: e.target.checked ? [...settings.product_ids, product.id] : settings.product_ids.filter(id => id !== product.id) })} /><ProductPhoto product={product} compact /><span className="min-w-0 break-words text-sm">{product.name}<span className="block text-kova-muted">{money(product.price_amount)}</span></span></label>)}</div>}
        <p className="mt-4 text-sm text-kova-muted">{settings.product_ids.length} seleccionados. Costos, márgenes y cantidades exactas de inventario permanecen privados.</p>
      </fieldset>
      <Button disabled={busy || !online || !settings.title.trim()} type="submit">{busy ? "Guardando…" : "Guardar publicación"}</Button>
    </form>}
    {settings?.share_path && <section aria-label="Enlace publicado" className="space-y-3 rounded-2xl border border-kova-border p-5"><h2 className="font-semibold">Un mismo enlace para tus clientes</h2><p className="text-sm text-kova-muted">Comparte esta dirección para todas tus actualizaciones. Al abrir o recargar el menú, tus clientes ven la publicación guardada y los precios, fotos y disponibilidad actuales de tus productos.</p><a href={settings.share_path} target="_blank" rel="noreferrer" className="inline-block text-kova-blue underline">Abrir catálogo público</a><label className="block text-sm" htmlFor="public-catalog-link">Enlace público</label><Input ref={shareInput} id="public-catalog-link" readOnly value={new URL(settings.share_path, window.location.origin).href} /><Button type="button" variant="outline" onClick={() => void copyLink()}>Copiar enlace</Button>{copyNotice && <p role="status" className="text-sm">{copyNotice}</p>}<p className="text-sm text-kova-muted">Para revisar pedidos y consultas, abre <Link to="/commercial-requests" className="text-kova-blue underline">Ver solicitudes del catálogo</Link>.</p>{qr && <div><img src={qr} alt="Código QR del catálogo público" className="h-48 w-48" width={192} height={192} /><a href={qr} download="catalogo-kova.png" className="inline-block py-3 text-sm underline">Descargar código QR</a></div>}</section>}
  </ViewLayout>;
}
