import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateUrl, release } from "./release.mjs";
import { recoverRelease } from "./release-recovery.mjs";

const artifact = {
  releaseSha: "a".repeat(40), flyImage: "registry.fly.io/kova@sha256:old",
  vercelDeployment: "https://old.vercel.app", frontendUrl: "https://kova.example",
  backendUrl: "https://api.kova.example",
};
const sha = "b".repeat(40);

function fixture(fail) {
  const calls = [];
  const call = async (name, value) => {
    calls.push(name);
    if (name === fail) throw new Error(name);
    return value;
  };
  return { calls, provider: {
    createCandidate: () => call("candidate", "https://candidate.vercel.app"),
    deployFly: () => call("fly"), promote: () => call("promote"),
    restoreVercel: () => call("restore-vercel"), restoreFly: () => call("restore-fly"),
  }, verify: (input) => call(input.sha === artifact.releaseSha ? "restored"
    : input.frontendUrl === artifact.frontendUrl ? "acceptance" : "verify") };
}

test("successful release verifies candidate before promotion and public site after", async () => {
  const fake = fixture();
  assert.equal((await release({ artifact, sha, ...fake })).accepted, true);
  assert.deepEqual(fake.calls, ["candidate", "fly", "verify", "promote", "acceptance"]);
});

test("candidate failure leaves production alone", async () => {
  const fake = fixture("candidate");
  await assert.rejects(release({ artifact, sha, ...fake }), /candidate/);
  assert.deepEqual(fake.calls, ["candidate"]);
});

for (const [fail, restores] of [
  ["fly", ["restore-fly", "restored"]],
  ["verify", ["restore-fly", "restored"]],
  ["promote", ["restore-vercel", "restore-fly", "restored"]],
  ["acceptance", ["restore-vercel", "restore-fly", "restored"]],
]) {
  test(`${fail} failure restores exact previous artifacts and still fails CI`, async () => {
    const fake = fixture(fail);
    await assert.rejects(release({ artifact, sha, ...fake }), /RELEASE_FAILED_RECOVERED/);
    assert.deepEqual(fake.calls.slice(-restores.length), restores);
  });
}

test("a failed restore remains a blocking incident", async () => {
  const fake = fixture("promote");
  fake.provider.restoreVercel = async () => { throw new Error("restore failed"); };
  await assert.rejects(release({ artifact, sha, ...fake, recover: recoverRelease }),
    /RECOVERY_BLOCKED/);
  assert.equal(fake.calls.includes("restore-fly"), false);
});

test("missing capture or SHA fails before creating a candidate", async () => {
  for (const input of [{ artifact: { ...artifact, flyImage: "" }, sha },
    { artifact, sha: "short" }]) {
    const fake = fixture();
    await assert.rejects(release({ ...input, ...fake }));
    assert.deepEqual(fake.calls, []);
  }
});

test("candidate URL rejects insecure, unrelated or ambiguous targets", () => {
  for (const url of ["http://candidate.vercel.app", "https://kova.example",
    "https://candidate.vercel.app/path", "https://candidate.vercel.app\ntext",
    "https://vercel.app.attacker.example"]) assert.throws(() => candidateUrl(url));
});
