import { WorkerEntrypoint } from "cloudflare:workers";
import gateway from "./gateway.mjs";
import { releaseStatusClass } from "./release-status.mjs";

export class NativeReleaseStatus extends releaseStatusClass(WorkerEntrypoint) {}
export default gateway;
