import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateUrl, release, releaseProvider } from "./release.mjs";
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

test("promotion explicitly assigns the public domain before public acceptance", async () => {
  const commands = [];
  const realProvider = releaseProvider("/test/private-auth", {
    env: { VERCEL_TOKEN: "test-only-token", FLY_API_TOKEN: "test-only-fly" },
    run: async (_command, args) => { commands.push(args); },
  });
  const fake = fixture();
  fake.provider.promote = realProvider.promote;
  const verify = async (input) => {
    if (input.frontendUrl === artifact.frontendUrl) {
      assert.equal(commands.length, 2);
      assert.deepEqual(commands[1].slice(2, 7),
        ["alias", "set", "https://candidate.vercel.app", "kova.example", "--global-config"]);
    }
  };
  assert.equal((await release({ artifact, sha, ...fake, verify })).accepted, true);
  assert.equal(commands[0][2], "promote");
  assert.equal(commands.flat().includes("test-only-token"), false);
});

test("a failed public domain assignment recovers before acceptance", async () => {
  const fake = fixture();
  fake.provider.promote = releaseProvider("/test/private-auth", {
    env: { VERCEL_TOKEN: "test-only-token", FLY_API_TOKEN: "test-only-fly" },
    run: async (_command, args) => {
      if (args.includes("alias")) throw new Error("domain assignment failed");
    },
  }).promote;
  await assert.rejects(release({ artifact, sha, ...fake }), /RELEASE_FAILED_RECOVERED/);
  assert.equal(fake.calls.includes("acceptance"), false);
  assert.deepEqual(fake.calls.slice(-3), ["restore-vercel", "restore-fly", "restored"]);
});

test("ambiguous public domain targets fail before any release mutation", async () => {
  for (const frontendUrl of ["https://kova.example/path", "https://user@kova.example",
    "https://kova.example?x=1", "https://kova.example#x", "https://kova.example:444"]) {
    const fake = fixture();
    await assert.rejects(release({ artifact: { ...artifact, frontendUrl }, sha, ...fake }));
    assert.deepEqual(fake.calls, []);
  }
});

test("candidate URL rejects insecure, unrelated or ambiguous targets", () => {
  for (const url of ["http://candidate.vercel.app", "https://kova.example",
    "https://candidate.vercel.app/path", "https://candidate.vercel.app\ntext",
    "https://vercel.app.attacker.example"]) assert.throws(() => candidateUrl(url));
});
