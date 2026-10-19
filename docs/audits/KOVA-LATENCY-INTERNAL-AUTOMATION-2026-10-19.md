# Arranque frío, revisiones de atención y enlaces a pendientes

Fecha: 2026-10-19. Estado: implementado y validado localmente; publicación y aceptación productiva
pendientes. Este corte continúa la cola/casos ya publicados por PR #217. No acredita todavía una
reducción de los aproximadamente 10 s observados en producción ni completa el horizonte E2E.

## Alcance implementado

La regla `service_case_overdue` amplía el motor existente y comienza desactivada. Tras autorización
por sucursal, genera revisiones internas para casos activos cuyo vencimiento manual sea anterior
al reloj servidor y posterior o igual a `enabled_since`. Excluye casos vencidos antes de habilitarla.
No envía avisos, escala personas automáticamente, define SLA ni modifica el caso o sus finanzas.

La identidad por caso/fecha UTC en microsegundos evita duplicados por notas o asignaciones. El
scanner excluye identidades existentes antes de LIMIT. Resolver/cancelar, reprogramar, pausar o
perder autorización suprime revisiones pendientes en el siguiente procesamiento acotado; no se
promete supresión inmediata. Las fuentes obsoletas tienen prioridad en ese barrido para evitar
que un lote válido lleno las bloquee. Completar exige fuente vigente con FOR SHARE hasta commit:
un cierre/reprogramación concurrente no puede confirmar entre validar y completar la revisión.

Reusa bloqueo por sucursal, permisos del autorizante, billing, rol runtime/RLS y worker/cohort/lease
existentes. `0091_case_deadline_automation` sólo amplía dos CHECK del catálogo de plantillas/eventos;
no crea tablas, grants ni cambios de exportación/purga. Su downgrade rechaza retirar historial nuevo,
incluso si la regla quedó desactivada. Los eventos/auditorías no incorporan notas ni nombres privados.
[Contrato y validación](../../specs/automations/automation_engine.md).

La cola ahora abre el registro individual de sus cuatro fuentes con rutas/IDs permitidos:
`case_id`, `opportunity_id`, `task_id` y `reminder_id`. Los tres GET nuevos de oportunidad, seguimiento
y recordatorio conservan DTOs existentes, `require_crm`, tenant/sucursal y respuesta privada no-store.
Atención reusa su GET individual. No buscan el registro dentro de una muestra paginada ni escriben
al navegar. UUID inválido/duplicado, falta de acceso, 404 y offline tienen estados explícitos; los
resultados tardíos o de otra identidad/sucursal se descartan. Reprogramar la cita refresca también
el recordatorio enlazado: si el GET exacto devuelve 404, se retiran sus acciones obsoletas.
[Spec de cola](../../specs/operations_queue/internal_queue.md) y
[BDD de enlaces](../../specs/operations_queue/linked_records.feature).

## Arranque frío y límites de medición

El PDF de Workers carga `pypdf` al construir el documento, preservando el render existente. En
WASM, Sentry conserva transporte/sanitización y las integraciones web/database utilizadas
(FastAPI, Starlette, SQLAlchemy, HTTPX), con integraciones automáticas opcionales desactivadas;
sus defaults principales se conservan. Resend carga su SDK al enviar con configuración habilitada.
No se cambian contratos de auth, cookies, CSRF, sesiones, RLS, billing, cohort ni conexiones.

El perfil local de importación pasó de 2,171 ms a 1,213 ms, aproximadamente 44% menos. Mide ese
perfil local, no latencia de login/sesión en producción, tiempo de red ni base de datos. La fuente
queda congelada para publicación; falta repetir la medición productiva del primer acceso frío,
que había rondado 10 s, y contrastarla con accesos calientes. No se declara resuelto ese problema.

## Evidencia local

| Comprobación | Resultado y límite |
|---|---|
| Backend completo | 1,800 pruebas finales, cero errores/fallos/omitidas, 146 s. |
| Automatizaciones | 25/25 con psycopg y 25/25 con pg8000; dos pruebas de migración 0091 aprobadas. |
| GET individuales | 18/18 con cada controlador, incluidas tres regresiones directas con rol `kova_app` y dos negocios reales. |
| Frontend completo final | 1,124 pruebas aprobadas. |
| Frontend focal/integrado | 79 focales, 16 recorridos browser y uno real con API/Postgres/RLS aprobados. |
| Artefacto frontend | Build aprobado y escaneo de 121 JS aprobado. |
| Workers fuente final | Nueve pruebas de runtime, cuatro de compatibilidad y una de jobs aprobadas. |
| Migraciones completas | 27 pruebas, cero errores/fallos/omitidas, 35 s; aprobadas. |

Las pruebas de automatización incluyen creación/resolución con dos conexiones runtime simultáneas,
identidad por fecha, no retroactividad, notas sin duplicar, reprogramación/resolución/pausa/revocación,
roles/billing, dos tenants/sucursales, fechas futuras/null y lotes de una fila sin starvation. La
carrera de cierre fue reproducida antes de FOR SHARE y su regresión pasa con ambos controladores.
La revisión independiente de enlaces detectó el recordatorio obsoleto tras reprogramar; frontend
lo corrigió y añadió regresión focal y recorrido real. No quedaron otros hallazgos reproducibles.

No se realizaron envíos ni transacciones financieras reales durante esta validación. Las pruebas
locales no acreditan conexión de cuentas, entrega externa ni funcionamiento autenticado productivo.
CI del commit final, migración/publicación y medición productiva conservan gates separados.

## Archivos principales

- Motor y contrato: `backend/app/automations/{models,schemas,service}.py`, migración
  `backend/alembic/versions/0091_case_deadline_automation.py`, pruebas API/migración y
  `specs/automations/automation_engine.{md,feature}`.
- Lecturas: routers/servicios de `backend/app/crm/` y `backend/app/appointments/`,
  `backend/app/tests/test_linked_operations_reads.py` y `specs/openapi.json`.
- UI: `frontend/src/operationsQueue/{useLinkedRecord,LinkedRecordNotice,OperationsQueueView}.tsx`
  (hook `.ts`), vistas de casos/CRM/seguimiento/agenda, y enlaces de automatizaciones.
- Arranque/compatibilidad: `backend/app/workers/pdf.py`, `backend/app/observability/sentry.py`,
  `backend/app/email/service.py`, sus guards de startup y pruebas de runtime/compatibilidad Workers.

WhatsApp/Meta, correo comercial, PSP y PAC mantienen sus dependencias de configuración/aceptación.
Este corte no conecta proveedores ni habilita efectos externos.
