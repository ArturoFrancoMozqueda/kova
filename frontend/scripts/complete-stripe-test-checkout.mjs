import fs from "node:fs";
import { chromium } from "playwright";

const statePath = process.env.KOV005_CHECKOUT_STATE_FILE;
if (!statePath) {
  throw new Error("KOV005_CHECKOUT_STATE_FILE is required");
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const checkoutUrl = String(state.checkout_url || "");
if (!checkoutUrl.startsWith("https://checkout.stripe.com/") || !checkoutUrl.includes("cs_test")) {
  throw new Error("Refusing to open a non-test Stripe Checkout URL");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const fillFirstVisible = async (selectors, value, required = true) => {
    for (const selector of selectors) {
      for (const frame of page.frames()) {
        const field = frame.locator(selector).first();
        if ((await field.count()) && (await field.isVisible())) {
          await field.fill(value);
          return true;
        }
      }
    }
    if (required) throw new Error(`Stripe Checkout field not found: ${selectors.join(", ")}`);
    return false;
  };

  await fillFirstVisible(["input[name=email]", "input[type=email]"], "kov005-checkout@example.com", false);
  await fillFirstVisible(["input[name=cardNumber]", "input[autocomplete=cc-number]"], "4242424242424242");
  await fillFirstVisible(["input[name=cardExpiry]", "input[autocomplete=cc-exp]"], "1230");
  await fillFirstVisible(["input[name=cardCvc]", "input[autocomplete=cc-csc]"], "123");
  await fillFirstVisible(["input[name=billingName]", "input[autocomplete=cc-name]"], "Kova Sandbox", false);
  await fillFirstVisible(["input[name=postalCode]", "input[autocomplete=postal-code]"], "01000", false);

  const submit = page.locator("button[type=submit]").last();
  await submit.click();
  await page.waitForURL((url) => !url.hostname.endsWith("stripe.com"), { timeout: 90_000 });
  process.stdout.write("Stripe hosted Checkout completed in test mode.\n");
} finally {
  await browser.close();
}
