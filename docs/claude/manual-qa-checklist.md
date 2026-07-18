# Manual QA Checklist

Use this checklist before finishing meaningful Kova changes.

## Core flows

- Signup.
- Login.
- Logout.
- Billing gate.
- Checkout/success/cancel behavior when relevant.
- Product setup.
- Employee setup.
- Inventory setup.
- POS sale flow.
- Reports/dashboard flow.

## UI states

- Loading.
- Empty.
- Error.
- Success.
- Mobile.
- Tablet.
- Desktop.

## Accessibility

- Keyboard-only pass: Tab from load reaches the "Saltar al contenido" skip link; Enter lands in the content area.
- Open and close a modal (shared Dialog) and the register's mobile sale-success overlay: focus moves in, Tab is trapped, Escape closes, focus returns to where it was.
- Screen reader spot check (NVDA/VoiceOver): failed login is announced, dialogs announce their title, toasts are announced.
- Contrast: muted/warning text ≥ 4.5:1 on its actual surface; icons and focus rings ≥ 3:1 (use `text-warning-strong`, not `text-warning`, on light backgrounds).
- 200% browser zoom: register and reports stay operable with no clipped controls.
- `prefers-reduced-motion: reduce`: animations and transitions are neutralized.
- `npm run lint` passes (includes jsx-a11y) and the axe smoke tests in AuthView/CatalogView tests pass.

## Safety

- No fake production analytics.
- No exposed secrets.
- No localStorage/sessionStorage token storage.
- No cross-tenant data leakage.
- No broken unpaid/paid access state.
