import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, logout as apiLogout } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser; tenantId: string; tenantName: string };

type AuthContextValue = {
  state: AuthState;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setState({
        status: "authenticated",
        user: me.user,
        tenantId: me.tenant_id,
        tenantName: me.tenant_name,
      });
    } catch {
      setState({ status: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ status: "unauthenticated" });
  }, []);

  return <AuthContext.Provider value={{ state, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
