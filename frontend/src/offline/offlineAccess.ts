import { offlineDb } from "./db";
import type { OfflineAccessSnapshot } from "./types";

export const OFFLINE_ACCESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type VerifiedSession = Omit<OfflineAccessSnapshot, "id" | "verified_at" | "expires_at">;

export type OfflineAccessResult =
  | { status: "ready"; snapshot: OfflineAccessSnapshot }
  | { status: "missing" | "expired" | "not_prepared" };

export async function cacheVerifiedOfflineAccess(
  session: VerifiedSession,
  nowMs = Date.now(),
): Promise<void> {
  const verifiedAt = new Date(nowMs).toISOString();
  await offlineDb.offline_access.put({
    id: "active",
    tenant_id: session.tenant_id,
    tenant_name: session.tenant_name,
    user: {
      id: session.user.id,
      tenant_id: session.user.tenant_id,
      role: session.user.role,
      ...(session.user.email_verified === undefined
        ? {}
        : { email_verified: session.user.email_verified }),
    },
    feature_flags: session.feature_flags,
    verified_at: verifiedAt,
    expires_at: new Date(nowMs + OFFLINE_ACCESS_MAX_AGE_MS).toISOString(),
  });
}

export async function readPreparedOfflineAccess(nowMs = Date.now()): Promise<OfflineAccessResult> {
  const snapshot = await offlineDb.offline_access.get("active");
  if (!snapshot) return { status: "missing" };

  const expiresAt = Date.parse(snapshot.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { status: "expired" };
  }

  // A verified identity alone is not enough to expose an empty application
  // shell. Cold-offline access is prepared only after this tenant's catalog
  // has actually been cached on this device.
  const catalog = await offlineDb.catalog_cache.get(snapshot.tenant_id);
  if (!catalog) return { status: "not_prepared" };

  return { status: "ready", snapshot };
}

export async function clearOfflineAccess(): Promise<void> {
  await offlineDb.offline_access.delete("active");
}
