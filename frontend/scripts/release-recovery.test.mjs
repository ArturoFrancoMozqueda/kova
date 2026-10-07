import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  cliProvider,
  recoverRelease,
  resolveNpxCommand,
  runProviderCommand,
} from "./release-recovery.mjs";

const artifact = {
  releaseSha: "0123456789abcdef0123456789abcdef01234567",
  flyImage: "registry.fly.io/kova@sha256:old",
  vercelDeployment: "https://kova-old.vercel.app",
  frontendUrl: "https://kovasuite.example",
  backendUrl: "https://api.kovasuite.example",
};

test("a previously serving Vercel artifact is rolled back without rebuilding or token argv", async () => {
  const calls = [];
  const provider = cliProvider({
    globalConfig: "/test/private-auth",
    env: { VERCEL_TOKEN: "test-only-token", FLY_API_TOKEN: "test-only-fly" },
    run: async (_command, args) => { calls.push(args); },
  });
  await provider.restoreVercel(artifact.vercelDeployment);
  assert.ok(calls[0].includes("rollback"));
  assert.ok(calls[0].includes(artifact.vercelDeployment));
  assert.equal(calls[0].includes("promote"), false);
  assert.equal(calls[0].includes("test-only-token"), false);
  assert.equal(calls[0].includes("build"), false);
});

function fakes({ failVercel = false } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      async restoreVercel(value) {
        calls.push(["vercel", value]);
        if (failVercel) throw new Error("fake Vercel failure");
      },
      async restoreFly(value) {
        calls.push(["fly", value]);
      },
    },
    async verify(input) {
      calls.push(["verify", input.sha]);
      return { commit: input.sha, site: "reachable", proxy: "reachable" };
    },
  };
}

test("candidate recovery restores Fly and verifies the previous public release", async () => {
  const fake = fakes();
  const result = await recoverRelease({
    phase: "candidate",
    artifact,
    provider: fake.provider,
    verify: fake.verify,
  });
  assert.deepEqual(fake.calls, [
    ["fly", artifact.flyImage],
    ["verify", artifact.releaseSha],
  ]);
  assert.deepEqual(result.restored, ["fly"]);
});

for (const phase of ["promotion", "acceptance"]) {
  test(`${phase} recovery restores Vercel before Fly and verifies both`, async () => {
    const fake = fakes();
    const result = await recoverRelease({
      phase,
      artifact,
      provider: fake.provider,
      verify: fake.verify,
    });
    assert.deepEqual(fake.calls, [
      ["vercel", artifact.vercelDeployment],
      ["fly", artifact.flyImage],
      ["verify", artifact.releaseSha],
    ]);
    assert.deepEqual(result.restored, ["vercel", "fly"]);
  });
}

test("missing rollback metadata fails before a provider is called", async () => {
  const fake = fakes();
  await assert.rejects(
    recoverRelease({
      phase: "acceptance",
      artifact: { ...artifact, flyImage: "" },
      provider: fake.provider,
      verify: fake.verify,
    }),
    /no Fly image/,
  );
  assert.deepEqual(fake.calls, []);
});

test("a Vercel recovery failure stops before changing Fly and opens a blocking incident", async () => {
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
