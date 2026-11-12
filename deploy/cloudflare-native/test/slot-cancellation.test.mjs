import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

// Reproduce the SDK 0.3.7 pipeline in real workerd: the caller leaves during
// startup, BEFORE anyone obtains the Response. Nothing consumes/cancels its
// body unless the slot explicitly reacts to Request.signal.
test("a disconnect before headers settles the SDK pipe and slot without replaying a write", async () => {
  const source = fileURLToPath(new URL("../slot-lifecycle.mjs", import.meta.url));
  const bundled = await build({ stdin: { resolveDir: import.meta.dirname, contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {slotContainerClass} from ${JSON.stringify(source)};
    let clock=1000000;
    class SimulatedSdk extends DurableObject {
      inflight=0; dispatches=0;
      async fetch(request) {
        this.dispatches++; this.inflight++;
        await new Promise(resolve=>setTimeout(resolve,150));
        let chunks=0;
        const source=new ReadableStream({pull(controller) {
          if(chunks++===8) controller.close(); else controller.enqueue(new Uint8Array(65536));
        }});
        const {readable,writable}=new IdentityTransformStream();
        this.ctx.waitUntil(source.pipeTo(writable).catch(()=>{}).finally(()=>{this.inflight--;}));
        return new Response(readable);
      }
    }
    export class Slot extends slotContainerClass(SimulatedSdk,{now:()=>clock}) {
      async ensureReadyForRequest(){}
      async stats(){clock+=400000;return {active:this.activeResponses,
        inflight:this.inflight,dispatches:this.dispatches,...await this.drainState()};}
    }
    export default {async fetch(request,env) {
      const stub=env.API.getByName('api-0');
      if(new URL(request.url).pathname==='/stats')return Response.json(await stub.stats());
      return stub.fetch(new Request(request,{signal:request.signal}));
    }};` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "worker", "browser"] });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: bundled.outputFiles[0].text, compatibilityDate: "2026-10-17",
    compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
    bindings: { KOVA_BUILD_SHA: "a".repeat(40) },
    durableObjects: { API: { className: "Slot", useSQLite: true } },
  }));
  try {
    const origin = await runtime.ready;
    const abort = new AbortController();
    const response = fetch(new URL("/api/v1/sales", origin), { method: "POST", body: "unchanged",
      headers: { "Idempotency-Key": "synthetic-once" }, signal: abort.signal });
    const rejected = assert.rejects(response, error => error.name === "AbortError");
    // The simulated SDK dispatch has begun, but cannot have returned headers.
    await new Promise(resolve => setTimeout(resolve, 60));
    abort.abort(); await rejected;
    await new Promise(resolve => setTimeout(resolve, 250));
    const stats = await (await runtime.dispatchFetch("https://private.test/stats")).json();
    assert.equal(stats.dispatches, 1);
    assert.equal(stats.active, 0, "a cancelled late response must not pin the slot's drain counter");
    assert.equal(stats.inflight, 0, "cancelling the readable must release the SDK pipe");
    assert.equal(stats.replaceable, true);
  } finally { await runtime.dispose(); }
});
