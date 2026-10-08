import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  cliProvider, recoverRelease, resolveNpxCommand, runProviderCommand,
  validateRollbackArtifact,
} from "./release-recovery.mjs";
import { verifyDeployment } from "./verify-deployment.mjs";

export function candidateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value
      || !url.hostname.endsWith(".vercel.app")) {
    throw new Error("candidate must be an immutable https Vercel deployment URL");
  }
  return value;
}

/** Phase is set BEFORE a provider may partially change production. */
export async function release({ artifact: rawArtifact, sha, provider,
  verify = verifyDeployment, recover = recoverRelease }) {
  const artifact = validateRollbackArtifact(rawArtifact);
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("full release SHA is required");
  let phase;
  try {
    const url = candidateUrl(await provider.createCandidate());
    phase = "candidate";
    await provider.deployFly(sha);
    await verify({ frontendUrl: url, backendUrl: artifact.backendUrl, sha,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    phase = "promotion";
    await provider.promote(url);
    phase = "acceptance";
    await verify({ frontendUrl: artifact.frontendUrl, backendUrl: artifact.backendUrl, sha,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    return { sha, url, phase, accepted: true };
  } catch (error) {
    if (phase) {
      await recover({ phase, artifact, provider, verify });
      throw new Error(`RELEASE_FAILED_RECOVERED (${phase}): ${error.message}`);
    }
    throw error;
  }
}

export function releaseProvider(globalConfig) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const npx = resolveNpxCommand();
  const vercel = (args, capture = false) => runProviderCommand(npx.command,
    [...npx.prefixArgs, "--yes", "vercel@59.0.0", ...args,
      "--global-config", globalConfig], { cwd: root, label: "Vercel", capture });
  return {
    ...cliProvider({ globalConfig }),
    async createCandidate() {
      await vercel(["pull", "--yes", "--environment=production"]);
      await vercel(["build", "--prod"]);
      return vercel(["deploy", "--prebuilt", "--prod", "--skip-domain", "--yes"], true);
    },
    async deployFly(sha) {
      // Provisioning is idempotent and stays inside the recoverable phase.
      await runProviderCommand("python3", ["../scripts/ensure_cfdi_storage_key.py"],
        { cwd: path.join(root, "backend"), label: "Fiscal encryption preflight" });
      await runProviderCommand(process.platform === "win32" ? "flyctl.exe" : "flyctl",
        ["deploy", "--remote-only", "--build-arg", `KOVA_RELEASE_SHA=${sha}`,
          "--env", `GIT_SHA=${sha}`, "--strategy", "rolling", "--wait-timeout", "5m",
          "--process-groups", "app,assistant", "--ha=false"],
        { cwd: path.join(root, "backend"), label: "Fly deploy" });
      await runProviderCommand("python3", ["../scripts/assistant_host_release.py",
        "update", "--sha", sha],
        { cwd: path.join(root, "backend"), label: "Existing assistant file host" });
      await runProviderCommand(npx.command,
        [...npx.prefixArgs, "--yes", "wait-on@9.0.1", "https://api.kovasuite.com/health/db",
          "--timeout", "180000"], { label: "Fly health wait" });
    },
    promote(url) { return vercel(["promote", url, "--yes"]); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifactPath = process.argv[process.argv.indexOf("--artifact") + 1];
  const sha = process.env.GITHUB_SHA;
  if (!process.argv.includes("--artifact")) throw new Error("--artifact is required");
  if (!process.env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is required");
  // Authenticate without tokens in command-line arguments. Never upload this
  // directory or .vercel (which contains pulled production configuration).
  const globalConfig = fs.mkdtempSync(path.join(os.tmpdir(), "kova-vercel-auth-"));
  try {
    fs.writeFileSync(path.join(globalConfig, "auth.json"),
      JSON.stringify({ token: process.env.VERCEL_TOKEN }), { mode: 0o600 });
    const result = await release({
      artifact: JSON.parse(fs.readFileSync(artifactPath, "utf8")), sha,
      provider: releaseProvider(globalConfig),
    });
    console.log(JSON.stringify(result));
  } finally {
    fs.rmSync(globalConfig, { recursive: true, force: true });
  }
}
