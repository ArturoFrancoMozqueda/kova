// Test-only boundary: no mail, payment or telemetry leaves the disposable runtime.
const mail = new Map();
const telemetry = [];
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "sentry.test" && request.method === "POST") {
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
