// Test-only boundary: no mail, payment or telemetry leaves the disposable runtime.
const mail = new Map();
const telemetry = [];
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "api.stripe.com") {
      if (request.headers.get("Authorization") !== "Bearer synthetic-test-only") {
        return Response.json({ error: { code: "invalid_test_credential" } }, { status: 401 });
      }
      if (request.method === "GET" && url.pathname === "/v1/prices/worker-valid") {
        return Response.json({ id: "worker-valid", active: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/subscriptions/worker-subscription"
          && request.headers.get("Idempotency-Key") === "synthetic-idempotency-key"
          && request.headers.get("Content-Type") === "application/x-www-form-urlencoded"
          && await request.text() === "cancel_at_period_end=true") {
        return Response.json({ id: "worker-subscription", cancel_at_period_end: true });
      }
      return Response.json({ error: { code: "resource_missing" } }, { status: 404 });
    }
    if (url.hostname === "sentry.test" && request.method === "POST") {
      // Delivery completes after the API response, exercising waitUntil/FFI
      // ownership rather than only an immediately fulfilled mock fetch.
      await new Promise(resolve => setTimeout(resolve, 50));
      telemetry.push(await request.text());
      return new Response("", { status: 200 });
    }
    if (url.hostname === "api.resend.com" && url.pathname === "/emails"
        && request.method === "POST") {
      const message = await request.json();
      const recipient = Array.isArray(message.to) ? message.to[0] : message.to;
      mail.set(recipient, message.html);
      return Response.json({ id: crypto.randomUUID() });
    }
    if (url.hostname === "mailbox.test" && request.method === "GET") {
      return Response.json({ html: mail.get(url.searchParams.get("to")) || null, telemetry });
    }
    return new Response("Unexpected outbound request blocked by test boundary", { status: 502 });
  },
};
