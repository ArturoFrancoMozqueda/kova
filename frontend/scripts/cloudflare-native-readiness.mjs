import { URL } from "node:url";

const SDK_PROVISIONING = "There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.";

function contentCategory(value) {
  const type = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!type) return "missing";
  if (type === "application/json" || type.endsWith("+json")) return "json";
  if (type === "text/html") return "html";
  if (type === "text/plain") return "text";
  return "other";
}

// Only literal SDK 0.3.7 signatures and complete plain Cloudflare error codes
// become enums. Never interpolate response text, headers, URLs or exceptions.
function bodySignature(prefix, ended, content) {
  if (prefix.startsWith("Failed to start container: ")) return "sdk-start-failed";
  if (prefix.startsWith("Error proxying request to container: ")) return "sdk-proxy-failed";
  if (ended && prefix === "Container suddenly disconnected, try again") return "sdk-disconnected";
  if (ended && prefix === SDK_PROVISIONING) return "sdk-provisioning";
  if (ended && content === "text") {
    if (/^error code: 1101\s*$/.test(prefix)) return "cloudflare-1101";
    if (/^error code: 1102\s*$/.test(prefix)) return "cloudflare-1102";
  }
  return "unknown";
}

async function errorDiagnostic(response, target, budgetMs) {
  const content = contentCategory(response.headers.get("content-type"));
  const runtime = response.headers.has("x-kova-runtime") ? "present" : "missing";
  const process = response.headers.has("x-kova-process-id") ? "present" : "missing";
  let reader;
  let timer;
  let prefix = "";
  let ended = false;
  let read = "empty";
  try {
    if (response.body) {
      reader = response.body.getReader();
      const bytes = new globalThis.Uint8Array(512);
      let length = 0;
      const timeout = new Promise(resolve => {
        timer = globalThis.setTimeout(() => resolve(null), Math.max(0, Math.min(250, budgetMs)));
      });
      read = "prefix";
      while (length < bytes.length) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (chunk === null) { read = "timeout"; break; }
        if (chunk.done) { ended = true; read = "end"; break; }
        const part = chunk.value.subarray(0, bytes.length - length);
        bytes.set(part, length);
        length += part.length;
      }
      prefix = new globalThis.TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, length));
    }
  } catch { read = "unreadable"; }
  finally {
    globalThis.clearTimeout(timer);
    // Cancellation itself can stall on a broken upstream; do not await it or
    // leave readiness waiting on arbitrary response-stream cleanup.
    try {
      const cancellation = reader ? reader.cancel() : response.body?.cancel();
      void cancellation?.catch(() => {});
    } catch { /* Never include upstream cancellation errors in diagnostics. */ }
    try { reader?.releaseLock(); } catch { /* A cancelled pending read may still settle. */ }
  }
  const signature = bodySignature(prefix, ended, content);
  return { target, content, runtime, process, signature, read };
}

function describeDiagnostic({ target, content, runtime, process, signature, read }) {
  return `target=${target} content=${content} runtime=${runtime} process=${process} signature=${signature} body=${read}`;
}

/** Container application rollout follows Worker activation, and the first
 * application may need several minutes to provision. Keep this bounded wait
 * separate from ordinary Workers readiness: a503, a valid previous release,
 * or the observed SDK0.3.7 proxy handoff500 may retry. That500 must be plain
 * text with no native identity; application/foreign/malformed errors fail closed.
 */
export async function waitForNativeBackendRelease({ backendUrl, frontendUrl, sha, previousSha,
  frontendBypassSecret, rollout = false, fetcher = globalThis.fetch,
  wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)), now = Date.now }) {
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")
      || (previousSha !== undefined && !/^[a-f0-9]{40}$/i.test(previousSha))) {
    throw new Error("Native propagation requires complete release SHAs");
  }
  const targets = [
    { target: "direct", url: new URL("/health", backendUrl), headers: {} },
    ...(frontendUrl === undefined ? [] : [{ target: "proxy", url: new URL("/api/health", frontendUrl),
      headers: frontendBypassSecret ? { "x-vercel-protection-bypass": frontendBypassSecret } : {} }]),
  ];
  // Application-wide rollouts may drain the old process for up to 15 minutes
  // before force-stopping it. Keep five minutes for cold provisioning, but allow
  // that drain, provider propagation and startup during publication/recovery.
  // The October 22 recovery took about 25 minutes to converge. Neither mode accepts
  // a previous image as readiness or changes the strict identity checks below.
  const budgetMs = rollout ? 1_800_000 : 300_000;
  const attempts = budgetMs / 1000;
  const deadline = now() + budgetMs;
  let directReady = false;
  let lastFailure;
  for (let attempt = 0; attempt < attempts && now() < deadline; attempt++) {
    // First boot can exceed a frontend provider's rewrite timeout. Establish
    // the resident API directly before testing it through that shorter hop.
    // Both phases share the same deadline and fixed attempt ceiling.
    const activeTargets = directReady ? targets : targets.slice(0, 1);
    const observations = await Promise.all(activeTargets.map(async ({ target, url, headers }) => {
      const remaining = deadline - now();
      if (remaining <= 0) return null;
      const response = await fetcher(url, {
        signal: globalThis.AbortSignal.timeout(Math.min(190_000, remaining)),
        headers: { "cache-control": "no-cache", ...headers }, redirect: "error",
      });
      if (!response.ok) {
        const diagnostic = await errorDiagnostic(response, target, deadline - now());
        // Correlated production telemetry confirms the old Worker can emit
        // this SDK handoff response while the new Container is propagating.
        // It is never readiness, and no application-identified500 may retry.
        const sdkProxyHandoff = response.status === 500
          && diagnostic.content === "text"
          && diagnostic.runtime === "missing" && diagnostic.process === "missing"
          && diagnostic.signature === "sdk-proxy-failed"
          && ["end", "prefix"].includes(diagnostic.read);
        if (response.status === 503 || sdkProxyHandoff) {
          lastFailure = describeDiagnostic(diagnostic);
          return null;
        }
        throw new Error(`Native readiness failed: HTTP ${response.status} ${describeDiagnostic(diagnostic)}`);
      }
      let body;
      try { body = await response.json(); }
      catch { throw new Error("Malformed native readiness response"); }
      if (!body || body.status !== "ok" || (body.release_sha !== sha
          && (previousSha === undefined || body.release_sha !== previousSha))) {
        throw new Error("Unexpected native backend version or status during publication");
      }
      if (body.release_sha !== sha) return null;
      const runtime = response.headers.get("x-kova-runtime");
      // A Python and a native publication can share the same commit during
      // first activation. Wait for the runtime, not just that commit's SHA.
      if (!runtime) return null;
      if (runtime !== "native-resident") throw new Error("Unexpected native runtime identity");
      const process = response.headers.get("x-kova-process-id") || "";
      if (!/^[a-f0-9]{32}$/.test(process)) throw new Error("Invalid native process identity");
      return process;
    }));
    if (now() >= deadline) break;
    if (!directReady && observations[0]) {
      directReady = true;
      if (targets.length === 1) return;
      continue;
    }
    if (observations.every(value => value && value === observations[0])) return;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(1000, remaining));
  }
  throw new Error(`Native container publication did not finish within ${rollout ? "thirty" : "five"} minutes`
    + (lastFailure ? ` ${lastFailure}` : ""));
}
