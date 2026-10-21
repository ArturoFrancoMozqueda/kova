import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForNativeBackendRelease } from "./cloudflare-native-readiness.mjs";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const process = "c".repeat(32);
const ready = (release = sha, headers = {}) => Response.json({ status: "ok", release_sha: release }, {
  headers: { "x-kova-runtime": "native-resident", "x-kova-process-id": process, ...headers },
});
const options = { backendUrl: "https://api.example.test", sha, previousSha };

test("first provisioning 503 retries without accepting it as readiness", async () => {
  let time = 0;
  let calls = 0;
  const sleeps = [];
  await waitForNativeBackendRelease({ ...options, now: () => time,
    wait: async ms => { sleeps.push(ms); time += ms; },
    fetcher: async () => ++calls < 4 ? new Response(null, { status: 503 }) : ready(),
  });
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 1000, 1000]);
});

test("both direct and proxy endpoints must converge on the native SHA and same process", async () => {
  let time = 0;
  let attempt = 0;
  const seen = [];
  await waitForNativeBackendRelease({ ...options, frontendUrl: "https://candidate.example.test",
    frontendBypassSecret: "synthetic-bypass", now: () => time,
    wait: async ms => { time += ms; attempt++; },
    fetcher: async (url, init) => {
      seen.push([url.href, init.headers]);
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["cache-control"], "no-cache");
      if (url.hostname === "candidate.example.test") {
        assert.equal(init.headers["x-vercel-protection-bypass"], "synthetic-bypass");
        if (attempt === 0) return ready(previousSha);
        if (attempt === 1) return ready(sha, { "x-kova-process-id": "d".repeat(32) });
      } else assert.equal(init.headers["x-vercel-protection-bypass"], undefined);
      return ready();
    },
  });
  assert.equal(attempt, 2);
  assert.ok(seen.some(([url]) => url.endsWith("/api/health")));
  assert.ok(seen.some(([url]) => url.endsWith("/health")));
});

test("same commit on previous Python runtime does not pass native acceptance", async () => {
  let time = 0;
  let calls = 0;
  await waitForNativeBackendRelease({ ...options, now: () => time,
    wait: async ms => { time += ms; },
    fetcher: async () => ++calls === 1 ? Response.json({ status: "ok", release_sha: sha }) : ready(),
  });
  assert.equal(calls, 2);
});

test("foreign SHA, malformed data, wrong identity and non503 errors fail immediately", async () => {
  for (const response of [
    ready("e".repeat(40)), new Response("not-json"), Response.json({ status: "wrong", release_sha: sha }),
    ready(sha, { "x-kova-runtime": "unexpected" }), ready(sha, { "x-kova-process-id": "invalid" }),
    ...[401, 403, 429, 500, 502].map(status => new Response(null, { status })),
  ]) {
    let calls = 0;
    await assert.rejects(() => waitForNativeBackendRelease({ ...options,
      fetcher: async () => { calls++; return response; },
      wait: () => assert.fail("Invalid response must not be retried"),
    }));
    assert.equal(calls, 1);
  }
});

test("persistent503 is bounded by five minutes and fixed attempt ceiling", async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(() => waitForNativeBackendRelease({ ...options, now: () => time,
    wait: async ms => { time += ms; },
    fetcher: async () => { calls++; return new Response(null, { status: 503 }); },
  }), /five minutes/);
  assert.equal(time, 300_000);
  assert.equal(calls, 300);
  calls = 0;
  await assert.rejects(() => waitForNativeBackendRelease({ ...options, now: () => 0,
    wait: async () => {}, fetcher: async () => { calls++; return new Response(null, { status: 503 }); },
  }), /five minutes/);
  assert.equal(calls, 300, "clock anomalies must not create an unbounded loop");
});
