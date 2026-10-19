import assert from "node:assert/strict";
import { test } from "node:test";
import { backendWorkers, cloudflareBackendProvider, validateBackendVersions } from "./cloudflare-backend-provider.mjs";
import { cliProvider, recoverRelease, validateRollbackArtifact } from "./release-recovery.mjs";
import { release, releaseProvider } from "./release.mjs";

const version = "dcad4869-ba1d-43d4-865b-66349697bd7c";
const versions = Object.fromEntries(backendWorkers.map(name => [name, version]));
const sha = "a".repeat(40);
const env = { KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cf",
  CLOUDFLARE_ACCOUNT_ID: "test-account", VERCEL_TOKEN: "test-only-vercel",
  KOVA_HYPERDRIVE_APP_ID: "test-runtime", KOVA_HYPERDRIVE_PRIVILEGED_ID: "test-owner",
  KOVA_WORKERS_PACKAGES: "/test/locked-packages", SUPABASE_DB_URL: "postgresql://test-only-owner" };
const artifact = { releaseSha: sha, cloudflareBackendVersions: versions,
  vercelDeployment: "https://old.vercel.app", frontendUrl: "https://kovasuite.com",
  backendUrl: "https://api.kovasuite.com" };

test("backend deployment is opt-in and credentials are required before any command", () => {
  assert.equal(cloudflareBackendProvider({ env: {}, run: assert.fail }), undefined);
  assert.throws(() => cloudflareBackendProvider({ env: { KOVA_CLOUDFLARE_BACKEND: "1" } }), /credentials/);
  for (const invalid of [undefined, {}, { ...versions, extra: version },
    { ...versions, "kova-backend": "invalid" }]) {
    assert.throws(() => validateBackendVersions(invalid));
  }
});

test("capture requires one complete serving version for every backend Worker", async () => {
  const captured = [];
  const provider = cloudflareBackendProvider({ env, run: async (_command, args) => {
    captured.push(args[args.indexOf("--script-name") + 1]);
    return JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
  } });
  assert.deepEqual(await provider.capture(), versions);
  assert.deepEqual(captured, backendWorkers);
  for (const split of [[], [{ version_id: version, percentage: 50 }]]) {
    const broken = cloudflareBackendProvider({ env, run: async () =>
      JSON.stringify({ deployments: [{ versions: split }] }) });
    await assert.rejects(broken.capture(), /100%/);
  }
});

for (const failDeploy of [false, true]) {
  test(`backend release versions public identity without rotating secrets (failure=${failDeploy})`, async () => {
    const calls = [];
    const provider = cloudflareBackendProvider({ env, run: async (command, args, options) => {
      calls.push({ command, args });
      assert.ok(options.cwd.endsWith(command === "uv" ? "/backend" : "/deploy/cloudflare-backend"));
      for (const secret of [env.CLOUDFLARE_API_TOKEN, env.SUPABASE_DB_URL]) {
        assert.equal(args.join(" ").includes(secret), false);
      }
      if (command === "uv") assert.equal(options.env.MIGRATION_DATABASE_URL, env.SUPABASE_DB_URL);
      assert.equal(args.includes("--secrets-file"), false);
      if (args.some(value => value.endsWith("/build.mjs"))) {
        assert.equal(options.env.KOVA_BUILD_SHA, sha);
      }
      if (failDeploy && args.includes("deploy") && !args.includes("--dry-run")) {
        throw new Error("deployment failed");
      }
    } });
    if (failDeploy) await assert.rejects(provider.publish(sha), /deployment failed/);
    else await provider.publish(sha);
    assert.deepEqual(calls[0].args, ["run", "--frozen", "alembic", "upgrade", "head"]);
    assert.equal(calls.filter(call => call.args.includes("--dry-run")).length, 3);
    const deployed = calls.filter(call => call.args.includes("deploy") && !call.args.includes("--dry-run"));
    assert.deepEqual(deployed.map(call => call.args[call.args.indexOf("--worker") + 1]),
      failDeploy ? [backendWorkers[0]] : backendWorkers);
    assert.equal(calls.some(call => call.command.includes("flyctl")), false);
  });
}

test("missing migration inputs fail before building or modifying any service", async () => {
  for (const missing of ["KOVA_HYPERDRIVE_APP_ID", "KOVA_WORKERS_PACKAGES", "SUPABASE_DB_URL"]) {
    const provider = cloudflareBackendProvider({ env: { ...env, [missing]: "" }, run: assert.fail });
    await assert.rejects(provider.publish(sha));
  }
});

test("rollback restores all captured versions without rebuilding or invoking Fly", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env, run: async (_command, args) => calls.push(args) });
  await provider.restore(versions);
  assert.deepEqual(calls.map(args => args[args.indexOf("--script-name") + 1]),
    ["kova-backend", "kova-backend-jobs", "kova-backend-gateway"]);
  for (const args of calls) {
    assert.deepEqual(JSON.parse(args.at(-1)), [{ version_id: version, percentage: 100 }]);
    assert.equal(args.includes("--bypass-deployment-checks"), false);
  }
  await assert.rejects(provider.restore({ "kova-backend": version }));
  assert.equal(calls.length, 3);
});

test("Cloudflare recovery needs no Fly image or token and verifies the restored release", async () => {
  assert.equal(validateRollbackArtifact(artifact).flyImage, "");
  const configured = cliProvider({ env, run: assert.fail });
  assert.equal(configured.requiresCloudflareBackend, true);
  const calls = [];
  const result = await recoverRelease({ phase: "acceptance", artifact, provider: {
    requiresCloudflareBackend: true,
    restoreVercel: async () => calls.push("frontend"), restoreFly: assert.fail,
    restoreCloudflareBackend: async captured => { assert.deepEqual(captured, versions); calls.push("backend"); },
  }, verify: async input => { assert.equal(input.sha, sha); calls.push("verified"); } });
  assert.deepEqual(calls, ["frontend", "backend", "verified"]);
  assert.deepEqual(result.restored, ["vercel", "cloudflare-backend"]);
});

test("incomplete recovery capture fails before creating a candidate or restoring the frontend", async () => {
  const incomplete = { ...artifact, cloudflareBackendVersions: undefined, flyImage: "old-fly-image" };
  await assert.rejects(release({ artifact: incomplete, sha,
    provider: { requiresCloudflareBackend: true, createCandidate: assert.fail } }), /captured rollback/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact: incomplete,
    provider: { requiresCloudflareBackend: true, restoreVercel: assert.fail } }), /captured rollback/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact,
    provider: { restoreVercel: assert.fail } }), /configured provider/);
});

test("the normal release delegates backend publication to Cloudflare when selected", async () => {
  const commands = [];
  const provider = releaseProvider("/private-auth", { env, run: async (command, args) => commands.push({ command, args }) });
  await provider.deployFly(sha);
  assert.equal(provider.requiresCloudflareBackend, true);
  assert.equal(commands[0].command, "uv");
  assert.equal(commands.some(call => call.command.includes("flyctl")), false);
  assert.equal(commands.filter(call => call.args.includes("--tag")).length, 3);
});

test("frontend candidate tooling never inherits the backend owner connection", async () => {
  const provider = releaseProvider("/private-auth", { env, run: async (_command, _args, options) => {
    assert.equal(options.env.SUPABASE_DB_URL, undefined);
  } });
  await provider.createCandidate();
});
