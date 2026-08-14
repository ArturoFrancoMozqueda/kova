import { pathToFileURL } from "node:url";

function requireArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function getJson(url) {
  const response = await globalThis.fetch(url, {
    headers: { "cache-control": "no-cache" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return { body: await response.json(), headers: response.headers };
}

export async function verifyDeployment({ frontendUrl, backendUrl, sha }) {
  const normalizedFrontend = frontendUrl.replace(/\/$/, "");
  const normalizedBackend = backendUrl.replace(/\/$/, "");
  const expectedFrontendHash = sha.slice(0, 12);

  const [frontend, backend, database] = await Promise.all([
    getJson(`${normalizedFrontend}/version.json`),
    getJson(`${normalizedBackend}/health`),
    getJson(`${normalizedBackend}/health/db`),
  ]);

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

  return {
    commit: sha,
    frontend: normalizedFrontend,
    backend: normalizedBackend,
    database: "reachable",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyDeployment({
    frontendUrl: requireArg("frontend"),
    backendUrl: requireArg("backend"),
    sha: requireArg("sha"),
  });
  console.log(JSON.stringify(result));
}
