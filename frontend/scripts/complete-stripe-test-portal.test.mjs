import assert from "node:assert/strict";
import test from "node:test";
import { exercisePortal, validatePortalState } from "./complete-stripe-test-portal.mjs";

const standard = {
  portal_url: "https://billing.stripe.com/p/session/test_synthetic",
  provider_livemode: false, action: "standard", current_plan: "Standard",
  current_amount: 299, target_plan: "Gestión", target_amount: 699,
};

for (const [field, value] of [
  ["portal_url", "http://billing.stripe.com/p/session/test_synthetic"],
  ["portal_url", "https://billing.stripe.com.evil.test/p/session/x"],
  ["portal_url", "https://user@billing.stripe.com/p/session/x"],
  ["portal_url", "https://api.stripe.com/other/x"],
  ["portal_url", "https://billing.stripe.com:8443/other/x"],
  ["provider_livemode", true], ["action", "delete_customer"], ["current_amount", 1],
]) {
  test(`rejects unsafe ${field}: ${value}`, () => {
    assert.throws(() => validatePortalState({ ...standard, [field]: value }));
  });
}

test("accepts only supported current/target plan pairs", () => {
  assert.equal(validatePortalState(standard), standard);
  for (const action of ["upgrade_decline", "upgrade_success", "downgrade"]) {
    const state = { ...standard, action,
      current_plan: action === "downgrade" ? "Gestión" : "Esencial",
      current_amount: action === "downgrade" ? 699 : 399,
      target_plan: action === "downgrade" ? "Esencial" : "Gestión",
      target_amount: action === "downgrade" ? 399 : 699,
    };
    assert.equal(validatePortalState(state), state);
  }
});

function pageWithUpdate(enabled) {
  const visible = { first() { return this; }, async waitFor() {}, async isVisible() { return true; },
    async isEnabled() { return true; } };
  return {
    async goto() {}, url() { return standard.portal_url; }, getByText() { return visible; },
    getByRole() { return { async all() { return enabled ? [visible] : []; } }; },
  };
}

test("healthy Standard overview cannot expose a plan-change control", async () => {
  assert.deepEqual(await exercisePortal(pageWithUpdate(false), standard), {
    action: "standard", submitted: false, inspected: true,
  });
  await assert.rejects(exercisePortal(pageWithUpdate(true), standard), /basic_plan_change_exposed/);
});

test("cannot interpret a failed overview as plan-change absence", async () => {
  const page = pageWithUpdate(false);
  page.getByText = () => ({ first() { return this; }, async waitFor() { throw new Error("not loaded"); } });
  await assert.rejects(exercisePortal(page, standard), /not loaded/);
});


for (const [plan_code, current_plan, current_amount] of [
  ["standard", "Standard", 299], ["esencial", "Esencial", 399], ["gestion", "Gestión", 699],
]) {
  test(`basic mode accepts ${plan_code} without enabling tier changes`, async () => {
    const state = { ...standard, action: "inspect", plan_code, current_plan, current_amount };
    assert.deepEqual(await exercisePortal(pageWithUpdate(false), state), {
      action: "inspect", submitted: false, inspected: true,
    });
    await assert.rejects(exercisePortal(pageWithUpdate(true), state), /basic_plan_change_exposed/);
    assert.throws(() => validatePortalState({ ...state, current_amount: 1 }), /invalid_basic/);
  });
}


test("provider-owned Portal paths stay opaque on the exact trusted origin", () => {
  for (const path of ["/p/session/test_synthetic", "/p/test_synthetic", "/session/test_synthetic"]) {
    const state = { ...standard, portal_url: "https://billing.stripe.com" + path };
    assert.equal(validatePortalState(state), state);
  }
});
