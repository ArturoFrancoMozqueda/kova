import { NATIVE_INSTANCE, nativeEnvironment, privateResponse, publicPath, unavailable } from "./policy.mjs";

async function sdkTransportFailure(response) {
  if (response.status !== 500 || response.headers.has("x-kova-runtime")
      || response.headers.has("x-kova-process-id")
      || !/^text\/plain(?:;|$)/i.test(response.headers.get("content-type") || "")) return false;
  // SDK 0.3.7 returns these failures as Responses, rather than exceptions.
  // Inspect only a bounded prefix and never expose/log its internal details.
  const reader = response.clone().body?.getReader();
  if (!reader) return false;
  let prefix = "";
  const decoder = new TextDecoder();
  try {
    while (prefix.length < 96) {
      const { value, done } = await reader.read();
      if (done) break;
      prefix += decoder.decode(value.subarray(0, 96 - prefix.length));
      if (["Failed to start container: ", "Container suddenly disconnected, try again",
        "Error proxying request to container: "].some(message => prefix.startsWith(message))) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    // A cloned stream's cancellation can wait for the original branch. Do not
    // block returning the original response when it is an application error.
    void reader.cancel().catch(() => {});
  }
}

// The injected SDK base permits focused lifecycle tests without pretending a
// process was started. Actual image/runtime checks remain a release gate.
export function residentContainerClass(Container) {
  return class extends Container {
    defaultPort = 8000;
    requiredPorts = [8000];
    sleepAfter = "5m";
    portProbeRequired = false;

    constructor(ctx, env) {
      super(ctx, env);
      this.envVars = nativeEnvironment(env);
    }

    isResident() {
      return this.ctx.id.toString() === this.env.API.idFromName(NATIVE_INSTANCE).toString();
    }

    async ensureReady() {
      if (!this.isResident()) return await this.env.API.getByName(NATIVE_INSTANCE).ensureReady();
      // A running process may still be importing/compiling the application.
      // Avoid repeating port probes once healthy, but never let the SDK's
      // shorter default startup timeout handle an in-progress first boot.
      if (!this.portProbeRequired && this.ctx.container.running
          && (await this.getState()).status === "healthy") return;
      await this.startAndWaitForPorts({ cancellationOptions: {
        instanceGetTimeoutMS: 60_000,
        portReadyTimeoutMS: 120_000,
      } });
      this.portProbeRequired = false;
    }

    async fetch(request) {
      if (!publicPath(new URL(request.url).pathname)) {
        return privateResponse(Response.json({ detail: "Not Found" }, { status: 404 }));
      }
      try {
        if (!this.isResident()) {
          return await this.env.API.getByName(NATIVE_INSTANCE).fetch(request);
        }
        // Only the gateway reaches this DO binding. It already sets the
        // authoritative client IP. Replace caller-controlled proxy metadata so
        // native redirects preserve the original HTTPS scheme safely.
        const headers = new Headers(request.headers);
        const origin = new URL(request.url);
        headers.set("x-forwarded-proto", origin.protocol === "https:" ? "https" : "http");
        headers.set("host", origin.host);
        for (const name of ["x-forwarded-host", "x-forwarded-for", "x-real-ip", "forwarded", "fly-client-ip"]) {
          headers.delete(name);
        }
        await this.ensureReady();
        const response = await super.fetch(new Request(request, { headers }));
        if (await sdkTransportFailure(response)) {
          // A rollout can disconnect after ensureReady. Reprobe on the next
          // request without replaying this request or mutating SDK state.
          this.portProbeRequired = true;
          await response.body?.cancel();
          console.error(JSON.stringify({ event: "native_backend_unavailable" }));
          return unavailable();
        }
        return privateResponse(response, request);
      } catch {
        console.error(JSON.stringify({ event: "native_backend_unavailable" }));
        return unavailable();
      }
    }

    async onActivityExpired() {
      // Intentional always-on lifecycle. SDK 0.3.7 renews the inactivity timer
      // when this hook returns without stop()/destroy(); no HTTP warming cron.
    }

    async onStop() {
      // Run after SDK stop bookkeeping; do not restart recursively inside its
      // shutdown promise or replace the SDK-owned alarm handler.
      if (this.isResident()) await this.schedule(5, "ensureRunning");
    }

    async ensureRunning() {
      if (!this.isResident()) return;
      try {
        await this.ensureReady();
      } catch {
        console.error(JSON.stringify({ event: "native_restart_pending" }));
        await this.schedule(60, "ensureRunning");
      }
    }

    async ready() {
      if (!this.isResident()) return await this.env.API.getByName(NATIVE_INSTANCE).ready();
      await this.ensureReady();
      const response = await this.containerFetch("http://container/health");
      if (!response.ok) throw new Error("Native container failed readiness");
      const body = await response.json();
      if (body.release_sha !== this.envVars.KOVA_RELEASE_SHA) {
        throw new Error("Native container release identity mismatch");
      }
      const database = await this.containerFetch("http://container/health/db");
      if (!database.ok) throw new Error("Native container database failed readiness");
      return body;
    }
  };
}
