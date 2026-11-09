import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const actions = new Set(["inspect", "payment_update", "cancel", "standard", "upgrade_decline", "upgrade_success", "downgrade"]);
const basicActions = new Set(["inspect", "payment_update", "cancel"]);
const updateNames = /^(?:cambiar plan|actualizar plan|actualizar suscripción|update plan|change plan|update subscription)$/i;
const confirmNames = /^(?:confirmar|confirm|confirmar cambio|confirm change|actualizar|update|actualizar suscripción|update subscription|cambiar plan|change plan)$/i;

const failureReasons = new Set([
  "control_not_found", "control_not_visible", "control_disabled", "click_timeout",
  "click_failed", "outside_provider", "stage_timeout", "unknown",
  "field_missing", "billing_country_missing", "billing_postal_missing",
]);
const publicLabels = new Map([
  ["guardar", "save"], ["save", "save"],
  ["actualizar", "update"], ["update", "update"],
  ["actualizar tarjeta", "update_card"], ["update card", "update_card"],
  ["guardar cambios", "save_changes"], ["save changes", "save_changes"],
  ["guardar tarjeta", "save_card"], ["save card", "save_card"],
  ["guardar método de pago", "save_payment_method"], ["save payment method", "save_payment_method"],
  ["agregar", "add"], ["añadir", "add"], ["add", "add"],
  ["agregar tarjeta", "add_card"], ["añadir tarjeta", "add_card"], ["add card", "add_card"],
  ["agregar método de pago", "add_payment_method"], ["añadir método de pago", "add_payment_method"],
  ["add payment method", "add_payment_method"],
  ["actualizar método de pago", "update_payment_method"], ["update payment method", "update_payment_method"],
  ["continuar", "continue"], ["continue", "continue"], ["siguiente", "continue"], ["next", "continue"],
  ["confirmar", "confirm"], ["confirm", "confirm"],
  ["volver", "back"], ["back", "back"], ["cancelar", "cancel"], ["cancel", "cancel"],
  ["cancelar suscripción", "cancel_subscription"], ["cancel subscription", "cancel_subscription"],
]);

class PortalControlError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export async function portalFailureDiagnostics(error, page) {
  const reason = failureReasons.has(error?.reason) ? error.reason
    : error?.name === "TimeoutError" ? "stage_timeout" : "unknown";
  const controls = [];
  if (!page) return { reason, controls };
  try {
    requirePortalOrigin(page);
    const seen = new Set();
    for (const role of ["button", "link"]) {
      const candidates = await page.getByRole(role).all();
      for (const candidate of candidates.slice(0, 50)) {
        if (!await candidate.isVisible()) continue;
        const text = await candidate.getAttribute("aria-label", { timeout: 250 })
          || await candidate.innerText({ timeout: 250 });
        const normalized = String(text).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        // Unknown labels may contain customer names, card details or bearer URLs. Never emit them.
        const label = publicLabels.get(normalized) || "other";
        const enabled = await candidate.isEnabled({ timeout: 250 });
        const key = `${label}:${enabled}`;
        if (!seen.has(key)) { controls.push({ label, enabled }); seen.add(key); }
      }
    }
  } catch { /* Closed/outside-provider pages produce no additional diagnostics. */ }
  return { reason, controls };
}

// This function runs inside a visible frame. Raw DOM attributes/values never leave it.
export function visiblePortalFieldState(elements) {
  const states = [];
  for (const element of elements.slice(0, 128)) {
    if (states.length >= 64) break;
    if (element.type === "hidden") continue;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!element.getClientRects().length || rect.width <= 0 || rect.height <= 0
        || style.display === "none" || style.visibility !== "visible" || style.opacity === "0") continue;
    if (typeof element.checkVisibility === "function"
        && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const name = (element.getAttribute("name") || "").toLowerCase();
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    let kind = "other";
    // Explicit Link names take precedence over ambiguous billing autocomplete tokens.
    if (name === "search-linkemail") kind = "link_email";
    else if (name === "linkmobilephone") kind = "link_phone";
    else if (name === "linklegalname") kind = "link_name";
    else if (name === "enablestripepass") kind = "link_opt_in";
    else if (["number", "cardnumber"].includes(name) || autocomplete.includes("cc-number")) kind = "card_number";
    else if (["expiry", "cardexpiry"].includes(name)
        || autocomplete.some(token => ["cc-exp", "cc-exp-month", "cc-exp-year"].includes(token))) kind = "card_expiry";
    else if (["cvc", "cardcvc"].includes(name) || autocomplete.includes("cc-csc")) kind = "card_cvc";
    else if (["country", "billingcountry"].includes(name)
        || autocomplete.some(token => ["country", "country-name"].includes(token))) kind = "billing_country";
    else if (name === "postalcode" || autocomplete.includes("postal-code")) kind = "billing_postal";
    else if (name === "billingname" || autocomplete.includes("cc-name")
        || autocomplete.includes("billing") && autocomplete.includes("name")) kind = "billing_name";
    const checkable = ["checkbox", "radio"].includes(element.type);
    const state = {
      kind,
      filled: checkable ? element.checked === true : Boolean(element.value),
      required: element.required === true || element.getAttribute("aria-required") === "true",
      html_valid: element.validity?.valid === true,
      aria_invalid: ["true", "grammar", "spelling"].includes(element.getAttribute("aria-invalid")),
      checked: checkable && element.checked === true,
    };
    // Fixed synthetic fixtures only; values stay inside the visible frame.
    const fixtures = { card_number: "4242424242424242", card_expiry: "1230", card_cvc: "123",
      billing_country: "US", billing_postal: "10001" };
    if (Object.hasOwn(fixtures, kind)) {
      const value = String(element.value ?? "");
      const normalized = kind === "card_number" ? value.replace(/\s/g, "")
        : kind === "card_expiry" ? value.replace(/[\s/]/g, "") : value;
      state.fixture_match = normalized === fixtures[kind];
    }
    states.push(state);
  }
  return states;
}

function renderedPortalElement(element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return element.type !== "hidden" && rect.width > 0 && rect.height > 0 && style.display !== "none"
    && style.visibility === "visible" && style.opacity !== "0"
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

async function visiblePortalFrame(frame) {
  try {
    let current = frame;
    for (let depth = 0; depth < 12; depth++) {
      const parent = current.parentFrame();
      if (!parent) return true;
      const handle = await current.frameElement();
      try { if (!await handle.evaluate(renderedPortalElement)) return false; }
      finally { await handle.dispose(); }
      current = parent;
    }
  } catch { /* Detached/unavailable frames are not interaction targets. */ }
  return false;
}

export async function portalFieldStateDiagnostics(page) {
  const fields = [];
  if (!page) return fields;
  try { requirePortalOrigin(page); } catch { return fields; }
  for (const frame of page.frames().slice(0, 12)) {
    if (fields.length >= 64) break;
    try {
      requirePortalOrigin(page);
      if (!await visiblePortalFrame(frame)) continue;
      const states = await frame.locator("input,select,textarea").evaluateAll(visiblePortalFieldState);
      requirePortalOrigin(page);
      fields.push(...states.slice(0, 64 - fields.length));
    } catch { /* Detached/unavailable frames disclose no data or raw errors. */ }
  }
  return fields;
}

export function validatePortalState(state) {
  let url;
  try { url = new URL(state.portal_url); } catch { throw new Error("invalid_portal_url"); }
  // The provider owns the opaque path; only its exact HTTPS origin is part of this contract.
  if (url.protocol !== "https:" || url.host !== "billing.stripe.com" || url.username || url.password
      || state.provider_livemode !== false) {
    throw new Error("invalid_portal_scope");
  }
  if (!actions.has(state.action)) throw new Error("invalid_portal_action");
  if (basicActions.has(state.action)) {
    const plans = { standard: ["Standard", 299], esencial: ["Esencial", 399], gestion: ["Gestión", 699] };
    const plan = plans[state.plan_code];
    if (!plan || state.current_plan !== plan[0] || state.current_amount !== plan[1]) {
      throw new Error("invalid_basic_portal_plan");
    }
    return state;
  }
  const expected = state.action === "standard" ? ["Standard", 299]
    : state.action === "downgrade" ? ["Gestión", 699] : ["Esencial", 399];
  if (state.current_plan !== expected[0] || state.current_amount !== expected[1]
      || state.target_plan !== (state.action === "downgrade" ? "Esencial" : "Gestión")
      || state.target_amount !== (state.action === "downgrade" ? 399 : 699)) {
    throw new Error("invalid_portal_plan");
  }
  return state;
}

function requirePortalOrigin(page) {
  const current = new URL(page.url());
  if (current.protocol !== "https:" || current.host !== "billing.stripe.com") {
    throw new PortalControlError("outside_provider");
  }
}

async function visibleNamedControl(page, name) {
  for (const role of ["button", "link"]) {
    const candidates = await page.getByRole(role, { name }).all();
    for (const candidate of candidates.toReversed()) {
      if (await candidate.isVisible() && await candidate.isEnabled()) return candidate;
    }
  }
  return null;
}

export async function clickControl(page, name, {
  timeoutMs = 15_000, now = Date.now, wait = ms => page.waitForTimeout(ms),
} = {}) {
  requirePortalOrigin(page);
  const deadline = now() + timeoutMs;
  let matched = false;
  while (now() < deadline) {
    requirePortalOrigin(page);
    for (const role of ["button", "link"]) {
      const candidates = await page.getByRole(role, { name }).all();
      matched ||= candidates.length > 0;
      for (const candidate of candidates.toReversed()) {
        if (!await candidate.isVisible()) continue;
        try {
          // Keep disabled controls: Playwright waits for enabled/stable/unobstructed actionability.
          await candidate.click({ timeout: Math.max(1, deadline - now()) });
          return;
        } catch (error) {
          try {
            if (!await candidate.isVisible()) throw new PortalControlError("control_not_visible");
            if (!await candidate.isEnabled({ timeout: 250 })) throw new PortalControlError("control_disabled");
          } catch (stateError) {
            if (stateError instanceof PortalControlError) throw stateError;
          }
          throw new PortalControlError(error?.name === "TimeoutError" ? "click_timeout" : "click_failed");
        }
      }
    }
    await wait(Math.min(100, Math.max(1, deadline - now())));
  }
  throw new PortalControlError(matched ? "control_not_visible" : "control_not_found");
}

async function fillCardField(page, selectors, value, required = true, missingReason = "field_missing") {
  const deadline = Date.now() + (required ? 30_000 : 2_000);
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!await visiblePortalFrame(frame)) continue;
      for (const selector of selectors) {
        for (const field of await frame.locator(selector).all()) {
          if (await field.isVisible() && await field.evaluate(renderedPortalElement)) {
            await field.fill("");
            await field.pressSequentially(value, { delay: 25 });
            return field;
          }
        }
      }
    }
    await page.waitForTimeout(100);
  }
  if (required) throw new PortalControlError(missingReason);
}

async function chooseTestBillingCountry(page) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!await visiblePortalFrame(frame)) continue;
      for (const selector of ["select[name=country]", "select[name=billingCountry]",
        "select[autocomplete~=country]", "select[autocomplete~=country-name]"]) {
        for (const field of await frame.locator(selector).all()) {
          if (await field.isVisible() && await field.evaluate(renderedPortalElement)) {
            await field.selectOption("US");
            await field.press("Tab");
            return;
          }
        }
      }
    }
    await page.waitForTimeout(100);
  }
  throw new PortalControlError("billing_country_missing");
}

async function declineLinkOptIn(page) {
  for (const frame of page.frames()) {
    if (!await visiblePortalFrame(frame)) continue;
    const candidates = [...await frame.locator("input[name=enableStripePass]").all(),
      ...await frame.getByRole("checkbox", { name: /Link|Stripe Pass/i }).all()];
    for (const checkbox of candidates) {
      if (await checkbox.isVisible() && await checkbox.evaluate(renderedPortalElement)
          && await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }
    // A prefilled optional Link email is not consent. The hosted form permits
    // saving the card without a phone/Link signup. Preserve its supplied identity
    // fields instead of blanking a field Stripe still marks required. Only an
    // actual checked opt-in control should be changed here.
  }
}

export async function completeTestPaymentFields(page, setStage = () => {}) {
  setStage("fill_test_payment_method");
  const number = await fillCardField(page,
    ["input[name=cardNumber]", "input[autocomplete=cc-number]"], "4242424242424242");
  await number.press("Tab");
  const expiry = await fillCardField(page,
    ["input[name=cardExpiry]", "input[autocomplete=cc-exp]"], "1230");
  await expiry.press("Tab");
  const cvc = await fillCardField(page, ["input[name=cardCvc]", "input[autocomplete=cc-csc]"], "123");
  setStage("commit_test_card");
  await cvc.press("Tab");
  // Do not fill optional Link identity fields or opt the synthetic customer into Link.
  setStage("decline_link_enrollment");
  await declineLinkOptIn(page);
  setStage("select_billing_country");
  await chooseTestBillingCountry(page);
  setStage("fill_billing_postal");
  const postal = await fillCardField(page,
    ["input[name=postalCode]", "input[autocomplete~='postal-code']"], "10001", true,
    "billing_postal_missing");
  setStage("commit_billing_postal");
  await postal.press("Tab");
  // Billing changes may rerender Stripe's prefilled optional Link fields.
  setStage("decline_link_enrollment");
  await declineLinkOptIn(page);
}

async function updatePaymentMethod(page, setStage) {
  setStage("open_payment_method");
  await clickControl(page, /^(?:agregar método de pago|añadir método de pago|actualizar método de pago|add payment method|update payment method|edit payment method)$/i);
  await completeTestPaymentFields(page, setStage);
  const makeDefault = page.getByRole("checkbox", { name: /predeterminado|default/i }).first();
  if (await makeDefault.count() && await makeDefault.isVisible() && !await makeDefault.isChecked()) {
    await makeDefault.check();
  }
  setStage("save_payment_method");
  await clickControl(page, /^(?:guardar|guardar cambios|guardar tarjeta|guardar método de pago|actualizar|actualizar tarjeta|actualizar método de pago|agregar|añadir|agregar tarjeta|añadir tarjeta|agregar método de pago|añadir método de pago|save|save changes|save card|save payment method|add|add card|add payment method|update|update card|update payment method)$/i);
}

async function cancelAtPeriodEnd(page, setStage) {
  setStage("open_cancellation");
  const names = /^(?:cancelar suscripción|cancelar plan|cancel subscription|cancel plan)$/i;
  await clickControl(page, names);
  const reason = page.getByRole("radio", { name: /otro|other/i }).first();
  if (await reason.count() && await reason.isVisible()) await reason.check();
  const note = page.getByRole("textbox", { name: /comentario|comment|reason|motivo|detalle|detail/i }).first();
  if (await note.count() && await note.isVisible()) await note.fill("Kova sandbox acceptance");
  setStage("confirm_cancellation");
  await clickControl(page, /^(?:confirmar cancelación|confirmar|cancelar suscripción|cancelar plan|confirm cancellation|confirm|cancel subscription|cancel plan)$/i);
}

export async function exercisePortal(page, state, setStage = () => {}) {
  validatePortalState(state);
  setStage("open_portal");
  await page.goto(state.portal_url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  requirePortalOrigin(page);
  setStage("inspect_current_plan");
  if (state.action === "standard") {
    await page.getByText(/Standard/i).first().waitFor({ state: "visible", timeout: 30_000 });
  }
  const amount = new RegExp(`(?<![0-9])${state.current_amount}(?:[.,]00)?(?![0-9])`);
  await page.getByText(amount).first().waitFor({ state: "visible", timeout: 30_000 });
  if (state.action === "standard" || basicActions.has(state.action)) {
    // A healthy overview, not a blank or failed page, must precede the absence assertion.
    await page.getByText(/método de pago|payment method|historial de factur|invoice history/i)
      .first().waitFor({ state: "visible", timeout: 30_000 });
    if (await visibleNamedControl(page, updateNames)) throw new Error("basic_plan_change_exposed");
    if (state.action === "standard" || state.action === "inspect") {
      return { action: state.action, submitted: false, inspected: true };
    }
    if (state.action === "payment_update") {
      await updatePaymentMethod(page, setStage);
    } else {
      await cancelAtPeriodEnd(page, setStage);
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    return { action: state.action, submitted: true, inspected: true };
  }
  setStage("open_plan_change");
  await clickControl(page, updateNames);
  setStage("select_target_plan");
  const targetAmount = new RegExp(`(?<![0-9])${state.target_amount}(?:[.,]00)?(?![0-9])`);
  const namedTarget = page.getByText(new RegExp(state.target_plan, "i")).first();
  const target = await namedTarget.count() && await namedTarget.isVisible()
    ? namedTarget : page.getByText(targetAmount).first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  const radio = page.getByRole("radio", { name: targetAmount }).first();
  if (await radio.count() && await radio.isVisible()) await radio.check();
  else await target.click();
  const next = await visibleNamedControl(page, /^(?:continuar|continue|siguiente|next)$/i);
  if (next) await next.click();
  setStage("confirm_plan_change");
  requirePortalOrigin(page);
  await page.getByText(targetAmount).first().waitFor({ state: "visible", timeout: 30_000 });
  await clickControl(page, confirmNames);
  // Hosted UI submission is not proof of payment. Python validates the new invoice/event and Kova.
  setStage("wait_for_provider_submission");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return { action: state.action, submitted: true, inspected: true };
}

export function portalBrowserOptions(mode = "headless") {
  if (!["headless", "headed"].includes(mode)) throw new Error("invalid_portal_browser_mode");
  return { headless: mode === "headless" };
}

export async function savePortalDiagnostic(page, filename) {
  if (!page || !filename) return false;
  try {
    requirePortalOrigin(page);
    await page.screenshot({ path: filename, fullPage: false });
    return true;
  } catch { return false; }
}

async function main() {
  let browser;
  let page;
  let stage = "validate_input";
  try {
    const filename = process.env.KOV005_PORTAL_STATE_FILE;
    if (!filename) throw new Error("missing_portal_state");
    const state = validatePortalState(JSON.parse(fs.readFileSync(filename, "utf8")));
    const { chromium } = await import("playwright");
    browser = await chromium.launch(portalBrowserOptions(process.env.KOV005_PORTAL_BROWSER));
    page = await browser.newPage();
    const outcome = await exercisePortal(page, state, (value) => { stage = value; });
    process.stdout.write(JSON.stringify(outcome));
  } catch (error) {
    // Only fixed enums survive; never serialize Playwright errors, URLs or arbitrary DOM labels.
    const diagnostic = await portalFailureDiagnostics(error, page);
    process.stderr.write(`KOV005_PORTAL_FAILURE_STAGE=${stage}\n`);
    process.stderr.write(`KOV005_PORTAL_FAILURE_REASON=${diagnostic.reason}\n`);
    const controls = diagnostic.controls.map(({ label, enabled }) => `${label}:${enabled ? "enabled" : "disabled"}`).join(",");
    process.stderr.write(`KOV005_PORTAL_PUBLIC_CONTROLS=${controls}\n`);
    const fieldState = await portalFieldStateDiagnostics(page);
    process.stderr.write(`KOV005_PORTAL_FIELD_STATE=${JSON.stringify(fieldState)}\n`);
    await savePortalDiagnostic(page, process.env.KOV005_PORTAL_DIAGNOSTIC_PATH);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
