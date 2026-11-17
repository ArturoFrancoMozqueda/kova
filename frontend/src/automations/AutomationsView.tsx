import { useAuth } from "@/auth/useAuth";
import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { resolveUserFacingError } from "@/lib/apiError";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, CirclePause, RefreshCw, Workflow } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { isRecordId } from "@/operationsQueue/useLinkedRecord";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  OperationsError,
  OperationsSession,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "./workspace";
import type { AutomationRule, AutomationRun, AutomationsData } from "./types";
import { RuleFlow } from "./RuleFlow";
import { useTaskMeasurement } from "@/telemetry/useTaskMeasurement";

const statuses = {
  pending: "Pendiente",
  completed: "Completada",
  dismissed: "Descartada",
  suppressed: "Ya no aplica",
};

export default function AutomationsView() {
  useDocumentTitle("Reglas de tareas");
  const { state } = useAuth();
  return (
    <OperationsSession>
      {(identity) => (
        <AutomationsWorkspace
          identity={identity}
          canConfigure={hasPlanFeature(
            state.status === "authenticated"
              ? state.commercialAccess
              : undefined,
            "customer_orders",
          )}
        />
      )}
    </OperationsSession>
  );
}

function AutomationsWorkspace({
  identity,
  canConfigure,
}: {
  identity: WorkspaceIdentity;
  canConfigure: boolean;
}) {
  const request = useOperationsRequest("/api/v1/automations", identity);
  const online = useOnline();
  const [params] = useSearchParams();
  const selectedId = params.get("run_id");
  const taskMeasurement = useTaskMeasurement(
    "automation_task",
    `${identity.tenantId}:${identity.userId}:${identity.branchId}:${selectedId ?? ""}`,
    identity,
  );
  const selectedTask = useRef<HTMLElement>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [data, setData] = useState<AutomationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRule, setConfirmRule] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    try {
      const result = await request<AutomationsData>("?limit=200");
      if (mounted.current && revision === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      ) {
        setData(null);
        setError(
          resolveUserFacingError(e, "No pudimos cargar las reglas de tareas."),
        );
      }
    } finally {
      if (mounted.current && revision === generation.current) setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const mutate = async (
    action: () => Promise<unknown>,
    success: string,
    measuresTask = false,
  ) => {
    if (locked.current || !online) return;
    if (measuresTask) {
      taskMeasurement.start();
      taskMeasurement.pause();
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (measuresTask) taskMeasurement.finish("completed");
      if (!mounted.current) return;
      setNotice(success);
      setConfirmRule(null);
      await load();
    } catch (e) {
      if (measuresTask) taskMeasurement.finish("failed");
      if (!mounted.current) return;
      if (e instanceof OperationsError && e.status === 409) await load();
      if (mounted.current)
        setError(resolveUserFacingError(e, "No pudimos guardar los cambios."));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const toggle = (rule: AutomationRule) =>
    canConfigure &&
    void mutate(
      () =>
        request(
          `/rules/${encodeURIComponent(rule.template_key)}`,
          "PUT",
          { enabled: !rule.enabled, expected_version: rule.version },
          crypto.randomUUID(),
        ),
      rule.enabled
        ? "Regla pausada. Revisa los pendientes cancelados en el historial."
        : "Regla activada para los próximos cambios del negocio.",
    );
  const resolve = (run: AutomationRun, status: "completed" | "dismissed") =>
    void mutate(
      () =>
        request(
          `/runs/${run.id}/resolve`,
          "POST",
          { expected_version: run.version, status },
          crypto.randomUUID(),
        ),
      status === "completed"
        ? "Tarea marcada como completada."
        : "Tarea descartada.",
      true,
    );
  const pending = data?.runs.filter((run) => run.status === "pending") ?? [];
  const selected = data?.runs.find((run) => run.id === selectedId);
  useEffect(() => {
    if (selected) {
      selectedTask.current?.focus();
      if (selected.status === "pending") taskMeasurement.start();
    }
  }, [selected, selectedId, taskMeasurement]);
  const runs = data
    ? [...pending, ...data.runs.filter((run) => run.status !== "pending")]
    : [];
  return (
    <ViewLayout className="space-y-6 [&_.animate-fade-in]:animate-none">
      {!canConfigure && <PlanFeatureNotice />}
      <ViewHeader
        eyebrow="Seguimiento del equipo"
        title="Reglas de tareas"
        meta="Kova crea pendientes internos; tu equipo realiza la acción y registra el resultado."
        actions={
          <Button
            variant="outline"
            disabled={!online || busy || loading || !canConfigure}
            onClick={() =>
              void mutate(
                () =>
                  request("/process", "POST", undefined, crypto.randomUUID()),
                "Búsqueda terminada. Revisa los pendientes disponibles.",
              )
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Buscar nuevos pendientes
          </Button>
        }
      />
      {!online && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Sin conexión. Los cambios estarán disponibles cuando recuperes
          internet.
        </p>
      )}
      {error && (
        <ViewError
          message={error}
          onRetry={() => void load()}
          retryLabel="Volver a cargar"
        />
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-kova-growth/30 bg-kova-growth/10 p-4 text-sm text-kova-growth-strong"
        >
          {notice}
        </p>
      )}
      {loading && !data && (
        <SectionSkeleton label="Cargando reglas de tareas…" />
      )}
      {data && (
        <>
          <section aria-labelledby="automation-history" className="space-y-4">
            <h2 id="automation-history" className="text-lg font-semibold">
              Pendientes e historial reciente
            </h2>
            <p className="text-sm text-muted-foreground">
              {pending.length} {pending.length === 1 ? "pendiente" : "pendientes"} en esta consulta. También puedes
              revisarlos en{" "}
              <Link className="underline" to="/operations-queue">
                Pendientes del negocio
              </Link>
              .
            </p>
            {selectedId && !selected && (
              <p role="status" className="rounded-xl border p-4 text-sm">
                {isRecordId(selectedId)
                  ? "La tarea no está disponible en las últimas 200 revisiones de esta sucursal. Puede haber quedado fuera de esta consulta; revisa el registro de origen."
                  : "El enlace de la tarea no es válido. Revisa los pendientes disponibles."}
              </p>
            )}
            {runs.length === 0 ? (
              <ViewEmpty
                illustration="tasks"
                icon={<CheckCheck className="h-6 w-6" />}
                title="Todo empieza con un cambio real"
                body="Configura una regla. Los nuevos cambios elegibles crearán tareas aquí y en Pendientes del negocio."
              />
            ) : (
              <div className="space-y-3">
                {runs.map((run) => (
                  <article
                    key={run.id}
                    ref={run.id === selectedId ? selectedTask : undefined}
                    tabIndex={run.id === selectedId ? -1 : undefined}
                    aria-label={
                      run.id === selectedId
                        ? `Tarea seleccionada: ${run.title}`
                        : undefined
                    }
                    className={`flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between ${run.id === selectedId ? "border-kova-blue ring-2 ring-kova-blue/20 focus:outline-kova-blue" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium break-words">{run.title}</h3>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {statuses[run.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(run.created_at).toLocaleString("es-MX")} ·{" "}
                        {run.entity_type === "service_case"
                          ? "Seguimiento de una atención"
                          : run.entity_type === "product"
                            ? "Revisión de inventario"
                            : "Seguimiento de un pedido"}
                      </p>
                      <Link
                        className="mt-2 inline-flex min-h-11 items-center text-sm text-kova-blue underline"
                        onClick={() => taskMeasurement.start()}
                        to={
                          run.entity_type === "customer_order"
                            ? `/pedidos/${encodeURIComponent(run.entity_id)}`
                            : run.entity_type === "service_case"
                              ? `/service-cases?case_id=${encodeURIComponent(run.entity_id)}`
                              : `/inventory?product=${encodeURIComponent(run.entity_id)}`
                        }
                      >
                        {run.entity_type === "customer_order"
                          ? "Revisar pedido"
                          : run.entity_type === "service_case"
                            ? "Revisar atención postventa"
                            : "Revisar producto en inventario"}
                      </Link>
                    </div>
                    {run.status === "pending" && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !online}
                          onClick={() => resolve(run, "completed")}
                          aria-label={`Completar ${run.title}`}
                        >
                          Completar tarea
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !online}
                          onClick={() => resolve(run, "dismissed")}
                          aria-label={`Descartar ${run.title}`}
                        >
                          Descartar
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Últimas 200 revisiones como máximo. Completar una tarea registra
              el seguimiento del equipo; las entregas, compras y atenciones se
              realizan desde su registro.
            </p>
          </section>
          <section className="space-y-4" aria-label="Configuración de reglas">
            <Button
              variant="outline"
              aria-expanded={rulesOpen}
              aria-controls="automation-rule-settings"
              onClick={() => setRulesOpen((value) => !value)}
            >
              {rulesOpen
                ? "Ocultar configuración de reglas"
                : "Configurar reglas"}
            </Button>
            {rulesOpen && (
              <div id="automation-rule-settings" className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl border bg-card p-5">
                  <Workflow
                    className="mt-1 h-5 w-5 shrink-0 text-kova-blue"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="font-semibold">
                      Reglas que crean tareas internas
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Elige qué cambios deben generar un pendiente. Estas reglas
                      crean tareas para el equipo; no envían mensajes ni
                      realizan acciones financieras.
                    </p>
                    <p className="mt-2 text-sm">
                      {data.rules.filter((rule) => rule.enabled).length} reglas
                      activas
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {data.rules.map((rule) => (
                    <article
                      key={rule.template_key}
                      className="flex flex-col rounded-2xl border bg-card p-5"
                    >
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${rule.enabled ? "bg-kova-growth/10 text-kova-growth-strong" : "bg-muted text-muted-foreground"}`}
                      >
                        {rule.enabled ? (
                          <CheckCheck className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <CirclePause className="h-3 w-3" aria-hidden="true" />
                        )}
                        {rule.enabled ? "Activa" : "Pausada"}
                      </span>
                      <h3 className="mt-4 font-semibold">{rule.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {rule.description}
                      </p>
                      <div className="flex-1">
                        <RuleFlow rule={rule} />
                      </div>
                      {confirmRule === rule.template_key ? (
                        <div className="mt-5 rounded-xl bg-muted p-3">
                          <p className="text-sm">
                            {rule.enabled
                              ? "Pausar detiene nuevos pendientes y cancela los pendientes de esta regla."
                              : "Activar permite crear tareas con los próximos cambios del negocio."}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={busy || !online || !canConfigure}
                              onClick={() => toggle(rule)}
                            >
                              Confirmar {rule.enabled ? "pausa" : "activación"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => setConfirmRule(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          className="mt-5"
                          variant="outline"
                          disabled={busy || !online || !canConfigure}
                          aria-label={`${rule.enabled ? "Pausar" : "Activar"} ${rule.title}`}
                          onClick={() => setConfirmRule(rule.template_key)}
                        >
                          {rule.enabled ? (
                            <CirclePause
                              className="mr-2 h-4 w-4"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCheck
                              className="mr-2 h-4 w-4"
                              aria-hidden="true"
                            />
                          )}
                          {rule.enabled ? "Pausar regla" : "Activar regla"}
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </ViewLayout>
  );
}
