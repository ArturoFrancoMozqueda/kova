import { pathToFileURL } from "node:url";

function requireArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function getJson(url, extraHeaders = {}) {
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(20_000),
    headers: { "cache-control": "no-cache", ...extraHeaders },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return { body: await response.json(), headers: response.headers };
}

async function getText(url, extraHeaders = {}) {
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(20_000),
    headers: { "cache-control": "no-cache", ...extraHeaders },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return { body: await response.text(), headers: response.headers };
}

export async function verifyDeployment({ frontendUrl, backendUrl, sha, frontendBypassSecret }) {
  const normalizedFrontend = frontendUrl.replace(/\/$/, "");
  const normalizedBackend = backendUrl.replace(/\/$/, "");
  const expectedFrontendHash = sha.slice(0, 12);
  const frontendHeaders = frontendBypassSecret
    ? { "x-vercel-protection-bypass": frontendBypassSecret }
    : {};

  const [site, frontend, backend, database, proxyBackend, proxyDatabase] = await Promise.all([
    getText(`${normalizedFrontend}/`, frontendHeaders),
    getJson(`${normalizedFrontend}/version.json`, frontendHeaders),
    getJson(`${normalizedBackend}/health`),
    getJson(`${normalizedBackend}/health/db`),
    getJson(`${normalizedFrontend}/api/health`, frontendHeaders),
    getJson(`${normalizedFrontend}/api/health/db`, frontendHeaders),
  ]);

  if (
    !site.headers.get("content-type")?.includes("text/html") ||
    !/<html[\s>]/i.test(site.body) ||
    !site.body.includes("Kova")
  ) {
    throw new Error("Frontend site contract failed");
  }

  if (frontend.body.hash !== expectedFrontendHash) {
    throw new Error(
      `Vercel commit mismatch: expected ${expectedFrontendHash}, received ${frontend.body.hash ?? "missing"}`,
    );
  }
  if (backend.body.release_sha !== sha) {
    throw new Error(
      `Fly commit mismatch: expected ${sha}, received ${backend.body.release_sha ?? "missing"}`,
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

  return {
    commit: sha,
    frontend: normalizedFrontend,
    backend: normalizedBackend,
    site: "reachable",
    proxy: "reachable",
    database: "reachable",
  };
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
