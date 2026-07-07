# PLAN-UX-01 — Modal Accessibility & Destructive-Action Safety

## Priority and rationale

**Rank 1 of the UX plans.** Highest leverage-to-effort ratio in the whole UX audit. A single shared component (`components/ui/dialog.tsx`) backs every modal in the app, including the money-critical ones (Refund, Void, Close-shift, Cancel-subscription) — and it has **no focus management**. Fixing it once fixes accessibility for all of them. In parallel, several **destructive actions fire with no confirmation** (deactivate employee, change employee role, deactivate product/category/modifier), which is a security-relevant, support-generating footgun. Both are low-effort, high-trust changes with no data-model impact.

Bundles: A11Y-1 (focus trap), F-EMP-1 + F-FRM-2 (confirmations), F-FRM-3/A11Y-2 (label association), A11Y-3 (localize Void reasons), A11Y-4 (assertive error toasts), A11Y-5 (icon-button labels), A11Y-6 (radiogroup arrow keys).

## Goal

- The shared `Dialog` moves focus into itself on open, traps Tab within it, restores focus to the trigger on close, and links its title via `aria-labelledby`.
- Every destructive action (deactivate product/category/modifier-group/modifier-option/employee, change employee role) requires an explicit confirmation before executing.
- Refund and Void modal selects are programmatically labeled; Void reasons are localized es-MX.
- Error toasts are announced assertively; icon-only buttons have accessible names; the two radiogroups support arrow-key navigation.

## Current behavior (repository evidence)

- `frontend/src/components/ui/dialog.tsx:12-65` — handles Escape, overlay-click, body scroll-lock; sets `role="dialog"`, `aria-modal="true"`, close-button `aria-label="Cerrar"`. **Missing:** initial focus, focus trap, focus restore, `aria-labelledby`. `DialogTitle` is an `<h2>` (`:72`) with no id.
- **Deactivate/role-change fire immediately:** `SettingsView.tsx:337` (role change on `Select` change), `:342` (deactivate); `CatalogView.tsx:443-459` (category), `:774-789` (product via ProductForm), `:869-919` (modifier group/option). Contrast: VoidModal (`VoidModal.tsx:28,48-56`), BillingView cancel (`BillingView.tsx:403-431`), and CloseShiftModal (`CloseShiftModal.tsx:35,70-85`) already confirm.
- **Unlabeled selects:** `RefundModal.tsx:50,61` and `VoidModal.tsx:38` render `<Label>` (bare `<label>`, `components/ui/label.tsx`) with no `htmlFor`; the `<Select>`s have no `id`.
- **Void reasons not localized:** `VoidModal.tsx:41` renders `option.replaceAll("_"," ")` → "operator error". RefundModal uses `copy.refundModal.reasons`.
- **Toasts polite:** `components/ui/toast.tsx:117` uses `role="status"` for all variants including error.
- **Icon buttons without label:** `CatalogView.tsx:869-886, 902-919` (`Trash2`-only).
- **Radiogroups:** `RegisterView.tsx:1091-1124` (payment) and `DashboardView.tsx:471-497` (period) — `role="radio"` buttons with correct `aria-checked` but no arrow-key roving.

## Problems identified

1. Keyboard/SR users can tab out of any modal into the background; focus is not set on open or restored on close; the dialog has no accessible name.
2. Destructive actions execute on a single click / select-change with no undo and no confirm.
3. Refund/Void selects are unlabeled for assistive tech on money-critical actions.
4. Void reasons display raw English enum values (es-MX violation).
5. Error toasts don't interrupt SR output; some icon buttons are nameless; two radiogroups aren't arrow-navigable.

## Scope

**Included:** `frontend/src/components/ui/dialog.tsx`, `toast.tsx`; `RefundModal.tsx`, `VoidModal.tsx`; `SettingsView.tsx`, `CatalogView.tsx` (confirmations + icon labels); `RegisterView.tsx`, `DashboardView.tsx` (radiogroup arrow keys); `i18n/messages.ts` (Void reasons + confirmation copy). **Excluded:** backend, any data model, non-modal layout, contrast audit (A11Y-7 deferred to a measured pass).

## Exact files to modify

- **`frontend/src/components/ui/dialog.tsx`** — add: on open, capture `document.activeElement`, move focus to the first focusable element (or the dialog container with `tabIndex=-1`); a `keydown` Tab handler that cycles focus within the dialog; on close, restore focus to the saved trigger; accept/generate a title id and set `aria-labelledby`. Reuse the existing `open`/`onClose` contract so no caller changes.
- **`frontend/src/components/ui/dialog.tsx` (DialogTitle)** — give it an `id` (via a context or prop) referenced by `aria-labelledby`.
- **`frontend/src/settings/SettingsView.tsx`** — wrap deactivate-employee (`:342`) and change-role (`:337`) in a confirmation `Dialog` ("¿Desactivar acceso de …?" / "¿Cambiar el rol de … a …?"). Role change should confirm before the mutation, not fire on `Select` change.
- **`frontend/src/catalog/CatalogView.tsx`** — confirmation before deactivate category (`:443`), product (`:774`), modifier group (`:869`), modifier option (`:902`); add `aria-label` to the `Trash2` icon buttons.
- **`frontend/src/orders/RefundModal.tsx`, `VoidModal.tsx`** — associate `<Label htmlFor>` + `<Select id>` (use `useId`, as `SettingsView.tsx:409` does); localize VoidModal reasons from `copy.voidModal.reasons`.
- **`frontend/src/components/ui/toast.tsx`** — `role="alert"` + `aria-live="assertive"` for the `error` variant; keep `status`/polite for success/info.
- **`frontend/src/register/RegisterView.tsx`, `dashboard/DashboardView.tsx`** — add roving-tabindex + Arrow key handling to the radiogroups.
- **`frontend/src/i18n/messages.ts`** — add `copy.voidModal.reasons` (operator_error → "Error del operador", wrong_product → "Producto equivocado", system_issue → "Problema del sistema", other → "Otro") and confirmation strings.

No new files except optional tests.

## Dependencies

- None external. `useId` is already in use. The focus-trap logic is self-contained; no library needed (the repo intentionally hand-rolls the dialog).

## Step-by-step implementation order

1. **`dialog.tsx` focus management.** Behavior: save trigger, focus-in on open, trap Tab (Shift+Tab wraps), restore on close, `aria-labelledby`. UI: every modal becomes keyboard-safe. Security: none. Backward-compat: no caller API change. Tests: RTL test that Tab cycles within the dialog and focus returns to the trigger on close.
2. **`toast.tsx` assertive errors.** Behavior: error variant announces immediately. Tests: RTL asserting `role="alert"` on error toast.
3. **Refund/Void label association + localize Void reasons** (`RefundModal.tsx`, `VoidModal.tsx`, `messages.ts`). Tests: RTL asserting the select has an accessible name; Void reasons render Spanish.
4. **Confirmations for destructive actions** (`SettingsView.tsx`, `CatalogView.tsx`). Behavior: a confirm `Dialog` gates each; role-change confirms before mutating. UI: prevents accidental destructive changes. Security: reduces accidental privilege changes. Backward-compat: adds a step (intended). Tests: RTL — action does not fire until confirmed; cancel aborts.
5. **Icon-button labels + radiogroup arrow keys** (`CatalogView.tsx`, `RegisterView.tsx`, `DashboardView.tsx`). Tests: RTL asserting `aria-label`; arrow-key changes selection.

## Edge cases

- **Nested/stacked dialogs** (e.g. a confirm dialog opened from within a modal): focus restore must return to the correct prior element, not the page.
- **Dialog with no focusable child:** focus the container (`tabIndex=-1`) so SR announces the title.
- **Escape while a `<Select>` is open:** the native select should close first; Escape closing the dialog must not skip a step unexpectedly.
- **Mobile bottom-sheet variant:** focus-in must not scroll the page or fight the slide-up animation; test at 360px.
- **Rapid open/close (double-tap):** focus restore must be idempotent (don't throw if the trigger unmounted).
- **Confirm on role-change:** if the owner cancels, the `<Select>` must revert to the prior value (don't leave it showing the un-applied role).
- **Last-owner demotion:** the confirmation copy should warn; the backend still enforces the guard (companion S3) — the UI confirm is not a substitute.
- **Toast assertive spam:** many rapid errors shouldn't flood SR — keep the existing dedupe/timeout.

## Security requirements

- Confirmations are UX safety, not authorization — backend permission checks and the last-owner guard remain the source of truth.
- No change to what actions are available per role; only an added confirm step.
- No secrets/PII in confirmation copy or toasts.

## Data migration and rollback

- **None** — pure frontend, no schema, no API contract change. Rollback = revert the frontend commits.

## Testing strategy

- **Unit/RTL (Vitest + Testing Library):** dialog focus-in/trap/restore/`aria-labelledby`; error toast `role="alert"`; Refund/Void select labeled; Void reasons localized; destructive actions gated by confirm; icon `aria-label`; radiogroup arrow keys.
- **E2E (Playwright):** keyboard-only path through a refund (open modal → Tab stays inside → complete or Escape → focus back on trigger); accidental deactivate is blocked until confirmed.
- **Regression:** existing `components/ui/toast` test, `OrderDetail`, `SettingsView`, `CatalogView` tests stay green.
- **Manual (screen reader):** verify VoiceOver/NVDA announces dialog title on open and error toasts interrupt.

Exact test files: `frontend/src/components/ui/dialog.test.tsx` (new), `toast.test.tsx` (extend), `orders/RefundModal.test.tsx` / `VoidModal.test.tsx` (new/extend), `settings/SettingsView.test.tsx` (extend), `catalog/CatalogView.test.tsx` (extend), an `e2e/a11y-modals.spec.ts` (new).

## Observability

- Optional: a funnel/telemetry event when a destructive confirm is shown vs confirmed vs cancelled (helps quantify accidental-action prevention). No PII.
- No new logs required.

## Acceptance criteria

- Given any modal is open, when the user presses Tab repeatedly, then focus stays within the modal and never reaches background controls; Shift+Tab wraps backward.
- Given a modal opens, then focus moves into it and the dialog is announced by its title; when it closes, focus returns to the element that opened it.
- Given an owner changes an employee's role or deactivates an employee, when they trigger the action, then a confirmation dialog appears and the change is applied only on confirm (and the Select reverts on cancel).
- Given the Void modal, when it renders, then the reason options are in Spanish (es-MX) and the reason/select controls have accessible names.
- Given an operation fails, when the error toast appears, then it is exposed as `role="alert"` (assertive).
- Given the payment-method radiogroup, when focused, then Arrow keys move the selection.

## Verification commands

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test -- dialog toast RefundModal VoidModal SettingsView CatalogView
npm --prefix frontend run test:e2e -- a11y-modals
npm --prefix frontend run build
```

## Definition of done

- `dialog.tsx` traps + restores focus and is title-labeled; all modals inherit it.
- All listed destructive actions require confirmation; role-change confirms before mutating.
- Refund/Void selects labeled; Void reasons localized; error toasts assertive; icon buttons labeled; radiogroups arrow-navigable.
- New/updated tests green; lint, typecheck, build pass.

## Risks and mitigations

- **Risk:** focus trap breaks an existing modal's internal widget (e.g. native select). **Mitigation:** trap only Tab/Shift+Tab, don't intercept other keys; test each modal.
- **Risk:** added confirmations annoy power users. **Mitigation:** confirm only genuinely destructive/irreversible or security-relevant actions (not create/edit).
- **Risk:** focus restore throws if the trigger unmounted. **Mitigation:** guard with existence check.
- **Risk:** regressions across many modals. **Mitigation:** the change is centralized in `dialog.tsx`; broad RTL coverage + e2e keyboard path.
