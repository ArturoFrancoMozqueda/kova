import { pathToFileURL } from "node:url";

function requireArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

export class FrontendCommitMismatch extends Error {
  constructor(expectedSha, observedHash) {
    const validHash = typeof observedHash === "string" && /^[a-f0-9]{12}$/i.test(observedHash);
    super(`Frontend commit mismatch: expected ${expectedSha.slice(0, 12)}, received ${validHash ? observedHash : "invalid"}`);
    this.name = "FrontendCommitMismatch";
    this.expectedSha = expectedSha;
    this.observedHash = validHash ? observedHash : undefined;
  }
}

function requestSignal(deadline, now) {
  const remaining = deadline === undefined ? 20_000 : Math.min(20_000, deadline - now());
  if (remaining <= 0) throw new Error("Public deployment acceptance deadline exceeded");
  return globalThis.AbortSignal.timeout(Math.ceil(remaining));
}

async function getJson(url, extraHeaders = {}, deadline, now) {
  const response = await globalThis.fetch(url, {
    signal: requestSignal(deadline, now),
    headers: { "cache-control": "no-cache", ...extraHeaders },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return { body: await response.json(), headers: response.headers };
}

async function getText(url, extraHeaders = {}, deadline, now) {
  const response = await globalThis.fetch(url, {
    signal: requestSignal(deadline, now),
    headers: { "cache-control": "no-cache", ...extraHeaders },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return { body: await response.text(), headers: response.headers };
}

export async function verifyDeployment({ frontendUrl, backendUrl, sha, frontendBypassSecret,
  deadline, now = Date.now }) {
  const normalizedFrontend = frontendUrl.replace(/\/$/, "");
  const normalizedBackend = backendUrl.replace(/\/$/, "");
  const expectedFrontendHash = sha.slice(0, 12);
  const frontendHeaders = frontendBypassSecret
    ? { "x-vercel-protection-bypass": frontendBypassSecret }
    : {};

  const [site, frontend, backend, database, proxyBackend, proxyDatabase] = await Promise.all([
    getText(`${normalizedFrontend}/`, frontendHeaders, deadline, now),
    getJson(`${normalizedFrontend}/version.json`, frontendHeaders, deadline, now),
    getJson(`${normalizedBackend}/health`, {}, deadline, now),
    getJson(`${normalizedBackend}/health/db`, {}, deadline, now),
    getJson(`${normalizedFrontend}/api/health`, frontendHeaders, deadline, now),
    getJson(`${normalizedFrontend}/api/health/db`, frontendHeaders, deadline, now),
  ]);

  if (
    !site.headers.get("content-type")?.includes("text/html") ||
    !/<html[\s>]/i.test(site.body) ||
    !site.body.includes("Kova")
  ) {
    throw new Error("Frontend site contract failed");
  }

  if (backend.body.release_sha !== sha) {
    throw new Error(
      `Backend commit mismatch: expected ${sha}, received ${backend.body.release_sha ?? "missing"}`,
    );
  }
  if (backend.body.status !== "ok" || database.body.status !== "ok" || database.body.db !== "reachable") {
    throw new Error("Backend health contract failed");
  }
  if (
    proxyBackend.body.release_sha !== sha ||
    proxyBackend.body.status !== "ok" ||
    proxyDatabase.body.status !== "ok" ||
    proxyDatabase.body.db !== "reachable"
  ) {
    throw new Error("Frontend API proxy health contract failed");
  }

  // Only classify frontend propagation after every other contract is valid.
  // An old frontend must never hide a broken backend, DB, proxy or site.
  if (frontend.body?.hash !== expectedFrontendHash) {
    throw new FrontendCommitMismatch(sha, frontend.body?.hash);
  }

  return {
    commit: sha,
    frontend: normalizedFrontend,
    backend: normalizedBackend,
    site: "reachable",
    proxy: "reachable",
    database: "reachable",
  };
}

/** Recheck all public contracts after a known previous frontend is observed. */
export async function verifyPublicDeployment({ frontendUrl, backendUrl, sha, previousSha,
  verify = verifyDeployment, now = Date.now,
  wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)) }) {
  if (![sha, previousSha].every(value => /^[a-f0-9]{40}$/i.test(value ?? ""))) {
    throw new Error("Public acceptance requires current and captured previous complete SHAs");
  }
  const deadline = now() + 20_000;
  for (let attempt = 0; attempt < 10 && now() < deadline; attempt++) {
    try {
      const result = await verify({ frontendUrl, backendUrl, sha, deadline, now });
      if (now() >= deadline) throw new Error("Public deployment acceptance deadline exceeded");
      return result;
    } catch (error) {
      if (!(error instanceof FrontendCommitMismatch) || error.expectedSha !== sha
          || error.observedHash !== previousSha.slice(0, 12)) throw error;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await wait(Math.min(2000, remaining));
    }
  }
  throw new Error("Public deployment acceptance deadline exceeded");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyDeployment({
    frontendUrl: requireArg("frontend"),
    backendUrl: requireArg("backend"),
    sha: requireArg("sha"),
    frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  console.log(JSON.stringify(result));
}
