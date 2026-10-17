import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { cloudflareProvider } from "./cloudflare-provider.mjs";
import { release, releaseProvider } from "./release.mjs";
import { recoverRelease, validateRollbackArtifact } from "./release-recovery.mjs";

const version = "dcad4869-ba1d-43d4-865b-66349697bd7c";
const env = { KOVA_CLOUDFLARE_FRONTEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cloudflare",
  CLOUDFLARE_ACCOUNT_ID: "test-account", VERCEL_TOKEN: "test-only-vercel", FLY_API_TOKEN: "test-only-fly" };
const artifact = { releaseSha: "a".repeat(40), flyImage: "registry.fly.io/test@sha256:old",
  vercelDeployment: "https://old.vercel.app", frontendUrl: "https://kovasuite.com",
  backendUrl: "https://api.kovasuite.com", cloudflareVersion: version };

test("the capture executable initializes its full ESM graph without a top-level await cycle", () => {
  const executable = fileURLToPath(new URL("./capture-cloudflare.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [executable, "/unused-when-disabled.json"], {
    env: { ...process.env, KOVA_CLOUDFLARE_FRONTEND: "0" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /unsettled top-level await/);
});

test("Cloudflare is opt-in and missing CI credentials fail before mutation", () => {
  assert.equal(cloudflareProvider({ env: {}, run: assert.fail }), undefined);
  assert.throws(() => cloudflareProvider({ env: { KOVA_CLOUDFLARE_FRONTEND: "1" } }), /requires/);
});

test("capture rejects empty or split deployments instead of guessing rollback", async () => {
  for (const versions of [[], [{ version_id: version, percentage: 50 }],
    [{ version_id: "not-a-version", percentage: 100 }]]) {
    const provider = cloudflareProvider({ env, run: async () =>
      JSON.stringify({ deployments: [{ versions }] }) });
    await assert.rejects(provider.capture());
  }
  const provider = cloudflareProvider({ env, run: async () =>
    JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] }) });
  assert.equal(await provider.capture(), version);
});

test("release requires Cloudflare rollback capture before creating a candidate", async () => {
  const missing = { ...artifact, cloudflareVersion: undefined };
  await assert.rejects(release({ artifact: missing, sha: "b".repeat(40),
    provider: { requiresCloudflare: true, createCandidate: assert.fail } }), /captured rollback/);
  assert.throws(() => validateRollbackArtifact({ ...artifact, cloudflareVersion: "invalid" }));
});

test("promotion publishes the same candidate assets to Cloudflare before public acceptance", async () => {
  const calls = [];
  const provider = releaseProvider("/private-auth", { env,
    run: async (_command, args, options) => {
      calls.push(args);
      assert.equal(args.join(" ").includes(env.CLOUDFLARE_API_TOKEN), false);
      if (args.includes("build")) assert.equal(options.env.VITE_HOSTING_PROVIDER, "cloudflare");
      if (args.some(arg => arg.endsWith("/build.mjs"))) {
        assert.ok(options.env.KOVA_ASSETS_DIR.endsWith("/.vercel/output/static"));
      }
      if (args.includes("deploy") && args.includes("--skip-domain")) return "https://candidate.vercel.app";
    } });
  await provider.createCandidate();
  await provider.promote("https://candidate.vercel.app", artifact.frontendUrl);
  const cfDeploy = calls.findIndex(args => args.includes("--prebuilt") && !args.includes("--dry-run")
    && args[0].endsWith("/cf/bin/cf"));
  const alias = calls.findIndex(args => args.includes("alias"));
  assert.ok(cfDeploy > alias);
  assert.equal(calls[cfDeploy - 1].includes("--dry-run"), true);
});

test("failed public acceptance restores Cloudflare, Vercel and Fly in that order", async () => {
  const calls = [];
  await recoverRelease({ phase: "acceptance", artifact, provider: {
    restoreCloudflare: async captured => { assert.equal(captured, version); calls.push("cloudflare"); },
    restoreVercel: async () => calls.push("vercel"), restoreFly: async () => calls.push("fly"),
  }, verify: async () => calls.push("verified") });
  assert.deepEqual(calls, ["cloudflare", "vercel", "fly", "verified"]);
});

test("failed Cloudflare restore stops recovery and keeps the incident blocking", async () => {
  await assert.rejects(recoverRelease({ phase: "promotion", artifact, provider: {
    restoreCloudflare: async () => { throw new Error("restore failed"); },
    restoreVercel: assert.fail, restoreFly: assert.fail,
  }, verify: assert.fail }), /RECOVERY_BLOCKED/);
});

test("Cloudflare rollback deploys the captured version without rebuilding or bypassing checks", async () => {
  const calls = [];
  const provider = cloudflareProvider({ env, run: async (_command, args) => calls.push(args) });
  await provider.restore(version);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].at(-1)), [{ version_id: version, percentage: 100 }]);
  assert.equal(calls[0].includes("--bypass-deployment-checks"), false);
  assert.equal(calls[0].join(" ").includes(env.CLOUDFLARE_API_TOKEN), false);
});
