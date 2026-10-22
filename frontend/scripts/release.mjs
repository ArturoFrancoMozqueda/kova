import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  cliProvider, productionHostname, recoverRelease, resolveNpxCommand, runProviderCommand,
  validateRollbackArtifact,
} from "./release-recovery.mjs";
import { verifyDeployment, verifyPublicDeployment } from "./verify-deployment.mjs";
import { cloudflareProvider } from "./cloudflare-provider.mjs";
import { cloudflareBackendProvider } from "./cloudflare-backend-provider.mjs";

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
  if (provider.requiresNativeContainer && !artifact.cloudflareNativeContainer) {
    throw new Error("Resident release requires the captured Container image or explicit absence");
  }
  if (provider.requiresCloudflare && !artifact.cloudflareVersion) {
    throw new Error("Cloudflare release requires a captured rollback version");
  }
  if (provider.requiresCloudflare && typeof provider.waitForPublicFrontend !== "function") {
    throw new Error("Cloudflare publication requires frontend readiness verification");
  }
  if (provider.requiresCloudflareBackend && !artifact.cloudflareBackendVersions) {
    throw new Error("Cloudflare backend release requires captured rollback versions");
  }
  if (provider.requiresCloudflareBackend && typeof provider.waitForPublicBackend !== "function") {
    throw new Error("Cloudflare backend publication requires readiness verification");
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("full release SHA is required");
  let phase;
  try {
    const url = candidateUrl(await provider.createCandidate());
    phase = "candidate";
    await provider.deployBackend(sha, artifact.releaseSha);
    if (provider.requiresCloudflareBackend) {
      await provider.waitForPublicBackend({ frontendUrl: url, backendUrl: artifact.backendUrl,
        sha, previousSha: artifact.releaseSha,
        frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    }
    await verify({ frontendUrl: url, backendUrl: artifact.backendUrl, sha,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    phase = "promotion";
    await provider.promote(url, artifact.frontendUrl);
    phase = "acceptance";
    if (provider.requiresCloudflare) {
      await provider.waitForPublicFrontend({ frontendUrl: artifact.frontendUrl, sha,
        previousSha: artifact.releaseSha });
    }
    if (provider.requiresCloudflareBackend) {
      await provider.waitForPublicBackend({ frontendUrl: artifact.frontendUrl,
        backendUrl: artifact.backendUrl, sha, previousSha: artifact.releaseSha });
    }
    if (provider.requiresCloudflare) {
      await verifyPublicDeployment({ frontendUrl: artifact.frontendUrl,
        backendUrl: artifact.backendUrl, sha, previousSha: artifact.releaseSha, verify });
    } else {
      await verify({ frontendUrl: artifact.frontendUrl, backendUrl: artifact.backendUrl, sha });
    }
    return { sha, url, phase, accepted: true };
  } catch (error) {
    if (phase) {
      try {
        await recover({ phase, artifact, provider, verify, failedSha: sha });
      } catch (recoveryError) {
        throw new globalThis.AggregateError([error, recoveryError], recoveryError.message, { cause: error });
      }
      throw new Error(`RELEASE_FAILED_RECOVERED (${phase}): ${error.message}`);
    }
    throw error;
  }
}

export function releaseProvider(globalConfig, { run = runProviderCommand, env = process.env } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const npx = resolveNpxCommand();
  const cloudflare = cloudflareProvider({ run, env });
  const backend = cloudflareBackendProvider({ run, env });
  if (!backend) throw new Error("Cloudflare backend is required; the retired provider cannot be used");
  const buildEnv = { ...env, ...(cloudflare ? { VITE_HOSTING_PROVIDER: "cloudflare" } : {}) };
  // The owner connection belongs only to the backend migration subprocess.
  delete buildEnv.SUPABASE_DB_URL;
  const vercel = (args, capture = false) => run(npx.command,
    [...npx.prefixArgs, "--yes", "vercel@59.0.0", ...args,
      "--global-config", globalConfig], { cwd: root, label: "Vercel", capture, env: buildEnv });
  return {
    ...cliProvider({ globalConfig, run, env }),
    requiresCloudflare: Boolean(cloudflare),
    ...(cloudflare ? { waitForPublicFrontend: cloudflare.waitForPublicFrontend } : {}),
    requiresCloudflareBackend: Boolean(backend),
    requiresNativeContainer: Boolean(backend?.requiresNativeContainer),
    ...(backend ? { waitForPublicBackend: backend.waitForPublicBackend } : {}),
    async createCandidate() {
      await vercel(["pull", "--yes", "--environment=production"]);
      await vercel(["build", "--prod"]);
      return vercel(["deploy", "--prebuilt", "--prod", "--skip-domain", "--yes"], true);
    },
    async deployBackend(sha, previousSha) {
      return backend.publish(sha, previousSha);
    },
    async promote(url, frontendUrl) {
      const hostname = productionHostname(frontendUrl);
      await vercel(["promote", url, "--yes"]);
      await vercel(["alias", "set", url, hostname]);
      if (cloudflare) await cloudflare.publish();
    },
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
