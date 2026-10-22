import assert from "node:assert/strict";
import { test } from "node:test";
import { FrontendCommitMismatch } from "./verify-deployment.mjs";
import { candidateUrl, release, releaseProvider } from "./release.mjs";
import { recoverRelease } from "./release-recovery.mjs";

const artifact = {
  releaseSha: "a".repeat(40), cloudflareBackendVersions: Object.fromEntries(["kova-backend-jobs", "kova-backend", "kova-backend-gateway"].map(name => [name, "dcad4869-ba1d-43d4-865b-66349697bd7c"])),
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
    deployBackend: () => call("backend"), promote: () => call("promote"),
    waitForPublicBackend: async () => {},
    restoreVercel: () => call("restore-vercel"), restoreCloudflareBackend: () => call("restore-backend"),
  }, verify: (input) => call(input.sha === artifact.releaseSha ? "restored"
    : input.frontendUrl === artifact.frontendUrl ? "acceptance" : "verify") };
}

test("successful release verifies candidate before promotion and public site after", async () => {
  const fake = fixture();
  assert.equal((await release({ artifact, sha, ...fake })).accepted, true);
  assert.deepEqual(fake.calls, ["candidate", "backend", "verify", "promote", "acceptance"]);
});

test("backend publication receives the validated previous artifact identity", async () => {
  const fake = fixture();
  fake.provider.deployBackend = async (target, previous) => {
    assert.equal(target, sha);
    assert.equal(previous, artifact.releaseSha);
  };
  assert.equal((await release({ artifact, sha, ...fake })).accepted, true);
});

test("candidate failure leaves production alone", async () => {
  const fake = fixture("candidate");
  await assert.rejects(release({ artifact, sha, ...fake }), /candidate/);
  assert.deepEqual(fake.calls, ["candidate"]);
});

for (const [fail, restores] of [
  ["backend", ["restore-backend", "restored"]],
  ["verify", ["restore-backend", "restored"]],
  ["promote", ["restore-vercel", "restore-backend", "restored"]],
  ["acceptance", ["restore-vercel", "restore-backend", "restored"]],
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
  assert.equal(fake.calls.includes("restore-backend"), false);
});

test("a failed recovery preserves the original acceptance error for diagnosis", async () => {
  const fake = fixture("acceptance");
  fake.provider.restoreVercel = async () => { throw new Error("recovery transport failed"); };
  await assert.rejects(release({ artifact, sha, ...fake }), error => {
    assert.ok(error instanceof globalThis.AggregateError);
    assert.match(error.message, /RECOVERY_BLOCKED/);
    assert.equal(error.errors[0].message, "acceptance");
    assert.match(error.errors[1].message, /recovery transport failed/);
    return true;
  });
});

test("Cloudflare waits for publication readiness before strict public acceptance", async () => {
  const fake = fixture();
  fake.provider.requiresCloudflare = true;
  fake.provider.waitForPublicFrontend = async input => {
    assert.equal(input.sha, sha);
    assert.equal(input.previousSha, artifact.releaseSha);
    fake.calls.push("ready");
  };
  await release({ artifact: { ...artifact, cloudflareVersion: "dcad4869-ba1d-43d4-865b-66349697bd7c" }, sha, ...fake });
  assert.deepEqual(fake.calls.slice(-2), ["ready", "acceptance"]);
});

test("missing Cloudflare readiness support fails before creating a candidate", async () => {
  await assert.rejects(release({ artifact: { ...artifact,
    cloudflareVersion: "dcad4869-ba1d-43d4-865b-66349697bd7c" }, sha,
    provider: { requiresCloudflare: true, createCandidate: assert.fail },
  }), /readiness verification/);
});

const backendVersions = Object.fromEntries(["kova-backend-jobs", "kova-backend", "kova-backend-gateway"]
  .map(name => [name, "dcad4869-ba1d-43d4-865b-66349697bd7c"]));

test("Cloudflare waits for the new backend before verifying or promoting the candidate", async () => {
  const fake = fixture();
  fake.provider.requiresCloudflareBackend = true;
  fake.provider.waitForPublicBackend = async input => {
    const frontendUrl = fake.calls.includes("promote")
      ? artifact.frontendUrl : "https://candidate.vercel.app";
    assert.deepEqual(input, { backendUrl: artifact.backendUrl, frontendUrl, sha,
      previousSha: artifact.releaseSha,
      ...(fake.calls.includes("promote") ? {} : {
        frontendBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      }) });
    fake.calls.push("backend-ready");
  };
  await release({ artifact: { ...artifact, cloudflareBackendVersions: backendVersions }, sha, ...fake });
  assert.deepEqual(fake.calls, ["candidate", "backend", "backend-ready", "verify", "promote", "backend-ready", "acceptance"]);
});

test("missing backend readiness support blocks publication and recovery before mutations", async () => {
  const captured = { ...artifact, cloudflareBackendVersions: backendVersions };
  await assert.rejects(release({ artifact: captured, sha,
    provider: { requiresCloudflareBackend: true, createCandidate: assert.fail } }), /readiness verification/);
  await assert.rejects(recoverRelease({ phase: "candidate", artifact: captured,
    provider: { requiresCloudflareBackend: true, restoreCloudflareBackend: assert.fail },
    verify: assert.fail }), /readiness verification/);
});

test("failed backend readiness restores and waits for the exact old backend before verification", async () => {
  const fake = fixture();
  fake.provider.requiresCloudflareBackend = true;
  fake.provider.restoreCloudflareBackend = async versions => {
    assert.deepEqual(versions, backendVersions);
    fake.calls.push("restore-backend");
  };
  fake.provider.waitForPublicBackend = async input => {
    if (input.sha === sha) {
      fake.calls.push("new-readiness-failed");
      throw new Error("new backend did not propagate");
    }
    assert.deepEqual(input, { frontendUrl: artifact.frontendUrl, backendUrl: artifact.backendUrl,
      sha: artifact.releaseSha, previousSha: sha });
    fake.calls.push("restored-ready");
  };
  await assert.rejects(release({ artifact: { ...artifact, cloudflareBackendVersions: backendVersions },
    sha, ...fake }), /RELEASE_FAILED_RECOVERED/);
  assert.deepEqual(fake.calls, ["candidate", "backend", "new-readiness-failed", "restore-backend", "restored-ready", "restored"]);
});

test("missing capture or SHA fails before creating a candidate", async () => {
  for (const input of [{ artifact: { ...artifact, cloudflareBackendVersions: undefined }, sha },
    { artifact, sha: "short" }]) {
    const fake = fixture();
    await assert.rejects(release({ ...input, ...fake }));
    assert.deepEqual(fake.calls, []);
  }
});

test("promotion explicitly assigns the public domain before public acceptance", async () => {
  const commands = [];
  const realProvider = releaseProvider("/test/private-auth", {
    env: { VERCEL_TOKEN: "test-only-token", KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cf", CLOUDFLARE_ACCOUNT_ID: "test-account" },
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
    env: { VERCEL_TOKEN: "test-only-token", KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cf", CLOUDFLARE_ACCOUNT_ID: "test-account" },
    run: async (_command, args) => {
      if (args.includes("alias")) throw new Error("domain assignment failed");
    },
  }).promote;
  await assert.rejects(release({ artifact, sha, ...fake }), /RELEASE_FAILED_RECOVERED/);
  assert.equal(fake.calls.includes("acceptance"), false);
  assert.deepEqual(fake.calls.slice(-3), ["restore-vercel", "restore-backend", "restored"]);
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

test("new frontend readiness may regress to captured previous at final acceptance without bypass headers", async () => {
  const fake = fixture();
  fake.provider.requiresCloudflare = true;
  fake.provider.waitForPublicFrontend = async () => { fake.calls.push("ready-new"); };
  let publicCalls = 0;
  const deadlines = [];
  fake.verify = async input => {
    if (input.frontendUrl !== artifact.frontendUrl) {
      assert.equal(Object.hasOwn(input, "frontendBypassSecret"), true);
      fake.calls.push("verify");
      return;
    }
    assert.equal(Object.hasOwn(input, "frontendBypassSecret"), false);
    deadlines.push(input.deadline);
    publicCalls++;
    fake.calls.push(publicCalls === 1 ? "acceptance-previous" : "acceptance-new");
    if (publicCalls === 1) throw new FrontendCommitMismatch(sha, artifact.releaseSha.slice(0, 12));
  };
  const result = await release({ artifact: { ...artifact,
    cloudflareVersion: "dcad4869-ba1d-43d4-865b-66349697bd7c" }, sha, ...fake });
  assert.equal(result.accepted, true);
  assert.deepEqual(deadlines, [deadlines[0], deadlines[0]]);
  assert.deepEqual(fake.calls, ["candidate", "backend", "verify", "promote",
    "ready-new", "acceptance-previous", "acceptance-new"]);
});
