import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { cleanBuildOutputDir, getWorkerBundleDir, writeAssets,
  writeRootConfig, writeWorkerConfig, readBuildOutput } from "@cloudflare/build-output-utils";
import config from "./cloudflare.config.ts";
import { headerRules, securityHeaders } from "./policy.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const source = process.env.KOVA_ASSETS_DIR
  ? resolve(process.env.KOVA_ASSETS_DIR) : resolve(root, "../../frontend/dist");
for (const filename of ["index.html", "app-shell.html", "sw.js", "version.json"]) {
  await readFile(resolve(source, filename));
}
const shell = await readFile(resolve(source, "app-shell.html"), "utf8");
if (!shell.includes('<div id="root"></div>')) throw new Error("Expected empty app shell");

await cleanBuildOutputDir(root);
await writeRootConfig(root, { accountId: process.env.CLOUDFLARE_ACCOUNT_ID }, { isPreview: false });
await writeAssets({ root, sourceDirectory: source });
const bundle = getWorkerBundleDir(root);
await mkdir(bundle, { recursive: true });
await build({
  entryPoints: [resolve(root, "worker.mjs")], outfile: resolve(bundle, "worker.mjs"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022",
});
await writeWorkerConfig({ root, config: config.worker, manifest: {
  type: "complete", mainModule: "worker.mjs",
  modules: { "worker.mjs": { type: "esm" } },
} });

// Assets served directly never invoke the Worker (and don't consume its quota).
// _headers covers those responses; the Worker applies the same policy to API/HTML.
const headers = headerRules.map(rule => {
  const pattern = rule.source.replaceAll("(.*)", "*");
  return `${pattern}\n${rule.headers.map(({ key, value }) =>
    `  ${key}: ${securityHeaders[key] ?? value}`).join("\n")}`;
}).join("\n\n");
await writeFile(resolve(root, ".cloudflare/output/v0/workers/default/assets/_headers"),
  `${headers}\n\n/\n  Cache-Control: no-cache\n\n/*.html\n  Cache-Control: no-cache\n` +
  "\nhttps://preview.kovasuite.com/*\n  X-Robots-Tag: noindex, nofollow\n");
await readBuildOutput(root);
console.log("Cloudflare artifact validated: frontend assets + API proxy; no database credentials.");
