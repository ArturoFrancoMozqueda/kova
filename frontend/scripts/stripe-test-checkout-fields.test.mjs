import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutFieldError, checkoutFailureReason, completeCheckoutBilling,
  fillCheckoutField } from "./stripe-test-checkout-fields.mjs";

function clock() {
  let time = 0;
  return { now: () => time, wait: async ms => { time += ms; } };
}

test("a replaced Stripe frame is rescanned without replaying a completed edit", async () => {
  let scans = 0;
  const edits = [];
  const field = { isVisible: async () => true, fill: async value => { edits.push(value); } };
  const page = { frames: () => [{ locator: () => ({ all: async () => {
    if (++scans === 1) throw new Error("Frame was detached; https://example.invalid/private");
    return [field];
  } }) }] };
  assert.equal(await fillCheckoutField(page, ["input"], "fixture", clock()), true);
  assert.deepEqual(edits, ["fixture"]);
  assert.equal(scans, 2);
});

test("hidden first matches cannot mask a later visible billing field", async () => {
  let changed = false;
  const page = { frames: () => [{ locator: () => ({ all: async () => [
    { isVisible: async () => false, fill: async () => { throw new Error("hidden"); } },
    { isVisible: async () => true, fill: async () => { changed = true; } },
  ] }) }] };
  await fillCheckoutField(page, ["input"], "fixture", clock());
  assert.equal(changed, true);
});

test("missing fields and repeated replacement terminate within the original deadline", async () => {
  const timer = clock();
  const missing = { frames: () => [{ locator: () => ({ all: async () => [] }) }] };
  assert.equal(await fillCheckoutField(missing, ["input"], "fixture", { ...timer,
    timeoutMs: 250, required: false }), false);
  assert.equal(timer.now(), 250);
  await assert.rejects(fillCheckoutField(missing, ["input"], "fixture", { ...timer,
    timeoutMs: 250 }), { reason: "field_missing" });
  const detached = { frames: () => [{ locator: () => ({ all: async () => {
    throw new Error("Execution context was destroyed");
  } }) }] };
  await assert.rejects(fillCheckoutField(detached, ["input"], "fixture", { ...timer,
    timeoutMs: 250 }), { reason: "field_unstable" });
  assert.equal(timer.now(), 750);
});

test("unexpected field failures expose a fixed reason without the provider error", async () => {
  const page = { frames: () => [{ locator: () => ({ all: async () => {
    throw new Error("https://checkout.stripe.com/private?token=do-not-log");
  } }) }] };
  await assert.rejects(fillCheckoutField(page, ["input"], "fixture", clock()), error => {
    assert.equal(error.message, "field_action_failed");
    return true;
  });
  assert.equal(checkoutFailureReason(new CheckoutFieldError("field_unstable")), "field_unstable");
  assert.equal(checkoutFailureReason(new CheckoutFieldError("private_token")), "unknown");
  assert.equal(checkoutFailureReason({ name: "TimeoutError" }), "stage_timeout");
});

test("the real browser selects the ZIP fixture's country and waits for its dynamic postal field", {
  skip: process.env.KOV005_CHECKOUT_LOCAL_BROWSER_TEST !== "true",
}, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let network = false;
    await page.route("**/*", async route => { network = true; await route.abort(); });
    await page.setContent(`<!doctype html><select name="billingCountry">
      <option value="MX">Mexico</option><option value="US">United States</option></select>
      <input name="billingName" autocomplete="cc-name">
      <input name="billingPostalCode" style="display:none" value="hidden-preserved">
      <script>document.querySelector('select').addEventListener('change', () => {
        setTimeout(() => {const input=document.createElement('input');
          input.name='billingPostalCode'; input.autocomplete='billing postal-code';
          document.body.appendChild(input);}, 25);
      });</script>`);
    await completeCheckoutBilling(page);
    assert.equal(await page.locator("select").inputValue(), "US");
    assert.equal(await page.locator('[name=billingName]').inputValue(), "Kova Sandbox");
    assert.deepEqual(await page.locator('[name=billingPostalCode]').evaluateAll(
      elements => elements.map(element => element.value)), ["hidden-preserved", "10001"]);
    assert.equal(network, false);
  } finally { await browser.close(); }
});
