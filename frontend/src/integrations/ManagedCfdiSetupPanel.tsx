import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FiscalIdentity } from "./api";
import {
  getManagedCfdiSetup,
  ManagedCfdiError,
  refreshManagedCfdiSetup,
  startManagedCfdiSetup,
  uploadCfdiCertificate,
  type CfdiEnvironment,
  type ManagedCfdiSetup,
} from "./cfdiApi";

const manifestUrl = "https://www.facturapi.io/embedded/manifiesto";

export function ManagedCfdiSetupPanel({
  issuer,
  environment,
  onEnvironment,
  onChange,
  onBusy,
  locked = false,
}: {
  issuer?: FiscalIdentity;
  environment: CfdiEnvironment;
  onEnvironment: (value: CfdiEnvironment) => void;
  onChange: () => Promise<void>;
  onBusy?: (value: boolean) => void;
  locked?: boolean;
}) {
  const [setup, setSetup] = useState<ManagedCfdiSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showManifest, setShowManifest] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const certificateForm = useRef<HTMLFormElement>(null);
  const certificate = useRef<HTMLInputElement>(null);
  const privateKey = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  useEffect(() => {
    active.current = true;
    const current = ++generation.current;
    getManagedCfdiSetup()
      .then((value) => {
        if (active.current && generation.current === current) setSetup(value);
      })
      .catch(() => {
        if (active.current && generation.current === current)
          setError("No pudimos consultar la configuración fiscal. Vuelve a consultar el estado.");
      });
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);

  async function run(action: () => Promise<ManagedCfdiSetup>, success: string) {
    if (busyRef.current || locked || !active.current) return;
    busyRef.current = true;
    const current = ++generation.current;
    setBusy(true);
    onBusy?.(true);
    setError("");
    setMessage("");
    try {
      const value = await action();
      if (!active.current || generation.current !== current) return;
      setSetup(value);
      setMessage(success);
      await onChange();
    } catch (failure) {
      if (active.current && generation.current === current)
        setError(failure instanceof ManagedCfdiError
          ? failure.message
          : "No pudimos confirmar la operación. Consulta el estado antes de volver a intentarlo. Si enviaste certificados, vuelve a seleccionarlos cuando sea necesario.");
    } finally {
      if (active.current && generation.current === current) {
        busyRef.current = false;
        setBusy(false);
        onBusy?.(false);
      }
    }
  }

  const legacy = setup?.state === "legacy";
  const created = Boolean(setup?.organization_created);
  const unavailable = setup && !setup.available;
  const issuerMismatch = Boolean(
    created && issuer && setup?.issuer &&
    issuer.rfc.toUpperCase() !== setup.issuer.rfc.toUpperCase(),
  );
  const ready = Boolean(setup?.live_connected && setup?.production_ready && !issuerMismatch);
  const blocked = busy || locked;
  const canStart = Boolean(
    setup?.available && issuer && !created &&
    ["not_started", "error"].includes(setup.state),
  );
  const canUpload = Boolean(setup?.available && created && !legacy && !issuerMismatch);
  return (
    <section className="rounded-2xl border border-border p-5 space-y-4" aria-label="Activación de facturación">
      <div>
        <h2 className="font-semibold">Activa la facturación en Kova</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Kova configura la conexión fiscal de tu negocio. Completa tus datos, carga tu certificado de sello digital y autoriza la emisión desde aquí.
        </p>
      </div>
      <ol className="grid gap-2 text-sm sm:grid-cols-2" aria-label="Pasos de activación fiscal">
        <li>1. Datos fiscales · {setup?.issuer || issuer ? "Guardados" : "Pendientes"}</li>
        <li>2. Certificado de sello digital · {setup?.certificate_expires_at ? "Recibido; revisa su vigencia" : "Pendiente"}</li>
        <li>3. Autorización · {ready ? "Verificada" : "Pendiente de verificación"}</li>
        <li>4. Emisión Live · {ready ? "Lista" : "Pendiente"}</li>
      </ol>
      {!setup && !error && <p role="status">Consultando activación fiscal…</p>}
      {unavailable && <p role="status">La activación fiscal necesita configuración por parte de Kova. Contacta a soporte; tus ventas y solicitudes siguen disponibles.</p>}
      {legacy && <p role="status">Tu negocio conserva su conexión fiscal existente. Kova puede ayudarte a migrarla a la activación integrada; contacta a soporte antes de crear otra organización.</p>}
      {setup?.issuer && <p className="text-sm">Emisor registrado: {setup.issuer.legal_name} · RFC {setup.issuer.rfc}</p>}
      {issuerMismatch && <p role="alert" className="text-destructive">El RFC guardado no coincide con el emisor de esta conexión. Revisa los datos fiscales o contacta a soporte antes de cargar certificados o emitir.</p>}
      {!created && !legacy && (
        <div className="space-y-2">
          <p className="text-sm">{issuer ? `Activaremos la facturación para ${issuer.legal_name} · RFC ${issuer.rfc}.` : "Guarda los datos fiscales del negocio para iniciar la activación."}</p>
          <Button type="button" disabled={blocked || !canStart} onClick={() => {
            if (issuer) void run(() => startManagedCfdiSetup(issuer), "Configuración recibida. Revisa los pasos pendientes antes de emitir.");
          }}>Activar facturación</Button>
        </div>
      )}
      {setup && ["creating", "unknown"].includes(setup.state) && <p role="status">La creación de la conexión aún no está confirmada. Consulta el estado para continuar sin duplicarla.</p>}
      {setup?.state === "error" && <p role="alert" className="text-destructive">La configuración fiscal requiere revisión. Consulta el estado o contacta a soporte si el problema continúa.</p>}
      {created && !legacy && <form ref={certificateForm} className="space-y-3 rounded-xl border p-4" onSubmit={(event) => {
        event.preventDefault();
        if (busyRef.current || locked || !canUpload) return;
        const cer = certificate.current?.files?.[0];
        const key = privateKey.current?.files?.[0];
        const secret = password.current?.value ?? "";
        if (!cer || !key || !secret) return;
        certificateForm.current?.reset();
        if (!/\.cer$/i.test(cer.name) || !/\.key$/i.test(key.name)) {
          setError("Selecciona el certificado .cer y la llave .key de tu CSD.");
          return;
        }
        if (cer.size > 64 * 1024 || key.size > 64 * 1024 || secret.length > 256) {
          setError("Cada archivo del CSD debe medir como máximo 64 KB y la contraseña debe tener como máximo 256 caracteres.");
          return;
        }
        void run(() => uploadCfdiCertificate(cer, key, secret), "Certificados enviados. Consulta el estado para comprobar la autorización y la disponibilidad de emisión.");
      }}>
        <h3 className="font-medium">Certificado de sello digital (CSD)</h3>
        <p className="text-sm text-muted-foreground">Carga los archivos del CSD de este RFC, no los de tu e.firma (FIEL). Cada archivo debe medir como máximo 64 KB. Se envían de forma segura para configurar la emisión; el formulario se limpia al enviarlos.</p>
        <div><Label htmlFor="cfdi-certificate">Certificado CSD (.cer)</Label><Input ref={certificate} id="cfdi-certificate" type="file" accept=".cer" required disabled={blocked || !canUpload} /></div>
        <div><Label htmlFor="cfdi-private-key">Llave privada CSD (.key)</Label><Input ref={privateKey} id="cfdi-private-key" type="file" accept=".key" required disabled={blocked || !canUpload} /></div>
        <div><Label htmlFor="cfdi-csd-password">Contraseña del CSD</Label><Input ref={password} id="cfdi-csd-password" type="password" autoComplete="off" maxLength={256} required disabled={blocked || !canUpload} /></div>
        <Button type="submit" disabled={blocked || !canUpload}>{busy ? "Enviando…" : "Enviar CSD"}</Button>
      </form>}
      {created && !legacy && setup?.manifest_url === manifestUrl && !ready && (
        <div className="space-y-3">
          <p className="text-sm">Revisa y firma el manifiesto de autorización con el proveedor. Kova comprobará el resultado al consultar el estado.</p>
          <Button type="button" variant="outline" disabled={blocked} onClick={() => setShowManifest((value) => !value)}>{showManifest ? "Cerrar autorización" : "Revisar autorización fiscal"}</Button>
          {showManifest && <iframe title="Manifiesto de autorización fiscal" src={manifestUrl} referrerPolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" className="h-[36rem] w-full rounded-xl border" />}
        </div>
      )}
      {setup?.certificate_expires_at && <p className="text-sm">Vigencia del CSD: {new Date(setup.certificate_expires_at).toLocaleDateString("es-MX")}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button type="button" variant="outline" disabled={blocked} onClick={() => void run(!setup || !setup.available ? getManagedCfdiSetup : refreshManagedCfdiSetup, "Estado consultado. La emisión Live sólo está lista cuando el proveedor lo confirma.")}>{busy ? "Consultando…" : "Consultar estado de activación"}</Button>
      <div className="space-y-2 border-t pt-4">
        <Label htmlFor="cfdi-environment">Ambiente fiscal</Label>
        <Select id="cfdi-environment" value={environment} disabled={blocked} onChange={(event) => onEnvironment(event.target.value as CfdiEnvironment)}>
          <option value="test">Test · pruebas sin validez fiscal</option>
          <option value="live">Live · documentos con efectos fiscales</option>
        </Select>
        <p className="text-sm">{environment === "test" ? "Los documentos Test no tienen validez fiscal." : "La emisión y cancelación Live tienen efectos fiscales. Revisa cada documento antes de confirmar."}</p>
        <p className="text-sm">{environment === "test" ? (setup?.test_connected ? "Conexión Test disponible" : "Conexión Test pendiente") : (ready ? "Emisión Live lista" : "Emisión Live pendiente de requisitos fiscales")}</p>
      </div>
    </section>
  );
}
