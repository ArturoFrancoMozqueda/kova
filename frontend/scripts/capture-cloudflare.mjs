import fs from "node:fs";
import { cloudflareProvider } from "./cloudflare-provider.mjs";
import { cloudflareBackendProvider } from "./cloudflare-backend-provider.mjs";
import { runProviderCommand } from "./release-recovery.mjs";

// Keep the executable entry point separate from the provider imported by recovery.
// Importing recovery from the provider's top-level await creates an ESM deadlock.
if (!process.argv[2]) throw new Error("Usage: node capture-cloudflare.mjs <rollback-artifact>");
const provider = cloudflareProvider({ run: runProviderCommand, env: process.env });
const backend = cloudflareBackendProvider({ run: runProviderCommand, env: process.env });
if (provider) {
  const artifact = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  artifact.cloudflareVersion = await provider.capture();
  fs.writeFileSync(process.argv[2], JSON.stringify(artifact, null, 2) + "\n");
  console.log("Captured current Cloudflare version for exact rollback.");
}
if (backend) {
  const artifact = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  artifact.cloudflareBackendVersions = await backend.capture();
  if (backend.requiresNativeContainer) artifact.cloudflareNativeContainer = await backend.captureNative();
  fs.writeFileSync(process.argv[2], JSON.stringify(artifact, null, 2) + "\n");
  console.log("Captured all three Cloudflare backend versions for exact rollback.");
}
