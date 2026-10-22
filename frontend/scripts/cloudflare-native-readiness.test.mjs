import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForNativeBackendRelease } from "./cloudflare-native-readiness.mjs";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const process = "c".repeat(32);
const ready = (release = sha, headers = {}) => globalThis.Response.json({ status: "ok", release_sha: release }, {
  headers: { "x-kova-runtime": "native-resident", "x-kova-process-id": process, ...headers },
});
const options = { backendUrl: "https://api.example.test", sha, previousSha };

test("first provisioning 503 retries without accepting it as readiness", async () => {
  let time = 0;
  let calls = 0;
  const sleeps = [];
  await waitForNativeBackendRelease({ ...options, now: () => time,
    wait: async ms => { sleeps.push(ms); time += ms; },
    fetcher: async () => ++calls < 4 ? new globalThis.Response(null, { status: 503 }) : ready(),
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
    fetcher: async () => ++calls === 1 ? globalThis.Response.json({ status: "ok", release_sha: sha }) : ready(),
  });
  assert.equal(calls, 2);
});

test("foreign SHA, malformed data, wrong identity and non503 errors fail immediately", async () => {
  for (const response of [
    ready("e".repeat(40)), new globalThis.Response("not-json"), globalThis.Response.json({ status: "wrong", release_sha: sha }),
    ready(sha, { "x-kova-runtime": "unexpected" }), ready(sha, { "x-kova-process-id": "invalid" }),
    ...[401, 403, 429, 500, 502].map(status => new globalThis.Response(null, { status })),
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
    fetcher: async () => { calls++; return new globalThis.Response(null, { status: 503 }); },
  }), /five minutes/);
  assert.equal(time, 300_000);
  assert.equal(calls, 300);
  calls = 0;
  await assert.rejects(() => waitForNativeBackendRelease({ ...options, now: () => 0,
    wait: async () => {}, fetcher: async () => { calls++; return new globalThis.Response(null, { status: 503 }); },
  }), /five minutes/);
  assert.equal(calls, 300, "clock anomalies must not create an unbounded loop");
});

test("rollout waits through observed provider propagation and still verifies both endpoints", async () => {
  let time = 0;
  let calls = 0;
  const targets = [];
  await waitForNativeBackendRelease({ ...options, rollout: true,
    frontendUrl: "https://candidate.example.test", now: () => time,
    wait: async ms => { time += ms; },
    fetcher: async url => {
      targets.push(url.pathname);
      if (++calls === 1) { time += 1_500_000; return ready(previousSha); }
      return ready();
    },
  });
  assert.equal(time, 1_501_000);
  assert.deepEqual(targets, ["/health", "/health", "/health", "/api/health"]);
});

test("rollout deadline and attempt ceiling remain bounded even with a frozen clock", async () => {
  for (const advancing of [true, false]) {
    let time = 0;
    let calls = 0;
    await assert.rejects(waitForNativeBackendRelease({ ...options, rollout: true,
      now: () => time, wait: async ms => { if (advancing) time += ms; },
      fetcher: async () => { calls++; return ready(previousSha); },
    }), /within thirty minutes/);
    assert.equal(calls, 1800);
    assert.equal(time, advancing ? 1_800_000 : 0);
  }
});

test("rollout budget never retries a foreign image or an application error", async () => {
  for (const response of [ready("d".repeat(40)), new globalThis.Response(null, { status: 500 })]) {
    let calls = 0;
    await assert.rejects(waitForNativeBackendRelease({ ...options, rollout: true,
      fetcher: async () => { calls++; return response; }, wait: assert.fail,
    }));
    assert.equal(calls, 1);
  }
});

test("initial provisioning reaches the direct native process before probing the frontend rewrite", async () => {
  let time = 0;
  let directCalls = 0;
  const sequence = [];
  await waitForNativeBackendRelease({ ...options, frontendUrl: "https://candidate.example.test",
    now: () => time, wait: async ms => { time += ms; },
    fetcher: async url => {
      if (url.hostname === "api.example.test") {
        sequence.push("direct");
        directCalls++;
        if (directCalls === 1) return new globalThis.Response(null, { status: 503 });
        if (directCalls === 2) return globalThis.Response.json({ status: "ok", release_sha: sha });
      } else {
        sequence.push("proxy");
        assert.ok(directCalls >= 3, "proxy must not receive the first cold-start request");
      }
      return ready();
    },
  });
  assert.deepEqual(sequence, ["direct", "direct", "direct", "direct", "proxy"]);
});

test("long first boot has a190second request cap bounded by the original five-minute deadline", async t => {
  let time = 0;
  let calls = 0;
  const timeouts = [];
  t.mock.method(globalThis.AbortSignal, "timeout", ms => {
    timeouts.push(ms);
    return new globalThis.AbortController().signal;
  });
  await waitForNativeBackendRelease({ ...options, frontendUrl: "https://candidate.example.test",
    now: () => time, wait: async ms => { time += ms; },
    fetcher: async () => {
      if (++calls === 1) { time += 180_000; return new globalThis.Response(null, { status: 503 }); }
      return ready();
    },
  });
  assert.deepEqual(timeouts, [190_000, 119_000, 119_000, 119_000]);
  assert.equal(time, 181_000);
});

test("frontend verification does not receive a fresh deadline after slow direct readiness", async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(() => waitForNativeBackendRelease({ ...options,
    frontendUrl: "https://candidate.example.test", now: () => time,
    wait: () => assert.fail("The original deadline has already expired"),
    fetcher: async () => {
      time += ++calls === 1 ? 299_000 : 2_000;
      return ready();
    },
  }), /five minutes/);
  assert.equal(calls, 2);
});

test("identified HTTP500 diagnostics use fixed categories and literal SDK signatures without retry", async () => {
  const cases = [
    ["Container suddenly disconnected, try again", "sdk-disconnected"],
    ["Container suddenly disconnected, try again SECRET", "unknown"],
    ["Failed to start container: SECRET https://private.invalid", "sdk-start-failed"],
    ["Error proxying request to container: SECRET access_token=private", "sdk-proxy-failed"],
    ["error code: 1101", "cloudflare-1101"],
    ["error code: 1102\n", "cloudflare-1102"],
    ["SECRET mentions error code: 1101", "unknown"],
    ["arbitrary SECRET Cookie: session=private https://private.invalid", "unknown"],
  ];
  for (const [body, signature] of cases) {
    let calls = 0;
    await assert.rejects(() => waitForNativeBackendRelease({ ...options,
      fetcher: async () => {
        calls++;
        return new globalThis.Response(body, { status: 500, headers: {
          "content-type": "text/plain; charset=utf-8", "set-cookie": "SECRET",
          "x-kova-runtime": "SECRET", "x-kova-process-id": "https://private.invalid",
        } });
      },
      wait: () => assert.fail("Every HTTP500 must still fail without retry"),
    }), error => {
      assert.equal(error.message, "Native readiness failed: HTTP 500 target=direct content=text "
        + `runtime=present process=present signature=${signature} body=end`);
      assert.doesNotMatch(error.message, /SECRET|private|Cookie|https:/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("proxy failures identify only the proxy enum and MIME category, never URL or bypass", async () => {
  let calls = 0;
  await assert.rejects(() => waitForNativeBackendRelease({ ...options,
    frontendUrl: "https://SECRET.invalid", frontendBypassSecret: "PRIVATE-BYPASS",
    fetcher: async url => {
      calls++;
      return url.pathname === "/api/health"
        ? new globalThis.Response("SECRET", { status: 500,
          headers: { "content-type": "application/problem+json" } }) : ready();
    },
    wait: () => assert.fail("Proxy HTTP500 must not be retried"),
  }), error => {
    assert.equal(error.message, "Native readiness failed: HTTP 500 target=proxy content=json "
      + "runtime=missing process=missing signature=unknown body=end");
    assert.doesNotMatch(error.message, /SECRET|PRIVATE|https:/);
    return true;
  });
  assert.equal(calls, 3);
});

test("diagnostics inspect at most512bytes and always cancel the response stream", async () => {
  let cancelled = 0;
  const encoder = new globalThis.TextEncoder();
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("x".repeat(512) + "error code: 1101 SECRET"));
    },
    cancel() { cancelled++; },
  });
  await assert.rejects(() => waitForNativeBackendRelease({ ...options,
    fetcher: async () => new globalThis.Response(stream, { status: 500,
      headers: { "content-type": "text/html" } }),
    wait: () => assert.fail("HTTP500 cannot retry after a prefix read"),
  }), /target=direct content=html runtime=missing process=missing signature=unknown body=prefix$/);
  assert.equal(cancelled, 1);
});

test("stalled error streams are cancelled within the bounded diagnostic timeout", async () => {
  let cancelled = 0;
  const stream = new globalThis.ReadableStream({ cancel() { cancelled++; } });
  const started = Date.now();
  await assert.rejects(() => waitForNativeBackendRelease({ ...options,
    fetcher: async () => new globalThis.Response(stream, { status: 500 }),
    wait: () => assert.fail("Stalled HTTP500 cannot become a retry"),
  }), /signature=unknown body=timeout$/);
  assert.ok(Date.now() - started < 1000, "Diagnostic cannot wait for the190s request deadline");
  assert.equal(cancelled, 1);
});

test("diagnostic timeout respects the existing remaining deadline even when cancellation stalls", async t => {
  let time = 0;
  let cancelled = 0;
  const timers = [];
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    timers.push(ms);
    return setTimeout(callback, 0);
  });
  const reader = {
    read: () => new Promise(() => {}),
    cancel: () => { cancelled++; return new Promise(() => {}); },
    releaseLock: () => {},
  };
  await assert.rejects(() => waitForNativeBackendRelease({ ...options, now: () => time,
    fetcher: async () => {
      time = 299_990;
      return { status: 500, ok: false, headers: new globalThis.Headers(),
        body: { getReader: () => reader } };
    },
    wait: () => assert.fail("Deadline never creates a retry for HTTP500"),
  }), /HTTP 500.*body=timeout$/);
  assert.deepEqual(timers, [10]);
  assert.equal(cancelled, 1);
});

test("unreadable error bodies and arbitrary content types still give only enums", async () => {
  let cancelled = 0;
  const stream = new globalThis.ReadableStream({
    pull(controller) { controller.error(new Error("SECRET body read error")); },
    cancel() { cancelled++; },
  });
  await assert.rejects(() => waitForNativeBackendRelease({ ...options,
    fetcher: async () => new globalThis.Response(stream, { status: 500,
      headers: { "content-type": "SECRET/PRIVATE" } }),
  }), error => {
    assert.match(error.message, /content=other.*signature=unknown body=unreadable$/);
    assert.doesNotMatch(error.message, /SECRET|PRIVATE/);
    return true;
  });
  // An already errored stream rejects cancel instead of invoking its source;
  // the diagnostic absorbs that failure and still returns the original500.
  assert.equal(cancelled, 0);
});

const sdkProxyFailure = (headers = {}) => new globalThis.Response(
  "Error proxying request to container: SECRET internal variable suffix",
  { status: 500, headers: { "content-type": "text/plain; charset=utf-8", ...headers } },
);

test("observed SDK proxy handoff500 waits through503 and previousSHA until both hops converge", async () => {
  let time = 0;
  let directCalls = 0;
  let proxyCalls = 0;
  const sleeps = [];
  await waitForNativeBackendRelease({ ...options, frontendUrl: "https://candidate.example.test",
    now: () => time, wait: async ms => { sleeps.push(ms); time += ms; },
    fetcher: async url => {
      if (url.pathname === "/api/health") {
        proxyCalls++;
        return proxyCalls === 1 ? sdkProxyFailure() : ready();
      }
      directCalls++;
      if (directCalls === 1) return sdkProxyFailure();
      if (directCalls === 2) return new globalThis.Response(null, { status: 503 });
      if (directCalls === 3) return ready(previousSha);
      return ready();
    },
  });
  assert.equal(directCalls, 6);
  assert.equal(proxyCalls, 2);
  assert.deepEqual(sleeps, [1000, 1000, 1000, 1000]);
});

test("SDK-like500 from an application, non-text response or another SDK error fails immediately", async () => {
  const failures = [
    sdkProxyFailure({ "x-kova-runtime": "native-resident" }),
    sdkProxyFailure({ "x-kova-process-id": process }),
    sdkProxyFailure({ "x-kova-runtime": "" }),
    sdkProxyFailure({ "x-kova-process-id": "" }),
    sdkProxyFailure({ "content-type": "application/json" }),
    sdkProxyFailure({ "content-type": "text/html" }),
    ...["Failed to start container: SECRET", "Container suddenly disconnected, try again",
      "error code: 1101", "error code: 1102", "Internal Server Error",
      "Error proxying request to containers: SECRET",
      "\ufeffError proxying request to container: SECRET"].map(body => new globalThis.Response(
      body, { status: 500, headers: { "content-type": "text/plain" } },
    )),
  ];
  for (const response of failures) {
    let calls = 0;
    await assert.rejects(() => waitForNativeBackendRelease({ ...options,
      fetcher: async () => { calls++; return response; },
      wait: () => assert.fail("Only the exact unidentified plain SDK proxy handoff can retry"),
    }), error => {
      assert.match(error.message, /Native readiness failed: HTTP 500/);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("persistent SDK proxy500 is never ready and exhausts the same five-minute/300-attempt budget", async () => {
  for (const advancingClock of [true, false]) {
    let time = 0;
    let calls = 0;
    await assert.rejects(() => waitForNativeBackendRelease({ ...options,
      now: () => time, wait: async ms => { if (advancingClock) time += ms; },
      fetcher: async () => { calls++; return sdkProxyFailure(); },
    }), error => {
      assert.match(error.message, /did not finish within five minutes.*signature=sdk-proxy-failed/);
      assert.doesNotMatch(error.message, /SECRET|internal variable/);
      return true;
    });
    assert.equal(calls, 300);
    assert.equal(time, advancingClock ? 300_000 : 0);
  }
});

test("candidate and recovery readiness share the native provider helper with unchanged acceptance", async () => {
  const { cloudflareBackendProvider } = await import("./cloudflare-backend-provider.mjs");
  const { nativeContainerIdentity } = await import("./cloudflare-container-provider.mjs");
  const checks = [];
  const provider = cloudflareBackendProvider({
    env: { KOVA_CLOUDFLARE_BACKEND: "1", KOVA_NATIVE_BACKEND: "1",
      CLOUDFLARE_API_TOKEN: "synthetic-not-real", CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId },
    run: async (command, args) => { checks.push([command, args]); },
  });
  for (const phase of ["candidate", "recovery"]) {
    let calls = 0;
    let time = 0;
    const targetSha = phase === "candidate" ? sha : previousSha;
    await provider.waitForPublicBackend({ ...options, nativeRuntime: true,
      sha: targetSha, previousSha: phase === "candidate" ? previousSha : sha,
      now: () => time, wait: async ms => { time += ms; },
      fetcher: async () => {
        if (++calls === 1) { time += 360_000; return sdkProxyFailure(); }
        return ready(targetSha);
      },
    });
    assert.equal(calls, 2);
  }
  assert.equal(checks.length, 2);
  for (const [command, args] of checks) {
    assert.equal(command, "python3");
    assert.ok(args[0].endsWith("/scripts/check_native_resident.py"));
    assert.ok(args.includes("--check-private-bindings"));
  }
});
