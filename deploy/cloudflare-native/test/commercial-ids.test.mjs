import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ids = {
  STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
  STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
};
const previous = "a".repeat(40), target = "b".repeat(40);

for (const project of ["cloudflare-native", "cloudflare-backend"]) {
  test(`real ${project} comparator permits only captured public IDs and preserves every other binding`, async () => {
    const directory = new URL(`../../${project}/node_modules/cf/dist/`, import.meta.url);
    const scratch = mkdtempSync(join(tmpdir(), "kova-public-stripe-comparator-"));
    const name = "containers-BtcOgwm5.mjs";
    const names = ["KOVA_NATIVE_PREVIOUS_SHA", "KOVA_NATIVE_DEPLOY_SHA", "KOVA_NATIVE_HANDOFF", ...Object.keys(ids)];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      symlinkSync(realpathSync(new URL(`../../${project}/node_modules`, import.meta.url)), join(scratch, "node_modules"));
      for (const file of readdirSync(directory)) {
        if (file === name) writeFileSync(join(scratch, file),
          readFileSync(new URL(file, directory), "utf8") + "\nexport { xE as compareForTest };\n");
        else symlinkSync(fileURLToPath(new URL(file, directory)), join(scratch, file));
      }
      const { compareForTest } = await import(pathToFileURL(join(scratch, name)));
      Object.assign(process.env, ids, { KOVA_NATIVE_PREVIOUS_SHA: previous, KOVA_NATIVE_DEPLOY_SHA: target });
      for (const worker of ["kova-backend", "kova-backend-jobs"]) {
        const local = {
          name: worker, workers_dev: false, preview_urls: false,
          vars: { KOVA_BUILD_SHA: target, KEEP: "unchanged", ...ids,
            STRIPE_STANDARD_PRICE_ID: "price_ExistingStandard299",
            BILLING_TIERED_PLANS_ENABLED: "false", BILLING_PORTAL_ENABLED: "false" },
          hyperdrive: [{ binding: "DB_APP", id: "synthetic-runtime" }],
          r2_buckets: [{ binding: "ASSISTANT_STORAGE", bucket_name: "synthetic-storage" }],
          unsafe: { bindings: [{ name: "STRIPE_SECRET_KEY", type: "secret_text" }] },
        };
        const remote = structuredClone(local);
        remote.vars.KOVA_BUILD_SHA = previous;
        remote.vars.STRIPE_ESENCIAL_PRICE_ID = "price_Previous123";
        const original = structuredClone(remote);
        assert.equal(compareForTest(remote, local).diff, null);
        if (project === "cloudflare-native" && worker === "kova-backend") {
          const withPolicy = { ...local, unsafe: { ...local.unsafe,
            metadata: { code_update_strategy: { mode: "immediate" } } } };
          assert.equal(compareForTest(remote, withPolicy).nonDestructive, true,
            "the write-only deployment strategy must not appear to replace sealed bindings");
          const handoff = JSON.stringify({ previousSha: previous, expiresAt: Date.now() + 600_000 });
          process.env.KOVA_NATIVE_HANDOFF = handoff;
          const withHandoff = { ...local, vars: { ...local.vars, KOVA_NATIVE_HANDOFF: handoff } };
          assert.equal(compareForTest(remote, withHandoff).diff, null);
          assert.equal(compareForTest(withHandoff, withHandoff).diff, null,
            "publishing the image after the staged controller must retain the exact original lease");
          const stagedResourceChange = { ...withHandoff,
            hyperdrive: [{ binding: "DB_APP", id: "foreign-database" }] };
          assert.equal(compareForTest(withHandoff, stagedResourceChange).nonDestructive, false);
          const oldLease = structuredClone(remote);
          oldLease.vars.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "c".repeat(40), expiresAt: 1 });
          assert.equal(compareForTest(oldLease, withHandoff).diff, null, "only the previous public lease is replaced");
          const sealedConflict = structuredClone(remote);
          sealedConflict.unsafe.bindings.push({ name: "KOVA_NATIVE_HANDOFF", type: "secret_text" });
          assert.equal(compareForTest(sealedConflict, withHandoff).nonDestructive, false);
          const foreignLease = { ...withHandoff, vars: { ...withHandoff.vars,
            KOVA_NATIVE_HANDOFF: JSON.stringify({ previousSha: "c".repeat(40), expiresAt: Date.now() + 600_000 }) } };
          assert.throws(() => compareForTest(remote, foreignLease), /bounded captured/);
          delete process.env.KOVA_NATIVE_HANDOFF;
          assert.throws(() => compareForTest(remote, withHandoff), /bounded captured/);
        }
        assert.deepEqual(remote, original);
        const added = structuredClone(remote);
        for (const field of Object.keys(ids)) delete added.vars[field];
        assert.equal(compareForTest(added, local).diff, null);
        for (const [field, value] of [["KEEP", "changed"], ["BILLING_TIERED_PLANS_ENABLED", "true"],
          ["BILLING_PORTAL_ENABLED", "true"], ["STRIPE_STANDARD_PRICE_ID", "price_Other299"]]) {
          const altered = structuredClone(local); altered.vars[field] = value;
          assert.equal(compareForTest(remote, altered).nonDestructive, false, field);
        }
        for (const [field, value] of [
          ["hyperdrive", [{ binding: "DB_APP", id: "foreign-database" }]],
          ["r2_buckets", [{ binding: "ASSISTANT_STORAGE", bucket_name: "foreign-storage" }]],
          ["unsafe", { bindings: [{ name: "OTHER_SECRET", type: "secret_text" }] }],
        ]) {
          assert.equal(compareForTest(remote, { ...local, [field]: value }).nonDestructive, false, field);
        }
        assert.equal(compareForTest(remote, { ...local, name: "foreign-worker" }).nonDestructive, false);
        for (const field of Object.keys(ids)) {
          const invalid = structuredClone(local); invalid.vars[field] = "sk_" + "live_syntheticForbidden";
          assert.throws(() => compareForTest(remote, invalid), /Unverified/);
          const partial = structuredClone(local); delete partial.vars[field];
          assert.throws(() => compareForTest(remote, partial), /Incomplete/);
        }
        const removed = structuredClone(local);
        for (const field of Object.keys(ids)) delete removed.vars[field];
        assert.equal(compareForTest(remote, removed).nonDestructive, false);
        process.env.KOVA_NATIVE_PREVIOUS_SHA = "c".repeat(40);
        assert.throws(() => compareForTest(remote, local), /captured release transition/);
        process.env.KOVA_NATIVE_PREVIOUS_SHA = previous;
      }
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
