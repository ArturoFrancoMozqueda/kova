import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Palette } from "lucide-react";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import type { WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { CardFace, type CardAppearance } from "@/loyaltyCard/CardFace";
import type { Reward } from "./rewards/api";

type Program = {
  business_name: string;
  appearance: CardAppearance & { version: number };
  policy: {
    enabled: boolean;
    spend_amount: string | null;
    points_per_step: number | null;
    version: number;
  };
  reward: Reward | null;
  enrollment: { enabled: boolean; version: number };
};
type Draft = {
  color: string;
  logo: boolean;
  spend: string;
  points: string;
  reward: boolean;
  title: string;
  cost: string;
  discount: string;
  enabled: boolean;
  enrollment: boolean;
};
const initial = (p: Program): Draft => ({
  color: p.appearance.color,
  logo: p.appearance.use_business_logo,
  spend: p.policy.spend_amount ?? "",
  points: p.policy.points_per_step?.toString() ?? "",
  reward: Boolean(p.reward?.enabled),
  title: p.reward?.title ?? "",
  cost: p.reward?.points_cost.toString() ?? "",
  discount: p.reward?.discount_amount ?? "",
  enabled: p.policy.enabled,
  enrollment: p.enrollment.enabled,
});
const money = (s: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(s),
  );
const validMoney = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0.01 && Number(v) <= 1000000;
const validInt = (v: string, max: number) =>
  /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max;
const steps = ["Apariencia", "Acumulación", "Recompensa", "Revisión y acceso"];
export function ProgramWizard({
  identity,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  onSaved: () => void;
}) {
  const panel = useOperationsPanel<Program>(
    "/api/v1/loyalty/program",
    identity,
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Program | null>(null);
  const [discard, setDiscard] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [hasNavigated, setHasNavigated] = useState(false);
  useEffect(() => {
    if (open && hasNavigated) heading.current?.focus();
  }, [step, open, hasNavigated]);
  const edit = () => {
    if (!panel.data) return;
    setBaseline(panel.data);
    setDraft(initial(panel.data));
    setStep(0);
    setOpen(true);
    setDiscard(false);
    setHasNavigated(true);
  };
  const dirty =
    draft &&
    baseline &&
    JSON.stringify(draft) !== JSON.stringify(initial(baseline));
  const close = () => {
    if (dirty) setDiscard(true);
    else setOpen(false);
  };
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const accumulationValid = Boolean(
    draft && validMoney(draft.spend) && validInt(draft.points, 10000),
  );
  const rewardValid = Boolean(
    draft &&
      (!draft.reward ||
        (draft.title.trim() &&
          validInt(draft.cost, 1000000000) &&
          validMoney(draft.discount))),
  );
  const valid = Boolean(
    draft &&
      /^#[0-9a-f]{6}$/i.test(draft.color) &&
      accumulationValid &&
      rewardValid,
  );
  const save = async () => {
    if (!draft || !baseline || !valid) return;
    const success = await panel.mutate(
      "",
      "PUT",
      {
        appearance: {
          color: draft.color,
          use_business_logo: draft.logo,
          expected_version: baseline.appearance.version,
        },
        policy: {
          enabled: draft.enabled,
          spend_amount: draft.spend,
          points_per_step: Number(draft.points),
          expected_version: baseline.policy.version,
        },
        reward: draft.reward
          ? {
              title: draft.title.trim(),
              points_cost: Number(draft.cost),
              discount_amount: draft.discount,
              enabled: true,
              expected_version: baseline.reward?.version ?? 0,
            }
          : null,
        reward_expected_version: baseline.reward?.version ?? 0,
        enrollment: {
          enabled: draft.enrollment,
          expected_version: baseline.enrollment.version,
        },
      },
      "Programa guardado. Tus tarjetas ya muestran estos cambios.",
    );
    if (success) {
      setOpen(false);
      onSaved();
    }
  };
  return (
    <section
      aria-label="Programa de lealtad"
      className="space-y-5 rounded-2xl border border-kova-border bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Tu tarjeta, paso a paso</h2>
          <p className="mt-1 max-w-xl text-sm text-kova-muted">
            Elige cómo se ve, cómo suma puntos y qué recompensa ofrece.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!panel.data || panel.busy || !panel.online}
          onClick={open ? close : edit}
          aria-expanded={open}
          aria-controls="loyalty-program-editor"
        >
          {open
            ? "Cerrar configuración"
            : panel.data?.policy.version
              ? "Editar tarjeta y programa"
              : "Crear mi tarjeta"}
        </Button>
      </div>
      {panel.loading && !panel.data && (
        <SectionSkeleton label="Consultando el programa…" variant="form" />
      )}
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar configuración actual"
        />
      )}
      {panel.notice && (
        <p role="status" className="text-sm text-kova-growth-strong">
          {panel.notice}
        </p>
      )}
      {!open && panel.data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-kova-mist px-3 py-1">
            {panel.data.policy.enabled
              ? "Acumulación activa"
              : "Acumulación pausada"}
          </span>
          <span className="rounded-full bg-kova-mist px-3 py-1">
            {panel.data.reward?.enabled
              ? "Con recompensa en caja"
              : "Sin recompensa configurada"}
          </span>
          <span className="rounded-full bg-kova-mist px-3 py-1">
            {panel.data.enrollment.enabled
              ? "Altas desde el menú permitidas"
              : "Altas desde el menú pausadas"}
          </span>
        </div>
      )}
      {open && draft && baseline && (
        <div id="loyalty-program-editor" className="space-y-5">
          <nav aria-label="Pasos de configuración">
            <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {steps.map((name, index) => (
                <li key={name}>
                  <Button
                    type="button"
                    variant={step === index ? "default" : "ghost"}
                    className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                    aria-current={step === index ? "step" : undefined}
                    disabled={
                      panel.busy ||
                      (index > 1 && !accumulationValid) ||
                      (index > 2 && !rewardValid)
                    }
                    onClick={() => setStep(index)}
                  >
                    {index < step ? (
                      <Check className="mr-2 h-4 w-4 shrink-0" />
                    ) : (
                      <span className="mr-2">{index + 1}.</span>
                    )}
                    {name}
                  </Button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.85fr)]">
            <aside
              className="order-first min-w-0 space-y-3 lg:sticky lg:top-6 lg:order-last"
              aria-label="Vista previa de la tarjeta"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-kova-muted">
                Vista previa · Cambios sin guardar
              </p>
              <CardFace
                businessName={baseline.business_name}
                appearance={{
                  color: draft.color,
                  use_business_logo: draft.logo,
                  logo_url: baseline.appearance.logo_url,
                }}
                label="Diseño de tu tarjeta"
              >
                <div
                  className={`rounded-xl p-2 transition-colors motion-reduce:transition-none ${step === 1 ? "bg-current/5 ring-1 ring-current" : ""}`}
                >
                  <p className="text-sm font-medium">
                    {accumulationValid
                      ? `${draft.points} puntos por cada ${money(draft.spend)}`
                      : "Tu regla de puntos aparecerá aquí"}
                  </p>
                  <p className="mt-1 text-xs">
                    Por tramos completos en cada compra
                  </p>
                </div>
                <div
                  className={`border-t border-current/20 pt-3 text-sm ${step === 2 ? "rounded-lg ring-1 ring-current" : ""}`}
                >
                  <p className="break-words font-semibold">
                    {draft.reward
                      ? draft.title.trim() || "Nombre de tu recompensa"
                      : "Beneficios por definir"}
                  </p>
                  {draft.reward && rewardValid && (
                    <p className="mt-1 text-xs">
                      {draft.cost} puntos por {money(draft.discount)} de
                      descuento
                    </p>
                  )}
                </div>
              </CardFace>
              <p className="text-xs text-kova-muted">
                La tarjeta de cada cliente mostrará sus puntos reales. Guarda
                para publicar el diseño.
              </p>
            </aside>
            <form
              className="min-w-0 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (step < 3) setStep(step + 1);
                else void save();
              }}
            >
              <fieldset disabled={panel.busy} className="space-y-4">
                <h3
                  ref={heading}
                  tabIndex={-1}
                  className="text-lg font-semibold outline-none"
                >
                  {steps[step]}
                </h3>
                {step === 0 && (
                  <>
                    <Label htmlFor="card-color">Color de tu tarjeta</Label>
                    <div className="flex flex-wrap items-center gap-3">
                      <Input
                        id="card-color"
                        type="color"
                        className="h-12 w-20 p-1"
                        value={draft.color}
                        onChange={(e) => change("color", e.target.value)}
                      />
                      <Palette
                        className="h-5 w-5 text-kova-muted"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-kova-muted">
                        El texto se ajusta para que sea legible.
                      </p>
                    </div>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.logo}
                        onChange={(e) => change("logo", e.target.checked)}
                      />
                      Usar el logo del negocio
                    </label>
                    {!baseline.appearance.logo_url && (
                      <p className="text-sm text-kova-muted">
                        Puedes agregar tu logo en{" "}
                        <Link className="underline" to="/settings">
                          Configuración del negocio
                        </Link>
                        .
                      </p>
                    )}
                  </>
                )}
                {step === 1 && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="program-spend">
                        Por cada compra de (MXN)
                      </Label>
                      <Input
                        id="program-spend"
                        inputMode="decimal"
                        required
                        value={draft.spend}
                        onChange={(e) => change("spend", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="program-points">
                        El cliente suma estos puntos
                      </Label>
                      <Input
                        id="program-points"
                        type="number"
                        min="1"
                        max="10000"
                        step="1"
                        required
                        value={draft.points}
                        onChange={(e) => change("points", e.target.value)}
                      />
                    </div>
                    <p className="text-sm text-kova-muted">
                      Se cuentan tramos completos por compra. Los sobrantes no
                      pasan a la siguiente. Cambiar la regla conserva los puntos
                      de ventas anteriores.
                    </p>
                  </>
                )}
                {step === 2 && (
                  <>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.reward}
                        onChange={(e) => change("reward", e.target.checked)}
                      />
                      Ofrecer una recompensa en caja
                    </label>
                    {draft.reward ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="program-reward">
                            Nombre de la recompensa
                          </Label>
                          <Input
                            id="program-reward"
                            maxLength={160}
                            required
                            value={draft.title}
                            onChange={(e) => change("title", e.target.value)}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="program-cost">
                              Puntos para canjear
                            </Label>
                            <Input
                              id="program-cost"
                              type="number"
                              min="1"
                              max="1000000000"
                              required
                              value={draft.cost}
                              onChange={(e) => change("cost", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="program-discount">
                              Descuento en MXN
                            </Label>
                            <Input
                              id="program-discount"
                              inputMode="decimal"
                              required
                              value={draft.discount}
                              onChange={(e) =>
                                change("discount", e.target.value)
                              }
                            />
                          </div>
                        </div>
                        <p className="text-sm text-kova-muted">
                          Se aplica al completar una venta en línea. La compra
                          debe cubrir el beneficio; no se combina con otro
                          descuento.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-kova-muted">
                        Puedes definirla después. Los puntos existentes se
                        conservan.
                      </p>
                    )}
                  </>
                )}
                {step === 3 && (
                  <>
                    <p className="text-sm">
                      Revisa tu tarjeta y elige cómo comenzará a funcionar.
                    </p>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => change("enabled", e.target.checked)}
                      />
                      Activar acumulación de puntos
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.enrollment}
                        onChange={(e) => change("enrollment", e.target.checked)}
                      />
                      Permitir nuevas tarjetas desde el menú
                    </label>
                    <p className="text-sm text-kova-muted">
                      Las altas requieren tu menú publicado y la acumulación
                      activa. Pausar las altas conserva las tarjetas emitidas.
                      Los puntos se generan con ventas reales asociadas a un
                      cliente.
                    </p>
                  </>
                )}
              </fieldset>
              <div className="flex flex-wrap gap-3">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={panel.busy}
                    onClick={() => setStep(step - 1)}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Anterior
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    panel.busy ||
                    !panel.online ||
                    (step === 1 && !accumulationValid) ||
                    (step === 2 && !rewardValid) ||
                    (step === 3 && !valid)
                  }
                >
                  {panel.busy
                    ? "Guardando…"
                    : step === 3
                      ? "Guardar tarjeta y programa"
                      : "Continuar"}
                  {step < 3 && <ChevronRight className="ml-1 h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
          {discard && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-kova-border bg-kova-mist p-4"
            >
              <p className="text-sm">
                Tienes cambios sin guardar. ¿Quieres descartarlos?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    setDiscard(false);
                  }}
                >
                  Descartar cambios
                </Button>
                <Button type="button" onClick={() => setDiscard(false)}>
                  Seguir editando
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
