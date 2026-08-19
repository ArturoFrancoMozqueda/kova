// External deep links (Sentry, Fly, Vercel, Stripe, UptimeRobot). Only anchors:
// the strict CSP forbids fetch to external hosts, but navigation is allowed.
// URLs are always built server-side.
const TRUSTED_EXTERNAL_HOSTS = [
  "sentry.io",
  "dashboard.stripe.com",
  "fly.io",
  "vercel.com",
  "dashboard.uptimerobot.com",
] as const;

function isTrustedExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      TRUSTED_EXTERNAL_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export function ExternalLink({ label, url }: { label: string; url: string }) {
  if (!isTrustedExternalUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-[color:var(--kova-blue)] hover:underline"
    >
      {label}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
