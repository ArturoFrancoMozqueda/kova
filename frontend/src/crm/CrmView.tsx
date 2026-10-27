import { resolveUserFacingError } from "@/lib/apiError";
import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Handshake, Plus, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";
import {
  OperationsError,
  OperationsSession,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import type {
  ContactConsent,
  CrmData,
  Opportunity,
  OpportunityStage,
} from "./types";

const stages: Record<OpportunityStage, string> = {
  new: "Nueva",
  contacted: "En contacto",
  proposal: "Propuesta",
  won: "Ganada",
  lost: "Perdida",
};
const money = (amount: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(amount),
  );
const selectClass =
  "mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm";

export default function CrmView() {
  useDocumentTitle("Seguimiento comercial");
  return (
    <OperationsSession>
      {(identity) => <CrmWorkspace identity={identity} />}
    </OperationsSession>
  );
}

function CrmWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const linked = useLinkedRecord<Opportunity>(
    identity,
    "opportunity_id",
    "/api/v1/crm/opportunities",
  );
  const request = useOperationsRequest("/api/v1", identity);
  const online = useOnline();
  const [data, setData] = useState<CrmData | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [consentRevision, setConsentRevision] = useState(0);
  const [customerConsentData, setCustomerConsentData] = useState<{
    customerId: string;
    rows: ContactConsent[];
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  useEffect(() => {
    setEditing(null);
    setCreateOpen(false);
  }, [linked.id]);
  const [dueAt, setDueAt] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<ContactConsent["channel"]>("whatsapp");
  const [purpose, setPurpose] =
    useState<ContactConsent["purpose"]>("transactional");
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState<string | null>(
    null,
  );
  const mounted = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const createCommand = useRef<{ body: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    try {
      const result = await request<CrmData>(`/crm?limit=50&offset=${offset}`);
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
          resolveUserFacingError(e, "No pudimos cargar el seguimiento."),
        );
    } finally {
      if (mounted.current && revision === generation.current) setLoading(false);
    }
  }, [request, offset]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      void request<Customer[]>(`/customers?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) setCustomers(rows);
        })
        .catch((e: unknown) => {
          if (active && !(e instanceof DOMException && e.name === "AbortError"))
            setError(
              "No pudimos cargar los clientes. Vuelve a buscar para intentar de nuevo.",
            );
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [request, search]);
  useEffect(() => {
    let active = true;
    if (!customerId) {
      setCustomerConsentData(null);
      return;
    }
    setCustomerConsentData(null);
    void request<CrmData>(
      `/crm?customer_id=${encodeURIComponent(customerId)}&limit=50&offset=0`,
    )
      .then((result) => {
        if (active)
          setCustomerConsentData({ customerId, rows: result.consents });
      })
      .catch((e: unknown) => {
        if (active && !(e instanceof DOMException && e.name === "AbortError"))
          setError(
            "No pudimos cargar los permisos del cliente. Vuelve a seleccionarlo antes de guardar.",
          );
      });
    return () => {
      active = false;
    };
  }, [customerId, request, consentRevision]);
  const consentLoading = Boolean(
    customerId && customerConsentData?.customerId !== customerId,
  );
  const visibleConsents = customerId
    ? (customerConsentData?.rows ?? [])
    : (data?.consents ?? []);
  const mutate = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) => {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (!mounted.current) return;
      after?.();
      setConsentRevision((value) => value + 1);
      setNotice(success);
      await load();
      if (linked.requested) linked.reload();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof OperationsError && e.status === 409) {
        setConfirmedConsent(false);
        setConsentRevision((value) => value + 1);
        await load();
        if (linked.requested) {
          setEditing(null);
          setCreateOpen(false);
          linked.reload();
        }
      }
      if (mounted.current)
        setError(
          resolveUserFacingError(e, "No pudimos guardar los cambios."),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    const fields = {
      title: title.trim(),
      estimated_amount: amount || "0.00",
      next_action: nextAction.trim() || null,
      note: note.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    };
    const body = editing
      ? { ...fields, expected_version: editing.version }
      : { customer_id: customerId, ...fields };
    const serialized = JSON.stringify(body);
    if (createCommand.current?.body !== serialized)
      createCommand.current = { body: serialized, key: crypto.randomUUID() };
    const key = createCommand.current.key;
    void mutate(
      () =>
        request(
          editing ? `/crm/opportunities/${editing.id}` : "/crm/opportunities",
          editing ? "PATCH" : "POST",
          body,
          key,
        ),
      editing
        ? "Seguimiento actualizado."
        : "Oportunidad creada. Su valor es estimado y no modifica tus ventas.",
      () => {
        createCommand.current = null;
        setCreateOpen(false);
        setEditing(null);
        setDueAt("");
        setTitle("");
        setAmount("");
        setNextAction("");
        setNote("");
      },
    );
  };
  const edit = (opportunity: Opportunity) => {
    setEditing(opportunity);
    setCustomerId(opportunity.customer_id);
    setTitle(opportunity.title);
    setAmount(opportunity.estimated_amount);
    setNextAction(opportunity.next_action ?? "");
    setNote(opportunity.note ?? "");
    if (opportunity.due_at) {
      const date = new Date(opportunity.due_at);
      setDueAt(
        new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16),
      );
    } else setDueAt("");
    setCreateOpen(true);
    setConfirmedConsent(false);
    setError("");
  };
  const changeStage = (opportunity: Opportunity, stage: OpportunityStage) =>
    void mutate(
      () =>
        request(
          `/crm/opportunities/${opportunity.id}`,
          "PATCH",
          { expected_version: opportunity.version, stage },
          crypto.randomUUID(),
        ),
      "Etapa actualizada. Las ventas se registran por separado en Caja.",
    );
  const selectedConsent = visibleConsents.find(
    (consent) =>
      consent.customer_id === customerId &&
      consent.channel === channel &&
      consent.purpose === purpose,
  );
  const saveConsent = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmedConsent || consentLoading) return;
    void mutate(
      () =>
        request(
          "/crm/consents",
          "PUT",
          {
            customer_id: customerId,
            channel,
            purpose,
            enabled: true,
            expected_version: selectedConsent?.version ?? 0,
          },
          crypto.randomUUID(),
        ),
      "Permiso registrado. El canal permanece sin conectar y no se enviaron mensajes.",
      () => setConfirmedConsent(false),
    );
  };
  const withdraw = (consent: ContactConsent) =>
    void mutate(
      () =>
        request(
          "/crm/consents",
          "PUT",
          {
            customer_id: consent.customer_id,
            channel: consent.channel,
            purpose: consent.purpose,
            enabled: false,
            expected_version: consent.version,
          },
          crypto.randomUUID(),
        ),
      "Permiso retirado para este canal y finalidad.",
      () => setConfirmWithdrawal(null),
    );
  const open =
    data?.opportunities.filter(
      (row) => row.stage !== "won" && row.stage !== "lost",
    ) ?? [];
  return (
    <ViewLayout className="space-y-7 [&_.animate-fade-in]:animate-none">
      <ViewHeader
        eyebrow="Relación con tus clientes"
        title="Seguimiento comercial"
        meta="Cada oportunidad con su siguiente paso. Cada contacto con un permiso claro."
        actions={
          <Button
            disabled={busy || !online || (!data && !createOpen)}
            onClick={() => {
              setEditing(null);
              setTitle("");
              setAmount("");
              setNextAction("");
              setNote("");
              setDueAt("");
              setCreateOpen((value) => !value);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {createOpen ? "Cerrar formulario" : "Nueva oportunidad"}
          </Button>
        }
      />
      <LinkedRecordNotice linked={linked}>
        {linked.record && (
          <OpportunityCard
            row={linked.record}
            busy={busy}
            online={online}
            onStage={changeStage}
            onEdit={edit}
          />
        )}
      </LinkedRecordNotice>
      {createOpen && (
        <form
          onSubmit={create}
          className="space-y-4 rounded-2xl border bg-card p-5"
          aria-label={editing ? "Editar oportunidad" : "Nueva oportunidad"}
        >
          <h2 className="text-lg font-semibold">
            {editing ? "Editar seguimiento" : "Nueva oportunidad"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Selecciona un cliente registrado arriba. No se enviarán mensajes.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="opportunity-title">
                ¿Qué necesita el cliente?
              </Label>
              <Input
                id="opportunity-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                required
              />
            </div>
            <div>
              <Label htmlFor="opportunity-amount">Valor estimado en MXN</Label>
              <Input
                id="opportunity-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                type="number"
                min="0"
                max="9999999999.99"
                step="0.01"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="opportunity-next">Siguiente acción</Label>
              <Input
                id="opportunity-next"
                value={nextAction}
                onChange={(event) => setNextAction(event.target.value)}
                maxLength={300}
              />
            </div>
            <div>
              <Label htmlFor="opportunity-due">
                Fecha límite (hora de este dispositivo)
              </Label>
              <Input
                id="opportunity-due"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="opportunity-note">Nota interna</Label>
              <Input
                id="opportunity-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={busy || !online || !customerId || !title.trim()}
          >
            {editing ? "Guardar seguimiento" : "Guardar oportunidad"}
          </Button>
        </form>
      )}
      {!online && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Sin conexión. Conéctate para actualizar oportunidades y permisos.
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
      {loading && !data && <p role="status">Cargando seguimiento…</p>}
      {data && (
        <>
          <section
            className="rounded-2xl border bg-card p-5 sm:p-6"
            aria-labelledby="crm-summary"
          >
            <h2 id="crm-summary" className="font-semibold">
              Tu próxima conversación tiene contexto
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {open.length} oportunidades abiertas en esta vista. Los importes
              son estimaciones comerciales; ganar una oportunidad no registra un
              cobro.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="rounded-full bg-muted px-3 py-1.5">
                WhatsApp:{" "}
                {data.capabilities.whatsapp === "not_connected"
                  ? "sin conectar"
                  : "consulta la conexión"}
              </span>
              <span className="rounded-full bg-muted px-3 py-1.5">
                Correo:{" "}
                {data.capabilities.email === "not_connected"
                  ? "sin conectar"
                  : "consulta la conexión"}
              </span>
            </div>
          </section>
          <section
            className="rounded-2xl border bg-card p-5"
            aria-labelledby="crm-customer"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="crm-customer" className="font-semibold">
                Cliente para seguimiento
              </h2>
              <Link
                to="/customers"
                className="text-sm text-kova-blue underline"
              >
                Administrar clientes
              </Link>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="crm-search">Buscar cliente por nombre</Label>
                <Input
                  id="crm-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  maxLength={160}
                  placeholder="Buscar en tus clientes"
                />
              </div>
              <div>
                <Label htmlFor="crm-customer-select">Cliente registrado</Label>
                <select
                  id="crm-customer-select"
                  className={selectClass}
                  disabled={editing !== null}
                  value={customerId}
                  onChange={(event) => {
                    setCustomerId(event.target.value);
                    setConfirmedConsent(false);
                  }}
                >
                  <option value="">Selecciona un cliente</option>
                  {customerId &&
                    !customers.some(
                      (customer) => customer.id === customerId,
                    ) && (
                      <option value={customerId}>Cliente seleccionado</option>
                    )}
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section aria-labelledby="crm-opportunities" className="space-y-4">
            <h2 id="crm-opportunities" className="text-lg font-semibold">
              Oportunidades del negocio
            </h2>
            {data.opportunities.length === 0 ? (
              <ViewEmpty
                icon={<Handshake className="h-6 w-6" />}
                title="El próximo pedido empieza aquí"
                body="Registra qué necesita un cliente y el siguiente paso para que ninguna conversación quede olvidada."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {data.opportunities
                  .filter((row) => row.id !== linked.record?.id)
                  .map((row) => (
                    <OpportunityCard
                      key={row.id}
                      row={row}
                      busy={busy}
                      online={online}
                      onStage={changeStage}
                      onEdit={edit}
                    />
                  ))}
              </div>
            )}
          </section>
          <section
            className="space-y-5 rounded-2xl border bg-card p-5"
            aria-labelledby="crm-consent"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck
                className="mt-1 h-5 w-5 shrink-0 text-kova-blue"
                aria-hidden="true"
              />
              <div>
                <h2 id="crm-consent" className="text-lg font-semibold">
                  Permisos de contacto
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Tener un teléfono o correo no implica permiso. Registra la
                  autorización que el cliente te dio para cada finalidad.
                </p>
              </div>
            </div>
            <form
              onSubmit={saveConsent}
              className="space-y-4"
              aria-label="Registrar permiso de contacto"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Canal
                  <select
                    className={selectClass}
                    value={channel}
                    onChange={(event) => {
                      setChannel(
                        event.target.value as ContactConsent["channel"],
                      );
                      setConfirmedConsent(false);
                    }}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Correo</option>
                  </select>
                </label>
                <label className="text-sm">
                  Finalidad
                  <select
                    className={selectClass}
                    value={purpose}
                    onChange={(event) => {
                      setPurpose(
                        event.target.value as ContactConsent["purpose"],
                      );
                      setConfirmedConsent(false);
                    }}
                  >
                    <option value="transactional">Avisos de sus pedidos</option>
                    <option value="marketing">Promociones y recompra</option>
                  </select>
                </label>
              </div>
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmedConsent}
                  onChange={(event) =>
                    setConfirmedConsent(event.target.checked)
                  }
                  disabled={
                    busy ||
                    !online ||
                    !customerId ||
                    consentLoading ||
                    (selectedConsent?.enabled === true &&
                      selectedConsent.contact_current)
                  }
                />
                Confirmo que este cliente autorizó este canal y esta finalidad.
              </label>
              <Button
                type="submit"
                variant="outline"
                disabled={
                  busy ||
                  !online ||
                  !customerId ||
                  consentLoading ||
                  !confirmedConsent ||
                  (selectedConsent?.enabled === true &&
                    selectedConsent.contact_current)
                }
              >
                {selectedConsent?.enabled && selectedConsent.contact_current
                  ? "Permiso ya registrado"
                  : "Registrar permiso"}
              </Button>
            </form>
            {visibleConsents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {consentLoading
                  ? "Cargando permisos del cliente…"
                  : "Todavía no hay permisos de contacto registrados."}
              </p>
            ) : (
              <ul className="divide-y">
                {visibleConsents.map((consent) => (
                  <li
                    key={consent.id}
                    className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {consent.customer_name ??
                          customers.find(
                            (customer) => customer.id === consent.customer_id,
                          )?.name ??
                          "Cliente registrado"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {consent.channel === "whatsapp" ? "WhatsApp" : "Correo"}{" "}
                        ·{" "}
                        {consent.purpose === "transactional"
                          ? "Avisos de pedidos"
                          : "Promociones y recompra"}{" "}
                        ·{" "}
                        {consent.enabled
                          ? consent.contact_current
                            ? "Autorizado"
                            : "Contacto cambió; vuelve a registrar autorización"
                          : "Retirado"}
                      </p>
                    </div>
                    {consent.enabled &&
                      (confirmWithdrawal === consent.id ? (
                        <div className="space-y-2">
                          <p className="text-sm">
                            ¿Retirar este permiso de contacto?
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !online}
                              onClick={() => withdraw(consent)}
                            >
                              Confirmar retiro
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setConfirmWithdrawal(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !online}
                          onClick={() => setConfirmWithdrawal(consent.id)}
                          aria-label={`Retirar permiso ${consent.channel} ${consent.purpose}`}
                        >
                          Retirar permiso
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {(offset > 0 ||
            data.opportunities_has_more ||
            data.consents_has_more) && (
            <nav
              className="flex flex-wrap items-center gap-3"
              aria-label="Páginas del seguimiento"
            >
              <Button
                variant="outline"
                disabled={busy || loading || !online || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {Math.floor(offset / 50) + 1}
              </span>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  loading ||
                  !online ||
                  !(data.opportunities_has_more || data.consents_has_more)
                }
                onClick={() => setOffset((value) => value + 50)}
              >
                Más registros
              </Button>
            </nav>
          )}
        </>
      )}
    </ViewLayout>
  );
}

function OpportunityCard({
  row,
  busy,
  online,
  onStage,
  onEdit,
}: {
  row: Opportunity;
  busy: boolean;
  online: boolean;
  onStage: (row: Opportunity, stage: OpportunityStage) => void;
  onEdit: (row: Opportunity) => void;
}) {
  return (
    <article className="min-w-0 rounded-2xl border bg-card p-5">
      <p className="text-xs text-muted-foreground break-words">
        {row.customer_name}
      </p>
      <h3 className="mt-1 font-semibold break-words">{row.title}</h3>
      <p className="mt-3 text-lg font-semibold">
        {money(row.estimated_amount)}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          estimados
        </span>
      </p>
      {row.next_action && (
        <p className="mt-3 text-sm break-words">
          <span className="font-medium">Siguiente paso:</span> {row.next_action}
        </p>
      )}
      {row.due_at && (
        <p className="mt-2 text-sm text-muted-foreground">
          Fecha límite: {new Date(row.due_at).toLocaleString("es-MX")}
        </p>
      )}
      {row.note && (
        <p className="mt-2 text-sm text-muted-foreground break-words">
          Nota interna: {row.note}
        </p>
      )}
      <label className="mt-4 block text-sm">
        Etapa de {row.title}
        <select
          className={selectClass}
          disabled={busy || !online}
          value={row.stage}
          onChange={(event) =>
            onStage(row, event.target.value as OpportunityStage)
          }
        >
          {Object.entries(stages).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !online}
          onClick={() => onEdit(row)}
          aria-label={`Editar seguimiento de ${row.title}`}
        >
          Editar seguimiento
        </Button>
        {online && !busy && (
          <Link
            to={`/quotes?opportunity_id=${encodeURIComponent(row.id)}`}
            className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-kova-blue underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue"
          >
            Preparar cotización
          </Link>
        )}
      </div>
    </article>
  );
}
