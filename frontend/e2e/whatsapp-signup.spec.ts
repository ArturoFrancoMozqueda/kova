import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

for (const width of [390, 1440]) for (const coexistence of [false, true]) {
  test(`owner connects WhatsApp ${coexistence ? "with existing mobile app" : "with a new number"} at ${width}px`, async ({ page }) => {
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
    let syncReady = false;
    await page.route("**/api/v1/messaging/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/conversations")) return route.fulfill({ json: {
        items: [{ id: "review-chat", customer_id: null, customer_name: "Cliente de prueba",
          contact_phone: "525555555555", subject: "Consulta por WhatsApp", origin: "whatsapp",
          status: "open", automation_paused: true, assigned_user_id: null, version: 1 }],
        has_more: false, channel_status: "connected", send_enabled: true,
      } });
      if (path.endsWith("/review-chat/messages")) return route.fulfill({ json: {
        items: [
          { id: "imported", conversation_id: "review-chat", direction: "inbound", body: "Consulta anterior",
            message_type: "text", source: "history", state: "received", purpose: null, version: 1,
            error_code: null, created_at: "2026-11-12T12:00:00Z", updated_at: "2026-11-12T12:00:00Z" },
          { id: "mobile", conversation_id: "review-chat", direction: "outbound", body: "Respuesta desde el celular",
            message_type: "text", source: "whatsapp_app", state: "sent", purpose: null, version: 1,
            error_code: null, created_at: "2026-11-14T12:00:00Z", updated_at: "2026-11-14T12:00:00Z" },
        ], has_more: false,
      } });
      if (path.endsWith("/readiness")) return route.fulfill({ json: {
        status: connected ? "connected" : "not_connected", signup_available: true,
        send_enabled: sending, webhook_enabled: connected, tenant_mapping_verified: connected,
        checklist: [],
      } });
      if (path.endsWith("/onboarding")) return route.fulfill({ json: {
        available: true, can_manage: true, app_id: "123", config_id: "456", graph_version: "v25.0",
        state: connected ? "connected" : "not_started",
        coexistence: coexistence && connected,
        sync_status: coexistence && connected ? syncReady ? "ready" : "synchronizing" : "not_required",
        sync_progress: syncReady ? 100 : 55,
      } });
      if (path.endsWith("/start")) {
        expect(request.method()).toBe("POST");
        return route.fulfill({ json: { session_id: "synthetic-session", nonce: "synthetic-nonce",
          expires_at: new Date(Date.now() + 600_000).toISOString() } });
      }
      if (path.endsWith("/finish")) {
        expect(request.method()).toBe("POST");
        expect(request.postDataJSON()).toEqual({ session_id: "synthetic-session", nonce: "synthetic-nonce",
          code: "synthetic-code", waba_id: "987", ...(coexistence ? {} : { phone_number_id: "654" }),
          event: coexistence ? "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" : "FINISH" });
        connected = true; finishCalls++;
        return route.fulfill({ json: { status: "connected", send_enabled: false, receive_enabled: true } });
      }
      if (path.endsWith("/sync")) {
        expect(request.method()).toBe("POST");
        syncReady = true;
        return route.fulfill({ json: { available: true, can_manage: true, app_id: "123",
          config_id: "456", graph_version: "v25.0", state: "connected", coexistence: true,
          sync_status: "ready", sync_progress: 100 } });
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
          data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'${coexistence ? 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' : 'FINISH'}',data:${JSON.stringify(coexistence ? {waba_id:'987'} : {waba_id:'987',phone_number_id:'654'})}})}));
        callback({authResponse:{code:'synthetic-code'}});
      }};window.fbAsyncInit?.();`,
    }));
    await page.goto("/settings/channels");
    await page.getByRole("button", { name: "Conectar WhatsApp", exact: true }).click();
    const authorize = page.getByRole("button", { name: "Autorizar en Meta", exact: true });
    await expect(authorize).toBeVisible();
    expect(finishCalls).toBe(0);
    await page.screenshot({ path: `/tmp/kova-whatsapp-${coexistence ? "app" : "new"}-prepared-${width}.png`, fullPage: true });
    await authorize.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Conexión configurada", { exact: true })).toBeVisible();
    expect(finishCalls).toBe(1);
    await expect(page.getByRole("button", { name: "Habilitar respuestas desde Kova" })).toBeVisible();
    if (coexistence) {
      await expect(page.getByText(/Historial: 55 %/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Habilitar respuestas desde Kova" })).toBeDisabled();
      await expect(page.getByText(/La sincronización inicial terminó/)).toBeVisible({ timeout: 10_000 });
    }
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
    await page.screenshot({ path: `/tmp/kova-whatsapp-${coexistence ? "app" : "new"}-connected-${width}.png`, fullPage: true });
    if (coexistence) {
      await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [] }));
      await page.goto("/inbox");
      await page.getByRole("button", { name: /Consulta por WhatsApp/ }).click();
      await expect(page.getByText("Cliente · Recibido · Historial importado", { exact: true })).toBeVisible();
      await expect(page.getByText("Equipo · Enviado · Desde WhatsApp Business", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Enviar por WhatsApp", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: `/tmp/kova-whatsapp-app-inbox-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
