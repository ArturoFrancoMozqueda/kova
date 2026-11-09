export class CheckoutFieldError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

const reasons = new Set(["field_missing", "field_unstable", "field_action_failed", "stage_timeout"]);
export function checkoutFailureReason(error) {
  return reasons.has(error?.reason) ? error.reason
    : error?.name === "TimeoutError" ? "stage_timeout" : "unknown";
}

function replacedDuringInteraction(error) {
  return error?.name === "TimeoutError" || /frame was detached|frame has been detached|execution context was destroyed|element is not attached/i.test(error?.message || "");
}

/** Stripe replaces billing fields/frames after country and identity changes.
 * Rescan within one deadline; do not force an edit or suppress a real failure.
 */
export async function fillCheckoutField(page, selectors, value, {
  required = true, action = "fill", timeoutMs = required ? 30_000 : 3_000,
  now = Date.now, wait = ms => page.waitForTimeout(ms),
} = {}) {
  const deadline = now() + timeoutMs;
  let interrupted = false;
  while (now() < deadline) {
    scan: for (const selector of selectors) {
      for (const frame of page.frames()) {
        try {
          for (const field of await frame.locator(selector).all()) {
            if (!await field.isVisible()) continue;
            if (now() >= deadline) break scan;
            const timeout = Math.max(1, Math.min(1000, deadline - now()));
            if (action === "select") await field.selectOption(value, { timeout });
            else await field.fill(value, { timeout });
            return true;
          }
        } catch (error) {
          if (!replacedDuringInteraction(error)) throw new CheckoutFieldError("field_action_failed");
          interrupted = true;
        }
      }
    }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(100, remaining));
  }
  if (interrupted) throw new CheckoutFieldError("field_unstable");
  if (required) throw new CheckoutFieldError("field_missing");
  return false;
}

export async function completeCheckoutBilling(page) {
  // Keep the existing US ZIP fixture independent of the runner's IP country.
  await fillCheckoutField(page, ["select[name=billingCountry]", "select#billingCountry",
    "select[autocomplete~=country]", "select[autocomplete~=country-name]"], "US", { action: "select" });
  await fillCheckoutField(page, ["input[name=billingName]", "input[autocomplete~=cc-name]"],
    "Kova Sandbox", { required: false });
  await fillCheckoutField(page, ["input[name=billingPostalCode]", "input[name=postalCode]",
    "input[name=postal_code]", "input[autocomplete~=postal-code]", 'input[placeholder="ZIP"]'], "10001");
}
