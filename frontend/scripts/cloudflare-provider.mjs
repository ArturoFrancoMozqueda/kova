import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "capture" || !process.argv[3]) {
    throw new Error("Usage: node cloudflare-provider.mjs capture <rollback-artifact>");
  }
  const { runProviderCommand } = await import("./release-recovery.mjs");
  const provider = cloudflareProvider({ run: runProviderCommand, env: process.env });
  if (provider) {
    const artifact = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    artifact.cloudflareVersion = await provider.capture();
    fs.writeFileSync(process.argv[3], JSON.stringify(artifact, null, 2) + "\n");
    console.log("Captured current Cloudflare version for exact rollback.");
  }
}
