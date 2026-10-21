import { NATIVE_INSTANCE, nativeEnvironment, privateResponse, publicPath, unavailable } from "./policy.mjs";

// The injected SDK base permits focused lifecycle tests without pretending a
// process was started. Actual image/runtime checks remain a release gate.
export function residentContainerClass(Container) {
  return class extends Container {
    defaultPort = 8000;
    requiredPorts = [8000];
    sleepAfter = "5m";

    constructor(ctx, env) {
      super(ctx, env);
      this.envVars = nativeEnvironment(env);
    }

    isResident() {
      return this.ctx.id.toString() === this.env.API.idFromName(NATIVE_INSTANCE).toString();
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
        if (!this.ctx.container.running) await this.startAndWaitForPorts();
        return privateResponse(await super.fetch(new Request(request, { headers })));
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
        await this.startAndWaitForPorts();
      } catch {
        console.error(JSON.stringify({ event: "native_restart_pending" }));
        await this.schedule(60, "ensureRunning");
      }
    }

    async ready() {
      if (!this.isResident()) return await this.env.API.getByName(NATIVE_INSTANCE).ready();
      await this.startAndWaitForPorts();
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
