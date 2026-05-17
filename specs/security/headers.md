# Security Headers Spec

## Problem

Missing security headers expose the app to clickjacking, MIME-sniffing, and data leakage.

## Backend API Headers (FastAPI middleware)

Applied to all API responses:

| Header | Value | Reason |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit URL leakage |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS (production only) |

## Frontend Headers (Vercel — vercel.json)

Applied to all Vercel-served responses (HTML, JS, CSS):

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |
| `Content-Security-Policy` | See below |

### Content-Security-Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io;
font-src 'self' data: https://fonts.gstatic.com;
style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com;
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self' https://checkout.stripe.com;
upgrade-insecure-requests;
```

`unsafe-inline` for styles is required because Tailwind/CSS modules may inject inline styles.
No `unsafe-eval` — Vite production builds do not require it.

## Acceptance Criteria

- API response from `/health` includes all four backend security headers.
- HSTS is only set when `app_env == "production"`.
- `vercel.json` headers block renders the CSP header in browser dev tools.
- Automated test verifies backend headers.
- Production routes `/`, `/login`, `/dashboard`, and `/settings/billing` load required fonts without CSP console errors.
