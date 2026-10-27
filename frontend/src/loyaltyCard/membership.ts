import { csrfHeaders } from "@/lib/csrf";
import { isReward } from "@/loyalty/rewards/api";
import type { PublicLoyaltyCardData } from "./LoyaltyCardScreen";

export type Membership = {
  available: boolean;
  enrolled: boolean;
  business_name: string;
  branch_name: string;
  policy: PublicLoyaltyCardData["policy"];
  reward: PublicLoyaltyCardData["reward"];
  csrf_token: string | null;
  card: PublicLoyaltyCardData | null;
  card_path: string;
};
export const memberCardPath = (path: string, menuToken: string) => path === `/lealtad?menu=${encodeURIComponent(menuToken)}` ? path : null;
const storagePrefix = "kova:loyalty-enrollment:pending:";
const storageName = (menuToken: string) => `${storagePrefix}${encodeURIComponent(menuToken)}`;
export function pendingMembershipKey(menuToken: string): string | null {
  try { return sessionStorage.getItem(storageName(menuToken)); } catch { return null; }
}
export function prepareMembershipKey(menuToken: string): string {
  try {
    const key = pendingMembershipKey(menuToken) ?? crypto.randomUUID();
    sessionStorage.setItem(storageName(menuToken), key);
    if (sessionStorage.getItem(storageName(menuToken)) !== key) throw new Error("Storage unavailable");
    return key;
  } catch { throw new Error("Este navegador no nos permite guardar tu solicitud. Revisa sus permisos o pide ayuda al equipo antes de crear tu tarjeta."); }
}
export function clearMembershipKey(menuToken: string, key: string | null) {
  try { if (key && sessionStorage.getItem(storageName(menuToken)) === key) sessionStorage.removeItem(storageName(menuToken)); } catch { /* A retained operation is safe to resolve again. */ }
}
function validPolicy(value: unknown): value is PublicLoyaltyCardData["policy"] {
  const row = value as PublicLoyaltyCardData["policy"] | null;
  return Boolean(row && typeof row.enabled === "boolean" && (row.spend_amount === null || (typeof row.spend_amount === "string" && Number(row.spend_amount) > 0)) && (row.points_per_step === null || (Number.isSafeInteger(row.points_per_step) && Number(row.points_per_step) > 0)));
}
function validMemberCard(value: unknown): value is PublicLoyaltyCardData {
  const row = value as PublicLoyaltyCardData | null;
  return Boolean(row && typeof row.business_name === "string" && row.business_name.trim() && typeof row.branch_name === "string" && Number.isSafeInteger(row.balance) && typeof row.adjustments_pending === "boolean" && typeof row.member_code === "string" && row.member_code.trim() && validPolicy(row.policy) && typeof row.expires_at === "string" && Number.isFinite(Date.parse(row.expires_at)) && (row.catalog_path === null || typeof row.catalog_path === "string") && (row.reward === null || row.reward === undefined || isReward(row.reward)));
}
export async function loadMembership(menuToken: string, signal?: AbortSignal): Promise<Membership> {
  const pendingKey = pendingMembershipKey(menuToken);
  const response = await fetch(`/api/v1/public/loyalty/membership?menu=${encodeURIComponent(menuToken)}`, {
    credentials: "include", cache: "no-store", referrerPolicy: "no-referrer", signal, headers: pendingKey ? { "Idempotency-Key": pendingKey } : undefined,
  });
  if (!response.ok) throw new Error(response.status === 409 ? "No pudimos recuperar el alta anterior. Pide ayuda al equipo; no crees otra tarjeta para reemplazarla." : "No pudimos consultar tu tarjeta. Intenta de nuevo en un momento.");
  const value = await response.json() as Membership;
  if (!value || typeof value.available !== "boolean" || typeof value.enrolled !== "boolean" || typeof value.business_name !== "string" || typeof value.branch_name !== "string" || !validPolicy(value.policy) || (value.reward !== null && !isReward(value.reward)) || (value.csrf_token !== null && typeof value.csrf_token !== "string") || !memberCardPath(value.card_path, menuToken) || (value.enrolled ? !validMemberCard(value.card) : value.card !== null)) throw new Error("No pudimos verificar la tarjeta recibida. Consulta de nuevo antes de continuar.");
  return value;
}
export async function enrollMembership(body: { menu_token: string; name: string; confirmed: true }, csrfToken: string, key: string, signal?: AbortSignal) {
  if (!navigator.onLine) throw new Error("Conéctate a internet para crear tu tarjeta.");
  const response = await fetch("/api/v1/public/loyalty/membership/enroll", {
    method: "POST", credentials: "include", cache: "no-store", referrerPolicy: "no-referrer", signal,
    headers: { "Content-Type": "application/json", "X-Kova-Member-CSRF": csrfToken, "Idempotency-Key": key, ...csrfHeaders("POST") },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 409
    ? "No pudimos confirmar el alta. Vuelve a consultar tu tarjeta antes de intentar de nuevo."
    : "No pudimos confirmar si tu tarjeta se creó. Reintenta con los mismos datos para evitar duplicarla.");
  const value = await response.json() as { card: PublicLoyaltyCardData; card_path: string };
  if (!value || !validMemberCard(value.card) || !memberCardPath(value.card_path, body.menu_token)) throw new Error("No pudimos verificar si tu tarjeta se creó. Consulta tu tarjeta de nuevo antes de continuar.");
  return value;
}
