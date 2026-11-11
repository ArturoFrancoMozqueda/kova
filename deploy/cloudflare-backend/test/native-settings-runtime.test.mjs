import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";

test("the actual settings entrypoint is reachable by private RPC and never by HTTP", async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../cloudflare-native/private-settings-entry.mjs", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "worker", "browser"] });
  const ids = { STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
    STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Portal123", STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Portal123" };
  // Exercise private RPC on this repository's pinned workerd baseline. The
  // new slot's production compatibility date remains current in slot.config;
  // its complete startup/Container behavior also requires live acceptance.
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "holder", modules: true,
    script: bundled.outputFiles[0].text, compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
    bindings: { APP_DATABASE_URL: "synthetic-runtime", MIGRATION_DATABASE_URL: "synthetic-owner",
      SECRET_KEY: "synthetic-settings-key", CLOUDFLARE_API_TOKEN: "must-not-project",
      KOVA_BUILD_SHA: "b".repeat(40), ...ids },
  }, { name: "caller", modules: true, compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
    bindings: { IDS: ids }, serviceBindings: { SETTINGS: { name: "holder", entrypoint: "NativeSettings" } },
    script: `export default { async fetch(request, env) {
      const settings = await env.SETTINGS.getRuntimeEnvironment({sha: "${"a".repeat(40)}", publicIds: env.IDS});
      return Response.json({ boot: settings.KOVA_BOOT_CONTROLLER_SHA,
        runtime: settings.APP_DATABASE_URL === "synthetic-runtime",
        privileged: settings.MIGRATION_DATABASE_URL === "synthetic-owner",
        sharedKey: settings.SECRET_KEY === "synthetic-settings-key",
        deploymentTokenAbsent: settings.CLOUDFLARE_API_TOKEN === undefined,
        production: settings.APP_ENV === "production", cookiesPolicyUnchanged: settings.TRUSTED_CLIENT_IP_HEADER === "x-kova-client-ip" });
    }};`,
  }] }));
  try {
    const caller = await runtime.getWorker("caller");
    const result = await caller.fetch("https://private.test/");
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { boot: "a".repeat(40), runtime: true, privileged: true,
      sharedKey: true, deploymentTokenAbsent: true, production: true, cookiesPolicyUnchanged: true });
    const holder = await runtime.getWorker("holder");
    for (const path of ["/", "/getRuntimeEnvironment", "/NativeSettings", "/health", "/api/v1/auth/session"]) {
      const response = await holder.fetch("https://holder.test" + path);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "");
    }
  } finally { await runtime.dispose(); }
});
