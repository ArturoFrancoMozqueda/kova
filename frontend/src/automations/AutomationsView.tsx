import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, CirclePause, RefreshCw, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
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

const statuses = {
  pending: "Pendiente",
  completed: "Completada",
  dismissed: "Descartada",
  suppressed: "Ya no aplica",
};

export default function AutomationsView() {
  useDocumentTitle("Automatizaciones");
  return (
    <OperationsSession>
      {(identity) => <AutomationsWorkspace identity={identity} />}
    </OperationsSession>
  );
}

function AutomationsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1/automations", identity);
  const online = useOnline();
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
      const result = await request<AutomationsData>();
      if (mounted.current && revision === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos cargar las automatizaciones.",
        );
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

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (!mounted.current) return;
      setNotice(success);
      setConfirmRule(null);
      await load();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof OperationsError && e.status === 409) await load();
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "No pudimos guardar los cambios.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const toggle = (rule: AutomationRule) =>
    void mutate(
      () =>
        request(
          `/rules/${encodeURIComponent(rule.template_key)}`,
          "PUT",
          { enabled: !rule.enabled, expected_version: rule.version },
          crypto.randomUUID(),
        ),
      rule.enabled
        ? "Automatización pausada. Revisa los pendientes cancelados en el historial."
        : "Automatización activada para los próximos eventos.",
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
    );
  const pending = data?.runs.filter((run) => run.status === "pending") ?? [];
  return (
    <ViewLayout className="space-y-7 [&_.animate-fade-in]:animate-none">
      <ViewHeader
        eyebrow="Operación conectada"
        title="Automatizaciones"
        meta="Convierte cambios de pedidos e inventario en pendientes claros para tu equipo."
        actions={
          <Button
            variant="outline"
            disabled={!online || busy || loading}
            onClick={() =>
              void mutate(
                () =>
                  request("/process", "POST", undefined, crypto.randomUUID()),
                "Revisión terminada. El historial muestra los pendientes disponibles.",
              )
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Revisar eventos
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
      {loading && !data && <p role="status">Cargando automatizaciones…</p>}
      {data && (
        <>
          <section
            className="rounded-2xl border bg-card p-5 sm:p-6"
            aria-labelledby="automation-scope"
          >
            <div className="flex items-start gap-3">
              <Workflow
                className="mt-1 h-5 w-5 shrink-0 text-kova-blue"
                aria-hidden="true"
              />
              <div>
                <h2 id="automation-scope" className="font-semibold">
                  Pendientes internos, con seguimiento
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Las reglas crean tareas a partir de datos del negocio. El
                  equipo realiza la acción y registra el resultado. Los mensajes
                  externos y las acciones financieras requieren una integración
                  verificada.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full border px-3 py-1">
                {data.rules.filter((rule) => rule.enabled).length} reglas
                activas
              </span>
              <span className="rounded-full border px-3 py-1">
                {pending.length} pendientes en esta vista
              </span>
              {!data.capabilities.external_messaging && (
                <span className="rounded-full bg-muted px-3 py-1">
                  Mensajería externa sin conectar
                </span>
              )}
            </div>
          </section>
          <section aria-labelledby="automation-rules" className="space-y-4">
            <h2 id="automation-rules" className="text-lg font-semibold">
              Reglas del negocio
            </h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {data.rules.map((rule) => (
                <article
                  key={rule.template_key}
                  className="flex flex-col rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${rule.enabled ? "bg-kova-growth/10 text-kova-growth-strong" : "bg-muted text-muted-foreground"}`}
                    >
                      {rule.enabled ? "Activa" : "Pausada"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Versión {rule.version}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold">{rule.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                    {rule.description}
                  </p>
                  {confirmRule === rule.template_key ? (
                    <div className="mt-5 rounded-xl bg-muted p-3">
                      <p className="text-sm">
                        {rule.enabled
                          ? "Pausar detiene nuevos pendientes y cancela los pendientes de esta regla."
                          : "Activar permite crear tareas con los próximos eventos del negocio."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !online}
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
                      disabled={busy || !online}
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
          </section>
          <section aria-labelledby="automation-history" className="space-y-4">
            <h2 id="automation-history" className="text-lg font-semibold">
              Pendientes e historial reciente
            </h2>
            {data.runs.length === 0 ? (
              <ViewEmpty
                icon={<CheckCheck className="h-6 w-6" />}
                title="Todo empieza con un cambio real"
                body="Activa una regla. Los nuevos eventos elegibles aparecerán aquí con su tarea y estado."
              />
            ) : (
              <div className="space-y-3">
                {data.runs.map((run) => (
                  <article
                    key={run.id}
                    className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium break-words">{run.title}</h3>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {statuses[run.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(run.created_at).toLocaleString("es-MX")} ·
                        {run.entity_type === "service_case"
                          ? "Seguimiento del vencimiento de una atención"
                          : `Versión del recurso ${run.entity_version}`}
                      </p>
                      {run.entity_type === "customer_order" && (
                        <Link
                          className="mt-2 inline-flex min-h-10 items-center text-sm text-kova-blue underline"
                          to={`/pedidos/${run.entity_id}`}
                        >
                          Revisar pedido
                        </Link>
                      )}
                      {run.entity_type === "service_case" && (
                        <Link
                          className="mt-2 inline-flex min-h-11 items-center text-sm text-kova-blue underline"
                          to={`/service-cases?case_id=${encodeURIComponent(run.entity_id)}`}
                        >
                          Revisar atención postventa
                        </Link>
                      )}
                      {run.entity_type === "product" && (
                        <Link
                          className="mt-2 inline-flex min-h-10 items-center text-sm text-kova-blue underline"
                          to="/inventory"
                        >
                          Revisar inventario
                        </Link>
                      )}
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
          </section>
        </>
      )}
    </ViewLayout>
  );
}
