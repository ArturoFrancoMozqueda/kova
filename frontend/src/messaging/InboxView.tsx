import { MessagesSquare } from "lucide-react";
import { useId, useEffect, useRef, useState, type FormEvent } from "react";
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
import { resolveUserFacingError } from "@/lib/apiError";
import type { AutomationsData, AutomationRun } from "@/automations/types";
import type { Customer } from "@/customers/api";

type Conversation = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  contact_phone?: string | null;
  subject: string;
  origin: "manual" | "whatsapp";
  status: "open" | "closed";
  automation_paused: boolean;
  assigned_user_id: string | null;
  version: number;
};
type InboxData = {
  items: Conversation[];
  has_more: boolean;
  channel_status: "not_connected" | "connected" | "configuration_error";
  send_enabled?: boolean;
};
type MessageState =
  | "received"
  | "draft"
  | "queued"
  | "sending"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "suppressed";
type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string;
  state: MessageState;
  purpose: "transactional" | "marketing" | null;
  version: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};
const stateLabels: Record<MessageState, string> = {
  received: "Recibido",
  draft: "Borrador privado",
  queued: "En espera de envío",
  sending: "Envío en curso",
  accepted: "Aceptado por proveedor",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
  uncertain: "Resultado incierto: no reintentar a ciegas",
  cancelled: "Cancelado",
  suppressed: "Ya no aplica",
};
const errorLabels: Record<string, string> = {
  daily_send_limit: "Alcanzaste el límite diario de envíos de esta sucursal.",
  provider_result_ambiguous: "El proveedor no confirmó el resultado. Revisa la entrega antes de volver a contactar al cliente.",
  provider_rejected: "El proveedor rechazó el mensaje. Revisa la conexión antes de preparar una nueva respuesta.",
  interrupted_delivery: "El envío se interrumpió. Es necesario comprobar el resultado.",
  consent_required: "El permiso de contacto ya no está vigente.",
  contact_changed: "El teléfono del cliente cambió. Revisa su autorización.",
  human_handoff: "La conversación está en atención humana. El responsable debe confirmar la respuesta.",
  conversation_changed: "La conversación cambió y se canceló la autorización anterior.",
  source_changed: "El pedido cambió. Prepara un aviso con sus datos actuales.",
};
const fieldClass = "mt-1 min-w-0";
export default function InboxView() {
  useDocumentTitle("Bandeja de atención");
  return (
    <OperationsSession>
      {(identity) => <InboxWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function InboxWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const fieldId = useId();
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<InboxData>(
    "/api/v1/messaging",
    identity,
    `/conversations?limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const customersRequest = useOperationsRequest("/api/v1/customers", identity);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerError, setCustomerError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const selected = panel.data?.items.find((row) => row.id === selectedId);
  const [messages, setMessages] = useState<{
    id: string;
    items: Message[];
    has_more: boolean;
  } | null>(null);
  const [messagesError, setMessagesError] = useState("");
  const [messageOffset, setMessageOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [purpose, setPurpose] = useState<"transactional" | "marketing">(
    "transactional",
  );
  const [confirm, setConfirm] = useState<{
    action: "queue" | "send" | "cancel";
    message: Message;
  } | null>(null);
  const requestGeneration = useRef(0);
  const loadConversations = panel.load;
  useEffect(() => {
    if (!panel.online || panel.busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversations();
      setRevision((value) => value + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [panel.online, panel.busy, loadConversations]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void customersRequest<Customer[]>(`?q=${encodeURIComponent(search)}`)
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
  }, [customersRequest, search]);
  useEffect(() => {
    const generation = ++requestGeneration.current;
    let active = true;
    setMessages(null);
    setMessagesError("");
    if (selectedId)
      void request<{ items: Message[]; has_more: boolean }>(
        `/conversations/${selectedId}/messages?limit=100&offset=${messageOffset}&latest=true`,
      )
        .then((result) => {
          if (active && generation === requestGeneration.current)
            setMessages({ id: selectedId, ...result });
        })
        .catch((e: unknown) => {
          if (active)
            setMessagesError(
              resolveUserFacingError(e, "No pudimos cargar los mensajes."),
            );
        });
    return () => {
      active = false;
    };
  }, [selectedId, request, revision, messageOffset]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await panel.mutate(
        "/conversations",
        "POST",
        { customer_id: customerId, subject: subject.trim() },
        "Conversación interna creada. Todavía no se ha enviado ningún mensaje.",
      )
    ) {
      setNewOpen(false);
      setCustomerId("");
      setSubject("");
    }
  };
  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (
      await panel.mutate(
        `/conversations/${selected.id}/messages`,
        "POST",
        { body: body.trim(), purpose },
        "Borrador guardado. No se ha enviado al cliente.",
      )
    ) {
      setBody("");
      setRevision((value) => value + 1);
    }
  };
  const patchConversation = async (
    patch: Partial<Conversation>,
    success: string,
  ) => {
    if (selected)
      await panel.mutate(
        `/conversations/${selected.id}`,
        "PATCH",
        { expected_version: selected.version, ...patch },
        success,
      );
  };
  const transition = async () => {
    if (!confirm) return;
    if (
      await panel.mutate(
        `/messages/${confirm.message.id}/${confirm.action === "send" ? "send" : "transition"}`,
        "POST",
        { expected_version: confirm.message.version, ...(confirm.action === "send" ? {} : { action: confirm.action }) },
        confirm.action === "send"
          ? "Respuesta procesada. Revisa el estado del mensaje para confirmar la entrega."
          : confirm.action === "queue"
          ? "Solicitud de envío registrada. Consulta el estado real de entrega."
          : "Mensaje cancelado.",
      )
    ) {
      setConfirm(null);
      setRevision((value) => value + 1);
    }
  };
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Atención al cliente"
        title="Bandeja de atención"
        meta="Conserva el contexto, prepara respuestas y controla cuándo interviene el equipo."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-auto min-h-11 whitespace-normal"
              variant="outline"
              disabled={panel.loading || panel.busy || !panel.online}
              onClick={() => { void panel.load(); setRevision(value => value + 1); }}
            >
              Actualizar conversaciones y mensajes
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal"
              disabled={panel.busy || !panel.online}
              aria-expanded={newOpen}
              aria-controls="inbox-conversation-form"
              onClick={() => setNewOpen((value) => !value)}
            >
              Nueva conversación interna
            </Button>
          </div>
        }
      />
      <div className="rounded-2xl border border-kova-border bg-kova-mist p-5">
        <h2 className="font-semibold">{panel.data?.channel_status === "connected" ? "WhatsApp configurado" : "Conversaciones internas"}</h2>
        <p className="mt-2 text-sm text-kova-muted">
          {panel.data?.channel_status === "connected" ? (panel.data.send_enabled
            ? "Vincula al cliente, asígnate la conversación y prepara tu respuesta. Cada envío requiere tu confirmación; la atención humana puede permanecer activada."
            : "Puedes revisar los mensajes recibidos. Los envíos de esta sucursal están pausados.") : <>
          Organiza notas de atención y prepara borradores para tu equipo.
          Guardar un borrador no envía un mensaje al cliente.
          </>}
        </p>
        {panel.data?.channel_status === "connected" && <Link
          className="mt-2 inline-flex min-h-11 items-center text-sm underline"
          to="/settings/channels"
        >
          Revisar conexión del canal
        </Link>}
      </div>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Volver a cargar"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {panel.loading && <p role="status">Cargando conversaciones…</p>}
      {newOpen && (
        <form
          id="inbox-conversation-form"
          onSubmit={(event) => void create(event)}
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
        >
          <h2 className="text-xl font-semibold">Preparar conversación</h2>
          <Label htmlFor={`${fieldId}-1`} className="block text-sm">
            Buscar cliente
            <Input id={`${fieldId}-1`}
              className={fieldClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Label>
          {customerError && <p role="alert">{customerError}</p>}
          <Label htmlFor={`${fieldId}-2`} className="block text-sm">
            Cliente registrado
            <Select id={`${fieldId}-2`}
              className={fieldClass}
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Selecciona un cliente</option>
              {customers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label htmlFor={`${fieldId}-3`} className="block text-sm">
            Asunto de la conversación
            <Input id={`${fieldId}-3`}
              className={fieldClass}
              maxLength={160}
              required
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Label>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              disabled={
                panel.busy || !panel.online || !customerId || !subject.trim()
              }
            >
              Crear conversación interna
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              type="button"
              variant="ghost"
              onClick={() => setNewOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <section aria-label="Conversaciones" className="space-y-3">
          <h2 className="text-xl font-semibold">Conversaciones</h2>
          {!panel.loading && !panel.error && panel.data?.items.length === 0 && (
            <ViewEmpty
              icon={<MessagesSquare className="h-6 w-6" aria-hidden="true" />}
              title="Todavía no hay conversaciones."
              body="Crea una interna para preparar la atención de un cliente."
            />
          )}
          {panel.data?.items.map((row) => (
            <button
              key={row.id}
              onClick={() => {
                setSelectedId(row.id);
                setMessageOffset(0);
                setBody("");
                setConfirm(null);
                setCustomerId("");
                setSearch("");
                setAutomationOpen(false);
              }}
              aria-pressed={selectedId === row.id}
              className="block w-full min-w-0 space-y-2 rounded-2xl border border-kova-border bg-white p-5 text-left hover:border-kova-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue"
            >
              <span className="block break-words font-semibold">
                {row.subject}
              </span>
              <span className="block break-words text-sm">
                {row.customer_name ?? row.contact_phone ?? "Cliente sin vincular"}
              </span>
              <span className="block text-xs text-kova-muted">
                {row.status === "open" ? "Abierta" : "Cerrada"} ·{" "}
                {row.automation_paused
                  ? "Atención humana"
                  : "Automatización permitida"}{" "}
                · {row.origin === "manual" ? "Interna" : "WhatsApp"}
              </span>
            </button>
          ))}
          <nav
            aria-label="Páginas de conversaciones"
            className="flex flex-wrap gap-2"
          >
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
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
              className="h-auto min-h-11 whitespace-normal text-left"
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
        </section>
        {selected && (
          <section
            aria-label="Detalle de conversación"
            className="min-w-0 space-y-5 rounded-2xl border border-kova-border bg-white p-5 sm:p-6"
          >
            <h2 className="break-words text-xl font-semibold">
              {selected.subject}
            </h2>
            {selected.customer_id ? <div className="flex flex-wrap gap-4 text-sm">
              <Link className="inline-flex min-h-11 items-center underline" to={`/customers?customerId=${encodeURIComponent(selected.customer_id)}`}>Ver cliente, compras y pendientes</Link>
              <Link className="inline-flex min-h-11 items-center underline" to={`/pedidos/nuevo?customerId=${encodeURIComponent(selected.customer_id)}`}>Preparar pedido con este cliente</Link>
              <Link className="inline-flex min-h-11 items-center underline" to={`/crm?customer_id=${encodeURIComponent(selected.customer_id)}`}>Oportunidades y permisos de contacto</Link>
            </div> : <form className="space-y-3 rounded-xl bg-kova-mist p-4" onSubmit={event => {
              event.preventDefault();
              if (customerId) void patchConversation({ customer_id: customerId }, "Cliente vinculado. Revisa sus permisos de contacto antes de enviar.");
            }}>
              <h3 className="font-semibold">Identifica al cliente para continuar</h3>
              {selected.contact_phone && <p className="text-sm">WhatsApp del contacto: <span className="break-all font-medium">+{selected.contact_phone}</span></p>}
              <p className="text-sm text-kova-muted">Selecciona un cliente registrado con el mismo teléfono exacto. El mensaje no crea un cliente ni autoriza comunicaciones futuras.</p>
              <Label htmlFor={`${fieldId}-4`} className="block text-sm">Buscar cliente para vincular<Input id={`${fieldId}-4`} className={fieldClass} value={search} onChange={event => setSearch(event.target.value)} /></Label>
              {customerError && <p role="alert">{customerError}</p>}
              <Label htmlFor={`${fieldId}-5`} className="block text-sm">Cliente de esta conversación<Select id={`${fieldId}-5`} className={fieldClass} required value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Selecciona al cliente</option>{customers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Label>
              <Button disabled={!customerId || panel.busy || !panel.online}>Vincular cliente</Button>
              <Link className="ml-4 inline-flex min-h-11 items-center text-sm underline" to="/customers">Registrar cliente</Link>
            </form>}
            <div className="flex flex-wrap gap-3">
              <Button
                className="h-auto min-h-11 whitespace-normal text-left"
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() =>
                  void patchConversation(
                    { automation_paused: !selected.automation_paused },
                    selected.automation_paused
                      ? "Automatización permitida de nuevo; los envíos conservan sus verificaciones."
                      : "Atención humana activada. Se bloquean nuevos envíos automáticos.",
                  )
                }
              >
                {selected.automation_paused
                  ? "Permitir automatización"
                  : "Tomar atención humana"}
              </Button>
              <Button
                className="h-auto min-h-11 whitespace-normal text-left"
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() =>
                  void patchConversation(
                    {
                      assigned_user_id:
                        selected.assigned_user_id === identity.userId
                          ? null
                          : identity.userId,
                    },
                    selected.assigned_user_id === identity.userId
                      ? "Conversación sin responsable asignado."
                      : "Ahora eres responsable de esta conversación.",
                  )
                }
              >
                {selected.assigned_user_id === identity.userId
                  ? "Liberar mi asignación"
                  : "Asignarme conversación"}
              </Button>
              <Button
                className="h-auto min-h-11 whitespace-normal text-left"
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() =>
                  void patchConversation(
                    { status: selected.status === "open" ? "closed" : "open" },
                    "Estado de conversación actualizado.",
                  )
                }
              >
                {selected.status === "open"
                  ? "Cerrar conversación"
                  : "Reabrir conversación"}
              </Button>
            </div>
            {messagesError && (
              <ViewError
                message={messagesError}
                onRetry={() => setRevision((value) => value + 1)}
                retryLabel="Consultar mensajes"
              />
            )}
            {!messages && !messagesError && (
              <p role="status">Cargando mensajes…</p>
            )}
            {messages?.items.length === 0 && (
              <p className="text-sm text-kova-muted">
                Esta conversación todavía no contiene mensajes ni borradores.
              </p>
            )}
            <ol className="space-y-3" aria-label="Mensajes y borradores">
              {messages?.id === selected.id &&
                messages.items.map((message) => (
                  <li
                    key={message.id}
                    className="min-w-0 space-y-2 rounded-xl bg-kova-mist p-4"
                  >
                    <p className="text-xs font-medium">
                      {message.direction === "inbound" ? "Cliente" : "Equipo"} ·{" "}
                      {stateLabels[message.state]}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {message.body ?? "Mensaje sin contenido de texto"}
                    </p>
                    <p className="text-xs text-kova-muted">
                      {new Date(message.created_at).toLocaleString("es-MX")}
                      {message.purpose
                        ? ` · ${message.purpose === "marketing" ? "Marketing" : "Atención transaccional"}`
                        : ""}
                    </p>
                    {message.error_code && (
                      <p className="break-words text-sm">
                        {errorLabels[message.error_code] ?? "Revisa la conexión, el contacto y los permisos antes de preparar otro mensaje."}
                      </p>
                    )}
                    {["draft", "queued"].includes(message.state) && (
                      <div className="flex flex-wrap gap-3">
                        {message.state === "draft" && (
                          <Button
                            className="h-auto min-h-11 whitespace-normal text-left"
                            size="sm"
                            variant="outline"
                            disabled={
                              panel.busy ||
                              !panel.online ||
                              panel.data?.channel_status !== "connected" ||
                              !panel.data.send_enabled ||
                              selected.origin !== "whatsapp" ||
                              !selected.customer_id ||
                              selected.assigned_user_id !== identity.userId ||
                              message.purpose !== "transactional" ||
                              selected.status !== "open"
                            }
                            onClick={() =>
                              setConfirm({ action: "send", message })
                            }
                          >
                            Enviar por WhatsApp
                          </Button>
                        )}
                        <Button
                          className="h-auto min-h-11 whitespace-normal text-left"
                          size="sm"
                          variant="outline"
                          disabled={panel.busy || !panel.online}
                          onClick={() =>
                            setConfirm({ action: "cancel", message })
                          }
                        >
                          Cancelar mensaje
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
            </ol>
            <nav
              aria-label="Páginas de mensajes"
              className="flex flex-wrap gap-3"
            >
              <Button
                className="h-auto min-h-11 whitespace-normal"
                variant="outline"
                disabled={!messages || messageOffset === 0}
                onClick={() =>
                  setMessageOffset((value) => Math.max(0, value - 100))
                }
              >
                Mensajes más recientes
              </Button>
              <Button
                className="h-auto min-h-11 whitespace-normal"
                variant="outline"
                disabled={!messages?.has_more}
                onClick={() => setMessageOffset((value) => value + 100)}
              >
                Mensajes anteriores
              </Button>
            </nav>
            {selected.status === "open" && (
              <div className="space-y-4">
                <Button variant="outline" disabled={panel.busy || !panel.online} onClick={() => {
                  void panel.mutate(`/conversations/${selected.id}/catalog-draft`, "POST", { expected_version: selected.version }, "Enlace del catálogo guardado como borrador. Revísalo antes de enviarlo.").then(saved => { if (saved) setRevision(value => value + 1); });
                }}>Preparar enlace del catálogo</Button>
                <Button
                  className="h-auto min-h-11 whitespace-normal"
                  variant="outline"
                  disabled={panel.busy}
                  onClick={() => setAutomationOpen((value) => !value)}
                >
                  Preparar aviso desde un pedido
                </Button>
                {automationOpen && (
                  <AutomationDraft
                    key={selected.id}
                    identity={identity}
                    conversationId={selected.id}
                    onSaved={() => setRevision((value) => value + 1)}
                  />
                )}
              </div>
            )}
            {selected.status === "open" && (
              <form
                onSubmit={(event) => void saveDraft(event)}
                className="space-y-4 border-t border-kova-border pt-5"
              >
                <h3 className="font-semibold">
                  Guardar respuesta para revisar
                </h3>
                <Label htmlFor={`${fieldId}-6`} className="block text-sm">
                  Respuesta del equipo
                  <Textarea id={`${fieldId}-6`}
                    className={fieldClass}
                    required
                    maxLength={4000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </Label>
                <Label htmlFor={`${fieldId}-7`} className="block text-sm">
                  Finalidad del mensaje
                  <Select id={`${fieldId}-7`}
                    className={fieldClass}
                    value={purpose}
                    onChange={(event) =>
                      setPurpose(event.target.value as typeof purpose)
                    }
                  >
                    <option value="transactional">
                      Atención transaccional
                    </option>
                    <option value="marketing">
                      Marketing con consentimiento independiente
                    </option>
                  </Select>
                </Label>
                <p className="text-sm text-kova-muted">
                  Guardar no envía. El canal y el consentimiento se verifican
                  nuevamente al solicitar un envío.
                </p>
                <Button
                  className="h-auto min-h-11 whitespace-normal text-left"
                  disabled={panel.busy || !panel.online || !body.trim()}
                >
                  Guardar borrador privado
                </Button>
              </form>
            )}
            {confirm && (
              <section
                aria-label="Confirmar cambio de mensaje"
                className="space-y-3 rounded-xl border border-kova-border p-4"
              >
                <h3 className="font-semibold">
                  {confirm.action === "send"
                    ? "Confirmar envío por WhatsApp"
                    : "Confirmar cancelación"}
                </h3>
                <p className="text-sm">
                  {confirm.action === "send"
                    ? "Se verificará el canal, la ventana de atención y el consentimiento. El estado del proveedor confirmará el resultado."
                    : "Este mensaje dejará de estar disponible para nuevos envíos."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    className="h-auto min-h-11 whitespace-normal text-left"
                    disabled={panel.busy || !panel.online}
                    onClick={() => void transition()}
                  >
                    Confirmar{" "}
                    {confirm.action === "send" ? "envío" : "cancelación"}
                  </Button>
                  <Button
                    className="h-auto min-h-11 whitespace-normal text-left"
                    variant="ghost"
                    disabled={panel.busy}
                    onClick={() => setConfirm(null)}
                  >
                    Volver
                  </Button>
                </div>
              </section>
            )}
          </section>
        )}
      </div>
    </ViewLayout>
  );
}

function AutomationDraft({
  identity,
  conversationId,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  conversationId: string;
  onSaved: () => void;
}) {
  const fieldId = useId();
  const automation = useOperationsPanel<AutomationsData>(
    "/api/v1/automations",
    identity,
  );
  const request = useOperationsRequest("/api/v1/messaging", identity);
  const [runId, setRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const active = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const runs = (automation.data?.runs ?? []).filter(
    (row: AutomationRun) =>
      row.status === "pending" &&
      ["order_ready", "order_fulfilled"].includes(row.template_key),
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const run = runs.find((row) => row.id === runId);
    if (!run || locked.current || !automation.online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const body = {
      automation_run_id: run.id,
      expected_run_version: run.version,
      conversation_id: conversationId,
    };
    const fingerprint = JSON.stringify(body);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await request(
        "/drafts/from-automation",
        "POST",
        body,
        command.current.key,
      );
      if (active.current) {
        setNotice(
          "Aviso preparado con los datos del pedido. Es un borrador privado; no se ha enviado.",
        );
        onSaved();
      }
    } catch (e) {
      if (active.current) {
        const fallback = "No pudimos confirmar si se preparó el aviso. Consulta los borradores antes de repetirlo.";
        const message = resolveUserFacingError(e, fallback);
        setError(message === fallback ? message : `${message} Consulta los borradores antes de repetirlo.`);
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => void save(event)}
      className="space-y-3 rounded-xl bg-kova-mist p-4"
    >
      <h3 className="font-semibold">Aviso con datos del pedido</h3>
      <p className="text-sm text-kova-muted">
        El servidor confirma que la tarea siga vigente y que el pedido
        corresponda al cliente de esta conversación. No se crea consentimiento
        ni se envía el aviso.
      </p>
      {automation.loading && (
        <p role="status">Consultando tareas de pedidos…</p>
      )}
      {automation.error && (
        <ViewError
          message={automation.error}
          onRetry={() => void automation.load()}
          retryLabel="Consultar tareas"
        />
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <Label htmlFor={`${fieldId}-8`} className="block text-sm">
        Tarea de pedido
        <Select id={`${fieldId}-8`}
          className={fieldClass}
          required
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
        >
          <option value="">Selecciona una tarea pendiente</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.title}
            </option>
          ))}
        </Select>
      </Label>
      <Button
        className="h-auto min-h-11 whitespace-normal"
        disabled={!runId || busy || !automation.online}
      >
        Crear borrador del aviso
      </Button>
    </form>
  );
}
