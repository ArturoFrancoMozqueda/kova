const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

let latestRequestId: string | null = null;

function apiUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  const rawUrl = apiUrl(input);
  if (rawUrl.startsWith("/api/")) return true;
  if (typeof window === "undefined") return false;
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Retains only the backend's opaque request correlation id. It deliberately
 * ignores response bodies, URLs and identity data so opening support never
 * copies PII, cookies or secrets into the contact message.
 */
export function captureApiRequestId(input: RequestInfo | URL, response: Response): void {
  if (!isSameOriginApi(input)) return;
  const requestId = response.headers.get("x-request-id");
  if (requestId && SAFE_REQUEST_ID.test(requestId)) {
    latestRequestId = requestId;
  }
}

export function getLatestRequestId(): string | null {
  return latestRequestId;
}

export function clearLatestRequestId(): void {
  latestRequestId = null;
}
