import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import path from "node:path";
import { verifyDeployment } from "./verify-deployment.mjs";
import { cloudflareProvider, validateCloudflareVersion } from "./cloudflare-provider.mjs";
import { cloudflareBackendProvider, validateBackendVersions } from "./cloudflare-backend-provider.mjs";

const RECOVERY_PHASES = new Set(["candidate", "promotion", "acceptance"]);
const FULL_SHA = /^[0-9a-f]{40}$/i;

function requireArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function optionalArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use https`);
  return parsed.href.replace(/\/$/, "");
}

export function productionHostname(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
      || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("frontend URL must be an https origin for production alias assignment");
  }
  return parsed.hostname;
}

export function validateRollbackArtifact(input) {
  if (!input || typeof input !== "object") throw new Error("rollback artifact is required");
  const releaseSha = String(input.releaseSha ?? "");
  const flyImage = String(input.flyImage ?? "").trim();
  if (!FULL_SHA.test(releaseSha)) throw new Error("rollback artifact has no valid release SHA");
  if (!flyImage && input.cloudflareBackendVersions === undefined) throw new Error("rollback artifact has no Fly image");
  productionHostname(String(input.frontendUrl ?? ""));
  return {
    ...(input.cloudflareBackendVersions !== undefined
      ? { cloudflareBackendVersions: validateBackendVersions(input.cloudflareBackendVersions) } : {}),
    ...(input.cloudflareVersion !== undefined
      ? { cloudflareVersion: validateCloudflareVersion(input.cloudflareVersion) } : {}),
    releaseSha,
    flyImage,
    vercelDeployment: requireHttpsUrl(
      String(input.vercelDeployment ?? ""),
      "rollback Vercel deployment",
    ),
    frontendUrl: requireHttpsUrl(String(input.frontendUrl ?? ""), "frontend URL"),
    backendUrl: requireHttpsUrl(String(input.backendUrl ?? ""), "backend URL"),
  };
}

export async function recoverRelease({ phase, artifact: rawArtifact, provider, verify = verifyDeployment, failedSha }) {
  if (!RECOVERY_PHASES.has(phase)) throw new Error(`unknown release phase: ${phase}`);
  // Validate every target before the first mutation. A partial/empty capture
  // must stop recovery and keep the incident visible rather than guessing.
  const artifact = validateRollbackArtifact(rawArtifact);
  if (failedSha !== undefined && !FULL_SHA.test(failedSha)) {
    throw new Error("Cloudflare backend recovery requires a complete failed release SHA");
  }
  if (provider.requiresCloudflareBackend && !artifact.cloudflareBackendVersions) {
    throw new Error("Cloudflare backend recovery requires captured rollback versions");
  }
  if (artifact.cloudflareBackendVersions && typeof provider.restoreCloudflareBackend !== "function") {
    throw new Error("Cloudflare backend recovery requires its configured provider");
  }
  if (artifact.cloudflareBackendVersions && typeof provider.waitForPublicBackend !== "function") {
    throw new Error("Cloudflare backend recovery requires readiness verification");
  }
  if (artifact.cloudflareVersion && typeof provider.waitForPublicFrontend !== "function") {
    throw new Error("Cloudflare frontend recovery requires readiness verification");
  }
  const restored = [];

  try {
    if (phase === "promotion" || phase === "acceptance") {
      // Restore the old frontend first. The newly deployed backend must remain
      // backward compatible during this short interval.
      if (artifact.cloudflareVersion) {
        await provider.restoreCloudflare(artifact.cloudflareVersion);
        restored.push("cloudflare");
      }
      await provider.restoreVercel(artifact.vercelDeployment, artifact.frontendUrl);
      restored.push("vercel");
    }
    if (artifact.cloudflareBackendVersions) {
      await provider.restoreCloudflareBackend(artifact.cloudflareBackendVersions);
      restored.push("cloudflare-backend");
    } else {
      await provider.restoreFly(artifact.flyImage);
      restored.push("fly");
    }
    if (restored.includes("cloudflare")) {
      await provider.waitForPublicFrontend({ frontendUrl: artifact.frontendUrl,
        sha: artifact.releaseSha, previousSha: failedSha ?? artifact.releaseSha });
    }
    if (artifact.cloudflareBackendVersions) {
      await provider.waitForPublicBackend({ frontendUrl: artifact.frontendUrl,
        backendUrl: artifact.backendUrl, sha: artifact.releaseSha,
        previousSha: failedSha ?? artifact.releaseSha,
        frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    }
    const verification = await verify({
      frontendUrl: artifact.frontendUrl,
      backendUrl: artifact.backendUrl,
      sha: artifact.releaseSha,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    });
    return { phase, restored, releaseSha: artifact.releaseSha, verification };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `RECOVERY_BLOCKED (${phase}; restored=${restored.join(",") || "none"}): ${message}`,
    );
  }
}

export function resolveNpxCommand({
  platform = process.platform,
  execPath = process.execPath,
  fileExists = fs.existsSync,
} = {}) {
  if (platform !== "win32") return { command: "npx", prefixArgs: [] };

  // Windows cannot spawn the npx.cmd shim with shell:false on current Node
  // releases (EINVAL). Invoke npm's JavaScript entry point with Node instead,
  // preserving argument boundaries without passing provider tokens to a shell.
  const cliPath = path.resolve(path.dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!fileExists(cliPath)) {
    throw new Error(`npx CLI was not found next to Node: ${cliPath}`);
  }
  return { command: execPath, prefixArgs: [cliPath] };
}

export function runProviderCommand(command, args, options = {}) {
  const { label = command, capture = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      shell: false, ...spawnOptions,
    });
    if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) =>
      reject(new Error(`${label} could not start: ${error.code ?? error.message}`)),
    );
    child.once("exit", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
    });
  });
}

export function cliProvider({ globalConfig, run = runProviderCommand, env = process.env } = {}) {
  if (!env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is required for recovery");
  if (env.KOVA_CLOUDFLARE_BACKEND !== "1" && !env.FLY_API_TOKEN) throw new Error("FLY_API_TOKEN is required for recovery");
  const npx = resolveNpxCommand();
  const flyctl = process.platform === "win32" ? "flyctl.exe" : "flyctl";
  const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend");
  const cloudflare = cloudflareProvider({ run, env });
  const backend = cloudflareBackendProvider({ run, env });
  return {
    requiresCloudflareBackend: Boolean(backend),
    ...(backend ? { restoreCloudflareBackend: backend.restore,
      waitForPublicBackend: backend.waitForPublicBackend } : {}),
    ...(cloudflare ? { restoreCloudflare: cloudflare.restore,
      waitForPublicFrontend: cloudflare.waitForPublicFrontend } : {}),
    async restoreVercel(deployment, frontendUrl) {
      const hostname = productionHostname(frontendUrl);
      const authArgs = globalConfig ? ["--global-config", globalConfig]
        : ["--token", env.VERCEL_TOKEN];
      await run(
        npx.command,
        [
          ...npx.prefixArgs,
          "--yes",
          "vercel@59.0.0",
          "rollback",
          deployment,
          "--yes",
          ...authArgs,
        ],
        { label: "Vercel restore", env },
      );
      // Custom domains are intentionally not auto-assigned to candidates.
      // Rollback must explicitly restore the same public domain as promotion.
      return run(npx.command, [...npx.prefixArgs, "--yes", "vercel@59.0.0",
        "alias", "set", deployment, hostname, ...authArgs],
      { label: "Vercel production domain restore", env });
    },
    async restoreFly(image) {
      await run("python3", ["../scripts/assistant_host_release.py", "pause"],
        { cwd: backendDirectory, label: "Assistant recovery pause", env });
      return run(
        flyctl,
        [
          "deploy",
          "--image",
          image,
          "--skip-release-command",
          "--strategy",
          "rolling",
          "--wait-timeout",
          "5m",
          "--process-groups",
          "app,assistant",
          "--ha=false",
        ],
        { cwd: backendDirectory, label: "Fly restore", env },
      );
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifactPath = optionalArg("artifact");
  const artifact = artifactPath
    ? JSON.parse(fs.readFileSync(artifactPath, "utf8"))
    : {
        releaseSha: requireArg("previous-sha"),
        flyImage: requireArg("fly-image"),
        vercelDeployment: requireArg("vercel-deployment"),
        frontendUrl: requireArg("frontend"),
        backendUrl: requireArg("backend"),
      };
  const result = await recoverRelease({
    phase: requireArg("phase"),
    failedSha: optionalArg("failed-sha"),
    artifact,
    provider: cliProvider(),
  });
  console.log(JSON.stringify(result));
}
