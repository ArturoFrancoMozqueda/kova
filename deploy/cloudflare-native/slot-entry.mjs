import { Container, ContainerProxy } from "@cloudflare/containers";
import { slotContainerClass } from "./slot-lifecycle.mjs";
import { RATE_LIMIT_HOST, JOBS_HOST, rateLimitBridge, jobsBridge } from "./policy.mjs";

export class KovaApi extends slotContainerClass(Container) {}
KovaApi.outboundByHost = { [RATE_LIMIT_HOST]: rateLimitBridge, [JOBS_HOST]: jobsBridge };
export { ContainerProxy };
export default { fetch() { return new Response(null, { status: 404 }); } };
