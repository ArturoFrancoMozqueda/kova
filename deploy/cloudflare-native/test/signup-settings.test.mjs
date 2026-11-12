import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

test("signup settings extend only four reviewed fields over private RPC, never HTTP", async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../signup-settings.mjs", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    external: ["cloudflare:workers"], conditions: ["workerd", "worker", "browser"] });
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "original", modules: true, compatibilityDate: "2026-10-17", script: `
      import {WorkerEntrypoint} from 'cloudflare:workers';
      export class Original extends WorkerEntrypoint {getRuntimeEnvironment(input) {
        if (Object.keys(input).sort().join(',') !== 'publicIds,sha') throw new Error('invalid');
        return {KOVA_BOOT_CONTROLLER_SHA: input.sha,SECRET_KEY:'original-only',
          APP_DATABASE_URL:'original-database',WHATSAPP_APP_SECRET:'original-meta'};
      }}; export default {fetch(){return new Response(null,{status:404});}};` },
    { name: "settings", modules: true, compatibilityDate: "2026-10-17",
      script: bundled.outputFiles[0].text,
      serviceBindings: { ORIGINAL: { name: "original", entrypoint: "Original" } },
      bindings: { WHATSAPP_APP_ID: "123", WHATSAPP_SIGNUP_CONFIG_ID: "456",
        WHATSAPP_SIGNUP_ENABLED: "true", WHATSAPP_CREDENTIALS_KEY: "synthetic-root",
        SECRET_KEY: "must-not-override", KOVA_BOOT_CONTROLLER_SHA: "must-not-override",
        CLOUDFLARE_API_TOKEN: "must-not-project" } },
    { name: "caller", modules: true, compatibilityDate: "2026-10-17",
      serviceBindings: { SETTINGS: { name: "settings", entrypoint: "SignupSettings" } },
      script: `export default {async fetch(request,env){const value=await env.SETTINGS.getRuntimeEnvironment({
        sha:'${"a".repeat(40)}',publicIds:{}});return Response.json(value);}};` },
  ] }));
  try {
    const caller = await runtime.getWorker("caller");
    const result = await (await caller.fetch("https://private.test/")).json();
    assert.equal(result.SECRET_KEY, "original-only");
    assert.equal(result.APP_DATABASE_URL, "original-database");
    assert.equal(result.WHATSAPP_APP_SECRET, "original-meta");
    assert.equal(result.KOVA_BOOT_CONTROLLER_SHA, "a".repeat(40));
    assert.equal(result.WHATSAPP_CREDENTIALS_KEY, "synthetic-root");
    assert.equal(result.WHATSAPP_SIGNUP_CONFIG_ID, "456");
    assert.equal(result.CLOUDFLARE_API_TOKEN, undefined);
    const settings = await runtime.getWorker("settings");
    for (const path of ["/", "/getRuntimeEnvironment", "/SignupSettings"]) {
      const response = await settings.fetch("https://private.test" + path);
      assert.equal(response.status, 404); assert.equal(await response.text(), "");
    }
  } finally { await runtime.dispose(); }
});
