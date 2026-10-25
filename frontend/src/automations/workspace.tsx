import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/auth/useAuth";
import { getActiveBranchId } from "@/branches/activeBranch";
import { ViewPermissionDenied } from "@/components/ui/view-states";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { Card, CardContent } from "@/components/ui/card";
import { csrfHeaders } from "@/lib/csrf";

export type WorkspaceIdentity = {
  tenantId: string;
  userId: string;
  branchId: string;
};

export function OperationsSession({
  children,
}: {
  children: (identity: WorkspaceIdentity) => ReactNode;
}) {
  const { state } = useAuth();
  if (
    state.status !== "authenticated" ||
    !["owner", "manager"].includes(state.user.role)
  ) {
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
      const response = await fetch(`${base}${path}`, {
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
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          detail?: string | { message?: string };
        };
        const detail =
          typeof payload.detail === "string"
            ? payload.detail
            : payload.detail?.message;
        throw new OperationsError(
          response.status === 409
            ? "Los datos cambiaron. Revisa la versión actual antes de volver a intentar."
            : (detail ??
              "No pudimos completar esta acción. Inténtalo de nuevo."),
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
