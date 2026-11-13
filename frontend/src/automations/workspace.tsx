import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/auth/useAuth";
import { permissionsForRole } from "@/auth/permissions";
import { getActiveBranchId } from "@/branches/activeBranch";
import { ViewPermissionDenied } from "@/components/ui/view-states";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { Card, CardContent } from "@/components/ui/card";
import { csrfHeaders } from "@/lib/csrf";
import { resolveApiErrorMessage, safeUserMessage } from "@/lib/apiError";
import { copy } from "@/i18n/messages";

export type WorkspaceIdentity = {
  tenantId: string;
  userId: string;
  branchId: string;
};

export function OperationsSession({
  children,
  permission,
}: {
  children: (identity: WorkspaceIdentity) => ReactNode;
  /** Opens the workspace to every role holding this permission (e.g. the
   * operational agenda). Without it, only owner and manager enter. */
  permission?: string;
}) {
  const { state } = useAuth();
  const allowed = state.status === "authenticated" && (
    permission
      ? permissionsForRole(state.user.role).has(permission)
      : ["owner", "manager"].includes(state.user.role)
  );
  if (state.status !== "authenticated" || !allowed) {
    return (
      <ViewPermissionDenied
        title="Acceso de administración"
        description="El dueño o gerente puede administrar el seguimiento y las automatizaciones del negocio."
      />
    );
  }
  if (state.sessionMode === "offline") {
    return (
      <ViewLayout className="space-y-6">
        <ViewHeader title="Seguimiento del negocio" />
        <Card>
          <CardContent className="p-6">
            <p className="text-sm leading-6 text-muted-foreground" role="status">
              Conéctate para consultar y administrar el seguimiento del negocio.
            </p>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }
  const identity = {
    tenantId: state.tenantId,
    userId: state.user.id,
    branchId: getActiveBranchId(state.tenantId, state.user.id),
  };
  return (
    <OperationsIdentity
      key={`${identity.tenantId}:${identity.userId}:${identity.branchId}:${state.user.role}`}
    >
      {children(identity)}
    </OperationsIdentity>
  );
}

function OperationsIdentity({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export class OperationsError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
  }
}

export function useOperationsRequest(
  base: string,
  identity: WorkspaceIdentity,
) {
  const controller = useRef(new AbortController());
  useEffect(() => {
    // StrictMode may replay mount effects; each mounted lifetime owns its controller.
    controller.current = new AbortController();
    const active = controller.current;
    return () => active.abort();
  }, []);
  return useCallback(
    async <T,>(
      path = "",
      method = "GET",
      body?: unknown,
      key?: string,
    ): Promise<T> => {
      if (!navigator.onLine)
        throw new OperationsError("Conéctate a internet para continuar.", 0);
      let response: Response;
      try {
        response = await fetch(`${base}${path}`, {
        method,
        credentials: "include",
        cache: "no-store",
        signal: controller.current.signal,
        headers: {
          "X-Kova-Expected-Tenant": identity.tenantId,
          "X-Kova-Expected-User": identity.userId,
          "X-Kova-Branch": identity.branchId,
          ...csrfHeaders(method),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        // Aborts stay silent for callers; a dropped connection ("Failed to
        // fetch") becomes the shared network copy, never the raw text.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        throw new OperationsError(resolveApiErrorMessage(err, copy.errors.network), 0);
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          detail?: string | { message?: string };
        };
        const rawDetail =
          typeof payload.detail === "string"
            ? payload.detail
            : payload.detail?.message;
        const fallback = "No pudimos completar esta acción. Inténtalo de nuevo.";
        const detail = response.status < 500 ? safeUserMessage(rawDetail, fallback) : fallback;
        throw new OperationsError(
          response.status === 409
            ? "Los datos cambiaron. Revisa la información actualizada antes de volver a intentar."
            : resolveApiErrorMessage({ status: response.status }, detail),
          response.status,
          detail,
        );
      }
      return (await response.json()) as T;
    },
    [base, identity.tenantId, identity.userId, identity.branchId],
  );
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
