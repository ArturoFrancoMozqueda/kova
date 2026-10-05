const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A tab-specific UI preference, never an authorization credential. The server
// verifies tenant ownership on every request. Principal is deterministic for old bundles.
export function getActiveBranchId(tenantId: string, userId: string): string {
  try {
    const selected = window.sessionStorage.getItem(
      `kova-branch:${tenantId}:${userId}`,
    );
    return selected && UUID_PATTERN.test(selected) ? selected : tenantId;
  } catch {
    return tenantId;
  }
}

export function saveActiveBranchId(
  tenantId: string,
  userId: string,
  branchId: string,
): void {
  if (!UUID_PATTERN.test(branchId)) throw new Error("Sucursal inválida");
  window.sessionStorage.setItem(`kova-branch:${tenantId}:${userId}`, branchId);
}
