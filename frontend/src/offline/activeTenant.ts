type TenantChangeListener = (tenantId: string | null) => void;

let activeTenantId: string | null = null;
const listeners = new Set<TenantChangeListener>();

/** Mirrors the authenticated AuthContext tenant for the offline subsystem. */
export function setActiveOfflineTenant(tenantId: string | null) {
  if (activeTenantId === tenantId) return;
  activeTenantId = tenantId;
  for (const listener of listeners) listener(tenantId);
}

export function getActiveOfflineTenant() {
  return activeTenantId;
}

export function onActiveOfflineTenantChange(listener: TenantChangeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
