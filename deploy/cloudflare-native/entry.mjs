import { DurableObject } from "cloudflare:workers";
import { Container, ContainerProxy } from "@cloudflare/containers";
import { residentContainerClass } from "./lifecycle.mjs";
import { persistentRateLimitClass } from "./rate-limit.mjs";
import { RATE_LIMIT_HOST, JOBS_HOST, rateLimitBridge, jobsBridge } from "./policy.mjs";
import privateEntry from "./private-settings-entry.mjs";

// Attach the process to the existing api-0 object. The other fifteen names
// remain compatibility proxies; no new API namespace or session shard exists.
export class KovaApi extends residentContainerClass(Container, { retirement: true }) {}
KovaApi.outboundByHost = { [RATE_LIMIT_HOST]: rateLimitBridge, [JOBS_HOST]: jobsBridge };

export { ContainerProxy };
export class KovaRateLimit extends persistentRateLimitClass(DurableObject) {}
export { NativeSettings } from "./private-settings-entry.mjs";

// No public Worker URL is configured. External requests continue through the
// existing gateway, which sanitizes forwarding headers before calling KovaApi.
export default privateEntry;
