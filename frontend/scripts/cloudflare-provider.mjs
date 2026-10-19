import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare");
const cli = path.join(directory, "node_modules/cf/bin/cf");
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function waitForFrontendRelease({ frontendUrl, sha, previousSha,
  fetcher = globalThis.fetch, wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)) }) {
  if (![sha, previousSha].every(value => /^[a-f0-9]{40}$/i.test(value ?? ""))) {
    throw new Error("Frontend propagation requires current and previous complete SHAs");
  }
  const url = new URL("/version.json", frontendUrl);
  const deadline = Date.now() + 20_000;
  for (let attempt = 0; attempt < 20 && Date.now() < deadline; attempt++) {
    const response = await fetcher(url, {
      signal: globalThis.AbortSignal.timeout(5000), headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`Frontend readiness failed: HTTP ${response.status}`);
    const { hash } = await response.json();
    if (hash === sha.slice(0, 12)) return;
    // Only an explicitly captured previous version is eventual propagation.
    // Foreign commits, malformed responses and HTTP failures remain blocking.
    if (hash !== previousSha.slice(0, 12)) throw new Error("Unexpected frontend version during publication");
    await wait(500);
  }
  throw new Error("Frontend publication did not finish propagating");
}

export function validateCloudflareVersion(version) {
  if (!VERSION.test(version ?? "")) throw new Error("rollback artifact has no valid Cloudflare version");
  return version;
}

export function cloudflareProvider({ run, env }) {
  if (env.KOVA_CLOUDFLARE_FRONTEND !== "1") return undefined;
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Cloudflare release requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
  }
  const cf = (args, capture = false) => run(process.execPath, [cli, ...args],
    { cwd: directory, env, capture, label: "Cloudflare" });
  return {
    waitForPublicFrontend: waitForFrontendRelease,
    async capture() {
      const result = JSON.parse(await cf(["workers", "deployments", "list",
        "--script-name", "kova-frontend"], true));
      const versions = result.deployments?.[0]?.versions;
      if (versions?.length !== 1 || versions[0].percentage !== 100) {
        throw new Error("Capture requires exactly one Cloudflare version serving 100% of traffic");
      }
      return validateCloudflareVersion(versions[0].version_id);
    },
    async publish() {
      await run(process.execPath, [path.join(directory, "build.mjs")], {
        cwd: directory, label: "Cloudflare artifact", env: {
          ...env, KOVA_ASSETS_DIR: path.join(root, ".vercel/output/static"),
        },
      });
      await cf(["deploy", "--prebuilt", "--dry-run"]);
      await cf(["deploy", "--prebuilt"]);
    },
    async restore(version) {
      validateCloudflareVersion(version);
      await cf(["workers", "deployments", "create", "--script-name", "kova-frontend",
        "--strategy", "percentage", "--versions",
        JSON.stringify([{ version_id: version, percentage: 100 }])]);
    },
  };
}
