import { offlineDb } from "./db";
import type { OfflineAccessSnapshot } from "./types";

import { OFFLINE_ACCESS_MAX_AGE_MS } from "./accessPolicy";
export { OFFLINE_ACCESS_MAX_AGE_MS } from "./accessPolicy";

type VerifiedSession = Omit<OfflineAccessSnapshot, "id" | "verified_at" | "expires_at">;

export type OfflineAccessResult =
  | { status: "ready"; snapshot: OfflineAccessSnapshot }
  | { status: "missing" | "expired" | "not_prepared" };

export async function cacheVerifiedOfflineAccess(
  session: VerifiedSession,
  nowMs = Date.now(),
): Promise<void> {
  const access = session.commercial_access;
  const validUntil = access?.valid_until ? Date.parse(access.valid_until) : NaN;
  if (!access?.allowed || !Number.isFinite(validUntil) || validUntil <= nowMs) {
    await clearOfflineAccess();
    return;
  }
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
    commercial_access: access,
    verified_at: verifiedAt,
    expires_at: new Date(Math.min(nowMs + OFFLINE_ACCESS_MAX_AGE_MS, validUntil)).toISOString(),
  });
}

export async function readPreparedOfflineAccess(nowMs = Date.now()): Promise<OfflineAccessResult> {
  const snapshot = await offlineDb.offline_access.get("active");
  if (!snapshot) return { status: "missing" };

  const expiresAt = Date.parse(snapshot.expires_at);
  const validUntil = snapshot.commercial_access?.valid_until
    ? Date.parse(snapshot.commercial_access.valid_until) : NaN;
  const verifiedAt = Date.parse(snapshot.verified_at);
  if (!snapshot.commercial_access?.allowed || !Number.isFinite(validUntil)
    || !Number.isFinite(verifiedAt) || verifiedAt > nowMs
    || nowMs >= verifiedAt + OFFLINE_ACCESS_MAX_AGE_MS
    || !Number.isFinite(expiresAt) || Math.min(expiresAt, validUntil) <= nowMs) {
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
