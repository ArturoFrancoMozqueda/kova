# Mobile UI Review

Last updated: 2026-05-18

## Scope

This review covers the public landing page at `https://point-of-sale-ochre.vercel.app/`
after a mobile Safari screenshot showed the page rendered with a large blank area to the right.

The immediate goal is to convert the issue into reviewable UI tasks before making visual changes.

## Evidence

At a 390 px viewport, Playwright measured:

- `window.innerWidth`: 390 px
- `document.documentElement.scrollWidth`: 597 px
- `document.body.scrollWidth`: 597 px
- Horizontal overflow: true

Visible overflow contributors included:

- Desktop nav links visible on mobile.
- Header primary CTA positioned beyond the viewport.
- Product showcase cart panel positioned beyond the viewport.

## Root Cause Analysis

The landing page uses inline styles for most layout rules in
`frontend/src/routes/Home.tsx`. Several responsive Tailwind classes are attached to elements that
also define conflicting inline `display` values.

Most importantly, the desktop nav links use `className="hidden md:flex"` but also set
`style={{ display: "flex" }}`. The inline style wins, so the desktop nav is still visible below
the `md` breakpoint.

The responsive helper only changes a few grid templates. It does not define mobile behavior for:

- Navbar layout and actions.
- Hero padding, type scale, and button wrapping.
- Hero stats row.
- Product showcase mockups.
- Fixed-width preview panels.
- Horizontal overflow regression tests for the landing route.

The existing mobile E2E tests assert no horizontal overflow for authenticated app routes such as
orders, register, dashboard, billing, catalog, inventory, and shifts. They do not cover `/`.

## Product Impact

This is a buyer-trust blocker. The first public screen looks broken on a phone, which is likely the
device a small business owner will use when opening a shared link.

It also masks the actual product value because the user sees navigation overflow and blank page
space before they can judge the POS.

## Recommended Work

### P0 - Stop Mobile Overflow

- Fix the landing navbar so desktop links are truly hidden below the tablet breakpoint.
- Replace conflicting inline `display` values with responsive classes or explicit media-query
  classes.
- Ensure the header action group fits at 320, 360, 390, 430, and 768 px widths.
- Add a no-horizontal-overflow E2E test for `/` at 390 px.
- Add a helper that reports the widest overflowing elements when the test fails.

### P1 - Rebuild Landing Mobile Layout

- Define mobile-first layout rules for the hero: padding, heading size, body copy width, CTA stack,
  and stats row.
- Make the hero animation responsive, with a capped width and no contribution to document overflow.
- Convert the product showcase into a phone-friendly sequence instead of shrinking a desktop POS
  mockup into the viewport.
- Constrain all preview panels with `max-width: 100%`, `min-width: 0`, and mobile-specific internal
  grids.
- Review footer columns and pricing card at 320 px.

### P1 - Visual QA Matrix

- Add Playwright coverage for `/` at 320, 390, 430, 768, and 1024 px.
- Assert no horizontal overflow on every public section anchor: `#producto`, `#como-funciona`,
  `#precio`, and `#comercios`.
- Capture a screenshot artifact for the 390 px landing page in CI on failure.
- Test both fresh load and returning PWA/app-shell load.

### P2 - Polish and Credibility

- Remove or verify the landing claim `247 negocios activos ahora mismo`.
- Fix mojibake risk in marketing copy if it appears in generated output or deployment artifacts.
- Reduce decorative density on mobile so the above-the-fold area clearly communicates product,
  price, and next action.
- Review tap target sizes and spacing for Safari bottom browser chrome.

## Acceptance Criteria

- The landing page has no horizontal overflow at 320 px and above.
- Desktop nav links are not visible on phone widths.
- The primary CTA remains visible and tappable without horizontal scroll.
- The product showcase does not push content outside the viewport.
- CI catches regressions on the public landing route, not only authenticated app routes.
