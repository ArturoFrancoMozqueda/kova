import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { cleanBuildOutputDir, getWorkerBundleDir, writeRootConfig,
  writeWorkerConfig, readBuildOutput } from "@cloudflare/build-output-utils";
import { gateway } from "./cloudflare.config.ts";

// Stage/promote only the gateway. Never rebuild Python or alter an API image
// when changing which already-verified native slot receives public requests.
const root = import.meta.dirname;
await cleanBuildOutputDir(root);
await writeRootConfig(root, {}, { isPreview: false });
const bundle = getWorkerBundleDir(root);
await mkdir(bundle, { recursive: true });
await build({ entryPoints: [resolve(root, "gateway-entry.mjs")], outfile: resolve(bundle, "gateway.mjs"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["node:*", "cloudflare:workers"],
});
await writeWorkerConfig({ root, config: gateway.worker, manifest: {
  type: "complete", mainModule: "gateway.mjs", modules: { "gateway.mjs": { type: "esm" } },
} });
await readBuildOutput(root);
