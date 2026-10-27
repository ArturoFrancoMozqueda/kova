import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  OperationsError,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";

export const isRecordId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** A link resolves its exact ID; paginated samples never establish existence. */
export function useLinkedRecord<T extends { id: string }>(
  identity: WorkspaceIdentity,
  parameter: string,
  endpoint: string,
) {
  const [params, setParams] = useSearchParams();
  const values = params.getAll(parameter);
  const requested = values.length > 0;
  const id =
    values.length === 1 && isRecordId(values[0]) ? values[0].toLowerCase() : "";
  const request = useOperationsRequest(endpoint, identity);
  const online = useOnline();
  const [revision, setRevision] = useState(0);
  const scope = `${identity.tenantId}:${identity.userId}:${identity.branchId}:${id}:${revision}`;
  const [result, setResult] = useState<{
    scope: string;
    record?: T;
    error?: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const close = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(parameter);
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!id || !online) return;
    void request<T>(`/${id}`)
      .then((record) => {
        if (active && record.id === id) setResult({ scope, record });
        else if (active)
          setResult({
            scope,
            error: "No pudimos confirmar el registro solicitado.",
          });
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          setResult({
            scope,
            error:
              error instanceof OperationsError &&
              [403, 404].includes(error.status)
                ? "Este registro no está disponible en tu sucursal o no tienes acceso."
                : "No pudimos consultar este registro. Inténtalo de nuevo.",
          });
      });
    return () => {
      active = false;
    };
  }, [id, request, scope, online]);
  const current = online && result?.scope === scope ? result : null;
  return {
    requested,
    id,
    record: current?.record ?? null,
    loading: requested && !!id && online && !current,
    error: !requested
      ? ""
      : !id
        ? "Este enlace no es válido. Abre el registro desde su lista."
        : !online
          ? "Conéctate para consultar el registro del enlace."
          : (current?.error ?? ""),
    reload,
    close,
  };
}
