import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { resolveUserFacingError } from "@/lib/apiError";
import { ClipboardCheck } from "lucide-react";
import { useId, useEffect, useRef, useState, type FormEvent } from "react";
import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import { Link } from "react-router-dom";
import {
  OperationsSession,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";
import { utcToZonedInput, zonedInputToUtc } from "@/appointments/timezone";
import {
  serviceCaseStatuses,
  type ServiceCase,
  type ServiceCaseAssignee,
  type ServiceCaseEvent,
  type ServiceCasePage,
  type ServiceCaseStatus,
} from "./types";

const fieldClass = "mt-1 min-w-0";
const buttonClass = "h-auto min-h-11 whitespace-normal";
const date = (value: string) => new Date(value).toLocaleString("es-MX");
const money = (value: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(value),
  );
type References = {
  sales: { id: string; total_amount: string; occurred_at: string }[];
  customer_orders: { id: string; folio: string; status: string }[];
  sales_has_more: boolean;
  customer_orders_has_more: boolean;
};
export default function ServiceCasesView() {
  useDocumentTitle("Atención postventa");
  return (
    <OperationsSession>
      {(identity) => <ServiceCasesWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function ServiceCasesWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const fieldId = useId();
  const linked = useLinkedRecord<ServiceCase>(
    identity,
    "case_id",
    "/api/v1/service-cases",
  );
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const panel = useOperationsPanel<ServiceCasePage>(
    "/api/v1/service-cases",
    identity,
    `?limit=50&offset=${offset}${status ? `&status=${status}` : ""}${overdueOnly ? "&overdue_only=true" : ""}`,
  );
  const { request } = panel;
  const customerRequest = useOperationsRequest("/api/v1/customers", identity);
  const [assignees, setAssignees] = useState<ServiceCaseAssignee[]>([]);
  const [assigneeError, setAssigneeError] = useState("");
  const [assigneeRevision, setAssigneeRevision] = useState(0);
  const [assigneeOffset, setAssigneeOffset] = useState(0);
  const [assigneesHasMore, setAssigneesHasMore] = useState(false);
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saleId, setSaleId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [references, setReferences] = useState<{
    customerId: string;
    data: References;
  } | null>(null);
  const [referencesError, setReferencesError] = useState("");
  const [referenceOffset, setReferenceOffset] = useState(0);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [formError, setFormError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const selected = linked.requested
    ? linked.record
    : panel.data?.items.find((row) => row.id === selectedId);
  const [deviceZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  useEffect(() => {
    let active = true;
    setAssigneeLoading(true);
    void request<{ items: ServiceCaseAssignee[]; has_more: boolean }>(
      `/assignees?limit=100&offset=${assigneeOffset}`,
    )
      .then((result) => {
        if (active) {
          setAssignees((previous) =>
            assigneeOffset === 0
              ? result.items
              : [
                  ...new Map(
                    [...previous, ...result.items].map((person) => [
                      person.user_id,
                      person,
                    ]),
                  ).values(),
                ],
          );
          setAssigneesHasMore(result.has_more);
          setAssigneeError("");
        }
      })
      .catch((e: unknown) => {
        if (active)
          setAssigneeError(
            resolveUserFacingError(e, "No pudimos consultar responsables."),
          );
      })
      .finally(() => {
        if (active) setAssigneeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, assigneeRevision, assigneeOffset]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void customerRequest<Customer[]>(`?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) {
            setCustomers(rows);
            setCustomerError("");
          }
        })
        .catch(() => {
          if (active)
            setCustomerError(
              "No pudimos buscar clientes. Cambia la búsqueda para reintentar.",
            );
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerRequest, search]);
  useEffect(() => {
    let active = true;
    setReferences(null);
    setReferencesError("");
    if (customerId)
      void request<References>(
        `/references?customer_id=${encodeURIComponent(customerId)}&limit=50&offset=${referenceOffset}`,
      )
        .then((result) => {
          if (active) setReferences({ customerId, data: result });
        })
        .catch((e: unknown) => {
          if (active)
            setReferencesError(
              resolveUserFacingError(e, "No pudimos consultar ventas y pedidos relacionados."),
            );
        });
    return () => {
      active = false;
    };
  }, [customerId, request, referenceRevision, referenceOffset]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    try {
      const body = {
        customer_id: customerId,
        title: title.trim(),
        note: note.trim(),
        assigned_user_id: assigneeId || null,
        due_at: dueAt ? zonedInputToUtc(dueAt, deviceZone) : null,
        sale_order_id: saleId || null,
        customer_order_id: orderId || null,
      };
      if (
        await panel.mutate(
          "",
          "POST",
          body,
          "Atención registrada con su nota inicial. No se modificaron ventas ni se envió un mensaje.",
        )
      ) {
        setCreateOpen(false);
        setCustomerId("");
        setTitle("");
        setNote("");
        setDueAt("");
        setSaleId("");
        setOrderId("");
        setAssigneeId("");
      }
    } catch (e) {
      setFormError(
        resolveUserFacingError(e, "Revisa los datos de la atención."),
      );
    }
  };
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Relación con clientes"
        title="Atención postventa"
        meta="Da seguimiento a cada incidencia con un responsable y un historial claro."
        actions={
          <Button
            className={buttonClass}
            aria-expanded={createOpen}
            aria-controls="service-case-create-form"
            disabled={panel.busy || !panel.online}
            onClick={() => setCreateOpen((value) => !value)}
          >
            {createOpen ? "Cerrar alta de atención" : "Nueva atención postventa"}
          </Button>
        }
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Registra lo ocurrido, acuerda el siguiente paso y conserva las notas del
        equipo. Resolver una atención no emite devoluciones, cambia pedidos ni
        confirma mensajes al cliente.
      </p>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar datos actualizados"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {assigneeError && (
        <ViewError
          message={assigneeError}
          onRetry={() => setAssigneeRevision((value) => value + 1)}
          retryLabel="Consultar responsables"
        />
      )}
      {assigneesHasMore && (
        <Button
          className={buttonClass}
          variant="outline"
          disabled={assigneeLoading || !panel.online}
          onClick={() => setAssigneeOffset((value) => value + 100)}
        >
          Cargar más responsables
        </Button>
      )}
      {createOpen && (
        <form
          id="service-case-create-form"
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void create(event)}
        >
          <h2 className="text-xl font-semibold">Abrir una atención</h2>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Label htmlFor={`${fieldId}-1`} className="text-sm">
              Buscar cliente
              <Input id={`${fieldId}-1`}
                className={fieldClass}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Label>
            <Label htmlFor={`${fieldId}-2`} className="text-sm">
              Cliente de la atención
              <Select id={`${fieldId}-2`}
                className={fieldClass}
                required
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setSaleId("");
                  setOrderId("");
                  setReferenceOffset(0);
                }}
              >
                <option value="">Elige un cliente registrado</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </Select>
            </Label>
          </div>
          {customerError && <p role="alert">{customerError}</p>}
          <p className="text-sm text-kova-muted">
            Si todavía no existe,{" "}
            <Link className="underline" to="/customers">
              registra al cliente
            </Link>{" "}
            antes de continuar. No se vinculan contactos por coincidencia de
            nombre o teléfono.
          </p>
          <Label htmlFor={`${fieldId}-3`} className="block text-sm">
            Asunto de la atención
            <Input id={`${fieldId}-3`}
              className={fieldClass}
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Label>
          <Label htmlFor={`${fieldId}-4`} className="block text-sm">
            Nota inicial privada
            <Textarea id={`${fieldId}-4`}
              className={fieldClass}
              required
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label htmlFor={`${fieldId}-5`} className="text-sm">
              Responsable de la atención
              <Select id={`${fieldId}-5`}
                className={fieldClass}
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">Sin responsable asignado</option>
                {assignees.map((row) => (
                  <option key={row.user_id} value={row.user_id}>
                    {row.email}
                  </option>
                ))}
              </Select>
            </Label>
            <Label htmlFor={`${fieldId}-6`} className="text-sm">
              Vencimiento de la atención (opcional)
              <Input id={`${fieldId}-6`}
                className={fieldClass}
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Label>
          </div>
          <p className="text-sm text-kova-muted">
            El vencimiento usa la hora de este dispositivo: {deviceZone}. Puedes
            registrar una fecha pasada para documentar un pendiente vencido; no
            dispara avisos automáticos.
          </p>
          <fieldset className="space-y-3 rounded-xl bg-kova-mist p-4">
            <legend className="px-1 text-sm font-medium">
              Relacionar una venta o pedido (opcional)
            </legend>
            <p className="text-sm text-kova-muted">
              Sólo se muestran referencias vinculadas a este cliente en la
              sucursal. Elige una venta o un pedido. Al elegir otra referencia
              se reemplaza la anterior. El vínculo no modifica la operación.
            </p>
            {customerId && !references && !referencesError && (
              <p role="status">Consultando referencias del cliente…</p>
            )}
            {referencesError && (
              <ViewError
                message={referencesError}
                onRetry={() => setReferenceRevision((value) => value + 1)}
                retryLabel="Consultar referencias"
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Label htmlFor={`${fieldId}-7`} className="text-sm">
                Venta relacionada
                <Select id={`${fieldId}-7`}
                  className={fieldClass}
                  value={saleId}
                  disabled={
                    !customerId || references?.customerId !== customerId
                  }
                  onChange={(event) => {
                    setSaleId(event.target.value);
                    setOrderId("");
                  }}
                >
                  <option value="">Sin venta</option>
                  {references?.customerId === customerId &&
                    references.data.sales.map((row) => (
                      <option key={row.id} value={row.id}>
                        {date(row.occurred_at)} · {money(row.total_amount)}
                      </option>
                    ))}
                </Select>
              </Label>
              <Label htmlFor={`${fieldId}-8`} className="text-sm">
                Pedido relacionado
                <Select id={`${fieldId}-8`}
                  className={fieldClass}
                  value={orderId}
                  disabled={
                    !customerId || references?.customerId !== customerId
                  }
                  onChange={(event) => {
                    setOrderId(event.target.value);
                    setSaleId("");
                  }}
                >
                  <option value="">Sin pedido</option>
                  {references?.customerId === customerId &&
                    references.data.customer_orders.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.folio}
                      </option>
                    ))}
                </Select>
              </Label>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                className={buttonClass}
                type="button"
                variant="outline"
                size="sm"
                disabled={referenceOffset === 0 || !references}
                onClick={() => {
                  setReferenceOffset((value) => Math.max(0, value - 50));
                  setSaleId("");
                  setOrderId("");
                }}
              >
                Referencias anteriores
              </Button>
              <Button
                className={buttonClass}
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !references?.data.sales_has_more &&
                  !references?.data.customer_orders_has_more
                }
                onClick={() => {
                  setReferenceOffset((value) => value + 50);
                  setSaleId("");
                  setOrderId("");
                }}
              >
                Más referencias
              </Button>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button
              className={buttonClass}
              disabled={
                panel.busy ||
                !panel.online ||
                !customerId ||
                !title.trim() ||
                !note.trim()
              }
            >
              Registrar atención
            </Button>
            <Button
              className={buttonClass}
              type="button"
              variant="ghost"
              disabled={panel.busy}
              onClick={() => setCreateOpen(false)}
            >
              Cancelar alta
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-4" aria-label="Atenciones de la sucursal">
        <h2 className="text-xl font-semibold">
          Pendientes e historial del equipo
        </h2>
        <div className="grid gap-4 rounded-xl border border-kova-border p-4 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Label htmlFor={`${fieldId}-9`} className="min-w-0 flex-1 text-sm">
            Estado de atención
            <Select id={`${fieldId}-9`}
              className={fieldClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
                setSelectedId("");
              }}
            >
              <option value="">Todos los estados</option>
              {Object.entries(serviceCaseStatuses).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => {
                setOverdueOnly(event.target.checked);
                setOffset(0);
                setSelectedId("");
              }}
            />
            Sólo atenciones vencidas
          </Label>
          <Button
            className={buttonClass}
            variant="outline"
            onClick={() => void panel.load()}
          >
            Actualizar atenciones
          </Button>
        </div>
        {panel.loading && <SectionSkeleton label="Consultando atenciones…" />}
        {!panel.loading && !panel.error && panel.data?.items.length === 0 && (
          <ViewEmpty
            icon={<ClipboardCheck className="h-6 w-6" aria-hidden="true" />}
            title="No hay atenciones con estos filtros."
            body="Registra una incidencia cuando necesites dar seguimiento o consulta otros estados."
          />
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {panel.data?.items.map((row) => (
            <article
              key={row.id}
              className="min-w-0 space-y-3 rounded-2xl border border-kova-border bg-white p-5"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="break-words font-semibold">{row.title}</h3>
                <span className="text-sm text-kova-muted">
                  {serviceCaseStatuses[row.status]}
                </span>
              </div>
              <p className="break-words text-sm">{row.customer_name}</p>
              <p className="break-words text-sm text-kova-muted">
                {row.assigned_user_id
                  ? `${
                      assignees.find(
                        (person) => person.user_id === row.assigned_user_id,
                      )?.email ?? "Responsable asignado"
                    }${row.assignee_active ? "" : " · Sin acceso actual a la sucursal"}`
                  : "Sin responsable asignado"}
              </p>
              {row.due_at && (
                <p
                  className={
                    row.overdue
                      ? "text-sm font-medium text-warning-strong"
                      : "text-sm"
                  }
                >
                  {row.overdue ? "Vencida desde" : "Vencimiento"}:{" "}
                  {date(row.due_at)}
                </p>
              )}
              <p className="text-xs text-kova-muted">
                Actualizada: {date(row.updated_at)}
              </p>
              <Button
                className={buttonClass}
                variant="outline"
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  if (linked.requested) linked.close();
                  setSelectedId(row.id);
                }}
              >
                Abrir atención: {row.title}
              </Button>
            </article>
          ))}
        </div>
      </section>
      <LinkedRecordNotice linked={linked} />
      {selected && (
        <ServiceCaseDetail
          key={selected.id}
          identity={identity}
          record={selected}
          assignees={assignees}
          busy={panel.busy}
          online={panel.online}
          mutate={async (...args) => {
            const saved = await panel.mutate(...args);
            if (linked.requested) linked.reload();
            return saved;
          }}
          onClose={() => {
            if (linked.requested) linked.close();
            setSelectedId("");
            opener.current?.focus();
          }}
        />
      )}
      <nav aria-label="Páginas de atenciones" className="flex flex-wrap gap-3">
        <Button
          className={buttonClass}
          variant="outline"
          disabled={offset === 0 || panel.loading}
          onClick={() => {
            setOffset((value) => Math.max(0, value - 50));
            setSelectedId("");
          }}
        >
          Anteriores
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          disabled={!panel.data?.has_more || panel.loading}
          onClick={() => {
            setOffset((value) => value + 50);
            setSelectedId("");
          }}
        >
          Siguientes
        </Button>
      </nav>
    </ViewLayout>
  );
}
const transitions: Record<ServiceCaseStatus, ServiceCaseStatus[]> = {
  open: ["in_progress", "resolved", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: ["reopened"],
  reopened: ["in_progress", "resolved", "cancelled"],
  cancelled: [],
};
function ServiceCaseDetail({
  identity,
  record,
  assignees,
  busy,
  online,
  mutate,
  onClose,
}: {
  identity: WorkspaceIdentity;
  record: ServiceCase;
  assignees: ServiceCaseAssignee[];
  busy: boolean;
  online: boolean;
  mutate: (
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const detail = useRef<HTMLElement | null>(null);
  useEffect(() => {
    detail.current?.focus({ preventScroll: true });
    detail.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, []);
  const [offset, setOffset] = useState(0);
  const history = useOperationsPanel<{
    items: ServiceCaseEvent[];
    has_more: boolean;
  }>(
    `/api/v1/service-cases/${record.id}/events`,
    identity,
    `?limit=50&offset=${offset}`,
  );
  const { load } = history;
  const lastVersion = useRef(record.version);
  useEffect(() => {
    if (lastVersion.current !== record.version) {
      lastVersion.current = record.version;
      void load();
    }
  }, [record.version, load]);
  const [note, setNote] = useState("");
  const [noteCommand, setNoteCommand] = useState<{
    note: string;
    version: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState(record.version);
  const [status, setStatus] = useState<ServiceCaseStatus>(record.status);
  const [assigneeId, setAssigneeId] = useState(record.assigned_user_id ?? "");
  const [dueAt, setDueAt] = useState("");
  const [formError, setFormError] = useState("");
  const [deviceZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const edit = () => {
    setEditVersion(record.version);
    setStatus(record.status);
    setAssigneeId(record.assigned_user_id ?? "");
    setDueAt(record.due_at ? utcToZonedInput(record.due_at, deviceZone) : "");
    setEditing(true);
    setFormError("");
  };
  const originalDueInput = record.due_at
    ? utcToZonedInput(record.due_at, deviceZone)
    : "";
  const dueChanged = dueAt !== originalDueInput;
  const changed =
    status !== record.status ||
    assigneeId !== (record.assigned_user_id ?? "") ||
    dueChanged;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    try {
      const body = {
        expected_version: editVersion,
        ...(status !== record.status ? { status } : {}),
        ...(assigneeId !== (record.assigned_user_id ?? "")
          ? { assigned_user_id: assigneeId || null }
          : {}),
        ...(dueChanged
          ? { due_at: dueAt ? zonedInputToUtc(dueAt, deviceZone) : null }
          : {}),
      };
      if (!changed) {
        setFormError("Elige al menos un cambio antes de confirmar.");
        return;
      }
      if (
        await mutate(
          `/${record.id}`,
          "PATCH",
          body,
          "Seguimiento actualizado. Los cambios quedaron en el historial.",
        )
      )
        setEditing(false);
    } catch (e) {
      setFormError(resolveUserFacingError(e, "Revisa el vencimiento."));
    }
  };
  const appendNote = async (event: FormEvent) => {
    event.preventDefault();
    const value = note.trim();
    if (!value) return;
    const command =
      noteCommand?.note === value
        ? noteCommand
        : { note: value, version: record.version };
    setNoteCommand(command);
    if (
      await mutate(
        `/${record.id}/notes`,
        "POST",
        { expected_version: command.version, note: value },
        "Nota privada agregada al historial. Las notas anteriores se conservan.",
      )
    ) {
      setNote("");
      setNoteCommand(null);
    }
  };
  return (
    <section
      className="space-y-5 rounded-2xl border border-kova-border bg-white p-6"
      aria-label="Detalle de atención"
      tabIndex={-1}
      ref={detail}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold">{record.title}</h2>
          <p className="mt-2 break-words text-sm">
            {record.customer_name} · {serviceCaseStatuses[record.status]}
          </p>
        </div>
        <Button
          className={buttonClass}
          variant="ghost"
          disabled={busy}
          onClick={onClose}
        >
          Cerrar detalle
        </Button>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {record.sale_order_id && (
          <Link
            className="inline-flex min-h-11 items-center underline"
            to={`/orders/${record.sale_order_id}`}
          >
            Consultar venta relacionada
          </Link>
        )}
        {record.customer_order_id && (
          <Link
            className="inline-flex min-h-11 items-center underline"
            to={`/pedidos/${record.customer_order_id}`}
          >
            Consultar pedido relacionado
          </Link>
        )}
      </div>
      {
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy || !online}
          onClick={edit}
        >
          Revisar estado y responsable
        </Button>
      }
      {editing && (
        <form
          className="space-y-4 rounded-xl bg-kova-mist p-4"
          onSubmit={(event) => void save(event)}
        >
          <h3 className="font-semibold">Confirmar cambios de seguimiento</h3>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <Label htmlFor={`${fieldId}-10`} className="block text-sm">
            Nuevo estado de la atención
            <Select id={`${fieldId}-10`}
              className={fieldClass}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as ServiceCaseStatus)
              }
            >
              <option value={record.status}>
                {serviceCaseStatuses[record.status]}
              </option>
              {transitions[record.status].map((next) => (
                <option key={next} value={next}>
                  {serviceCaseStatuses[next]}
                </option>
              ))}
            </Select>
          </Label>
          <Label htmlFor={`${fieldId}-11`} className="block text-sm">
            Responsable para seguimiento
            <Select id={`${fieldId}-11`}
              className={fieldClass}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Sin responsable asignado</option>
              {assigneeId &&
                !assignees.some((row) => row.user_id === assigneeId) && (
                  <option value={assigneeId} disabled>
                    Responsable anterior sin acceso
                  </option>
                )}
              {assignees.map((row) => (
                <option key={row.user_id} value={row.user_id}>
                  {row.email}
                </option>
              ))}
            </Select>
          </Label>
          <Label htmlFor={`${fieldId}-12`} className="block text-sm">
            Nuevo vencimiento (opcional)
            <Input id={`${fieldId}-12`}
              className={fieldClass}
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Label>
          <p className="text-sm text-kova-muted">
            Hora del dispositivo: {deviceZone}. Dejar vacío retira el
            vencimiento. El servidor verifica si la atención está vencida.
          </p>
          <p className="text-sm text-kova-muted">
            Cambiar el estado no modifica la venta, cobra dinero ni notifica al
            cliente.
          </p>
          <div className="flex flex-wrap gap-3">
            {editVersion !== record.version && (
              <p role="alert" className="text-sm text-warning-strong">
                La atención cambió. Descarta esta edición y revisa los datos
                actualizados antes de continuar.
              </p>
            )}
            <Button
              className={buttonClass}
              disabled={
                busy || !online || !changed || editVersion !== record.version
              }
            >
              Confirmar cambios
            </Button>
            <Button
              className={buttonClass}
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Descartar edición
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-3" aria-label="Historial privado de atención">
        <h3 className="text-lg font-semibold">Historial del equipo</h3>
        <p className="text-sm text-kova-muted">
          Las notas son privadas y se conservan sin sobrescribirlas. Las fechas
          de registro se muestran en la hora de este dispositivo.
        </p>
        {history.error && (
          <ViewError
            message={history.error}
            onRetry={() => void history.load()}
            retryLabel="Consultar historial"
          />
        )}
        {history.loading && <SectionSkeleton label="Consultando historial…" />}
        <ol className="space-y-3">
          {history.data?.items.map((event) => (
            <li
              key={event.id}
              className="min-w-0 space-y-2 rounded-xl bg-kova-mist p-4"
            >
              <p className="text-sm font-medium">
                {event.kind === "created"
                  ? "Atención registrada"
                  : event.kind === "note_added"
                    ? "Nota privada agregada"
                    : "Seguimiento actualizado"}{" "}
                · {serviceCaseStatuses[event.status]}
              </p>
              <p className="text-xs text-kova-muted">
                {date(event.created_at)}
              </p>
              <p className="break-words text-xs text-kova-muted">
                Registrado por{" "}
                {event.actor_user_id === identity.userId
                  ? "ti"
                  : (assignees.find(
                      (person) => person.user_id === event.actor_user_id,
                    )?.email ?? "un integrante del equipo")}
                .
              </p>
              <p className="break-words text-xs text-kova-muted">
                Responsable en este cambio:{" "}
                {event.assigned_user_id
                  ? (assignees.find(
                      (person) => person.user_id === event.assigned_user_id,
                    )?.email ?? "integrante del equipo")
                  : "sin asignar"}
                .
              </p>
              {event.note && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {event.note}
                </p>
              )}
              {event.due_at && (
                <p className="text-xs text-kova-muted">
                  Vencimiento registrado: {date(event.due_at)}
                </p>
              )}
            </li>
          ))}
        </ol>
        <nav
          aria-label="Páginas del historial de atención"
          className="flex flex-wrap gap-3"
        >
          <Button
            className={buttonClass}
            size="sm"
            variant="outline"
            disabled={offset === 0 || history.loading}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Historial anterior
          </Button>
          <Button
            className={buttonClass}
            size="sm"
            variant="outline"
            disabled={!history.data?.has_more || history.loading}
            onClick={() => setOffset((value) => value + 50)}
          >
            Más historial
          </Button>
        </nav>
      </section>
      {
        <form
          className="space-y-3 border-t border-kova-border pt-5"
          onSubmit={(event) => void appendNote(event)}
        >
          <h3 className="font-semibold">Agregar una nota privada</h3>
          <Label htmlFor={`${fieldId}-13`} className="block text-sm">
            Nueva nota del equipo
            <Textarea id={`${fieldId}-13`}
              className={fieldClass}
              required
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Label>
          {noteCommand &&
            noteCommand.note === note.trim() &&
            noteCommand.version !== record.version && (
              <div className="space-y-2 text-sm">
                <p>
                  La atención tiene cambios nuevos. Revisa el historial antes de
                  preparar esta nota con los datos actualizados.
                </p>
                <Button
                  className={buttonClass}
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setNoteCommand(null);
                    setFormError("");
                  }}
                >
                  Preparar nota actualizada
                </Button>
              </div>
            )}
          <Button
            className={buttonClass}
            disabled={busy || !online || !note.trim()}
          >
            Agregar nota al historial
          </Button>
        </form>
      }
    </section>
  );
}
