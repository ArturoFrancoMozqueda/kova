# Evidencia CRO-4 — Billing y checkout confiables

Estado: **CRO-4.1–4.4 aprobados localmente; CRO-4.5–4.6 pendientes de validación operacional con
Stripe**.

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

## Gate operativo pendiente: CRO-4.5

No se inspeccionaron tenants, eventos ni logs de Stripe desde el entorno local, por lo que todavía
no hay evidencia para atribuir la fecha vencida observada a un modo, webhook o suscripción
específicos, ni para enumerar tenants afectados. Antes de reconciliar en un entorno conectado:

1. Confirmar explícitamente si el entorno usa test o live y mantener separados sus claves, Price
   IDs, Customer IDs y Subscription IDs.
2. Para cada tenant afectado, correlacionar el ID de suscripción persistido con los eventos
   `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_succeeded` y
   `invoice.payment_failed`; registrar último evento recibido, respuesta HTTP y reintentos.
3. Consultar la suscripción a Stripe y comparar estado, periodo del item y marca de sincronización
   local. No editar manualmente fechas ni identificadores.
4. Usar el endpoint de reconciliación ya autorizado solo con el `session_id` del mismo tenant, o
   provocar el resync seguro mediante la lectura de Billing. Verificar después contrato, acceso y
   auditoría; escalar a soporte si no converge.

## Gate operativo pendiente: CRO-4.6

Playwright usa respuestas controladas y **no** sustituye el Checkout alojado. En Stripe test mode
queda por revisar manualmente: resumen `Standard Plan`, `$299 MXN`, cadencia mensual, campos y
errores, cancelación, ruta de regreso, estado pendiente y posterior confirmación backend. Usar solo
un método de prueba de Stripe; no introducir tarjeta real ni completar un cargo live.

## Seguridad y rollback

No cambian precio, trial, impuestos, cancelación, permisos, cookies, RLS, tenant isolation,
idempotencia, gates de acceso ni esquema de base de datos. El contrato solo añade
`period_freshness`. El rollback consiste en revertir el commit CRO-4; las columnas y datos
existentes permanecen intactos.
