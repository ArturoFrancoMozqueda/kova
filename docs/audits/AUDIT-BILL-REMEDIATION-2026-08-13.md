# Auditoría de remediación BILL — 2026-08-13

## Alcance y estado

- **BILL-1:** política temporal definida e implementada.
- **BILL-2:** watermarks, bloqueo, deduplicación y observabilidad implementados.
- **BILL-3:** reconciliación acotada y job interno protegido implementados.
- **BILL-4:** **pendiente externo**. No existe en este cambio evidencia de un recorrido completo en
  Stripe test mode; por lo tanto no se considera cerrado ni habilita live mode.

## Política temporal

Stripe no garantiza el orden de entrega y recomienda deduplicar por `event.id`. Kova mantiene dos
watermarks independientes por suscripción para no mezclar streams con semánticas distintas:

| Familia | Eventos | Campos mutados | Desempate para `event.created` igual |
|---|---|---|---|
| Lifecycle | `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted` | status, periodo, trial, cancelación, precio | `deleted` > `updated` > `created` > checkout |
| Payment | `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed` | active/past-due, gracia; recibo sólo tras aceptar | éxito > fallo |

Reglas:

1. `event.created` mayor al watermark se acepta; menor se registra `ignored` con razón
   `stale_<family>_event` y no muta la suscripción ni envía correo.
2. Mismo timestamp y mayor precedencia se acepta; menor precedencia se ignora. Dos eventos
   diferentes con el mismo rango son ambiguos y consultan la suscripción actual en Stripe.
3. Replay del mismo `event.id` devuelve su estado ya persistido. El claim usa `INSERT ... ON
   CONFLICT DO NOTHING` y `SELECT FOR UPDATE`, así dos workers no repiten efectos ni correos.
4. Eventos sin `created` sólo pueden bootstrappear una fila legacy sin watermark. Si ya hay
   watermark requieren reconciliación autoritativa. El webhook real de Stripe sí define `created`.
5. Un objeto incompleto que no permite identificar la suscripción no altera acceso. Las fallas
   temporales al consultar Stripe dejan el evento `failed` y reintentable; nunca inventan un estado.
6. Campos de observabilidad del evento (`processing_status`, tenant y error) sí se actualizan para
   stale/replay; ningún campo comercial de la suscripción se actualiza desde un evento stale.
7. Una lectura autoritativa (reconciliación o cancelación solicitada por API) avanza el watermark
   al instante de observación. Así, un webhook creado antes de esa lectura no puede deshacer la
   respuesta más reciente de Stripe.

Las columnas nuevas son nullable y no requieren backfill, por lo que la migración es compatible
con un despliegue rolling. La primera entrega timestamped establece cada watermark.

## Concurrencia y límites

- El webhook toma un advisory transaction lock por tenant y después `FOR UPDATE` sobre la fila de
  suscripción. El advisory lock cubre también el caso en que la fila aún no existe.
- La lectura autoritativa de suscripción usa timeout de 3 segundos, máximo 2 intentos y backoff
  corto sólo para red, 429 y 5xx.
- Las divergencias y fallas emiten logs estructurados con prefijo `billing.webhook.divergence_*` o
  `billing.reconciliation.*`, consumibles por el drain/alerting de producción.

## Runbook de reconciliación

Endpoint: `POST /api/v1/billing/internal/reconcile` con `X-Internal-Key` y body opcional
`{"limit": 100}`. Usa la conexión privilegiada porque cruza tenants; el secreto nunca debe ir en
logs ni cliente. Procesa como máximo 500 filas por ejecución, consulta Stripe y converge estado,
periodo y cancelación. Reporta `checked`, `updated` y `failed`; una fila fallida hace rollback de
esa unidad y no detiene las demás.

Antes de ejecutar en staging/producción:

1. Confirmar entorno y separación test/live de llaves.
2. Empezar con `limit: 10`, revisar logs de divergencia y respuesta.
3. Repetir por lotes pequeños; alertar si `failed > 0` o aparecen divergencias inesperadas.
4. No ejecutar cancelaciones ni cargos manuales como parte de este job.

## Evidencia automatizada prevista

`app/tests/test_billing_temporal_order.py` cubre new→old para lifecycle/payment, empate,
reconciliación ambigua, replay reintentable, protección del job y dos workers concurrentes. La
reversibilidad de `20e47faf64eb_add_billing_event_watermarks.py` se valida con upgrade→downgrade→
upgrade cuando Postgres local/CI está disponible.

Validación local realizada:

- `uv run ruff check .`: aprobado.
- `python -m compileall`: aprobado.
- smoke puro de política temporal: aprobado.
- smoke de retry acotado: 2 intentos con timeout de 3 segundos, aprobado.
- inspección ejecutable de migración: seis columnas nullable y seis drops simétricos, aprobado.
- pytest focalizado: bloqueado antes de ejecutar casos porque el Postgres local rechazó las
  credenciales `pos` configuradas por defecto. Docker Desktop tampoco estaba disponible. La suite
  y el drill upgrade→downgrade→upgrade deben ejecutarse en CI/Postgres efímero antes del merge.
