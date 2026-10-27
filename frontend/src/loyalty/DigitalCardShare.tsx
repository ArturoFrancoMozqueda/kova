import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Gift } from "lucide-react";
import { useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveUserFacingError } from "@/lib/apiError";

type DigitalCardLink = { share_path: string; expires_at: string };

/** One selected customer owns this component and its short-lived share link. */
export function DigitalCardShare({ identity, customerId, online, disabled }: {
  identity: WorkspaceIdentity; customerId: string; online: boolean; disabled: boolean;
}) {
  const request = useOperationsRequest("/api/v1/loyalty", identity);
  const [card, setCard] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const locked = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const generate = async () => {
    if (locked.current || disabled || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<DigitalCardLink>(`/customers/${encodeURIComponent(customerId)}/digital-card`, "POST");
      const url = new URL(result.share_path, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== "/lealtad" || !url.hash || !Number.isFinite(Date.parse(result.expires_at))) {
        throw new Error("No pudimos preparar el enlace de la tarjeta. Intenta de nuevo.");
      }
      if (alive.current) setCard({ url: url.href, expiresAt: result.expires_at });
    } catch (failure) {
      if (alive.current) setError(resolveUserFacingError(failure, "No pudimos preparar la tarjeta digital. Intenta de nuevo."));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const copy = async () => {
    if (!card) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(card.url);
      if (alive.current) setNotice("Enlace copiado. Compártelo directamente con este cliente.");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      if (alive.current) setNotice("Enlace seleccionado. Cópialo y compártelo directamente con este cliente.");
    }
  };

  return <section aria-label="Tarjeta digital del cliente" className="space-y-4 rounded-2xl border border-kova-blue/20 bg-kova-mist p-5">
    <div className="flex items-start gap-3">
      <Gift className="mt-0.5 h-5 w-5 shrink-0 text-kova-blue" aria-hidden="true" />
      <div>
        <h3 className="font-semibold">Su tarjeta, siempre a la mano</h3>
        <p className="mt-1 text-sm leading-relaxed text-kova-muted">Comparte una tarjeta digital para que este cliente consulte sus puntos y la regla de acumulación sin crear una cuenta.</p>
      </div>
    </div>
    {!card && <Button type="button" className="h-auto min-h-11 whitespace-normal" disabled={busy || disabled || !online} onClick={() => void generate()}>{busy ? "Preparando tarjeta…" : "Crear enlace de tarjeta digital"}</Button>}
    {error && <p role="alert" className="text-sm text-destructive-strong">{error}</p>}
    {card && <div className="space-y-3">
      <label htmlFor="customer-digital-card-link" className="block text-sm font-medium">Enlace de la tarjeta</label>
      <Input id="customer-digital-card-link" ref={linkInput} readOnly value={card.url} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={() => void copy()}><Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copiar tarjeta</Button>
        <a href={card.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-kova-blue underline">Ver tarjeta<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
      </div>
      <p className="text-xs leading-relaxed text-kova-muted">Vigente hasta el {new Date(card.expiresAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}. Quien tenga este enlace puede consultar los puntos. Entrégalo sólo al cliente; no lo publiques en el menú.</p>
    </div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
