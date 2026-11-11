import { WorkerEntrypoint } from "cloudflare:workers";
import { runtimeSettingsClass } from "./runtime-settings.mjs";

export class NativeSettings extends runtimeSettingsClass(WorkerEntrypoint) {}
export default { fetch() { return new Response(null, { status: 404 }); } };
