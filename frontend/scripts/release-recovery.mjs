import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import path from "node:path";
import { verifyDeployment } from "./verify-deployment.mjs";

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

export function validateRollbackArtifact(input) {
  if (!input || typeof input !== "object") throw new Error("rollback artifact is required");
  const releaseSha = String(input.releaseSha ?? "");
  const flyImage = String(input.flyImage ?? "").trim();
  if (!FULL_SHA.test(releaseSha)) throw new Error("rollback artifact has no valid release SHA");
  if (!flyImage) throw new Error("rollback artifact has no Fly image");
  return {
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

export async function recoverRelease({ phase, artifact: rawArtifact, provider, verify = verifyDeployment }) {
  if (!RECOVERY_PHASES.has(phase)) throw new Error(`unknown release phase: ${phase}`);
  // Validate every target before the first mutation. A partial/empty capture
  // must stop recovery and keep the incident visible rather than guessing.
  const artifact = validateRollbackArtifact(rawArtifact);
  const restored = [];

  try {
    if (phase === "promotion" || phase === "acceptance") {
      // Restore the old frontend first. The newly deployed backend must remain
      // backward compatible during this short interval.
      await provider.restoreVercel(artifact.vercelDeployment);
      restored.push("vercel");
    }
    await provider.restoreFly(artifact.flyImage);
    restored.push("fly");
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
  const { label = command, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...spawnOptions });
    child.once("error", (error) =>
      reject(new Error(`${label} could not start: ${error.code ?? error.message}`)),
    );
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
    });
  });
}

function cliProvider() {
  if (!process.env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is required for recovery");
  if (!process.env.FLY_API_TOKEN) throw new Error("FLY_API_TOKEN is required for recovery");
  const npx = resolveNpxCommand();
  const flyctl = process.platform === "win32" ? "flyctl.exe" : "flyctl";
  const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend");
  return {
    restoreVercel(deployment) {
      return runProviderCommand(
        npx.command,
        [
          ...npx.prefixArgs,
          "--yes",
          "vercel@59.0.0",
          "promote",
          deployment,
          "--yes",
          "--token",
          process.env.VERCEL_TOKEN ?? "",
        ],
        { label: "Vercel restore" },
      );
    },
    restoreFly(image) {
      return runProviderCommand(
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
        ],
        { cwd: backendDirectory, label: "Fly restore" },
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
    artifact,
    provider: cliProvider(),
  });
  console.log(JSON.stringify(result));
}
