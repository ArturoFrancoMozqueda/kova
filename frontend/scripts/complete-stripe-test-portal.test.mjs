import assert from "node:assert/strict";
import test from "node:test";
import { clickControl, exercisePortal, portalFailureDiagnostics, validatePortalState } from "./complete-stripe-test-portal.mjs";

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


test("waits for a disabled save control through Playwright click auto-wait", async () => {
  let clicked = false;
  const save = {
    async isVisible() { return true; }, async isEnabled() { return false; },
    async click(options) { assert.ok(options.timeout > 0); clicked = true; },
  };
  const page = { url: () => standard.portal_url,
    getByRole: role => ({ all: async () => role === "button" ? [save] : [] }),
  };
  await clickControl(page, /^Guardar cambios$/i);
  assert.equal(clicked, true);
});


function clickPage({ visible = true, enabled = true, failure } = {}) {
  const control = { async isVisible() { return visible; }, async isEnabled() { return enabled; },
    async click() { if (failure) throw failure; },
  };
  return { url: () => standard.portal_url,
    getByRole: role => ({ all: async () => role === "button" ? [control] : [] }),
  };
}

for (const [name, options, expected] of [
  ["disabled", { enabled: false }, "control_disabled"],
  ["unobstructed state but click timeout", { enabled: true }, "click_timeout"],
]) test(`classifies ${name} without copying the raw Playwright error`, async () => {
  const failure = Object.assign(new Error("private customer and bearer URL"), { name: "TimeoutError" });
  await assert.rejects(clickControl(clickPage({ ...options, failure }), /^Guardar$/), error => {
    assert.equal(error.reason, expected);
    assert.equal(error.message, expected);
    return true;
  });
});

test("polls for a late visible button and distinguishes missing from hidden controls", async () => {
  let tick = 0, clicked = false;
  const control = { async isVisible() { return true; }, async click() { clicked = true; } };
  const page = { url: () => standard.portal_url,
    getByRole: role => ({ all: async () => role === "button" && tick >= 100 ? [control] : [] }),
  };
  const timing = { timeoutMs: 300, now: () => tick, wait: async ms => { tick += ms; } };
  await clickControl(page, /^Guardar$/, timing);
  assert.equal(clicked, true);
  for (const [candidates, expected] of [[[], "control_not_found"],
    [[{ isVisible: async () => false }], "control_not_visible"]]) {
    tick = 0;
    page.getByRole = role => ({ all: async () => role === "button" ? candidates : [] });
    await assert.rejects(clickControl(page, /^Guardar$/, timing), error => error.reason === expected);
  }
});

test("diagnostics expose only fixed public label enums, never arbitrary button/customer contents", async () => {
  const buttons = [
    ["Guardar cambios", false], ["Añadir método de pago", true], ["Agregar tarjeta", false],
    ["Actualizar", true], ["Update card", false], ["Confirmar", true],
    ["private.customer@example.com https://billing.stripe.com/p/secret_bearer", true],
  ].map(([text, enabled]) => ({ isVisible: async () => true, isEnabled: async () => enabled,
    getAttribute: async () => null, innerText: async () => text }));
  const page = { url: () => standard.portal_url,
    getByRole: role => ({ all: async () => role === "button" ? buttons : [] }),
  };
  const diagnostic = await portalFailureDiagnostics(new Error("raw secret"), page);
  assert.deepEqual(diagnostic, { reason: "unknown", controls: [
    { label: "save_changes", enabled: false }, { label: "add_payment_method", enabled: true },
    { label: "add_card", enabled: false }, { label: "update", enabled: true },
    { label: "update_card", enabled: false }, { label: "confirm", enabled: true },
    { label: "other", enabled: true },
  ] });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|bearer|stripe|raw secret|example/);
});

test("local PaymentElement iframe commits CVC and required US postal by blur without opting into Link", {
  skip: process.env.KOV005_PORTAL_LOCAL_BROWSER_TEST !== "true",
}, async () => {
  const { chromium } = await import("playwright");
  const { completeTestPaymentFields } = await import("./complete-stripe-test-portal.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let externalRequest = false;
    await page.route("**/*", async route => { externalRequest = true; await route.abort(); });
    const form = `<!doctype html><html><body><form>
      <input name="number" autocomplete="cc-number" required>
      <input name="expiry" autocomplete="cc-exp" required>
      <input name="cvc" autocomplete="cc-csc" required>
      <select name="country" autocomplete="billing country" required>
        <option value="" selected>Choose country</option><option value="MX">Mexico</option><option value="US">United States</option>
      </select>
      <label id="postal-wrap" hidden>Postal<input name="postalCode" autocomplete="billing postal-code" required disabled></label>
      <label>Save information with Link<input name="enableStripePass" type="checkbox" checked></label>
      <input name="billingName" autocomplete="billing name" aria-label="Optional Link full name">
      <button type="button" id="add" disabled>Add</button>
      <script>
        const country = document.querySelector('[name=country]');
        const zip = document.querySelector('[name=postalCode]');
        const cvc = document.querySelector('[name=cvc]');
        const link = document.querySelector('[name=enableStripePass]');
        let cardCommitted = false, postalCommitted = false;
        function update() {
          document.querySelector('#add').disabled = !(cardCommitted && country.value === 'US'
            && postalCommitted && !link.checked);
        }
        cvc.addEventListener('blur', () => {
          cardCommitted = document.querySelector('[name=number]').value.length === 16
            && document.querySelector('[name=expiry]').value.length > 0 && cvc.value.length === 3;
          update();
        });
        country.addEventListener('change', () => {
          document.querySelector('#postal-wrap').hidden = country.value !== 'US';
          document.querySelector('#add').dataset.cardCommittedBeforeCountry = String(cardCommitted);
          zip.disabled = country.value !== 'US'; postalCommitted = false; update();
        });
        zip.addEventListener('input', () => { postalCommitted = false; update(); });
        zip.addEventListener('blur', () => { postalCommitted = /^\\d{5}$/.test(zip.value); update(); });
        link.addEventListener('change', update);
      </script></form></body></html>`;
    await page.setContent(`<iframe id="payment"></iframe>`);
    await page.locator("iframe").evaluate((iframe, html) => { iframe.srcdoc = html; }, form);
    const frame = page.frameLocator("#payment");
    await frame.locator("[name=country]").waitFor();
    assert.equal(await frame.locator("#add").isEnabled(), false);
    await completeTestPaymentFields(page);
    assert.equal(await frame.locator("[name=country]").inputValue(), "US");
    assert.equal(await frame.locator("#add").getAttribute("data-card-committed-before-country"), "true");
    assert.equal(await frame.locator("[name=postalCode]").isVisible(), true);
    assert.equal(await frame.locator("[name=enableStripePass]").isChecked(), false);
    assert.equal(await frame.locator("[name=billingName]").inputValue(), "");
    assert.equal(await frame.locator("#add").isEnabled(), true);
    assert.equal(externalRequest, false);
  } finally {
    await browser.close();
  }
});
