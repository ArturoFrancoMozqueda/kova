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
import { RELEASE_BILLING_OFFER, verifyPublicBillingOffer } from "./release-billing-offer.mjs";
import { backendReleasePlan } from "./backend-release-plan.mjs";

export function candidateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value
      || !url.hostname.endsWith(".vercel.app")) {
    throw new Error("candidate must be an immutable https Vercel deployment URL");
  }
  return value;
}

// Only a short symbolic code (e.g. ECONNRESET, UND_ERR_SOCKET) survives; never
// the raw cause message, URLs, headers or values.
export function causeSuffix(error) {
  const code = error?.cause?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? ` (cause=${code})` : "";
}

/** Phase is set BEFORE a provider may partially change production. */
export async function release({ artifact: rawArtifact, sha, provider,
  verify = verifyDeployment, recover = recoverRelease,
  expectedBillingOffer, verifyOffer = verifyPublicBillingOffer,
  reuseBackend = false, planBackend = backendReleasePlan }) {
  const artifact = validateRollbackArtifact(rawArtifact);
  if (provider.requiresBlueGreen && !artifact.cloudflareNativeSlots) {
    throw new Error("Independent native publication requires captured serving slots");
  }
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
  const plan = reuseBackend ? planBackend({ sha, previousSha: artifact.releaseSha })
    : { publishBackend: true, backendSha: sha };
  if (typeof plan?.publishBackend !== "boolean"
      || plan.backendSha !== (plan.publishBackend ? sha : artifact.releaseSha)) {
    throw new Error("Invalid backend publication plan");
  }
  const backendSha = plan.backendSha;
  const previousFrontendSha = artifact.frontendSha ?? artifact.releaseSha;
  const versions = { sha: backendSha, ...(backendSha === sha ? {} : { frontendSha: sha }) };
  let phase;
  let backendChanged = false;
  try {
    const url = candidateUrl(await provider.createCandidate());
    phase = "candidate";
    if (plan.publishBackend) {
      // Set before a provider that can fail after partially publishing.
      backendChanged = true;
      await provider.deployBackend(sha, artifact.releaseSha,
        ...(provider.requiresBlueGreen ? [artifact.cloudflareNativeSlots] : []));
    }
    if (provider.requiresCloudflareBackend) {
      await provider.waitForPublicBackend({ frontendUrl: url, backendUrl: artifact.backendUrl,
        sha: backendSha, previousSha: artifact.releaseSha,
        requireControllerBootIdentity: true,
        frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    }
    await verify({ frontendUrl: url, backendUrl: artifact.backendUrl, ...versions,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    if (expectedBillingOffer !== undefined) await verifyOffer({ frontendUrl: url,
      backendUrl: artifact.backendUrl, offer: expectedBillingOffer,
      frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    phase = "promotion";
    await provider.promote(url, artifact.frontendUrl);
    phase = "acceptance";
    if (provider.requiresCloudflare) {
      await provider.waitForPublicFrontend({ frontendUrl: artifact.frontendUrl, sha,
        previousSha: previousFrontendSha });
    }
    if (provider.requiresCloudflareBackend) {
      await provider.waitForPublicBackend({ frontendUrl: artifact.frontendUrl,
        backendUrl: artifact.backendUrl, sha: backendSha, previousSha: artifact.releaseSha,
        requireControllerBootIdentity: true });
    }
    if (provider.requiresCloudflare) {
      await verifyPublicDeployment({ frontendUrl: artifact.frontendUrl,
        backendUrl: artifact.backendUrl, ...versions, previousSha: artifact.releaseSha,
        previousFrontendSha, verify });
    } else {
      await verify({ frontendUrl: artifact.frontendUrl, backendUrl: artifact.backendUrl, ...versions });
    }
    if (expectedBillingOffer !== undefined) await verifyOffer({ frontendUrl: artifact.frontendUrl,
      backendUrl: artifact.backendUrl, offer: expectedBillingOffer });
    return { sha, ...(backendSha === sha ? {} : { backendSha }), url, phase, accepted: true };
  } catch (error) {
    if (phase) {
      try {
        await recover({ phase, artifact, provider, verify, failedSha: sha, backendChanged });
      } catch (recoveryError) {
        throw new globalThis.AggregateError([error, recoveryError], recoveryError.message, { cause: error });
      }
      throw new Error(`RELEASE_FAILED_RECOVERED (${phase}): ${error.message}${causeSuffix(error)}`);
    }
    throw error;
  }
}

export function releaseProvider(globalConfig, { run = runProviderCommand, env = process.env,
  backend: suppliedBackend } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const npx = resolveNpxCommand();
  const cloudflare = cloudflareProvider({ run, env });
  const backend = suppliedBackend ?? cloudflareBackendProvider({ run, env });
  if (!backend) throw new Error("Cloudflare backend is required; the retired provider cannot be used");
  const buildEnv = { ...env, ...(cloudflare ? { VITE_HOSTING_PROVIDER: "cloudflare" } : {}) };
  // The owner connection belongs only to the backend migration subprocess.
  delete buildEnv.SUPABASE_DB_URL;
  const vercel = (args, capture = false) => run(npx.command,
    [...npx.prefixArgs, "--yes", "vercel@59.0.0", ...args,
      "--global-config", globalConfig], { cwd: root, label: "Vercel", capture, env: buildEnv });
  return {
    ...cliProvider({ globalConfig, run, env, backend }),
    requiresCloudflare: Boolean(cloudflare),
    ...(cloudflare ? { waitForPublicFrontend: cloudflare.waitForPublicFrontend } : {}),
    requiresCloudflareBackend: Boolean(backend),
    requiresNativeContainer: Boolean(backend?.requiresNativeContainer),
    requiresBlueGreen: Boolean(backend?.requiresBlueGreen),
    ...(backend ? { waitForPublicBackend: backend.waitForPublicBackend } : {}),
    async createCandidate() {
      await vercel(["pull", "--yes", "--environment=production"]);
      await vercel(["build", "--prod"]);
      return vercel(["deploy", "--prebuilt", "--prod", "--skip-domain", "--yes"], true);
    },
    async deployBackend(sha, previousSha, slotSnapshot) {
      return backend.publish(sha, previousSha, slotSnapshot);
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
      expectedBillingOffer: RELEASE_BILLING_OFFER,
      reuseBackend: true,
    });
    console.log(JSON.stringify(result));
  } finally {
    fs.rmSync(globalConfig, { recursive: true, force: true });
  }
}
