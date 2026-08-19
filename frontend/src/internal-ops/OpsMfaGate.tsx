import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  confirmOpsMfa,
  getOpsMfaStatus,
  setupOpsMfa,
  verifyOpsMfa,
} from "./api";
import type { OpsMfaSetup, OpsMfaStatus } from "./types";

type Stage = "loading" | "password" | "confirm" | "verify" | "recovery" | "error";

export default function OpsMfaGate({ onVerified }: { onVerified: () => void }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [status, setStatus] = useState<OpsMfaStatus | null>(null);
  const [setup, setSetup] = useState<OpsMfaSetup | null>(null);
  const [password, setPassword] = useState("");
  const [enrollmentKey, setEnrollmentKey] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getOpsMfaStatus()
      .then((value) => {
        if (!active) return;
        setStatus(value);
        setStage(value.enrolled ? "verify" : "password");
      })
      .catch(() => {
        if (active) setStage("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function beginSetup(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const value = await setupOpsMfa(password, enrollmentKey);
      if (!value.qr_png_data_url.startsWith("data:image/png;base64,")) throw new Error();
      setPassword("");
      setEnrollmentKey("");
      setSetup(value);
      setStage("confirm");
    } catch {
      setMessage("No pudimos iniciar la configuración. Revisa tu contraseña.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const value = await confirmOpsMfa(password, enrollmentKey, code.trim());
      setPassword("");
      setEnrollmentKey("");
      setCode("");
      setSetup(null);
      setRecoveryCodes(value.recovery_codes);
      setStage("recovery");
    } catch {
      setMessage("El código no es válido. Espera al siguiente e inténtalo otra vez.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await verifyOpsMfa(code.trim());
      setCode("");
      onVerified();
    } catch {
      setMessage("Código inválido o ya utilizado.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "loading") {
    return <div className="min-h-screen bg-kova-cream" aria-busy="true" aria-label="Cargando MFA" />;
  }
  if (stage === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-kova-cream p-6">
        <p role="alert" className="text-sm text-kova-danger">No pudimos validar el segundo factor.</p>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-kova-cream p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kova-blue">Kova Ops</p>
            <h1 className="font-display text-2xl font-semibold text-kova-ink">Verificación en dos pasos</h1>
            <p className="text-sm text-kova-muted">
              {stage === "password" || stage === "confirm"
                ? "Vincula una app autenticadora para proteger la información global de Kova."
                : "Ingresa el código de tu app autenticadora o un código de recuperación."}
            </p>
          </div>

          {stage === "password" ? (
            <form className="space-y-4" onSubmit={beginSetup}>
              <label htmlFor="ops-mfa-password" className="block space-y-2 text-sm font-medium text-kova-ink">
                Confirma tu contraseña
                <Input
                  id="ops-mfa-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <label htmlFor="ops-mfa-enrollment-key" className="block space-y-2 text-sm font-medium text-kova-ink">
                Clave privada de enrolamiento
                <Input
                  id="ops-mfa-enrollment-key"
                  type="password"
                  autoComplete="off"
                  value={enrollmentKey}
                  onChange={(event) => setEnrollmentKey(event.target.value)}
                  minLength={32}
                  required
                />
              </label>
              <Button className="w-full" disabled={submitting}>Configurar MFA</Button>
            </form>
          ) : null}

          {stage === "confirm" && setup ? (
            <form className="space-y-4" onSubmit={confirmSetup}>
              <div className="mx-auto w-fit rounded-kova-md border border-kova-border bg-white p-3">
                <img src={setup.qr_png_data_url} alt="Código QR para configurar Kova Ops" className="h-48 w-48" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-xs text-kova-muted">Si no puedes escanearlo, usa esta clave:</p>
                <code className="break-all text-xs font-semibold text-kova-ink">{setup.secret}</code>
              </div>
              <label htmlFor="ops-mfa-confirm-code" className="block space-y-2 text-sm font-medium text-kova-ink">
                Código de 6 dígitos
                <Input
                  id="ops-mfa-confirm-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <label htmlFor="ops-mfa-confirm-password" className="block space-y-2 text-sm font-medium text-kova-ink">
                Confirma otra vez tu contraseña
                <Input
                  id="ops-mfa-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <label htmlFor="ops-mfa-confirm-enrollment-key" className="block space-y-2 text-sm font-medium text-kova-ink">
                Confirma la clave privada de enrolamiento
                <Input
                  id="ops-mfa-confirm-enrollment-key"
                  type="password"
                  autoComplete="off"
                  value={enrollmentKey}
                  onChange={(event) => setEnrollmentKey(event.target.value)}
                  minLength={32}
                  required
                />
              </label>
              <Button className="w-full" disabled={submitting}>Activar y continuar</Button>
            </form>
          ) : null}

          {stage === "verify" ? (
            <form className="space-y-4" onSubmit={verify}>
              <label htmlFor="ops-mfa-verify-code" className="block space-y-2 text-sm font-medium text-kova-ink">
                Código de autenticación
                <Input
                  id="ops-mfa-verify-code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  maxLength={64}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              {status?.recovery_codes_remaining !== undefined ? (
                <p className="text-xs text-kova-muted">
                  Códigos de recuperación disponibles: {status.recovery_codes_remaining}
                </p>
              ) : null}
              <Button className="w-full" disabled={submitting}>Verificar acceso</Button>
            </form>
          ) : null}

          {stage === "recovery" ? (
            <div className="space-y-4">
              <div className="rounded-kova-md border border-kova-border bg-kova-mist p-4">
                <p className="mb-3 text-sm font-semibold text-kova-ink">Guarda estos códigos una sola vez</p>
                <div className="grid gap-1 font-mono text-xs text-kova-ink">
                  {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
                </div>
              </div>
              <p className="text-xs text-kova-muted">Cada código funciona una sola vez. Guárdalos fuera de Kova.</p>
              <Button
                className="w-full"
                onClick={() => {
                  setRecoveryCodes([]);
                  onVerified();
                }}
              >
                Ya los guardé
              </Button>
            </div>
          ) : null}

          {message ? <p role="alert" className="text-sm text-kova-danger">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
