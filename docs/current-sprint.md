# Current Sprint

Last updated: 2026-05-20

## Source-of-truth rules

- This is the single document for what is in flight and what is the next execution target.
- Historical roadmap and completed sprints live in `docs/sprint-planning.md`.
- The Kova Product/UX/Business Audit backlog lives in `docs/sprint-planning.md` under
  `Kova Product/UX/Business Audit Findings`.
- Do not duplicate detailed acceptance criteria here; mirror current status and next execution focus.

## Active Focus

Kova Product/UX Audit execution.

Sprint 1 is mostly complete. Sprint 2 is functionally complete. Sprint 3 is functionally complete.
Sprint 4 is in progress, focused on report clarity without overwhelming the owner.

## Completed From Kova Audit Sprint 1: Trust, Clarity, and Conversion

- [x] Standard Plan price aligned to $299 MXN/month across frontend constants, backend billing
      defaults, docs, specs, tests, and Alembic migration
      `backend/alembic/versions/0023_standard_plan_299_mxn.py`.
- [x] Landing claims narrowed to beta-true cafe/small food retail scope.
- [x] Unsupported claims around branches, taxes, WhatsApp receipts, restaurant tables, commissions,
      barcode/fiado, and broad vertical support were removed or softened.
- [x] Signup trust cues improved with trial/price copy, privacy/terms mailto access, and support
      contact.
- [x] Global PWA update prompt suppressed on public/auth routes.
- [x] Billing/trial copy and tests/specs now reference the $299 MXN Standard Plan.

## Left From Sprint 1

- [x] Billing state copy matrix landed at `docs/billing-state-copy-matrix.md`. Single source of truth
      for every reason surfaced in `BillingBanner`.
- [x] Real privacy and terms pages at `/privacy` and `/terms`; signup and footer now link to them
      instead of mailto request links.
- [ ] Replace remaining audit-era historical references in `docs/ux-review-2026-05-19.md` only if
      that file is no longer treated as historical evidence.

## Completed From Kova Audit Sprint 2: Onboarding and First Value Moment

- [x] Added tenant-scoped cafe preset at `backend/presets/cafe.json`.
- [x] Allowed the onboarding preset API to apply `cafe`, alongside bakery and retail.
- [x] Rewrote dashboard checklist copy to be Spanish-first and cafe-specific.
- [x] Checklist action paths now open direct setup actions:
      `/catalog?new=product` and `/catalog?inventory=activate`.
- [x] Catalog opens the product form from those query params; inventory setup starts with inventory
      tracking enabled.
- [x] Register empty state now offers `Crear primer producto` and `Cargar menu de cafeteria`.
- [x] Inventory empty state explains which cafe products should use stock tracking.
- [x] Added first-value milestone states for first product, inventory, shift, sale, and first report.
- [x] Updated onboarding specs/features and Sprint 2 backlog status.

## Left From Sprint 2

- [x] Full-path onboarding E2E landed at `frontend/e2e/onboarding.spec.ts`: dashboard checklist ->
      first product -> shift -> sale -> first report -> checklist hidden when complete.
- [ ] Add first employee setup as a first-value path once employee management is clearer in Sprint 3.
- [ ] Decide whether the cafe preset should include modifier groups for milk/size, or keep modifiers
      as a later usability pass to avoid expanding beta scope.

## Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint` passed with two existing warnings in `RegisterView.tsx`.
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused E2E: `npm run test:e2e -- e2e/mobile.spec.ts e2e/app-shell.spec.ts --project=chromium`
      (9 passed)
- [x] Backend full test suite: `UV_PROJECT_ENVIRONMENT=.venv-win uv run pytest`
      (183 passed, 1 skipped)
- [x] Diff hygiene: `git diff --check`

## Sprint 3 Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint`
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused E2E:
      `npm run test:e2e -- e2e/register-sale.spec.ts e2e/settings.spec.ts e2e/mobile.spec.ts --project=chromium`
      (11 passed)
- [x] Focused Sprint 3 operational E2E:
      `npm run test:e2e -- e2e/catalog.spec.ts e2e/inventory.spec.ts e2e/orders.spec.ts e2e/settings.spec.ts --project=chromium`
      (11 passed)
- [x] Full frontend E2E: `npm run test:e2e -- --project=chromium` (49 passed, 3 skipped)
- [x] Diff hygiene: `git diff --check`

## Completed From Kova Audit Sprint 3: POS, Products, Employees, and Inventory Usability

- [x] Register payment controls are replaced by an instructional state until the cart has products.
- [x] Split payment remains behind advanced options and is hidden until a sale has cart context.
- [x] Employee roles are localized and now include business-language permission descriptions.
- [x] Employee management remains in the Settings employees tab, with clearer role guidance before
      inviting staff.
- [x] Mobile regression coverage now confirms the sidebar is closed on fresh mobile app loads while
      bottom navigation remains available.
- [x] Employee setup spec updated to reflect role-description UX acceptance criteria.
- [x] Catalog now supports product search and sorting by name, price, or inventory-tracked products.
- [x] Inventory now supports search, low/healthy filtering, and sorting by name, stock, or threshold.
- [x] Orders now support visible client-side sort options for newest, oldest, highest amount, and
      lowest amount alongside existing filters.
- [x] Mobile E2E now covers catalog product search/sort, product create/edit, inventory activation,
      inventory search/filter/sort, order status/sort, and employee invite/role/deactivation flows.

## Left From Sprint 3

- [ ] Decide whether employee management should graduate from Settings tab to a first-class nav item
      after beta usage data.
- [ ] Add invitation acceptance-path E2E once that separate acceptance flow is finalized.

## Completed From Kova Audit Sprint 4: Reports and Business Storytelling

- [x] Reports now use a compact owner decision brief instead of repeating a longer action list.
- [x] The owner brief deduplicates recommendations and caps them at three actions.
- [x] Restock-risk guidance is prioritized before general report recommendations.
- [x] Detailed KPI, chart, payment, operations, and employee sections are collapsed behind
      `Ver análisis detallado` so the first report screen is not saturated.
- [x] Detailed analysis was recut around admin decisions instead of duplicate KPI cards:
      timing, products plus inventory, payments plus operations, and employee comparison only when
      there is enough staff data.
- [x] Previous-period comparison, restock guidance, and the three-action cap are covered in E2E.
- [x] Reports spec, Gherkin scenario, and test matrix now document the compact decision brief.

## Sprint 4 Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint`
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused reports E2E after saturation reduction:
      `npm run test:e2e -- e2e/reports.spec.ts --project=chromium` (2 passed)
- [x] Full frontend E2E: `npm run test:e2e -- --project=chromium` (49 passed, 3 skipped)

## Left From Sprint 4

- [x] All report endpoints (sales-summary, payment-breakdown, top-products, sales-by-hour,
      sales-by-employee, refunds-by-reason) now compute date bounds in the tenant timezone, and
      hour bucketing reflects local business hours.
- [x] Generic product trends (growing/declining/slow movers) added to `business-story` via
      previous-period comparison. Applies to every tenant, not just cafes.
- [x] Inventory recommendations strengthened: `restock_alerts` joins 7-day sales velocity with
      low-stock thresholds; critical alerts surface in `recommended_actions` first.
- [x] Employee contribution cues added: `employee_contribution.rows` with `sales_share_pct` and an
      `even_distribution` flag for small-team staffing.
- [x] Reports no-data path now renders a single `EmptyBusinessState` card with one primary CTA; the
      duplicate `RecommendedActions` block was removed.

## Next Sprint Recommendation

Frontend consumption of the new `product_trends`, `restock_alerts`, and `employee_contribution`
fields on the reports view. Backend already returns them; UI work remains.

## Kova Audit Sprint 5: QA Bug Fixes (2026-05-22)

Source: full production QA pass on 2026-05-22 against
`https://point-of-sale-ochre.vercel.app/` with the `posprojectsupport@gmail.com` owner account.
Audit covered Panel, Caja, Catálogo, Órdenes, Inventario, Turnos, Reportes, Configuración
(Perfil, Recibo, Empleados, Avanzado) and Facturación.

Goal: close blocker UX/data-integrity bugs before onboarding more cafe tenants. No backend
behavior changes beyond what each task explicitly calls out; no schema changes.

### Progress Snapshot (2026-05-22)

Seven batches landed against this sprint:

- `b00c058` — BUG-001 (frontend), 003/012, 004, 006, 007, 011, 014 + i18n base
- `773afd4` — BUG-008 (60s SWR cache), 009 (param normalization), 010
  (dedupe by title), 013 (gross/net note), 015 (strip leading "-"),
  BUG-002 frontend "Ya agotado", per-route document titles
- `f22ca9a` — order list pluralization, cancel-sub confirm, register image
  fallback, CSP allow-listed Stripe
- `342c185` — HTML sanitize on product name (frontend + Pydantic),
  reports SWR cache (45s), centralized `formatDate` / `formatDateTime`
- `54874f1` — Mexican TZ map, offline QA checklist doc
- `2a7dddb` — dashboard onboarding auto-mark from live signals,
  `fix_category_accents.py` maintenance script
- `7ec035f` — BUG-002 backend OUT_OF_STOCK guard on order creation,
  test updates + new positive coverage, `backfill_skus.py`,
  `clamp_negative_stock.py`
- new — `routing.spec.ts` E2E covering NotFound and Spanish slug redirects

Still pending in this sprint (genuinely needs more than the current
sandbox can provide):

- BUG-005 session-loss audit — needs DevTools network capture against a
  real backend to confirm root cause.
- Catalog skeleton on first paint (would require inline HTML/CSS in
  `index.html` to render before React mounts).
- Sin-stock branch in `register-sale.spec.ts` and invalid-qty refund in
  `orders.spec.ts` — Playwright run gate; tests authored only for
  `routing.spec.ts` so far.
- Final verification gate: `UV_PROJECT_ENVIRONMENT=.venv-win uv run
  pytest` failed locally because `alembic upgrade head` could not
  connect to a Postgres in this sandbox. Run on CI / a dev environment
  with a healthy `DATABASE_URL` to close the gate.

### P0 · Blockers (data integrity, money, sessions)

- [ ] **BUG-001 · Bloquear venta de productos sin stock.**
  - Backend: in `backend/app/orders/service.py` (sale creation path), when a line item references
    a product with `inventory_tracking_enabled=True` and resulting on-hand would go below 0,
    raise a domain error with code `OUT_OF_STOCK` and the offending `product_id` + available qty.
  - Frontend: in `frontend/src/register/RegisterView.tsx` and the product card component used by
    `/register`, disable the click handler when `stock_on_hand <= 0` and `inventory_tracking_enabled`.
    Show a tooltip "Sin stock — actualiza inventario para vender". Add `aria-disabled="true"`.
  - Add a soft override: a secondary `Vender de todas formas` action that opens a confirm modal
    ("Vas a vender un producto sin stock disponible. ¿Continuar?"). Override sends
    `allow_oversell: true` in the sale payload; backend allows the sale but flags it in the
    response so we can surface a warning toast.
  - Tests:
    - Backend: `backend/app/tests/test_orders_service.py` — case for OUT_OF_STOCK and for
      `allow_oversell` bypass.
    - Frontend unit: register card disabled state when `stock_on_hand <= 0`.
    - E2E: extend `frontend/e2e/register-sale.spec.ts` with a no-stock product scenario.
  - Files: `backend/app/orders/service.py`, `backend/app/orders/schemas.py`,
    `frontend/src/register/RegisterView.tsx`, register product card component, `i18n/messages.ts`.

- [ ] **BUG-002 · Impedir stock negativo y limpiar registros existentes.**
  - Repository layer (`backend/app/inventory/repository.py` or wherever the stock decrement
    occurs): clamp to 0 on `apply_stock_delta` and reject negative deltas exceeding current
    on-hand with the same `OUT_OF_STOCK` error.
  - One-off data hygiene: write a maintenance script in `backend/scripts/` (NOT a migration) that
    finds rows with `stock_on_hand < 0`, sets them to 0, and prints a per-tenant report. Document
    how to run it in the script docstring.
  - Frontend: in `frontend/src/inventory/InventoryView.tsx` the "Velocidad de stock" estimator
    must short-circuit when current stock <= 0 and render "Ya agotado" instead of
    `"~-7 días con el ritmo actual"`.
  - Files: `backend/app/inventory/repository.py`, `backend/app/inventory/service.py`,
    `backend/scripts/clamp_negative_stock.py`, `frontend/src/inventory/InventoryView.tsx`.

- [ ] **BUG-003 / BUG-012 · Corregir el rótulo "Total pagado" en recibo y detalle de orden.**
  - In the order detail receipt block (search for the label string `Total pagado` under
    `frontend/src/orders/`), rename it to `Efectivo recibido` when the payment method is cash
    AND show the actual `tendered_amount`, not `order.total`. For card/transfer payments where
    no tender amount is captured, hide the row entirely (only show Subtotal/Total/Cambio rows
    that are meaningful).
  - Audit the backend schema: confirm the order response includes `tendered_amount` /
    `payment.amount_received`. If missing, expose it in `backend/app/orders/schemas.py` from the
    existing `payments` rows (no DB change needed; data is already stored).
  - Update the printable receipt template wherever the same string is duplicated (settings
    receipt preview already says `Pagado en efectivo $120.00` correctly — align order detail
    to the same wording).
  - Add a unit test that renders the receipt block with `total=108, tendered=200` and asserts
    "Efectivo recibido $200.00" and "Cambio $92.00" are present.
  - Files: order detail view component, `frontend/src/orders/format.ts`, receipt template,
    `frontend/src/i18n/messages.ts`.

- [ ] **BUG-004 · Pantalla 404 real + redirección de slugs en español.**
  - Create `frontend/src/routes/NotFound.tsx` with: Kova logo, copy "Esta página no existe",
    primary CTA `Volver al panel` → `/dashboard`, secondary CTA `Ir a Caja` → `/register`.
    Use the standard `Card` primitive; respect existing tokens.
  - In the router (likely `frontend/src/App.tsx` or `frontend/src/routes.tsx`) add the catch-all
    `<Route path="*" element={<NotFound />} />` AFTER all real routes.
  - Add aliases: `/caja` → redirect to `/register`, `/ordenes` → `/orders`,
    `/inventario` → `/inventory`, `/configuracion` → `/settings`, `/reportes` → `/reports`,
    `/catalogo` → `/catalog`, `/turnos` → `/shifts`, `/panel` → `/dashboard`. Use `<Navigate>`.
  - Verify the SW `navigateFallbackDenylist` does not interfere with the 404 (it should not,
    because the catch-all is client-side after `index.html` loads).
  - Add E2E coverage: `frontend/e2e/routing.spec.ts` covering `/this-route-does-not-exist`
    (renders 404) and `/caja` (redirects to `/register`).

- [ ] **BUG-005 · Auditar pérdida de sesión entre `/reports` y `/settings`.**
  - Reproduce locally with `npm run dev` + backend; capture network for the
    `/api/v1/auth/session` call that returns `authenticated: false`.
  - Suspected causes to check, in order:
    1. Refresh-token cookie path mismatch — confirm `refresh_token` cookie path is exactly
       `/api/v1/auth` (see `backend/app/auth/router.py` set-cookie calls) and that nothing in
       reports/settings issues a request to that path that wipes it.
    2. `AuthContext` in `frontend/src/auth/AuthContext.tsx` reacting to a stray 401 by clearing
       state — add logging to identify which response triggered the logout.
    3. Backend session row being revoked: instrument `get_current_session` in
       `backend/app/shared/dependencies.py` to log session id + revoked_at when it rejects.
  - Fix: whichever root cause. Add a test in `backend/app/tests/test_auth.py` for the
    "long browsing across modules" scenario (multiple calls within JWT TTL with one refresh
    in the middle should keep the session alive).

- [ ] **BUG-006 · Validar precio mínimo en formulario de producto.**
  - In the product create/edit modal (under `frontend/src/catalog/`), add a controlled error
    state for the price field. Show inline copy `El precio no puede ser negativo` (and
    `Ingresa un precio válido` for empty/NaN). Block submit until the field is valid.
  - Set `<input type="number" min="0" step="0.01" inputMode="decimal">` and strip leading `-`
    on change. Don't rely only on HTML5 — also validate in the submit handler.
  - Backend defense in depth: in `backend/app/catalog/schemas.py` ensure the Pydantic field
    has `ge=0` and returns a 422 with a Spanish-friendly message.
  - Test: unit test on the modal asserting error appears for `-99.999` and submit stays
    disabled.

- [ ] **BUG-007 · Mensajes específicos en devoluciones.**
  - Backend: in the refund endpoint (`backend/app/orders/router.py` refund handler), when
    requested qty > remaining refundable qty, return 422 with
    `{ "code": "REFUND_QTY_EXCEEDS_AVAILABLE", "available": <n>, "requested": <n> }`.
  - Frontend: in the refund modal, set the qty input `max` to the remaining refundable qty,
    show inline counter `Máximo: 2`, and on submit map the `REFUND_QTY_EXCEEDS_AVAILABLE`
    code to a specific toast `La cantidad excede lo disponible para devolución (máx. {n})`.
  - Replace the generic catch-all `No se pudo completar la operación.` toast in the refund
    flow with the error mapper; keep the generic toast only as a last-resort fallback.

### P1 · Important (performance, consistency, copy correctness)

- [ ] **BUG-008 · Deduplicar `/api/v1/billing/subscription` (4× por carga del Panel).**
  - Create a single `useBillingSubscription` hook backed by a React context provider mounted
    near `AppShell`. All consumers (`BillingBanner`, dashboard checklist, settings/billing
    badge, anywhere else) read from the context.
  - The provider fetches once on mount and exposes `refetch()` for explicit invalidations
    (after Stripe redirect, after plan changes).
  - Stale-while-revalidate window: 60 s. Don't refetch on every route change.
  - Files: new `frontend/src/billing/BillingContext.tsx`, update `BillingBanner` and the
    dashboard checklist consumers. Remove duplicate `useEffect` fetches.
  - Verify in DevTools Network: exactly one request per dashboard load.

- [ ] **BUG-009 · Normalizar query params de reportes a `start_date` / `end_date`.**
  - `backend/app/reports/router.py`: change `sales-by-hour` to accept `start_date` and
    `end_date` (keep `start`/`end` as deprecated aliases for one release).
  - Frontend reports client: send `start_date`/`end_date` for every endpoint.
  - Update `backend/app/tests/test_reports.py` accordingly.

- [ ] **BUG-010 · Deduplicar "Decisiones recomendadas" en `/reports`.**
  - In the backend `business-story` builder (where `recommended_actions` is assembled), dedupe
    by `(action_type, target_id)` BEFORE the three-action cap is applied. Currently it looks
    like restock alerts and generic recommendations both push the same "Reabastece Agua mineral"
    item.
  - Add a unit test with two overlapping alerts pointing to the same product; assert only one
    survives.

- [ ] **BUG-011 · Sincronizar nombre del negocio en sidebar y dashboard tras edición en Perfil.**
  - Identify where the tenant name is held in the frontend (likely `AuthContext` or a
    `TenantContext`). After `PATCH /api/v1/business-settings/profile` succeeds, call the
    relevant `refetch()` / `setTenant()` so `AppShell` and dashboard read the new value
    without a hard refresh.
  - If the value is part of the `/api/v1/auth/session` response, just call the existing
    session refresh after the save. Confirm both the sidebar header and the dashboard greeting
    update.

- [ ] **BUG-013 · Aclarar neto vs bruto en `/reports`.**
  - In the "Pagos y operación" section, relabel cash/card totals as
    `Cobrado en efectivo (bruto)` and `Cobrado con tarjeta (bruto)`, and add a small
    inline note: `Las ventas netas (arriba) ya descuentan devoluciones; los pagos muestran
    el bruto cobrado.`
  - Alternative if preferred by product: compute and show both `bruto` and `neto` columns.
    Default to the cheaper labeling fix unless product asks otherwise.

- [ ] **BUG-014 · SKU obligatorio o autogenerado.**
  - Decision (default): autogenerate SKU when the user leaves the field empty. Format:
    `<3-letter category prefix>-<short uuid>` e.g. `BEB-7H2K9`. Implement in
    `backend/app/catalog/service.py` (create path) — never overwrite an explicit value.
  - Frontend: in the product modal, when SKU is empty show helper text
    `Se generará automáticamente`. Remove the `Sin SKU` placeholder from catalog/register/
    inventory list views once backfill is done.
  - Backfill: one-off backend script `backend/scripts/backfill_skus.py` to generate SKUs for
    existing rows where SKU is NULL/empty.

- [ ] **BUG-015 · Bloquear efectivo recibido negativo.**
  - In the register payment input, set `min="0"`, strip leading `-` on change, and reject
    negative values in the submit handler with the existing error component (no new toast).
  - File: `frontend/src/register/RegisterView.tsx` (cash payment input).

### P1 · Localización (visible al usuario en cada pantalla)

- [ ] **Set `<html lang="es-MX">`** in `frontend/index.html`. Single-line fix.
- [ ] **Per-route document title.** Implement a small `useDocumentTitle(title)` hook and call it
  from each route container: `Caja · Kova`, `Reportes · Kova`, `Catálogo · Kova`,
  `Inventario · Kova`, `Órdenes · Kova`, `Turnos · Kova`, `Configuración · Kova`,
  `Panel · Kova`. Keep the default `kova · POS para tu negocio` for landing/auth.
- [ ] **Traducir strings en inglés residuales:**
  - Catalog filter `All` → `Todos`.
  - Shifts state `Open` → `Abierto`, `balanced` → `Balanceado`.
  - Shift movement type `OPENING_BALANCE` → `Apertura de caja`,
    movement description `Opening balance` → `Saldo inicial`. Map enum values to localized
    labels in the frontend (don't change the backend enum).
  - Refund reason dropdown values: keep enum codes (`customer_return`, `defective`,
    `wrong_item`, `other`) but render `Devolución de cliente`, `Defectuoso`,
    `Producto equivocado`, `Otro`.
  - ARIA labels in catalog: `Deactivate Cafe caliente` → `Desactivar Café caliente`. Use the
    localized product/category name.
- [ ] **Agregar acentos faltantes en `frontend/src/i18n/messages.ts`** (no exhaustivo):
  `Cafe caliente` → `Café caliente`, `Bebidas frias` → `Bebidas frías`,
  `Chocolate frio` → `Chocolate frío`, `configuracion` → `configuración`,
  `facturacion` → `facturación`, `catalogo` → `catálogo`, `ordenes` → `órdenes`,
  `critica` → `crítica`, `despues` → `después`, `Umbral mas bajo` → `Umbral más bajo`,
  `mostrara metodos` → `mostrará métodos`, `descripcion` → `descripción`,
  `Mas recientes` → `Más recientes`, `Mas antiguas` → `Más antiguas`,
  `Ordenar ordenes` → `Ordenar órdenes`, `Tu suscripcion esta activa` →
  `Tu suscripción está activa`, `El plan ya esta aplicado` → `El plan ya está aplicado`,
  `Checkout no necesario: la suscripcion ya esta activa.` →
  `Checkout no necesario: la suscripción ya está activa.`,
  `Maximo 512 KB` → `Máximo 512 KB`, `subelo` → `súbelo`. Grep the codebase for each before
  editing — some live in backend email templates or seed data.
- [ ] **Categorías existentes en DB:** las cuentas creadas antes del fix mantienen `Cafe caliente`
  como dato persistido. Crear `backend/scripts/fix_category_accents.py` que actualice acentos
  comunes en `categories.name` para tenants existentes (idempotente, limitado a cadenas
  conocidas — no LLM-translation).
- [ ] **Formato de fecha `dd/mm/yyyy`.** Centralizar el formatter en
  `frontend/src/orders/format.ts` (o crear `frontend/src/i18n/date.ts`) usando
  `Intl.DateTimeFormat('es-MX', ...)`. Reemplazar usos en `/orders` (placeholders y
  rendering) y en la tabla "Turnos cerrados recientes" de `/shifts`. Hora en 24 h por defecto.
- [ ] **Zona horaria humana.** Mapear `America/Mexico_City` → `Ciudad de México (UTC-6)` en
  el header de `/reports`. Mapa pequeño en `frontend/src/i18n/timezones.ts` cubriendo las TZ
  IANA de México (CDMX, Cancún, Tijuana, Hermosillo, Chihuahua, Mazatlán).
- [ ] **Pluralización "Completadas" → "Completada" por fila.** En la lista de Órdenes, la
  etiqueta por fila debe respetar singular cuando representa el estado de UNA orden. La
  etiqueta del filtro (multi-selección) mantiene el plural.

### P2 · UX polish

- [ ] **Onboarding 5/7 — marcar como completados los pasos ya logrados.**
  En el checklist del panel: si `subscription.status in ('active','trialing')` marcar
  `Activa el plan Standard` como hecho. Si existe al menos una venta cuyo recibo se haya
  configurado/personalizado (o si hay logo subido), marcar `Prepara el recibo del cliente`
  como hecho. Si el producto requiere validar configuración explícita, agregar checkbox
  manual "Marcar como hecho" en el item para que el usuario destrabe el checklist.
- [ ] **Toast doble en Caja al completar venta.** Mantener únicamente la tarjeta `Venta
  completada` con `Abrir orden` / `Nueva venta`; quitar el toast verde redundante.
- [ ] **Fallback de imagen para productos sin foto.** Usar el ícono de caja ya existente en
  Catálogo en vez de la inicial (`A`, `C`). Componente compartido `ProductImage` con
  fallback prop.
- [ ] **Confirmación destructiva para "Cancelar suscripción".** Modal con copy
  `¿Cancelar tu suscripción? Perderás acceso a Kova al final del periodo pagado actual.`
  + CTA `Cancelar suscripción` (rojo) y `Conservar suscripción` (secundario).
- [ ] **Sanitizar HTML en nombre de producto.** Rechazar etiquetas `<...>` en el campo
  nombre (frontend regex `/<[^>]+>/` → error inline; backend Pydantic validator que strippea
  o rechaza). No solo confiar en escape de render.

### P2 · Seguridad y configuración

- [ ] **Content-Security-Policy.** Definir headers CSP en el reverse proxy / Vercel config
  (`frontend/vercel.json` si existe, si no en el backend cuando sirva HTML). Política inicial
  estricta: `default-src 'self'; img-src 'self' data: blob: https://*.stripe.com;
  script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'
  https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'
  https://api.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com;
  object-src 'none'; base-uri 'self'; form-action 'self'`. Ajustar tras probar Stripe Checkout
  y PWA SW.
- [ ] **Documentar y probar modo offline end-to-end.** Crear `docs/offline-qa-checklist.md`
  con: alta de venta sin red, cola visible, reconexión y sync, retry desde dead letter,
  comportamiento del badge "Sin conexión" en sidebar/AppShell. No es un cambio de código
  obligatorio pero la promesa "funciona sin internet" exige checklist viva.

### P2 · Performance

- [ ] **Cache de 30–60 s para reportes.** Wrap los fetchers de `/reports` con un caché simple
  en memoria (Map por `{endpoint, range}` con TTL) o adoptar React Query *solo si* ya está
  en el repo. Si no, mantener implementación manual.
- [ ] **Esqueletos de Catálogo.** Reemplazar la pantalla blanca inicial por los skeletons
  que ya existen en Panel. Ajustar el primer render de `frontend/src/catalog/CatalogView.tsx`
  para mostrar el skeleton mientras hidrata.

### Sprint 5 Verification Gate

Antes de cerrar el sprint:

- [ ] `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -- --run` en verde.
- [ ] `UV_PROJECT_ENVIRONMENT=.venv-win uv run pytest` en verde.
- [ ] Nuevos E2E: `routing.spec.ts`, ampliación de `register-sale.spec.ts` para sin-stock,
      ampliación de `orders.spec.ts` para devoluciones con qty inválida.
- [ ] DevTools Network: exactamente 1 request a `/api/v1/billing/subscription` por carga del
      Panel.
- [ ] Manual: cambiar nombre del negocio en Perfil → sidebar refleja sin recargar.
- [ ] Manual: navegar `/reports` ⇄ `/settings` 10 veces sin perder sesión.

### Out of Scope (defer to next sprint)

- Rediseño profundo de "Decisiones recomendadas" (sólo deduplicar aquí).
- Cambios al cálculo de "Velocidad de stock" más allá del clamp a "Ya agotado".
- Localización completa de emails transaccionales (sólo los strings flagrantes de la app).
- Stripe live keys (gate explícito de GA, ver `Release Gate`).

## Carried Over From Older Production-Review Backlog

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [x] Tenant isolation tests for every tenant-scoped route landed in
      `backend/app/tests/test_tenant_isolation_routes.py`. Covers catalog, orders, reports,
      inventory, business-settings, employees, shifts, modifiers, and billing.
- [x] Landing tablet preview now labels itself as a demo (`Vista previa · ejemplo`) so the numbers
      cannot be mistaken for live tenant metrics. Real backend-driven dashboard trend comparisons
      and richer report endpoints remain a follow-up before Tax/Discounts work.

## Pre-Beta Ops Checklist

Still required before onboarding the first beta tenant.

- [x] Sentry: backend and frontend DSNs configured, alert rules active.
- [x] Backups: GitHub Actions `db-backup.yml` daily `pg_dump` (artifact 30 d).
      Pro plan upgrade and managed backups deferred to pre-GA.
- [ ] Uptime monitor: add UptimeRobot on `https://pos-project-backend.fly.dev/health` with email alert.
- [x] Support channel: `posprojectsupport@gmail.com` active.
- [x] Beta agreement template: `docs/beta-agreement-template.md`.
- [x] Production deployment Sprint 14: security headers verified in production.
- [x] Verify secure cookies in production: `Secure; HttpOnly; SameSite=Lax` confirmed.

## Release Gate

Stripe live keys and live Checkout are the last step before GA. Production stays in sandbox until the
web app is otherwise complete. See `docs/risk-register.md` for the hardened guard rails.

## Completed Sprints Summary

Detailed retros live in `docs/sprint-planning.md`.

- Sprint 9: Billing: Standard Plan (2026-05-11)
- Sprint 10: App Shell + POS Foundation (2026-05-11)
- Sprint 11: Catalog Management (2026-05-11)
- Sprint 12: Register Core (2026-05-13)
- Sprint 13: Offline Sync + Dead Letter (2026-05-13)
- Sprint 14: Beta Hardening (code) (2026-05-13)
- Sprint 15: Modifiers (2026-05-13, production validated)
- Sprint 16: UX Polish + Onboarding + Mobile Hardening (2026-05-14)
- Kova Audit Sprint 1: Trust, Clarity, and Conversion (2026-05-20, mostly complete)
- Kova Audit Sprint 2: Onboarding and First Value Moment (2026-05-20, functionally complete)
- Kova Audit Sprint 3: POS, Products, Employees, and Inventory Usability (2026-05-20, functionally complete)
- Kova Audit Sprint 4: Reports and Business Storytelling (2026-05-20, in progress)
