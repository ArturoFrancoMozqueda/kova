// Shared only over the private gateway -> controller binding. Never reflect
// caller headers or application responses as a controller failure reason.
export const CONTROLLER_FAILURE_HEADER = "x-kova-controller-failure";
export const CODE_UPDATE_RESET = "code-update-reset";

export function isCodeUpdateReset(error) {
  return error instanceof Error && !error.overloaded
    && error.message === "Durable Object reset because its code was updated.";
}

const readPaths = new Set([
  "/api/v1/quotes", "/health", "/health/db", "/api/v1/auth/session",
  "/api/v1/catalog/products", "/api/v1/reports/dashboard", "/api/v1/purchasing/orders",
]);
const RECOVERY_BUDGET_MS = 2000;
const BACKOFF_MS = 50;

function markedReset(response) {
  return response?.status === 503
    && response.headers.get(CONTROLLER_FAILURE_HEADER) === CODE_UPDATE_RESET
    && !response.headers.has("x-kova-runtime") && !response.headers.has("x-kova-process-id")
    && !response.headers.has("set-cookie");
}

function cancelBody(response) {
  try { void response?.body?.cancel().catch(() => {}); }
  catch { /* Cancellation must not replace the original failure. */ }
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    if (signal.aborted) return reject(signal.reason);
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function retryBeforeDeadline(request, getStub, remaining) {
  const deadline = new AbortController();
  // Keep the caller linked after headers, so aborting a streamed response still
  // cancels the second fetch. Only the recovery timer ends at header delivery.
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new DOMException("Read recovery deadline exceeded", "TimeoutError")), remaining);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(signal.reason); });
  signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      try { console.info(JSON.stringify({ event: "controller_update_read_retried" })); }
      catch { /* Observability must never alter the recovered read. */ }
      return getStub().fetch(new Request(request, { signal }));
    });
    // Bound the recovery even if an RPC implementation ignores its signal.
    void pending.then(response => { if (signal.aborted) cancelBody(response); }, () => {});
    return await Promise.race([pending, aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", rejectAbort);
  }
}

// Normal first requests keep their existing timeout/startup behavior. Only a
// proved code-update reset can consume the remainder of this short recovery
// window. Every attempt obtains a fresh stub; no mutation is ever replayed.
export async function fetchWithControllerUpdateRecovery(request, getStub,
  { now = () => performance.now(), wait = pause } = {}) {
  const started = now();
  let first, resetError;
  try { first = await getStub().fetch(request); }
  catch (error) {
    if (!isCodeUpdateReset(error)) throw error;
    resetError = error;
  }
  if (request.method !== "GET" || !readPaths.has(new URL(request.url).pathname)
      || (!resetError && !markedReset(first))
      || now() - started + BACKOFF_MS >= RECOVERY_BUDGET_MS) {
    if (resetError) throw resetError;
    return first;
  }
  try {
    request.signal.throwIfAborted();
    await wait(BACKOFF_MS, request.signal);
    request.signal.throwIfAborted();
  } catch (error) {
    cancelBody(first);
    throw error;
  }
  const remaining = RECOVERY_BUDGET_MS - (now() - started);
  if (remaining <= 0) {
    if (resetError) throw resetError;
    return first;
  }
  cancelBody(first);
  return retryBeforeDeadline(request, getStub, remaining);
}
