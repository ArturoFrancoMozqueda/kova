import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverRelease } from "./release-recovery.mjs";

const artifact = {
  releaseSha: "0123456789abcdef0123456789abcdef01234567",
  flyImage: "registry.fly.io/kova@sha256:old",
  vercelDeployment: "https://kova-old.vercel.app",
  frontendUrl: "https://kovasuite.example",
  backendUrl: "https://api.kovasuite.example",
};

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
