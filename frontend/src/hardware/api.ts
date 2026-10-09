import { csrfHeaders } from "@/lib/csrf";

export type DrawerStatus = {
  configured: boolean;
  online: boolean;
  auto_open: boolean;
  paired?: boolean;
  name?: string;
  pin?: 0 | 1;
  key_expires_at?: string | null;
};
export type DrawerSetup = { name: string; pin: 0 | 1; auto_open: boolean };
type Command = { id?: string; status: "disabled" | "pending" | "dispatched" | "sent" | "failed" | "expired" };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/hardware/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders(method) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error("No se pudo comunicar con el cajón");
  return response.json() as Promise<T>;
}

export const getDrawerStatus = () => request<DrawerStatus>("drawer");
export const saveDrawerSettings = (body: DrawerSetup) => request<DrawerStatus>("drawer", "PATCH", body);
export const pairDrawer = (body: DrawerSetup) => request<{
  pairing_code: string; pairing_expires_at: string; device: DrawerStatus;
}>("drawer/setup", "POST", body);
export const revokeDrawer = () => request("drawer", "DELETE");

export async function openDrawer(kind: "sale" | "manual" | "test", reason: string, orderId?: string): Promise<Command["status"]> {
  const result = await request<Command>("drawer/open", "POST", {
    request_id: crypto.randomUUID(), kind, reason, ...(orderId ? { order_id: orderId } : {}),
  });
  if (!result.id || result.status === "disabled") return result.status;
  const deadline = Date.now() + 6000;
  let command = result;
  while ((command.status === "pending" || command.status === "dispatched") && Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 500));
    command = await request<Command>(`drawer/commands/${result.id}`);
  }
  return command.status;
}
