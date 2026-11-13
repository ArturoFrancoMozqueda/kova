/**
 * Batch-level sync problems that are not caused by any single sale.
 *
 * A 401/403/409 (session, CSRF or identity mismatch) or an unexpected 4xx from
 * the sync endpoint says nothing about the sales themselves, so their leases
 * are released without spending retry budget and the queue surfaces this
 * state instead of turning every sale in the batch into a dead letter.
 */
export type SyncIssueKind = "session" | "unavailable";

export class SyncSessionError extends Error {
  readonly kind: SyncIssueKind;

  constructor(public readonly status: number) {
    super(`Sync blocked with status ${status}`);
    this.name = "SyncSessionError";
    this.kind = status === 401 || status === 403 || status === 409 || status === 419 ? "session" : "unavailable";
  }
}

type SyncIssue = { tenantId: string; kind: SyncIssueKind } | null;

let current: SyncIssue = null;
const listeners = new Set<() => void>();

export function setSyncIssue(next: SyncIssue) {
  if (current?.tenantId === next?.tenantId && current?.kind === next?.kind) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function getSyncIssue(): SyncIssue {
  return current;
}

export function subscribeSyncIssue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
