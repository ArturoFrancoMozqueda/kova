import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { validateCloudflareVersion } from "./cloudflare-provider.mjs";
import { waitForNativeBackendRelease } from "./cloudflare-native-readiness.mjs";
import { cloudflareContainerProvider, validateNativeContainerSnapshot } from "./cloudflare-container-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare-backend");
const nativeDirectory = path.join(root, "deploy/cloudflare-native");
export const backendWorkers = ["kova-backend-jobs", "kova-backend", "kova-backend-gateway"];

export function validateBackendVersions(input) {
  if (!input || typeof input !== "object" || Object.keys(input).length !== backendWorkers.length) {
    throw new Error("Rollback requires all three Cloudflare backend versions");
  }
  return Object.fromEntries(backendWorkers.map(name => [name, validateCloudflareVersion(input[name])]));
}

/** A successful deployment can precede global Worker/DO convergence.
 * Wait only for the captured previous identity; foreign/error responses still fail closed.
 * This readiness check never replaces the full site/API/database verification.
 * The deadline may overrun by the one in-flight read (at most 20 seconds).
 */
export async function waitForBackendRelease({ backendUrl, frontendUrl, sha, previousSha,
  frontendBypassSecret, fetcher = globalThis.fetch,
  wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)), now = Date.now }) {
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")
      || (previousSha !== undefined && !/^[a-f0-9]{40}$/i.test(previousSha))) {
    throw new Error("Backend propagation requires complete release SHAs");
  }
  const targets = [
    { url: new URL("/health", backendUrl), headers: {} },
    ...(frontendUrl === undefined ? [] : [{ url: new URL("/api/health", frontendUrl),
      headers: frontendBypassSecret ? { "x-vercel-protection-bypass": frontendBypassSecret } : {} }]),
  ];
  // Preserve the published direct-only helper contract. Full release checks also
  // inspect the frontend proxy and allow the documented DO propagation window.
  const withProxy = frontendUrl !== undefined;
  const deadline = now() + (withProxy ? 120_000 : 20_000);
  for (let attempt = 0; attempt < (withProxy ? 120 : 20) && now() < deadline; attempt++) {
    const observations = await Promise.all(targets.map(async ({ url, headers }) => {
      const response = await fetcher(url, {
        signal: globalThis.AbortSignal.timeout(20_000),
        headers: { "cache-control": "no-cache", ...headers }, redirect: "error",
      });
      if (!response.ok) throw new Error(`Backend readiness failed: HTTP ${response.status}`);
      const body = await response.json();
      if (body.status !== "ok" || (body.release_sha !== sha
          && (previousSha === undefined || body.release_sha !== previousSha))) {
        throw new Error("Unexpected backend version or status during publication");
      }
      return body.release_sha;
    }));
    if (observations.every(value => value === sha)) return;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(withProxy ? 1000 : 500, remaining));
  }
  throw new Error("Backend publication did not finish propagating");
}

export function cloudflareBackendProvider({ run, env }) {
  if (env.KOVA_CLOUDFLARE_BACKEND !== "1") return undefined;
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Cloudflare backend requires deployment credentials");
  }
  const cf = (args, capture = false) => run(process.execPath,
    [path.join(directory, "node_modules/cf/bin/cf"), ...args],
    { cwd: directory, env, capture, label: "Cloudflare backend" });
  const native = env.KOVA_NATIVE_BACKEND === "1";
  const containers = native ? cloudflareContainerProvider({ run, env }) : undefined;
  const nativeCf = (args, capture = false, commandEnv = env) => run(process.execPath,
    [path.join(nativeDirectory, "node_modules/cf/bin/cf"), ...args],
    { cwd: nativeDirectory, env: commandEnv, capture, label: "Cloudflare resident backend" });
  return {
    requiresNativeContainer: native,
    ...(containers ? { captureNative: containers.capture } : {}),
    async waitForPublicBackend(input) {
      const nativeRuntime = native && input.nativeRuntime !== false;
      if (nativeRuntime) await waitForNativeBackendRelease({ ...input, rollout: true });
      else await waitForBackendRelease(input);
      if (nativeRuntime) {
        // A Python and a native publication can share the same commit. Prove
        // the runtime as well as the SHA before accepting/promoting the site.
        await run("python3", [path.join(root, "scripts/check_native_resident.py"),
          "--base", input.backendUrl, "--sha", input.sha, "--check-private-bindings"], {
          cwd: root, env: { PATH: env.PATH }, label: "Resident runtime acceptance",
        });
      }
    },
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
    async publish(sha, previousSha) {
      if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Full backend release SHA is required");
      if (native && !/^[a-f0-9]{40}$/i.test(previousSha ?? "")) {
        throw new Error("Native publication requires the captured previous release SHA");
      }
      const publicationEnv = { ...env, KOVA_NATIVE_DEPLOY_SHA: sha,
        KOVA_NATIVE_PREVIOUS_SHA: previousSha };
      if (!env.KOVA_HYPERDRIVE_APP_ID || !env.KOVA_HYPERDRIVE_PRIVILEGED_ID || !env.KOVA_WORKERS_PACKAGES) {
        throw new Error("Backend build requires both Hyperdrive IDs and locked Python packages");
      }
      if (!env.SUPABASE_DB_URL) throw new Error("Backend migrations require the existing owner connection");
      if (native) {
        // Inspect names only. Sealed credentials stay inside Cloudflare/CI;
        // never substitute the migration owner for the tenant runtime role.
        const secrets = JSON.parse(await cf(["workers", "secrets", "list", "--script-name", "kova-backend"], true));
        for (const name of ["APP_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
          if (!Array.isArray(secrets) || !secrets.some(secret => secret.name === name)) {
            throw new Error(`Resident backend requires provisioned ${name}`);
          }
        }
      }
      await run("uv", ["run", "--frozen", "alembic", "upgrade", "head"], {
        cwd: path.join(root, "backend"), label: "Database migrations", env: {
          ...env, DATABASE_URL: env.SUPABASE_DB_URL, MIGRATION_DATABASE_URL: env.SUPABASE_DB_URL,
        },
      });
      const artifactEnv = { ...env, KOVA_BUILD_SHA: sha };
      delete artifactEnv.SUPABASE_DB_URL;
      await run(process.execPath, [path.join(directory, "build.mjs")],
        { cwd: directory, env: artifactEnv, label: "Cloudflare backend artifact" });
      if (native) {
        await run(process.execPath, [path.join(nativeDirectory, "build.mjs")], {
          cwd: nativeDirectory, env: artifactEnv, label: "Cloudflare resident artifact",
        });
        await nativeCf(["deploy", "--prebuilt", "--worker", "kova-backend", "--dry-run"], false, publicationEnv);
      }
      const pythonWorkers = backendWorkers.filter(name => !native || name !== "kova-backend");
      for (const name of pythonWorkers) await cf(["deploy", "--prebuilt", "--worker", name, "--dry-run"]);
      // Build identity is a versioned text binding, not a rotated secret.
      // Keep existing credential bindings sealed and preserve rollback checks.
      for (const name of backendWorkers) {
        const args = ["deploy", "--prebuilt", "--worker", name, "--tag", sha.slice(0, 12)];
        if (native && name === "kova-backend") await nativeCf(args, false, publicationEnv);
        else await cf(args);
      }
    },
    async restore(input, nativeSnapshot) {
      const versions = validateBackendVersions(input);
      if (native) validateNativeContainerSnapshot(nativeSnapshot);
      for (const name of ["kova-backend", "kova-backend-jobs", "kova-backend-gateway"]) {
        await cf(["workers", "deployments", "create", "--script-name", name,
          "--strategy", "percentage", "--versions", JSON.stringify([{ version_id: versions[name], percentage: 100 }])]);
      }
      if (native) await containers.restore(nativeSnapshot, { workersRestored: true });
    },
  };
}
