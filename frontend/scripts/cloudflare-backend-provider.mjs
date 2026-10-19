import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { validateCloudflareVersion } from "./cloudflare-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare-backend");
export const backendWorkers = ["kova-backend-jobs", "kova-backend", "kova-backend-gateway"];

export async function waitForBackendRelease({ backendUrl, sha, previousSha,
  fetcher = globalThis.fetch, wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)),
  now = Date.now }) {
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")
      || (previousSha !== undefined && !/^[a-f0-9]{40}$/i.test(previousSha))) {
    throw new Error("Backend propagation requires complete release SHAs");
  }
  const url = new URL("/health", backendUrl);
  const deadline = now() + 20_000;
  for (let attempt = 0; attempt < 20 && now() < deadline; attempt++) {
    const response = await fetcher(url, {
      // Python's first healthy invocation can exceed five seconds after idle.
      // Share the overall deadline rather than timing out a cold start early.
      signal: globalThis.AbortSignal.timeout(Math.max(1, deadline - now())),
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`Backend readiness failed: HTTP ${response.status}`);
    const health = await response.json();
    if (health.status !== "ok") throw new Error("Backend readiness health contract failed");
    if (health.release_sha === sha) return;
    // Only a known version being replaced may still be propagating. HTTP
    // failures, missing identities and unrelated commits remain blocking.
    if (previousSha === undefined || health.release_sha !== previousSha) {
      throw new Error("Unexpected backend version during publication");
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(500, remaining));
  }
  throw new Error("Backend publication did not finish propagating");
}

export function validateBackendVersions(input) {
  if (!input || typeof input !== "object" || Object.keys(input).length !== backendWorkers.length) {
    throw new Error("Rollback requires all three Cloudflare backend versions");
  }
  return Object.fromEntries(backendWorkers.map(name => [name, validateCloudflareVersion(input[name])]));
}

export function cloudflareBackendProvider({ run, env }) {
  if (env.KOVA_CLOUDFLARE_BACKEND !== "1") return undefined;
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Cloudflare backend requires deployment credentials");
  }
  const cf = (args, capture = false) => run(process.execPath,
    [path.join(directory, "node_modules/cf/bin/cf"), ...args],
    { cwd: directory, env, capture, label: "Cloudflare backend" });
  return {
    waitForPublicBackend: waitForBackendRelease,
    async capture() {
      const captured = {};
      for (const name of backendWorkers) {
        const response = JSON.parse(await cf(["workers", "deployments", "list", "--script-name", name], true));
        const versions = response.deployments?.[0]?.versions;
        if (versions?.length !== 1 || versions[0].percentage !== 100) {
          throw new Error(`Capture requires one version serving 100%: ${name}`);
        }
        captured[name] = versions[0].version_id;
      }
      return validateBackendVersions(captured);
    },
    async publish(sha) {
      if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Full backend release SHA is required");
      if (!env.KOVA_HYPERDRIVE_APP_ID || !env.KOVA_HYPERDRIVE_PRIVILEGED_ID || !env.KOVA_WORKERS_PACKAGES) {
        throw new Error("Backend build requires both Hyperdrive IDs and locked Python packages");
      }
      if (!env.SUPABASE_DB_URL) throw new Error("Backend migrations require the existing owner connection");
      await run("uv", ["run", "--frozen", "alembic", "upgrade", "head"], {
        cwd: path.join(root, "backend"), label: "Database migrations", env: {
          ...env, DATABASE_URL: env.SUPABASE_DB_URL, MIGRATION_DATABASE_URL: env.SUPABASE_DB_URL,
        },
      });
      await run(process.execPath, [path.join(directory, "build.mjs")],
        { cwd: directory, env: { ...env, KOVA_BUILD_SHA: sha }, label: "Cloudflare backend artifact" });
      for (const name of backendWorkers) await cf(["deploy", "--prebuilt", "--worker", name, "--dry-run"]);
      // Build identity is a versioned text binding, not a rotated secret.
      // Keep existing credential bindings sealed and preserve rollback checks.
      for (const name of backendWorkers) {
        await cf(["deploy", "--prebuilt", "--worker", name, "--tag", sha.slice(0, 12)]);
      }
    },
    async restore(input) {
      const versions = validateBackendVersions(input);
      for (const name of ["kova-backend", "kova-backend-jobs", "kova-backend-gateway"]) {
        await cf(["workers", "deployments", "create", "--script-name", name,
          "--strategy", "percentage", "--versions", JSON.stringify([{ version_id: versions[name], percentage: 100 }])]);
      }
    },
  };
}
