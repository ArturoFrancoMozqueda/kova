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

## Safety

- No fake production analytics.
- No exposed secrets.
- No localStorage/sessionStorage token storage.
- No cross-tenant data leakage.
- No broken unpaid/paid access state.
