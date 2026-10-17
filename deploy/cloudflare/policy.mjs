import config from "../../frontend/vercel.json" with { type: "json" };

// Keep the incumbent and candidate on the same security/cache policy.
export const headerRules = config.headers;
export const securityHeaders = Object.fromEntries(
  headerRules.find(rule => rule.source === "/(.*)").headers.map(({ key, value }) => [key, value]),
);
// Cloudflare injects the existing zone's Web Analytics beacon. Permit only its
// published script/collection origins; all other CSP directives stay intact.
securityHeaders["Content-Security-Policy"] = securityHeaders["Content-Security-Policy"]
  .replace("script-src 'self';", "script-src 'self' https://static.cloudflareinsights.com;")
  .replace("connect-src 'self'", "connect-src 'self' https://cloudflareinsights.com");
export const publicPages = Object.fromEntries(
  config.rewrites.filter(rule => rule.destination.endsWith(".html") && !rule.source.includes("("))
    .map(rule => [rule.source, rule.destination]),
);
