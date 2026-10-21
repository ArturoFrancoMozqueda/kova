import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { test } from "node:test";
import {
  cliProvider,
  recoverRelease,
  resolveNpxCommand,
  runProviderCommand,
} from "./release-recovery.mjs";

const artifact = {
  releaseSha: "0123456789abcdef0123456789abcdef01234567",
  cloudflareBackendVersions: Object.fromEntries(["kova-backend-jobs", "kova-backend", "kova-backend-gateway"].map(name => [name, "dcad4869-ba1d-43d4-865b-66349697bd7c"])),
  vercelDeployment: "https://kova-old.vercel.app",
  frontendUrl: "https://kovasuite.example",
  backendUrl: "https://api.kovasuite.example",
};

test("the disposable recovery fixture imports with its staged scripts and no Cloudflare installation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kova-recovery-fixture-"));
  try {
    // The resident release adds two runtime dependencies to the recovery
    // bundle. Stage those actual modules; retain the isolated import check.
    const staged = ["release-recovery.mjs", "verify-deployment.mjs", "cloudflare-provider.mjs",
      "cloudflare-backend-provider.mjs", "cloudflare-native-readiness.mjs", "cloudflare-container-provider.mjs"];
    for (const file of staged) {
      fs.copyFileSync(fileURLToPath(new URL(file, import.meta.url)), path.join(directory, file));
    }
    const target = pathToFileURL(path.join(directory, "release-recovery.mjs")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(target)})`],
      { encoding: "utf8", timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a previously serving Vercel artifact is rolled back without rebuilding or token argv", async () => {
  const calls = [];
  const provider = cliProvider({
    globalConfig: "/test/private-auth",
    env: { VERCEL_TOKEN: "test-only-token", KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cf", CLOUDFLARE_ACCOUNT_ID: "test-account" },
    run: async (_command, args) => { calls.push(args); },
  });
  await provider.restoreVercel(artifact.vercelDeployment, artifact.frontendUrl);
  assert.ok(calls[0].includes("rollback"));
  assert.ok(calls[0].includes(artifact.vercelDeployment));
  assert.equal(calls[0].includes("promote"), false);
  assert.equal(calls[0].includes("test-only-token"), false);
  assert.equal(calls[0].includes("build"), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(2, 7), ["alias", "set", artifact.vercelDeployment,
    "kovasuite.example", "--global-config"]);
  assert.equal(calls.flat().includes("test-only-token"), false);
});

test("retired provider cannot be selected even with stale credentials", () => {
  for (const KOVA_CLOUDFLARE_BACKEND of [undefined, "0"]) {
    assert.throws(() => cliProvider({ env: { VERCEL_TOKEN: "test-only-token",
      FLY_API_TOKEN: "obsolete-test-only-token", KOVA_CLOUDFLARE_BACKEND }, run: assert.fail }),
    /Cloudflare backend is required/);
  }
});

function fakes({ failVercel = false } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      async waitForPublicBackend() {},
      async restoreVercel(value, frontendUrl) {
        assert.equal(frontendUrl, artifact.frontendUrl);
        calls.push(["vercel", value]);
        if (failVercel) throw new Error("fake Vercel failure");
      },
      async restoreCloudflareBackend(value) {
        calls.push(["cloudflare-backend", value]);
      },
    },
    async verify(input) {
      calls.push(["verify", input.sha]);
      return { commit: input.sha, site: "reachable", proxy: "reachable" };
    },
  };
}

test("candidate recovery restores Cloudflare and verifies the previous public release", async () => {
  const fake = fakes();
  const result = await recoverRelease({
    phase: "candidate",
    artifact,
    provider: fake.provider,
    verify: fake.verify,
  });
  assert.deepEqual(fake.calls, [
    ["cloudflare-backend", artifact.cloudflareBackendVersions],
    ["verify", artifact.releaseSha],
  ]);
  assert.deepEqual(result.restored, ["cloudflare-backend"]);
});

for (const phase of ["promotion", "acceptance"]) {
  test(`${phase} recovery restores Vercel before Cloudflare and verifies both`, async () => {
    const fake = fakes();
    const result = await recoverRelease({
      phase,
      artifact,
      provider: fake.provider,
      verify: fake.verify,
    });
    assert.deepEqual(fake.calls, [
      ["vercel", artifact.vercelDeployment],
      ["cloudflare-backend", artifact.cloudflareBackendVersions],
      ["verify", artifact.releaseSha],
    ]);
    assert.deepEqual(result.restored, ["vercel", "cloudflare-backend"]);
  });
}

test("missing rollback metadata fails before a provider is called", async () => {
  const fake = fakes();
  await assert.rejects(
    recoverRelease({
      phase: "acceptance",
      artifact: { ...artifact, cloudflareBackendVersions: undefined },
      provider: fake.provider,
      verify: fake.verify,
    }),
    /requires Cloudflare backend versions/,
  );
  assert.deepEqual(fake.calls, []);
});

test("a Vercel recovery failure stops before changing Cloudflare and opens a blocking incident", async () => {
  const fake = fakes({ failVercel: true });
  await assert.rejects(
    recoverRelease({
      phase: "promotion",
      artifact,
      provider: fake.provider,
      verify: fake.verify,
    }),
    /RECOVERY_BLOCKED \(promotion; restored=none\): fake Vercel failure/,
  );
  assert.deepEqual(fake.calls, [["vercel", artifact.vercelDeployment]]);
});

test("Windows invokes the npx JavaScript entry point without a command shell", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const expectedCli = path.resolve(
    path.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  const command = resolveNpxCommand({
    platform: "win32",
    execPath,
    fileExists: (candidate) => candidate === expectedCli,
  });

  assert.deepEqual(command, { command: execPath, prefixArgs: [expectedCli] });
  assert.notEqual(command.command, "npx.cmd");
});

test("Windows fails closed when npm's JavaScript entry point cannot be resolved", () => {
  assert.throws(
    () =>
      resolveNpxCommand({
        platform: "win32",
        execPath: "C:\\missing\\node.exe",
        fileExists: () => false,
      }),
    /npx CLI was not found next to Node/,
  );
});

test(
  "the resolved Windows npx launcher starts without spawn EINVAL",
  { skip: process.platform !== "win32" },
  async () => {
    const command = resolveNpxCommand();
    await runProviderCommand(command.command, [...command.prefixArgs, "--version"], {
      label: "npx regression probe",
      stdio: "ignore",
    });
  },
);
