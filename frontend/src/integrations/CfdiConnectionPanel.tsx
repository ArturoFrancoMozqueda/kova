import { useState } from "react";
import { liveCfdiReady } from "./cfdiReadiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  connectCfdi,
  getCfdiStatus,
  refreshCfdiConnection,
  type CfdiEnvironment,
  type CfdiStatus,
} from "./cfdiApi";

export function CfdiConnectionPanel({
  status,
  environment,
  onEnvironment,
  onStatus,
  issuerRfc,
  locked = false,
}: {
  status: CfdiStatus;
  environment: CfdiEnvironment;
  onEnvironment: (value: CfdiEnvironment) => void;
  onStatus: (value: CfdiStatus) => void;
  issuerRfc?: string;
  locked?: boolean;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const connection = status.connections.find(
    (item) => item.environment === environment,
  );
  const mismatch = Boolean(
    environment === "live" &&
      issuerRfc &&
      connection?.issuer_rfc &&
      issuerRfc.toUpperCase() !== connection.issuer_rfc.toUpperCase(),
  );
  async function run(action: () => Promise<CfdiStatus>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      onStatus(await action());
      setMessage(
        "Conexión verificada. Revisa el ambiente y el RFC antes de emitir.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos verificar la conexión.",
      );
    } finally {
      setSecret("");
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-2xl border border-border p-5 space-y-4"
      aria-label="Conexión CFDI"
    >
      <h2 className="font-semibold">Conectar Facturapi</h2>
      <p className="text-sm">
        Crea tu cuenta en{" "}
        <a
          href="https://www.facturapi.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Facturapi
        </a>{" "}
        y configura una organización con el RFC de tu negocio. En el proveedor
        registra tu certificado de sello digital (CSD) y obtén la llave de esa
        organización para el ambiente elegido.
      </p>
      <p className="text-sm text-muted-foreground">
        Los certificados y sus contraseñas se cargan directamente en el
        proveedor. Kova sólo recibe la llave de organización; no solicita
        e.firma ni una llave general de tu cuenta. Consulta la{" "}
        <a
          href="https://docs.facturapi.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          guía del proveedor
        </a>
        .
      </p>
      {!status.storage_available && (
        <p role="status" className="text-amber-700">
          La conexión fiscal requiere configuración del servidor. Puedes guardar
          solicitudes mientras el administrador habilita el almacenamiento
          seguro.
        </p>
      )}
      <div>
        <Label htmlFor="cfdi-environment">Ambiente fiscal</Label>
        <Select
          id="cfdi-environment"
          value={environment}
          disabled={busy || locked}
          onChange={(e) => {
            setSecret("");
            setError("");
            setMessage("");
            onEnvironment(e.target.value as CfdiEnvironment);
          }}
        >
          <option value="test">Test · pruebas sin validez fiscal</option>
          <option value="live">Live · documentos con efectos fiscales</option>
        </Select>
      </div>
      <div className="rounded-xl bg-muted p-3 text-sm space-y-1">
        <p>
          {environment === "test"
            ? "Pruebas · Sin validez fiscal"
            : "Producción Live · La emisión y cancelación afectan tus documentos fiscales"}
        </p>
        <p>
          {connection?.connected
            ? `Organización conectada · RFC ${connection.issuer_rfc ?? "sin confirmar"}`
            : "Sin conexión en este ambiente"}
        </p>
        {mismatch && (
          <p role="alert" className="text-destructive">
            El RFC de la organización no coincide con el emisor guardado.
            Corrige los datos o conecta la organización correcta.
          </p>
        )}
        {environment === "live" && connection?.connected && (
          <p>
            {liveCfdiReady(connection, status.storage_available, issuerRfc)
              ? "Certificados listos para producción"
              : "Certificados o configuración pendientes en el proveedor"}
          </p>
        )}
        {connection?.certificate_expires_at && (
          <p>
            Vigencia del certificado:{" "}
            {new Date(connection.certificate_expires_at).toLocaleDateString(
              "es-MX",
            )}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const key = secret.trim();
          setSecret("");
          void run(async () => {
            await connectCfdi(environment, key);
            return getCfdiStatus();
          });
        }}
      >
        <Label htmlFor="cfdi-key">
          Llave de organización {environment === "test" ? "Test" : "Live"}
        </Label>
        <Input
          id="cfdi-key"
          type="password"
          minLength={10}
          maxLength={1000}
          autoComplete="off"
          spellCheck={false}
          value={secret}
          disabled={busy || locked || !status.storage_available}
          onChange={(e) => setSecret(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          La llave se borra del formulario después de enviarla. Nunca se guarda
          en este dispositivo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              busy || locked || !status.storage_available || !secret.trim()
            }
          >
            {busy ? "Verificando…" : "Guardar conexión"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              locked ||
              !connection?.connected ||
              !status.storage_available
            }
            onClick={() =>
              void run(async () => {
                await refreshCfdiConnection(environment);
                return getCfdiStatus();
              })
            }
          >
            Revalidar conexión
          </Button>
        </div>
      </form>
    </section>
  );
}
