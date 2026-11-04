const transientCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
]);
const certificateCodes = new Set([
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export class ReadinessFetchError extends Error {
  constructor(target, causeCode, retryable) {
    super(`Readiness GET failed target=${target} cause=${causeCode}`);
    this.retryable = retryable;
  }
}

function classify(error, signal) {
  if (error?.cause?.message === "unexpected redirect") return ["redirect", false];
  if (error?.name === "AbortError") return ["aborted", false];
  const codes = [error?.code, error?.cause?.code].filter(code => typeof code === "string");
  if (codes.includes("ENOTFOUND")) return ["dns_not_found", false];
  if (codes.some(code => certificateCodes.has(code))) return ["certificate", false];
  if (error?.name === "TimeoutError") {
    return signal.aborted && signal.reason?.name === "TimeoutError"
      ? ["request_timeout", true] : ["unowned_timeout", false];
  }
  if (codes.length && codes.every(code => transientCodes.has(code))) return [codes[0], true];
  return ["unknown", false];
}

/** Only callers' existing readiness loops may retry this GET; never a provider write. */
export async function fetchReadinessGet(url, { target, headers, deadline, timeoutMs,
  now, fetcher }) {
  if (!["direct", "candidate_proxy"].includes(target)) throw new Error("Invalid readiness target");
  const remaining = deadline - now();
  if (remaining <= 0) throw new ReadinessFetchError(target, "deadline", false);
  const signal = globalThis.AbortSignal.timeout(Math.ceil(Math.min(timeoutMs, remaining)));
  try {
    return await fetcher(url, {
      method: "GET", signal, headers: { "cache-control": "no-cache", ...headers }, redirect: "error",
    });
  } catch (error) {
    const [causeCode, retryable] = classify(error, signal);
    // No raw cause, URL, headers, values or credentials survive the boundary.
    throw new ReadinessFetchError(target, causeCode, retryable);
  }
}
