# Contexto de arquitectura para agentes

Resumen de las invariantes que ningún cambio puede debilitar. La topología, los componentes y el
flujo de datos, escritos desde el código, están en [`../arquitectura.md`](../arquitectura.md); el
flujo de release, en [`../despliegue.md`](../despliegue.md).

## Áreas de mayor riesgo

- Auth y sesiones.
- RLS y aislamiento entre tenants.
- Billing y webhooks de Stripe.
- Despliegue a producción.
- Sincronización offline del POS e idempotencia.
- Corrección de la analítica.

## Datos e identidad

- El backend es el único cliente de PostgreSQL. El frontend nunca recibe credenciales de Supabase.
- `APP_DATABASE_URL` usa el rol runtime `kova_app`, sin `BYPASSRLS`. `MIGRATION_DATABASE_URL` queda
  reservado para migraciones y rutas privilegiadas explícitas.
- El backend fija `app.tenant_id` por transacción y el RLS forzado lo compara. Producción no arranca
  si el rol runtime puede saltarse RLS o si una tabla de tenant no tiene RLS forzado.
- Identidad y tenant se resuelven desde una sesión válida en el servidor. Un tenant enviado por el
  navegador nunca autoriza una operación.
- Access y refresh token viajan solo en cookies HttpOnly; nada sensible en `localStorage` ni
  `sessionStorage`. La auth es propia de Kova; Supabase Auth no es parte del runtime.
- SQLite de Durable Objects no guarda tablas del negocio.

## Decisiones que conviene recordar

- Dinero en `Decimal` ([ADR-005](../adr/ADR-005-decimal-money.md)).
- Las migraciones deben ser reversibles y compatibles con la versión anterior de la app, porque un
  rollback nunca baja la base.
- Facturación de la suscripción y pagos del POS son dominios distintos
  ([ADR-008](../adr/ADR-008-billing-vs-pos-payments.md)).
- La ingesta de documentos del asistente está desactivada a propósito para controlar el gasto.
- Fly.io se retiró el 2026-10-19; publicación y recuperación usan versiones exactas de Cloudflare.

## Principios de ingeniería

- Cambios pequeños y revisables; contratos de API estables salvo que la tarea los cambie.
- Revisa las migraciones antes de tocar la base de datos.
- Datos reales del backend en flujos de producción; nada de datos de relleno para que una pantalla
  se vea completa.
- Entornos claramente separados (local, prueba y producción; Stripe test y live).

Los estados históricos de auditorías o sprints no reemplazan a
[`../current-sprint.md`](../current-sprint.md).
