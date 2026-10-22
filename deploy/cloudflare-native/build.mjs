import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { resolveAndParseConfig } from "@cloudflare/config";
import { cleanBuildOutputDir, getWorkerBundleDir, normalizeDirectoryName,
  writeRootConfig, writeWorkerConfig, writeContainerConfig, readBuildOutput } from "@cloudflare/build-output-utils";
import config from "./cloudflare.config.ts";

const root = import.meta.dirname;
const context = { isPreview: false, mode: undefined };
const parsed = await resolveAndParseConfig(config, context);
if (!parsed.success) throw new Error("Invalid native deployment configuration");
const { worker, containers, ...settings } = parsed.data;
const container = containers[0];
if (containers.length !== 1 || container.maxInstances !== 1 || container.instanceType !== "basic") {
  throw new Error("Native deployment must retain one basic instance");
}
const release = process.env.KOVA_BUILD_SHA;
const localImage = process.env.KOVA_NATIVE_IMAGE || `kova-native:${release}`;
if (!/^[a-z0-9][a-z0-9./:_-]*$/.test(localImage)) {
  throw new Error("Invalid native image reference");
}
if (!process.env.KOVA_NATIVE_IMAGE) {
  execFileSync("docker", ["build", "--platform", "linux/amd64", "--tag", localImage,
    "--build-arg", `KOVA_RELEASE_SHA=${release}`,
    "--file", resolve(root, container.image.dockerfile),
    resolve(root, container.image.buildContext)], { stdio: "inherit" });
}
// A supplied prebuilt image still must be present in this runner's Docker
// daemon. Container image identity is separately proved by runtime acceptance.
const architecture = execFileSync("docker", ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", localImage], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
if (architecture !== "linux/amd64") throw new Error("Native image must be linux/amd64");
await cleanBuildOutputDir(root);
await writeRootConfig(root, settings, context);
const bundle = getWorkerBundleDir(root);
await mkdir(bundle, { recursive: true });
await build({
  entryPoints: [resolve(root, "entry.mjs")],
  outfile: resolve(bundle, "entry.mjs"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022",
  external: ["cloudflare:workers", "node:*"],
  conditions: ["workerd", "worker", "browser"],
});
await writeWorkerConfig({ root, config: worker, manifest: {
  type: "complete", mainModule: "entry.mjs", modules: { "entry.mjs": { type: "esm" } },
} });
await writeContainerConfig({ root, directoryName: normalizeDirectoryName(container.name),
  config: { ...container, image: { localReference: localImage } },
});
await readBuildOutput(root);
console.log("Packaged resident API controller and one basic Container; production routes unchanged.");
