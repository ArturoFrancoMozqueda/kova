import { URL } from "node:url";

/** Container application rollout follows Worker activation, and the first
 * application may need several minutes to provision. Keep this bounded wait
 * separate from ordinary Workers readiness: only a 503 or a valid previous
 * release still propagating may retry. Foreign/malformed responses fail closed.
 */
export async function waitForNativeBackendRelease({ backendUrl, frontendUrl, sha, previousSha,
  frontendBypassSecret, fetcher = globalThis.fetch,
  wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)), now = Date.now }) {
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")
      || (previousSha !== undefined && !/^[a-f0-9]{40}$/i.test(previousSha))) {
    throw new Error("Native propagation requires complete release SHAs");
  }
  const targets = [
    { url: new URL("/health", backendUrl), headers: {} },
    ...(frontendUrl === undefined ? [] : [{ url: new URL("/api/health", frontendUrl),
      headers: frontendBypassSecret ? { "x-vercel-protection-bypass": frontendBypassSecret } : {} }]),
  ];
  const deadline = now() + 300_000;
  let directReady = false;
  for (let attempt = 0; attempt < 300 && now() < deadline; attempt++) {
    // First boot can exceed a frontend provider's rewrite timeout. Establish
    // the resident API directly before testing it through that shorter hop.
    // Both phases share the same deadline and fixed attempt ceiling.
    const activeTargets = directReady ? targets : targets.slice(0, 1);
    const observations = await Promise.all(activeTargets.map(async ({ url, headers }) => {
      const remaining = deadline - now();
      if (remaining <= 0) return null;
      const response = await fetcher(url, {
        signal: globalThis.AbortSignal.timeout(Math.min(190_000, remaining)),
        headers: { "cache-control": "no-cache", ...headers }, redirect: "error",
      });
      if (response.status === 503) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error(`Native readiness failed: HTTP ${response.status}`);
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
  throw new Error("Native container publication did not finish within five minutes");
}
