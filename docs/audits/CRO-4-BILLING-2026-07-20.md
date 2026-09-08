# Evidencia CRO-4 — Billing y checkout confiables

Estado: **CRO-4.1–4.5 aprobados; porción de proveedor/lifecycle de CRO-4.6 aprobada**. La UX de
retorno/cancelación y live mode conservan gates operativos independientes.

## Precio y contrato de periodo

- Billing forma el precio visible desde `plan.amount_minor_units`, `currency` e `interval`. Para el
  contrato actual muestra exactamente `$299 MXN/mes` tanto en la tarjeta como en el CTA; no usa un
  precio duplicado o hardcodeado en la vista.
- `subscription.period_freshness` es un campo aditivo con valores `verified`, `stale` y
  `unavailable`. Solo es `verified` cuando existe una fecha futura y el periodo fue sincronizado
  con Stripe dentro de las últimas 24 horas. La marca interna de sincronización no sale en el JSON.
- Solo un periodo `verified` muestra `Próxima renovación` o, si la cancelación ya está programada,
  `Acceso hasta`. Una fecha vencida, sin sincronización reciente o ausente queda oculta y se
  reemplaza por: “Estamos verificando tu próxima fecha de renovación. Tu acceso actual no cambia.”
- El TTL de resync y el umbral del contrato comparten una sola constante de 24 horas para evitar
  que backend y respuesta pública discrepen.

## Retorno de Checkout

- Volver por la ruta de éxito ya no equivale a afirmar que el pago terminó. La página muestra
  `Estamos confirmando tu suscripción` mientras consulta el estado autoritativo del backend.
- La reconciliación continúa siendo acotada e idempotente y acepta como confirmación únicamente
  una suscripción backend `active` o `trialing`. Si no converge, la página indica que no se repita
  el pago, permite actualizar y enlaza al canal oficial de soporte.
- El retorno sin `session_id` entra directamente al estado recuperable; no intenta reconciliar una
  sesión desconocida ni presenta una activación falsa.

## Validación local

- Backend billing API: 38/38 pruebas aprobadas contra una base Postgres efímera dentro de Compose;
  la base y su rol temporal se eliminaron al finalizar.
- Vitest focal de Billing: 8/8.
- Playwright Billing en Chromium: 8/8, incluidos periodo vencido oculto, periodo verificado,
  retorno pendiente, recuperación, trialing, cancelación y permisos.
- TypeScript, ESLint focal, Ruff, `git diff --check` y build de producción con SSR/prerender:
  aprobados.

## Gate operativo completado: CRO-4.5

Diagnóstico de solo lectura ejecutado el 2026-07-21 contra el backend desplegado y la API de
Stripe, sin imprimir claves, IDs, tenants ni datos personales:

- El entorno de producción usa una clave Stripe **live**, sin override de test mode. El Price
  configurado está activo, es live y coincide con `$299 MXN` cada mes.
- El endpoint webhook live está habilitado para `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.paid` e
  `invoice.payment_failed`. El backend trata `invoice.paid` y `invoice.payment_succeeded` como
  alias equivalentes.
- Tres de cuatro suscripciones locales tienen Subscription ID. Las tres se recuperaron desde
  Stripe live y coincidieron en modo, estado y fin de periodo futuro.
- No existen webhooks con estado `failed`. Hay eventos procesados de checkout, actualización,
  pago y fallo de pago; los eventos históricos `ignored` se conservaron sin reintento ni edición.
- Un solo tenant tiene una fila local `active` con periodo vencido. La fila se creó el 2026-05-21
  sin Customer ID, Subscription ID, Price ID ni Checkout Session ID; tampoco tiene evento Stripe
  o auditoría de activación. Por tanto, la causa es una activación local histórica, no un periodo
  vencido recibido desde Stripe ni un fallo de reconciliación.

La excepción afecta a un tenant. No se editó su estado ni su periodo porque hacerlo podría retirar
acceso a una operación interna o controlada sin una decisión del owner. La recuperación segura es
clasificar primero el tenant: si debe pagar, completar un Checkout nuevo y dejar que webhook/backend
creen el vínculo autoritativo; si es una cuenta interna, registrar una excepción de acceso explícita
en un flujo diseñado y auditado; si no debe conservar acceso, revocarlo mediante una operación
administrativa aprobada. Nunca completar IDs o fechas manualmente ni reconciliar una sesión de otro
tenant.

## Evidencia posterior: proveedor y lifecycle de CRO-4.6

El run de GitHub Actions `34179307328`, sobre el commit `6933ac2`, usó Stripe test mode con backend
y PostgreSQL desechables. Completó el Checkout alojado de `$299 MXN` mensual y verificó renovación,
fallo con `past_due` y gracia, recuperación, cancelación al fin del periodo, ambos órdenes de eventos
entre familias y replay duplicado. El job eliminó tres Test Clocks y el Customer independiente que
creó. La evidencia revisada y redactada está en
[`KOV-005-STRIPE-TEST-MODE-DRILL-2026-09-07.md`](evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-09-07.md).
Esta aceptación cubre el proveedor y lifecycle en test mode. No recorrió la página real de retorno
de Kova, la ruta de cancelación de Checkout, los mensajes de error al usuario ni correo; tampoco
valida producción live. Esos puntos continúan como release gates separados.

## Seguridad y rollback

No cambian precio, trial, impuestos, cancelación, permisos, cookies, RLS, tenant isolation,
idempotencia, gates de acceso ni esquema de base de datos. El contrato solo añade
`period_freshness`. El rollback consiste en revertir el commit CRO-4; las columnas y datos
existentes permanecen intactos.
