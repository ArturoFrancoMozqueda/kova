import fs from "node:fs";
import { cloudflareBackendProvider } from "./cloudflare-backend-provider.mjs";
import { runProviderCommand, validateRollbackArtifact } from "./release-recovery.mjs";

if (!process.argv[2]) throw new Error("A persisted rollback artifact is required");
const backend = cloudflareBackendProvider({ run: runProviderCommand, env: process.env });
if (!backend?.requiresBlueGreen) throw new Error("Native independent publication must be enabled");
const artifact = validateRollbackArtifact(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
await backend.prepareSlots(artifact);
// Capture the exact unchanged serving image/process and stable control plane
// after the initial private bootstrap, before publishing any candidate API.
artifact.cloudflareBackendVersions = await backend.capture();
artifact.cloudflareNativeSlots = await backend.captureSlots(artifact.releaseSha);
fs.writeFileSync(process.argv[2], JSON.stringify(artifact, null, 2) + "\n");
console.log("Captured the independent API slots; serving image and process verified.");
