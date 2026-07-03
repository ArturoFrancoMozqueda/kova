// External deep links (Sentry, Fly, Vercel, Stripe, UptimeRobot). Only anchors:
// the strict CSP forbids fetch to external hosts, but navigation is allowed.
// URLs are always built server-side.
export function ExternalLink({ label, url }: { label: string; url: string }) {
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
