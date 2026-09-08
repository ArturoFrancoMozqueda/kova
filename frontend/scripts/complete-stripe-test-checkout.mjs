import fs from "node:fs";
import { chromium } from "playwright";

const statePath = process.env.KOV005_CHECKOUT_STATE_FILE;
const diagnosticPath = process.env.KOV005_CHECKOUT_DIAGNOSTIC_PATH;
if (!statePath) {
  throw new Error("KOV005_CHECKOUT_STATE_FILE is required");
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const checkoutUrl = String(state.checkout_url || "");
if (!checkoutUrl.startsWith("https://checkout.stripe.com/") || !checkoutUrl.includes("cs_test")) {
  throw new Error("Refusing to open a non-test Stripe Checkout URL");
}

const browser = await chromium.launch({ headless: true });
let stage = "open_checkout";
try {
  const page = await browser.newPage();
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const fillFirstVisible = async (selectors, value, required = true) => {
    const deadline = Date.now() + (required ? 30_000 : 3_000);
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        for (const frame of page.frames()) {
          const field = frame.locator(selector).first();
          if ((await field.count()) && (await field.isVisible())) {
            await field.fill(value);
            return true;
          }
        }
      }
      await page.waitForTimeout(250);
    }
    if (required) throw new Error(`Stripe Checkout field not found: ${selectors.join(", ")}`);
    return false;
  };

  stage = "fill_email";
  await fillFirstVisible(
    ["input[name=email]", "input[autocomplete=email]", "input[type=email]"],
    "kov005-checkout@example.com",
  );
  stage = "fill_card_number";
  await fillFirstVisible(["input[name=cardNumber]", "input[autocomplete=cc-number]"], "4242424242424242");
  stage = "fill_expiry";
  await fillFirstVisible(["input[name=cardExpiry]", "input[autocomplete=cc-exp]"], "1230");
  stage = "fill_cvc";
  await fillFirstVisible(["input[name=cardCvc]", "input[autocomplete=cc-csc]"], "123");
  stage = "fill_optional_billing";
  await fillFirstVisible(["input[name=billingName]", "input[autocomplete=cc-name]"], "Kova Sandbox", false);
  await fillFirstVisible(
    [
      "input[name=postalCode]",
      "input[name=postal_code]",
      "input[autocomplete=postal-code]",
      'input[placeholder="ZIP"]',
    ],
    "10001",
  );

  stage = "disable_link_save";
  const linkSave = page.locator('input[name="enableStripePass"], input[type="checkbox"]').first();
  if ((await linkSave.count()) && (await linkSave.isVisible()) && (await linkSave.isChecked())) {
    await linkSave.uncheck();
  }

  stage = "submit_checkout";
  const submit = page.locator("button[type=submit]").last();
  await submit.click();
  stage = "wait_for_success_redirect";
  await page.waitForURL((url) => !url.hostname.endsWith("stripe.com"), { timeout: 90_000 });
  process.stdout.write("Stripe hosted Checkout completed in test mode.\n");
} catch (error) {
  if (diagnosticPath) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.at(-1);
    if (page) await page.screenshot({ path: diagnosticPath, fullPage: true }).catch(() => {});
  }
  process.stderr.write(`KOV005_CHECKOUT_FAILURE_STAGE=${stage}\n`);
  throw error;
} finally {
  await browser.close();
}
