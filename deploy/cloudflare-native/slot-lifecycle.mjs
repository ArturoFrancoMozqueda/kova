import { residentContainerClass, ACTIVE_CONTROLLER_HEADER, BOOT_CONTROLLER_HEADER } from "./lifecycle.mjs";
import { stripeRuntimeIds } from "../stripe-runtime-ids.mjs";
import { SLOT_DRAIN_MS } from "./slots.mjs";
import { verifyBillingOfferBody, RELEASE_BILLING_OFFER } from "../../frontend/scripts/release-billing-offer.mjs";

async function probeJson(response) {
  try { return await response.json(); }
  catch { throw new Error("Malformed private candidate contract"); }
}

export function slotContainerClass(Container, { now = Date.now } = {}) {
  const Resident = residentContainerClass(Container, {
    environment: async env => {
      const result = await env.SETTINGS.getRuntimeEnvironment({ sha: env.KOVA_BUILD_SHA,
        publicIds: stripeRuntimeIds(env) });
      if (result?.KOVA_BOOT_CONTROLLER_SHA !== env.KOVA_BUILD_SHA
          || result?.CLOUDFLARE_CONTAINER_MODE !== "true" || result?.APP_ENV !== "production"
          || !result?.APP_DATABASE_URL || !result?.MIGRATION_DATABASE_URL || !result?.SECRET_KEY) {
        throw new Error("Invalid private native runtime configuration");
      }
      return result;
    },
  });
  return class extends Resident {
    activeResponses = 0;
    parked = false;
    activityGeneration = 0;

    async cancelParking() {
      if (await this.ctx.storage.get("native_slot_park_after") !== undefined) {
        await this.ctx.storage.delete("native_slot_park_after");
        this.deleteSchedules("parkIfInactive");
      }
      this.parked = false;
    }

    async renewParkingLease() {
      await this.ctx.storage.put("native_slot_park_after", now() + 1_800_000);
      // SDK 0.3.7 exposes deleteSchedules()/schedule(). Keep exactly this
      // callback bounded without replacing its alarm or touching other tasks.
      this.deleteSchedules("parkIfInactive");
      await this.schedule(1800, "parkIfInactive");
      this.parked = false;
    }

    async onActivityExpired() {
      try { await this.parkIfInactive(); }
      catch { /* Unknown routing always preserves the rollback process. */ }
    }

    async parkIfInactive() {
      const generation = this.activityGeneration;
      const active = await this.env.GATEWAY_STATUS.getActiveSlot();
      if (generation !== this.activityGeneration) return;
      if (!["legacy", "blue", "green"].includes(active)
          || !["blue", "green"].includes(this.env.KOVA_NATIVE_SLOT)) throw new Error("Invalid native slot routing");
      if (active === this.env.KOVA_NATIVE_SLOT) {
        await this.cancelParking();
        return;
      }
      const deadline = await this.ctx.storage.get("native_slot_park_after");
      if (generation !== this.activityGeneration) return;
      if (deadline === undefined) {
        await this.renewParkingLease();
      } else if (Number.isSafeInteger(deadline) && now() >= deadline && await this.replaceable()
          && generation === this.activityGeneration) {
        this.parked = true;
        await this.stop();
      }
    }

    async onStop() {
      if (this.parked || await this.ctx.storage.get("native_slot_park_after") !== undefined) {
        this.invalidateBoot(); this.portProbeRequired = true;
        return;
      }
      await super.onStop();
    }

    async ensureRunning() {
      if (this.parked || await this.ctx.storage.get("native_slot_park_after") !== undefined) return;
      await super.ensureRunning();
    }

    async replaceable() {
      const lastRequest = await this.ctx.storage.get("native_last_request");
      return this.activeResponses === 0 && (lastRequest === undefined
        || (Number.isSafeInteger(lastRequest) && now() - lastRequest >= SLOT_DRAIN_MS));
    }

    async drainState() {
      // This must work even when a staged image never became healthy. It
      // inspects controller metadata without starting Linux or fetching keys.
      return { release_sha: this.env.KOVA_BUILD_SHA, replaceable: await this.replaceable() };
    }

    async probe() {
      // Private RPC has a fixed, read-only contract; callers cannot choose a
      // business path or supply cookies, credentials or a request body.
      this.activityGeneration++;
      await this.renewParkingLease();
      await this.ready();
      const database = await this.containerFetch("http://container/health/db");
      const health = await probeJson(database);
      if (!database.ok || health?.status !== "ok" || health?.db !== "reachable") {
        throw new Error("Candidate database is not reachable");
      }
      const offer = await this.containerFetch("http://container/api/v1/billing/plans");
      if (!offer.ok) throw new Error("Candidate public offer unavailable");
      const revision = verifyBillingOfferBody(await probeJson(offer), RELEASE_BILLING_OFFER);
      const response = await this.containerFetch("http://container/health");
      const processId = response.headers.get("x-kova-process-id");
      await response.body?.cancel();
      if (!/^[a-f0-9]{32}$/.test(processId ?? "")) throw new Error("Invalid candidate process identity");
      return { status: "ok", release_sha: this.env.KOVA_BUILD_SHA, processId,
        controller: this.env.KOVA_BUILD_SHA, boot: response.headers.get(BOOT_CONTROLLER_HEADER),
        replaceable: await this.replaceable(), offerVerified: true, offerRevision: revision };
    }

    async fetch(request) {
      // Persist before dispatch so an isolate restart never erases the drain
      // lease. A write is forwarded once, with its existing idempotency key.
      this.activityGeneration++;
      this.activeResponses++;
      let done;
      const completed = new Promise(resolve => { done = resolve; });
      this.ctx.waitUntil(completed);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.activeResponses--;
        done();
      };
      try {
        await this.cancelParking();
        await this.ctx.storage.put("native_last_request", now());
        const response = await super.fetch(request);
        if (!response.body) { finish(); return response; }
        const reader = response.body.getReader();
        const body = new ReadableStream({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) { controller.close(); finish(); }
              else controller.enqueue(chunk.value);
            } catch (error) { controller.error(error); finish(); }
          },
          async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
        });
        const result = new Response(body, response);
        // Preserve exact response bytes, distinct cookies and boot identity.
        if (new URL(request.url).pathname === "/health") {
          result.headers.set(ACTIVE_CONTROLLER_HEADER, this.env.KOVA_BUILD_SHA);
        }
        return result;
      } catch (error) { finish(); throw error; }
    }
  };
}
