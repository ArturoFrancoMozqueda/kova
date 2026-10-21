import { CONTROLLER_FAILURE_HEADER, CODE_UPDATE_RESET, isCodeUpdateReset } from "../controller-update-recovery.mjs";
import { NATIVE_INSTANCE, nativeEnvironment, privateResponse, publicPath, unavailable } from "./policy.mjs";

// Only the read-only acceptance contracts can opt in to fixed stage telemetry.
// Query strings and arbitrary paths/headers never become diagnostics.
const diagnosticPhases = new Set(["ensure_ready", "start_fetch", "response", "failed"]);
const diagnosticRoutes = new Map([
  ["GET /health", "health"], ["GET /health/db", "database_health"],
  ["GET /api/v1/auth/session", "session"], ["GET /api/v1/catalog/products", "catalog"],
  ["GET /api/v1/reports/dashboard", "dashboard"],
  ["GET /api/v1/purchasing/orders", "purchasing"],
  ["POST /api/v1/auth/login", "login_validation"],
]);

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
    diagnosticEvents = 0;

    constructor(ctx, env) {
      super(ctx, env);
      this.envVars = nativeEnvironment(env);
    }

    isResident() {
      return this.ctx.id.toString() === this.env.API.idFromName(NATIVE_INSTANCE).toString();
    }

    acceptanceDiagnostic(request) {
      if (request.headers.get("x-kova-resident-diagnostic") !== "1") return () => {};
      const url = new URL(request.url);
      const route = !url.search && diagnosticRoutes.get(`${request.method} ${url.pathname}`);
      if (!route) return () => {};
      const started = performance.now();
      return (phase, status) => {
        if (!diagnosticPhases.has(phase) || this.diagnosticEvents >= 256) return;
        this.diagnosticEvents++;
        const elapsed = performance.now() - started;
        const event = { event: "resident_acceptance_stage", route, phase,
          elapsed_ms: Number.isFinite(elapsed) ? Math.min(300000, Math.max(0, Math.round(elapsed))) : 0 };
        if (phase === "response" && Number.isInteger(status) && status >= 100 && status <= 599) {
          event.status = status;
        }
        try { console.info(JSON.stringify(event)); }
        catch { /* Diagnostics must never alter the original request outcome. */ }
      };
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
      let diagnostic;
      try {
        if (!this.isResident()) {
          return await this.env.API.getByName(NATIVE_INSTANCE).fetch(request);
        }
        diagnostic = this.acceptanceDiagnostic(request);
        diagnostic("ensure_ready");
        // Only the gateway reaches this DO binding. It already sets the
        // authoritative client IP. Replace caller-controlled proxy metadata so
        // native redirects preserve the original HTTPS scheme safely.
        const headers = new Headers(request.headers);
        headers.delete(CONTROLLER_FAILURE_HEADER);
        const origin = new URL(request.url);
        headers.set("x-forwarded-proto", origin.protocol === "https:" ? "https" : "http");
        headers.set("host", origin.host);
        for (const name of ["x-forwarded-host", "x-forwarded-for", "x-real-ip", "forwarded", "fly-client-ip"]) {
          headers.delete(name);
        }
        await this.ensureReady();
        diagnostic("start_fetch");
        const response = await super.fetch(new Request(request, { headers }));
        diagnostic("response", response.status);
        if (await sdkTransportFailure(response)) {
          // A rollout can disconnect after ensureReady. Reprobe on the next
          // request without replaying this request or mutating SDK state.
          this.portProbeRequired = true;
          await response.body?.cancel();
          console.error(JSON.stringify({ event: "native_backend_unavailable" }));
          return unavailable();
        }
        const result = privateResponse(response, request);
        result.headers.delete(CONTROLLER_FAILURE_HEADER);
        return result;
      } catch (error) {
        diagnostic?.("failed");
        const reset = isCodeUpdateReset(error);
        try { console.error(JSON.stringify({ event: "native_backend_unavailable",
          ...(reset ? { reason: "code_update_reset" } : {}),
        })); }
        catch { /* Observability must never replace the private failure. */ }
        const result = unavailable();
        if (reset) result.headers.set(CONTROLLER_FAILURE_HEADER, CODE_UPDATE_RESET);
        return result;
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
      if (body.release_sha !== this.env.KOVA_BUILD_SHA) {
        throw new Error("Native container release identity mismatch");
      }
      const database = await this.containerFetch("http://container/health/db");
      if (!database.ok) throw new Error("Native container database failed readiness");
      return body;
    }
  };
}
