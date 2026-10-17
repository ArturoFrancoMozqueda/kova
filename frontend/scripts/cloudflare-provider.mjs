import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare");
const cli = path.join(directory, "node_modules/cf/bin/cf");
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
