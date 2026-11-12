import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { resolveAndParseConfig } from "@cloudflare/config";
import { cleanBuildOutputDir, getWorkerBundleDir, writeRootConfig, writeWorkerConfig,
  readBuildOutput } from "@cloudflare/build-output-utils";
import config from "./signup-settings.config.ts";

const root = import.meta.dirname;
const context = { isPreview: false, mode: undefined };
const parsed = await resolveAndParseConfig(config, context);
if (!parsed.success) throw new Error("Invalid private signup settings configuration");
const { worker, containers, ...settings } = parsed.data;
if (containers.length) throw new Error("Signup settings must not create containers");
await cleanBuildOutputDir(root);
await writeRootConfig(root, settings, context);
const bundle = getWorkerBundleDir(root);
await mkdir(bundle, { recursive: true });
await build({ entryPoints: [resolve(root, "signup-settings.mjs")],
  outfile: resolve(bundle, "entry.mjs"), bundle: true, format: "esm", platform: "neutral",
  target: "es2022", external: ["cloudflare:workers"], conditions: ["workerd", "worker", "browser"] });
await writeWorkerConfig({ root, config: worker, manifest: {
  type: "complete", mainModule: "entry.mjs", modules: { "entry.mjs": { type: "esm" } },
} });
await readBuildOutput(root);
console.log("Packaged private signup settings; no container, public routes or secrets in output.");
