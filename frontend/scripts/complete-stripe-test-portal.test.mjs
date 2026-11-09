import assert from "node:assert/strict";
import test from "node:test";
import { clickControl, exercisePortal, portalFailureDiagnostics, portalFieldStateDiagnostics,
  portalBrowserOptions, savePortalDiagnostic, validatePortalState,
  visiblePortalFieldState } from "./complete-stripe-test-portal.mjs";

test("Portal browser selection changes rendering only and rejects unknown modes", () => {
  assert.deepEqual(portalBrowserOptions(), { headless: true });
  assert.deepEqual(portalBrowserOptions("headed"), { headless: false });
  assert.throws(() => portalBrowserOptions("stealth"), /invalid_portal_browser_mode/);
});

test("temporary Portal screenshots stay on the exact provider origin", async () => {
  const captures = [];
  const page = { url: () => "https://billing.stripe.com/p/session/test_synthetic",
    screenshot: async options => captures.push(options) };
  assert.equal(await savePortalDiagnostic(page, "/tmp/portal-fixture.png"), true);
  assert.deepEqual(captures, [{ path: "/tmp/portal-fixture.png", fullPage: false }]);
  assert.equal(await savePortalDiagnostic({ ...page, url: () => "https://example.invalid" },
    "/tmp/portal-fixture.png"), false);
  assert.equal(await savePortalDiagnostic(page), false);
  assert.equal(captures.length, 1);
});

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

function diagnosticField({ name = "", autocomplete = "", type = "text", value = "", required = false,
  valid = true, ariaInvalid = null, checked = false, visible = true } = {}) {
  return { type, value, required, validity: { valid }, checked,
    ownerDocument: { defaultView: { getComputedStyle: () => ({
      display: "block", visibility: "visible", opacity: "1",
    }) } },
    getClientRects: () => visible ? [{}] : [],
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: attribute => ({ name, autocomplete, "aria-invalid": ariaInvalid })[attribute] ?? null,
  };
}

test("field diagnostics emit fixed enums and booleans without names, values or lengths", () => {
  const entries = [
    ["number", "cc-number", "card_number"], ["expiry", "cc-exp", "card_expiry"],
    ["cvc", "cc-csc", "card_cvc"], ["country", "billing country", "billing_country"],
    ["postalCode", "billing postal-code", "billing_postal"], ["billingName", "billing name", "billing_name"],
    ["search-linkEmail", "billing email", "link_email"], ["linkMobilePhone", "billing tel", "link_phone"],
    ["linkLegalName", "billing name", "link_name"], ["enableStripePass", "", "link_opt_in"],
    ["private_customer_https://secret.invalid/bearer", "private-secret", "other"],
  ];
  const snapshot = visiblePortalFieldState(entries.map(([name, autocomplete]) => diagnosticField({
    name, autocomplete, value: "private.card.customer@example.com https://secret.invalid/bearer",
    required: true, valid: false, ariaInvalid: "true",
  })));
  assert.deepEqual(snapshot.map(field => field.kind), entries.map(entry => entry[2]));
  for (const field of snapshot) assert.deepEqual(field, {
    kind: field.kind, filled: true, required: true, html_valid: false, aria_invalid: true, checked: false,
    ...(["card_number", "card_expiry", "card_cvc", "billing_country", "billing_postal"].includes(field.kind)
      ? { fixture_match: false } : {}),
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private|secret|example|https|bearer|length|autocomplete/);
  const checkbox = visiblePortalFieldState([diagnosticField({
    name: "enableStripePass", type: "checkbox", checked: true, value: "on",
  })]);
  assert.equal(checkbox[0].checked, true);
  assert.equal(checkbox[0].filled, true);
});

test("field diagnostics never read hidden values and enforce element/field bounds", () => {
  const hidden = diagnosticField({ type: "hidden" });
  const invisible = diagnosticField({ visible: false });
  const transparent = diagnosticField();
  transparent.ownerDocument.defaultView.getComputedStyle = () => ({
    display: "block", visibility: "visible", opacity: "0",
  });
  for (const element of [hidden, invisible, transparent]) Object.defineProperty(element, "value", {
    get() { throw new Error("Hidden state must never be inspected"); },
  });
  assert.deepEqual(visiblePortalFieldState([hidden, invisible, transparent]), []);
  assert.equal(visiblePortalFieldState(Array.from({ length: 200 }, () => diagnosticField())).length, 64);
  assert.deepEqual(visiblePortalFieldState([
    ...Array.from({ length: 128 }, () => invisible), diagnosticField(),
  ]), []);
});

test("field snapshot excludes hidden frames, bounds traversal and refuses another top origin", async () => {
  let readFrames = 0;
  const main = { parentFrame: () => null,
    locator: () => ({ evaluateAll: async callback => {
      readFrames++; return callback([diagnosticField({ name: "number", value: "synthetic" })]);
    } }),
  };
  const hidden = { parentFrame: () => main,
    frameElement: async () => ({ evaluate: async () => false, dispose: async () => {} }),
    locator() { throw new Error("Hidden frame must not be inspected"); },
  };
  const page = { url: () => standard.portal_url, frames: () => [hidden, ...Array(30).fill(main)] };
  const fields = await portalFieldStateDiagnostics(page);
  assert.equal(fields.length, 11);
  assert.equal(readFrames, 11);
  page.url = () => "https://private.invalid";
  assert.deepEqual(await portalFieldStateDiagnostics(page), []);
  assert.equal(readFrames, 11);
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
    await page.setContent(`<iframe id="proxy" style="opacity:0"></iframe><iframe id="payment"></iframe>`);
    for (const id of ["proxy", "payment"]) {
      await page.locator(`#${id}`).evaluate((iframe, html) => { iframe.srcdoc = html; }, form);
    }
    const frame = page.frameLocator("#payment");
    await frame.locator("[name=country]").waitFor();
    assert.equal(await frame.locator("#add").isEnabled(), false);
    await completeTestPaymentFields(page);
    assert.equal(await page.frameLocator("#proxy").locator("[name=number]").inputValue(), "");
    assert.equal(await frame.locator("[name=country]").inputValue(), "US");
    assert.equal(await frame.locator("#add").getAttribute("data-card-committed-before-country"), "true");
    assert.equal(await frame.locator("[name=postalCode]").isVisible(), true);
    assert.equal(await frame.locator("[name=enableStripePass]").isChecked(), false);
    assert.equal(await frame.locator("[name=billingName]").inputValue(), "");
    assert.equal(await frame.locator("#add").isEnabled(), true);
    // Diagnose a visible duplicate separately from an opacity-zero autofill proxy.
    await frame.locator("form").evaluate(form => {
      form.insertAdjacentHTML("beforeend", `<input name="cardNumber" style="opacity:0" value="hidden-proxy">
        <input name="number" required aria-invalid="true">
        <div style="opacity:0"><input name="linkLegalName" value="invisible-ancestor"></div>`);
    });
    const fieldState = await frame.locator("input,select,textarea").evaluateAll(visiblePortalFieldState);
    assert.deepEqual(fieldState.filter(field => field.kind === "card_number").map(field => field.filled), [true, false]);
    assert.equal(fieldState.filter(field => field.kind === "link_name").length, 0);
    assert.doesNotMatch(JSON.stringify(fieldState), /hidden-proxy|invisible-ancestor|424242|10001/);
    const snapshot = await portalFieldStateDiagnostics({ url: () => standard.portal_url, frames: () => page.frames() });
    assert.deepEqual(snapshot.filter(field => field.kind === "card_number").map(field => field.filled), [true, false]);
    assert.equal(externalRequest, false);
  } finally {
    await browser.close();
  }
});


for (const label of ["Guardar mis datos para un proceso de compra más rápido", "Save my information for faster checkout"]) {
  test(`styled Link opt-in is unchecked through normal actionability: ${label}`, {
    skip: process.env.KOV005_PORTAL_LOCAL_BROWSER_TEST !== "true",
  }, async () => {
    const { chromium } = await import("playwright");
    const { completeTestPaymentFields } = await import("./complete-stripe-test-portal.mjs");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let externalRequest = false;
      await page.route("**/*", async route => { externalRequest = true; await route.abort(); });
      // The hosted diagnostic shows the optional enrollment visibly checked.
      // A native input styled with opacity zero remains an actionable checkbox;
      // it is different from an invisible autofill input/frame.
      const form = `<!doctype html><html><body>
        <input name="number" autocomplete="cc-number" required>
        <input name="expiry" autocomplete="cc-exp" required>
        <input name="cvc" autocomplete="cc-csc" required>
        <select name="country"><option value="MX">Mexico</option><option value="US">United States</option></select>
        <input name="postalCode" autocomplete="billing postal-code" required>
        <label><input name="savePaymentDetails" type="checkbox" checked style="opacity:0;width:20px;height:20px">${label}</label>
        <input name="search-linkEmail" value="qa-only@example.invalid">
        <input name="linkMobilePhone">
        <button id="add" type="button" disabled>Add</button>
        <script>
          const optIn = document.querySelector('[type=checkbox]');
          const postal = document.querySelector('[name=postalCode]');
          function update() { document.querySelector('#add').disabled = optIn.checked || postal.value !== '10001'; }
          optIn.addEventListener('change', update);
          postal.addEventListener('blur', update);
          document.querySelector('select').addEventListener('change', () => { optIn.checked = true; update(); });
        </script></body></html>`;
      await page.setContent('<iframe id="proxy" style="opacity:0"></iframe><iframe id="payment"></iframe>');
      for (const id of ["proxy", "payment"]) {
        await page.locator(`#${id}`).evaluate((iframe, html) => { iframe.srcdoc = html; }, form);
      }
      const frame = page.frameLocator("#payment");
      await frame.getByRole("checkbox", { name: label }).waitFor();
      assert.equal(await frame.getByRole("checkbox", { name: label }).isChecked(), true);
      await completeTestPaymentFields(page);
      assert.equal(await frame.getByRole("checkbox", { name: label }).isChecked(), false);
      assert.equal(await page.frameLocator("#proxy").getByRole("checkbox", { name: label }).isChecked(), true);
      assert.equal(await frame.locator('[name="search-linkEmail"]').inputValue(), "qa-only@example.invalid");
      assert.equal(await frame.locator('[name="linkMobilePhone"]').inputValue(), "");
      assert.equal(await frame.locator("#add").isEnabled(), true);
      assert.equal(externalRequest, false);
    } finally { await browser.close(); }
  });
}

test("optional Link prefill is preserved without supplying phone or enrolling the customer", {
  skip: process.env.KOV005_PORTAL_LOCAL_BROWSER_TEST !== "true",
}, async () => {
  const { chromium } = await import("playwright");
  const { completeTestPaymentFields } = await import("./complete-stripe-test-portal.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let externalRequest = false;
    await page.route("**/*", async route => { externalRequest = true; await route.abort(); });
    // Observed provider shape: Optional Link enrollment, QA email prefilled,
    // empty aria-required phone with native validity true, and no checkbox.
    // The interactive sandbox permits a card save with the supplied email and
    // an empty phone. The old fixture incorrectly treated any prefilled email
    // as consent, then rewarded blanking the supplied email. Model the observed
    // ability to save without a phone. Hosted acceptance
    // still independently checks the customer's effective default PaymentMethod.
    const form = `<!doctype html><html><body><form>
      <input name="number" autocomplete="cc-number" required>
      <input name="expiry" autocomplete="cc-exp" required>
      <input name="cvc" autocomplete="cc-csc" required>
      <select name="country" required><option value="MX" selected>Mexico</option><option value="US">United States</option></select>
      <input name="postalCode" autocomplete="billing postal-code" required>
      <input name="billingEmail" type="email" value="customer-kept@example.invalid">
      <section><h2>Optional</h2><p>Save my information for faster checkout</p>
        <input name="search-linkEmail" type="email" value="qa-only@example.invalid" required aria-required="true">
        <input name="linkMobilePhone" type="tel" aria-required="true">
        <input name="linkLegalName">
      </section>
      <button id="add" type="button" disabled>Add</button>
      <script>
        const email = document.querySelector('[name="search-linkEmail"]');
        const phone = document.querySelector('[name="linkMobilePhone"]');
        const cvc = document.querySelector('[name=cvc]');
        const postal = document.querySelector('[name=postalCode]');
        let cardCommitted = false, postalCommitted = false;
        function update() {
          document.querySelector('#add').disabled = Boolean(phone.value)
            || !cardCommitted || !postalCommitted;
        }
        cvc.addEventListener('blur', () => { cardCommitted = cvc.value.length === 3; update(); });
        email.addEventListener('input', update);
        postal.addEventListener('blur', () => { postalCommitted = postal.value.length === 5; update(); });
        // The billing rerender retains its prefill; it is not a Link opt-in.
        document.querySelector('[name=country]').addEventListener('change', () => {
          email.value = 'qa-only@example.invalid'; email.required = true;
          phone.setAttribute('aria-required', 'true'); update();
        });
      </script></form></body></html>`;
    await page.setContent('<iframe id="proxy" style="opacity:0"></iframe><iframe id="payment"></iframe>');
    for (const id of ["proxy", "payment"]) {
      await page.locator(`#${id}`).evaluate((iframe, html) => { iframe.srcdoc = html; }, form);
    }
    const frame = page.frameLocator("#payment");
    await frame.locator('[name="search-linkEmail"]').waitFor();
    const before = await frame.locator("input,select").evaluateAll(visiblePortalFieldState);
    assert.equal(before.find(field => field.kind === "link_email").filled, true);
    assert.equal(before.find(field => field.kind === "link_phone").filled, false);
    assert.equal(before.find(field => field.kind === "link_phone").required, true);
    assert.equal(before.find(field => field.kind === "link_phone").html_valid, true);
    assert.equal(before.some(field => field.kind === "link_opt_in"), false);
    assert.equal(await frame.getByRole("checkbox").count(), 0);
    await completeTestPaymentFields(page);
    assert.equal(await frame.locator('[name="search-linkEmail"]').inputValue(), "qa-only@example.invalid");
    assert.equal(await frame.locator('[name="linkMobilePhone"]').inputValue(), "");
    assert.equal(await frame.locator('[name="linkLegalName"]').inputValue(), "");
    assert.equal(await frame.locator('[name="billingEmail"]').inputValue(), "customer-kept@example.invalid");
    assert.equal(await page.frameLocator("#proxy").locator('[name="search-linkEmail"]').inputValue(), "qa-only@example.invalid");
    assert.equal(await frame.locator("#add").isEnabled(), true);
    const after = await portalFieldStateDiagnostics({ url: () => standard.portal_url, frames: () => page.frames() });
    assert.equal(after.find(field => field.kind === "link_email").filled, true);
    assert.doesNotMatch(JSON.stringify(after), /example|qa-only|customer-kept|424242|10001/);
    assert.equal(externalRequest, false);
  } finally { await browser.close(); }
});



test("fixture match diagnostics normalize only known fixtures and never emit their values", () => {
  const inputs = [
    ["number", "4242 4242 4242 4242"], ["expiry", "12 / 30"], ["cvc", "123"],
    ["country", "US"], ["postalCode", "10001"],
  ];
  const matching = visiblePortalFieldState(inputs.map(([name, value]) => diagnosticField({ name, value })));
  assert.deepEqual(matching.map(field => field.fixture_match), [true, true, true, true, true]);
  const wrong = visiblePortalFieldState(inputs.map(([name]) => diagnosticField({
    name, value: "private.customer@example.invalid/secret",
  })));
  assert.deepEqual(wrong.map(field => field.fixture_match), [false, false, false, false, false]);
  const identity = visiblePortalFieldState([diagnosticField({ name: "search-linkEmail", value: "private" })]);
  assert.equal(Object.hasOwn(identity[0], "fixture_match"), false);
  assert.doesNotMatch(JSON.stringify([...matching, ...wrong, ...identity]),
    /4242|1230|10001|private|secret|example|value|length/);
});


test("local keyboard-handled masked form commits all five fixtures without forcing submission", {
  skip: process.env.KOV005_PORTAL_LOCAL_BROWSER_TEST !== "true",
}, async () => {
  const { chromium } = await import("playwright");
  const { completeTestPaymentFields } = await import("./complete-stripe-test-portal.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let externalRequest = false;
    await page.route("**/*", async route => { externalRequest = true; await route.abort(); });
    // A local reproduction of special keyboard handling, not a claim that the
    // hosted Portal uses this implementation or that its root cause is proven.
    const html = `<!doctype html><html><body><form>
      <input name="number" autocomplete="cc-number" required>
      <input name="expiry" autocomplete="cc-exp" required>
      <input name="cvc" autocomplete="cc-csc" required>
      <select name="country" required><option value="MX">Mexico</option><option value="US">United States</option></select>
      <input name="postalCode" autocomplete="billing postal-code" required>
      <button id="add" type="button" disabled>Add</button>
      <script>
        const names = ['number', 'expiry', 'cvc', 'postalCode'];
        const keyed = {}, committed = {};
        let countryCommitted = false;
        function update() {
          document.querySelector('#add').disabled = !countryCommitted
            || !names.every(name => keyed[name] && committed[name]);
        }
        for (const name of names) {
          const field = document.querySelector('[name="' + name + '"]');
          field.addEventListener('keydown', event => {
            if (/^[0-9]$/.test(event.key)) keyed[name] = true;
          });
          field.addEventListener('input', () => {
            if (!field.value) keyed[name] = false;
            if (name === 'expiry') {
              const digits = field.value.replace(/[^0-9]/g, '');
              field.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
            }
            committed[name] = false; update();
          });
          field.addEventListener('blur', () => { committed[name] = Boolean(field.value); update(); });
        }
        const country = document.querySelector('[name=country]');
        country.addEventListener('blur', () => { countryCommitted = country.value === 'US'; update(); });
      </script></form></body></html>`;
    await page.setContent('<iframe id="payment"></iframe>');
    await page.locator("#payment").evaluate((frame, src) => { frame.srcdoc = src; }, html);
    const frame = page.frameLocator("#payment");
    await frame.locator("[name=expiry]").waitFor();
    await frame.locator("[name=expiry]").fill("1230");
    await frame.locator("[name=expiry]").press("Tab");
    assert.equal(await frame.locator("[name=expiry]").evaluate(field => field.validity.valid), true);
    assert.equal(await frame.locator("#add").isEnabled(), false);
    await completeTestPaymentFields(page);
    const fields = await frame.locator("input,select").evaluateAll(visiblePortalFieldState);
    assert.equal(fields.length, 5);
    assert.equal(fields.every(field => field.fixture_match === true), true);
    assert.equal(await frame.locator("#add").isEnabled(), true, "keyboard-handled local form remained disabled");
    assert.equal(externalRequest, false);
    assert.doesNotMatch(JSON.stringify(fields), /4242|1230|10001|value|length/);
  } finally { await browser.close(); }
});
