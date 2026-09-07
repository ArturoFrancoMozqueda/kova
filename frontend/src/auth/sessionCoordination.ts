const SESSION_CHANGE_STORAGE_KEY = "kova:session-change";
const SESSION_CHANGE_CHANNEL = "kova-session";
const LOGOUT_PENDING_KEY = "kova:logout-pending";

export function markLogoutPending(): void {
  try {
    window.localStorage.setItem(LOGOUT_PENDING_KEY, "1");
  } catch {
    // The in-memory AuthContext still closes local access for this tab.
  }
}

export function clearLogoutPending(): void {
  try {
    window.localStorage.removeItem(LOGOUT_PENDING_KEY);
  } catch {
    // No persisted marker existed when storage is unavailable.
  }
}

export function hasLogoutPending(): boolean {
  try {
    return window.localStorage.getItem(LOGOUT_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function announceSessionChange(): void {
  if (typeof window === "undefined") return;
  const nonce = `${Date.now()}:${crypto.randomUUID()}`;
  try {
    window.localStorage.setItem(SESSION_CHANGE_STORAGE_KEY, nonce);
  } catch {
    // BroadcastChannel still covers browsers where localStorage is disabled.
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(SESSION_CHANGE_CHANNEL);
    channel.postMessage(nonce);
    channel.close();
  }
}

export function onSessionChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_CHANGE_STORAGE_KEY && event.newValue) listener();
  };
  window.addEventListener("storage", onStorage);

  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(SESSION_CHANGE_CHANNEL)
    : null;
  if (channel) channel.onmessage = () => listener();

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

export const sessionChangeStorageKeyForTests = SESSION_CHANGE_STORAGE_KEY;
