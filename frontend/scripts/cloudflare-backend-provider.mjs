import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCloudflareVersion } from "./cloudflare-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare-backend");
export const backendWorkers = ["kova-backend-jobs", "kova-backend", "kova-backend-gateway"];

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
        { cwd: directory, env, label: "Cloudflare backend artifact" });
      for (const name of backendWorkers) await cf(["deploy", "--prebuilt", "--worker", name, "--dry-run"]);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kova-backend-release-"));
      fs.chmodSync(temporary, 0o700);
      const metadata = path.join(temporary, "release.json");
      fs.writeFileSync(metadata, JSON.stringify({ GIT_SHA: sha, KOVA_RELEASE_SHA: sha }), { mode: 0o600 });
      try {
        // Existing sealed secrets stay on the Worker; only public build identity
        // is refreshed. No export of production credentials is needed in CI.
        for (const name of backendWorkers) {
          await cf(["deploy", "--prebuilt", "--worker", name, "--tag", sha.slice(0, 12),
            ...(name === "kova-backend-gateway" ? [] : ["--secrets-file", metadata])]);
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
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
