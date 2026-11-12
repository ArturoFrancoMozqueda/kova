import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import {
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import type { Customer } from "@/customers/api";
import {
  appointmentTimezoneLabel,
  formatAppointmentTime,
  utcToZonedInput,
  zonedInputToUtc,
} from "./timezone";
import { resolveUserFacingError } from "@/lib/apiError";

type Booking = {
  id: string;
  customer_id: string | null;
  guest_name: string;
  phone: string;
  title: string;
  version: number;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  appointment_id: string | null;
  history: { action: string; created_at: string }[];
};
export function PublicBookingDetail({
  identity,
  bookingId,
  onClose,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  bookingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const panel = useOperationsPanel<Booking>(
    `/api/v1/appointments/bookings/${encodeURIComponent(bookingId)}`,
    identity,
  );
  const customersRequest = useOperationsRequest("/api/v1/customers", identity);
  const [, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newStart, setNewStart] = useState("");
  const lock = useRef(false);
  const command = useRef({ signature: "", key: "" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (panel.data) {
      setCustomerId(panel.data.customer_id ?? "");
      setName(panel.data.guest_name);
    }
  }, [panel.data]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setCustomers([]);
    const timer = window.setTimeout(() => {
      void customersRequest<Customer[]>(`?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) setCustomers(rows);
        })
        .catch((e) => {
          if (active)
            setError(resolveUserFacingError(e, "No pudimos buscar clientes."));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customersRequest, search]);
  const prepare = async () => {
    if (lock.current || !panel.data || !customerId || !panel.online) return;
    lock.current = true;
    setCreating(true);
    setError("");
    const body = {
      customer_id: customerId,
      expected_version: panel.data.version,
    };
    const signature = JSON.stringify(body);
    if (command.current.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await panel.request<{ appointment_id: string }>(
        "/customer",
        "POST",
        body,
        command.current.key,
      );
      if (alive.current) {
        onSaved();
        setParams((p) => {
          const n = new URLSearchParams(p);
          n.delete("bookingId");
          n.set("appointmentId", result.appointment_id);
          return n;
        });
      }
    } catch (e) {
      if (alive.current)
        setError(
          resolveUserFacingError(
            e,
            "No pudimos vincular el cliente. Consulta la reserva antes de reintentar.",
          ),
        );
    } finally {
      lock.current = false;
      if (alive.current) setCreating(false);
    }
  };
  return (
    <Dialog open onClose={onClose} className="space-y-4 sm:max-w-xl">
      <DialogTitle>Reserva en línea</DialogTitle>
      {panel.loading && (
        <SectionSkeleton label="Consultando reserva…" variant="form" />
      )}
      {panel.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={panel.error}
          onRetry={() => void panel.load()}
        />
      )}
      {panel.data && (
        <>
          <div className="space-y-2">
            <h3 className="break-words text-lg font-semibold">
              {panel.data.title}
            </h3>
            <p>
              {panel.data.guest_name} · {panel.data.phone}
            </p>
            <p className="text-sm">
              {formatAppointmentTime(panel.data.starts_at, panel.data.timezone)}
            </p>
            <p className="text-sm font-medium">
              {(
                {
                  scheduled: "Confirmada",
                  cancelled: "Cancelada",
                  completed: "Atendida",
                  no_show: "No asistió",
                } as Record<string, string>
              )[panel.data.status] ?? "Consultar cita"}
            </p>
          </div>
          {panel.data.status === "scheduled" && (
            <>
              <p className="text-sm text-kova-muted">
                {panel.data.customer_id
                  ? "La reserva ya está vinculada a un cliente. Continúa para registrar su atención o venta."
                  : "La cita está confirmada como invitado. Elige un cliente o crea su ficha antes de registrar atención o cobrar."}
              </p>
              {!panel.data.customer_id && (
                <div className="space-y-3">
                  <Label htmlFor="booking-client-search">
                    Buscar cliente registrado
                  </Label>
                  <Input
                    id="booking-client-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {loading && (
                    <p role="status" className="text-sm">
                      Buscando clientes…
                    </p>
                  )}
                  <Label htmlFor="booking-client">
                    Cliente de esta reserva
                  </Label>
                  <Select
                    id="booking-client"
                    value={customerId}
                    disabled={loading || Boolean(error)}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">
                      Selecciona explícitamente al cliente
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
                      Crear un cliente nuevo con estos datos
                    </summary>
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (lock.current) return;
                        lock.current = true;
                        setCreating(true);
                        setError("");
                        const signature = `customer:${name}:${panel.data?.phone}`;
                        if (command.current.signature !== signature)
                          command.current = {
                            signature,
                            key: crypto.randomUUID(),
                          };
                        void customersRequest<Customer>(
                          "",
                          "POST",
                          {
                            name: name.trim(),
                            phone: panel.data?.phone,
                            email: null,
                            is_active: true,
                          },
                          command.current.key,
                        )
                          .then((c) => {
                            if (alive.current) {
                              setCustomers((rows) => [
                                c,
                                ...rows.filter((r) => r.id !== c.id),
                              ]);
                              setCustomerId(c.id);
                              setNotice(
                                "Cliente creado. Confirma la vinculación para continuar.",
                              );
                            }
                          })
                          .catch((e) => {
                            if (alive.current)
                              setError(
                                resolveUserFacingError(
                                  e,
                                  "No pudimos confirmar el alta del cliente.",
                                ),
                              );
                          })
                          .finally(() => {
                            lock.current = false;
                            if (alive.current) setCreating(false);
                          });
                      }}
                    >
                      <Label htmlFor="booking-new-client">
                        Nombre del cliente
                      </Label>
                      <Input
                        id="booking-new-client"
                        value={name}
                        maxLength={160}
                        required
                        onChange={(e) => setName(e.target.value)}
                      />
                      <Button
                        disabled={creating || !panel.online || !name.trim()}
                      >
                        Crear ficha del cliente
                      </Button>
                    </form>
                  </details>
                </div>
              )}
              <Button
                disabled={creating || !customerId || !panel.online}
                onClick={() => void prepare()}
              >
                {creating ? "Guardando…" : "Continuar con este cliente"}
              </Button>
              {!panel.data.appointment_id && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={panel.busy || !panel.online}
                    onClick={() => {
                      setNewStart(
                        utcToZonedInput(
                          panel.data!.starts_at,
                          panel.data!.timezone,
                        ),
                      );
                      setRescheduling((v) => !v);
                    }}
                  >
                    Reprogramar reserva
                  </Button>
                  {rescheduling && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        try {
                          const starts_at = zonedInputToUtc(
                            newStart,
                            panel.data!.timezone,
                          );
                          void panel
                            .mutate(
                              "/reschedule",
                              "POST",
                              {
                                expected_version: panel.data!.version,
                                starts_at,
                              },
                              "Reserva reprogramada.",
                            )
                            .then((ok) => {
                              if (ok) {
                                setRescheduling(false);
                                onSaved();
                              }
                            });
                        } catch (failure) {
                          setError(
                            resolveUserFacingError(
                              failure,
                              "Revisa el horario de la reserva.",
                            ),
                          );
                        }
                      }}
                    >
                      <Label htmlFor="guest-new-start">
                        Nuevo inicio de la reserva
                      </Label>
                      <Input
                        id="guest-new-start"
                        type="datetime-local"
                        required
                        value={newStart}
                        onChange={(event) => setNewStart(event.target.value)}
                      />
                      <p className="text-xs text-kova-muted">
                        Hora de {appointmentTimezoneLabel(panel.data.timezone)}.
                        Se conserva la duración de la reserva.
                      </p>
                      <Button
                        disabled={panel.busy || !panel.online || !newStart}
                      >
                        Confirmar horario de la reserva
                      </Button>
                    </form>
                  )}
                </div>
              )}
              {cancelConfirm && (
                <div className="space-y-3 rounded-xl border border-kova-border p-4">
                  <p className="text-sm">
                    ¿Confirmas que quieres cancelar esta reserva? El horario
                    quedará disponible.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={panel.busy || !panel.online}
                      onClick={() => {
                        void panel
                          .mutate(
                            "/cancel",
                            "POST",
                            { expected_version: panel.data?.version },
                            "Reserva cancelada.",
                          )
                          .then((ok) => {
                            if (ok) {
                              setCancelConfirm(false);
                              onSaved();
                            }
                          });
                      }}
                    >
                      Confirmar cancelación de reserva
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setCancelConfirm(false)}
                    >
                      Conservar reserva
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  disabled={panel.busy || !panel.online}
                  onClick={() => setCancelConfirm(true)}
                >
                  Cancelar reserva
                </Button>
                <Button
                  variant="ghost"
                  disabled={panel.busy || !panel.online}
                  onClick={() => {
                    void panel.mutate(
                      "/revoke",
                      "POST",
                      { expected_version: panel.data?.version },
                      "El enlace privado anterior ya no permite gestionar esta reserva.",
                    );
                  }}
                >
                  Revocar enlace privado
                </Button>
              </div>
            </>
          )}
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
              Historial de la reserva
            </summary>
            <ol className="space-y-2 text-sm">
              {panel.data.history.map((h, i) => (
                <li key={i}>
                  {(
                    {
                      created: "Reserva confirmada",
                      linked: "Cliente vinculado",
                      cancel: "Cancelación",
                      reschedule: "Cambio de horario",
                      revoked: "Enlace revocado",
                    } as Record<string, string>
                  )[h.action] ?? "Actualización"}{" "}
                  · {new Date(h.created_at).toLocaleString("es-MX")}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {panel.notice && (
        <p role="status" className="text-sm">
          {panel.notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </Dialog>
  );
}
