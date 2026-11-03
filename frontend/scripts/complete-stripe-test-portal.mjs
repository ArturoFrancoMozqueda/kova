import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const actions = new Set(["inspect", "payment_update", "cancel", "standard", "upgrade_decline", "upgrade_success", "downgrade"]);
const basicActions = new Set(["inspect", "payment_update", "cancel"]);
const updateNames = /^(?:cambiar plan|actualizar plan|actualizar suscripción|update plan|change plan|update subscription)$/i;
const confirmNames = /^(?:confirmar|confirm|confirmar cambio|confirm change|actualizar|update|actualizar suscripción|update subscription|cambiar plan|change plan)$/i;

export function validatePortalState(state) {
  let url;
  try { url = new URL(state.portal_url); } catch { throw new Error("invalid_portal_url"); }
  if (url.protocol !== "https:" || url.host !== "billing.stripe.com" || url.username || url.password
      || !url.pathname.startsWith("/p/session/") || state.provider_livemode !== false) {
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
    throw new Error("portal_navigated_outside_provider");
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

async function clickControl(page, name) {
  requirePortalOrigin(page);
  const control = await visibleNamedControl(page, name);
  if (!control) throw new Error("portal_control_not_found");
  await control.click();
}

async function fillCardField(page, selectors, value, required = true) {
  const deadline = Date.now() + (required ? 30_000 : 2_000);
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        if (await field.count() && await field.isVisible()) {
          await field.fill(value);
          return;
        }
      }
    }
    await page.waitForTimeout(100);
  }
  if (required) throw new Error("portal_card_field_not_found");
}

async function updatePaymentMethod(page, setStage) {
  setStage("open_payment_method");
  await clickControl(page, /^(?:agregar método de pago|añadir método de pago|actualizar método de pago|add payment method|update payment method|edit payment method)$/i);
  setStage("fill_test_payment_method");
  await fillCardField(page, ["input[name=cardNumber]", "input[autocomplete=cc-number]"], "4242424242424242");
  await fillCardField(page, ["input[name=cardExpiry]", "input[autocomplete=cc-exp]"], "1230");
  await fillCardField(page, ["input[name=cardCvc]", "input[autocomplete=cc-csc]"], "123");
  await fillCardField(page, ["input[name=billingName]", "input[autocomplete=cc-name]"], "Kova Sandbox", false);
  await fillCardField(page, ["input[name=postalCode]", "input[autocomplete=postal-code]"], "10001", false);
  const makeDefault = page.getByRole("checkbox", { name: /predeterminado|default/i }).first();
  if (await makeDefault.count() && await makeDefault.isVisible() && !await makeDefault.isChecked()) {
    await makeDefault.check();
  }
  setStage("save_payment_method");
  await clickControl(page, /^(?:guardar|guardar método de pago|agregar|añadir|agregar método de pago|save|save payment method|add|add payment method|update payment method)$/i);
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

async function main() {
  let browser;
  let stage = "validate_input";
  try {
    const filename = process.env.KOV005_PORTAL_STATE_FILE;
    if (!filename) throw new Error("missing_portal_state");
    const state = validatePortalState(JSON.parse(fs.readFileSync(filename, "utf8")));
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const outcome = await exercisePortal(page, state, (value) => { stage = value; });
    process.stdout.write(JSON.stringify(outcome));
  } catch {
    // Never let Playwright diagnostics include a bearer Portal URL or customer page content.
    process.stderr.write(`KOV005_PORTAL_FAILURE_STAGE=${stage}\n`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
