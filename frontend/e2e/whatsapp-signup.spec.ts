import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

for (const width of [390, 1440]) {
  test(`owner connects WhatsApp with explicit Meta authorization at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await markFirstUseToursSeen(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
      authenticated: true, user: { id: "owner-a", email: "owner@example.com", tenant_id: "tenant-a", role: "owner" },
      tenant_id: "tenant-a", tenant_name: "Negocio de prueba",
    } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
      plan: { name: "Plan Standard", amount_minor_units: 29900, currency: "MXN", interval: "month" },
      subscription: null, access: { allowed: true, reason: "active", trialing: false,
        trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" },
    } }));
    let connected = false;
    let finishCalls = 0;
    let sending = false;
    await page.route("**/api/v1/messaging/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/readiness")) return route.fulfill({ json: {
        status: connected ? "connected" : "not_connected", signup_available: true,
        send_enabled: sending, webhook_enabled: connected, tenant_mapping_verified: connected,
        checklist: [],
      } });
      if (path.endsWith("/onboarding")) return route.fulfill({ json: {
        available: true, can_manage: true, app_id: "123", config_id: "456", graph_version: "v25.0",
        state: connected ? "connected" : "not_started",
      } });
      if (path.endsWith("/start")) {
        expect(request.method()).toBe("POST");
        return route.fulfill({ json: { session_id: "synthetic-session", nonce: "synthetic-nonce",
          expires_at: new Date(Date.now() + 600_000).toISOString() } });
      }
      if (path.endsWith("/finish")) {
        expect(request.method()).toBe("POST");
        expect(request.postDataJSON()).toEqual({ session_id: "synthetic-session", nonce: "synthetic-nonce",
          code: "synthetic-code", waba_id: "987", phone_number_id: "654", event: "FINISH" });
        connected = true; finishCalls++;
        return route.fulfill({ json: { status: "connected", send_enabled: false, receive_enabled: true } });
      }
      if (path.endsWith("/sending")) {
        expect(request.method()).toBe("PATCH");
        sending = request.postDataJSON().enabled;
        return route.fulfill({ json: { status: "connected", send_enabled: sending, receive_enabled: true } });
      }
      throw new Error(`Unexpected messaging route: ${path}`);
    });
    // An explicitly simulated Meta SDK: this test never contacts Meta or grants access.
    await page.route("https://connect.facebook.net/en_US/sdk.js", route => route.fulfill({
      contentType: "application/javascript", body: `window.FB={init(){},login(callback){
        window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',
          data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'987',phone_number_id:'654'}})}));
        callback({authResponse:{code:'synthetic-code'}});
      }};window.fbAsyncInit?.();`,
    }));
    await page.goto("/settings/channels");
    await page.getByRole("button", { name: "Conectar WhatsApp", exact: true }).click();
    const authorize = page.getByRole("button", { name: "Autorizar en Meta", exact: true });
    await expect(authorize).toBeVisible();
    expect(finishCalls).toBe(0);
    await page.screenshot({ path: `/tmp/kova-whatsapp-prepared-${width}.png`, fullPage: true });
    await authorize.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Conexión configurada", { exact: true })).toBeVisible();
    expect(finishCalls).toBe(1);
    await expect(page.getByRole("button", { name: "Habilitar respuestas desde Kova" })).toBeVisible();
    await page.getByRole("button", { name: "Habilitar respuestas desde Kova" }).click();
    await expect(page.getByRole("button", { name: "Pausar respuestas desde Kova" })).toBeVisible();
    expect(sending).toBe(true);
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("button", { name: "Pausar respuestas desde Kova" })).toBeDisabled();
    await expect(page.getByText("Conéctate a internet para administrar WhatsApp.")).toBeVisible();
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await window.axe.run("main", {
      rules: { "color-contrast": { enabled: false } },
    })).violations);
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(await page.locator("main").innerText()).not.toMatch(/synthetic-code|synthetic-nonce|synthetic-session/);
    await page.getByRole("heading", { name: "Canales del negocio", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/kova-whatsapp-connected-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
