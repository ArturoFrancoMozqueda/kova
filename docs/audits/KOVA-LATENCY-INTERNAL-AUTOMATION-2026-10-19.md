# Arranque frío, revisiones de atención y enlaces a pendientes

Fecha: 2026-10-19. Estado: PR #219 publicada y aceptada en producción; latencia fría pendiente de resolver.
Aceptación 18:00:50 UTC, SHA `1f12c4baf8a974ce6fd49d3cc2356009640a4b65`, migración 0091 aplicada. Este corte continúa la cola/casos ya publicados por PR #217. No acredita todavía una
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
perfil local, no latencia de login/sesión en producción, tiempo de red ni base de datos. La medición pública posterior a publicar confirmó 32/32 contratos privados correctos y el mismo
SHA antes/después. En ocho primeras peticiones directas, la mediana fue 8,453.5 ms (411–17,574 ms);
cinco superaron 8 s. En ocho repeticiones directas, 347.5 ms (219–1,120 ms). Las muestras proxy,
posteriores a las directas, tuvieron medianas de 790 y 474 ms. Son primeras observaciones por
contexto sintético y pueden estar calientes por tráfico previo; no prueban un SLA. La latencia fría
no está resuelta. Sitio, proxy, API y conexión de base de datos aprobaron el verificador estricto.

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

## Diagnóstico siguiente

Se añaden mediciones monotónicas con etiquetas estáticas y duración para configuración, importación,
Sentry/configuración, RLS, ACL privada y construcción de la aplicación. No cambian validaciones,
orden, lock/cache, cookies, RLS ni contratos HTTP. No registran configuración, SQL o datos de
clientes. La fase Workers temprana se emite después de instalar logging. Ocho regresiones nuevas
comprueban orden, fallo cerrado, cache y ausencia de payload privado; 14 focales aprobadas.
La instrumentación fue aceptada en producción por PR #220 a las 18:32:33 UTC, SHA
`50c6749725b66ee9c908ade48cdf32cd6552fc51`, versión API
`3368dde6-04dc-455d-8540-891d085e8c34`. Verificador estricto: sitio/proxy/API/base de datos
alcanzables y SHA coherente. La suite backend completa final pasó 1,808 pruebas sin
fallos/errores/omitidas. La prueba de comparación de rutas se aisló de las rutas temporales que
las pruebas RBAC añaden a `main.app`; once regresiones combinadas y suite completa aprobaron.

Nueva cohorte de 32 GET: todos los contratos aprobaron. Primeras directas: mediana 8,260 ms,
rango 245–17,575 ms, seis de ocho >=8 s; repeticiones directas: mediana 218 ms (191–234 ms).
Proxy posterior: medianas 262/221 ms. Telemetría por fases de esa versión: `workers.total`
mediana 5,686.5 ms, `app.rls_posture` 5,410 ms y ACL privada 271 ms, con muestras distintas.
Los relojes de Workers sólo avanzan tras I/O: los ceros no prueban CPU cero y el intervalo RLS
puede incorporar CPU anterior al siguiente I/O. No se atribuye todo el tiempo a consultas.
[Semántica del reloj](https://developers.cloudflare.com/workers/runtime-apis/performance/).

## Siguiente optimización, aún sin aceptación productiva

Se implementó una frontera explícita de metadata declarativa sin configuración ni conexiones:
`app.db.Base` conserva su identidad por reexportación. Los modelos y schemas se pueden importar
antes de la invocación sin `app.config`, `app.db`, engines o sockets. El experimento temporal
mantuvo el inventario puro de 96 tablas/201 índices/DDL y OpenAPI idénticos, con nueve pruebas runtime por corrida.
Dos mediciones equivalentes dieron ~28.7% menos trabajo local de inicialización; no se promete
ese porcentaje remoto. El modelo `InventoryTransfer`, declarado fuera de los archivos `*models.py`,
conserva su carga diferida y comparte la misma registry cuando se importa; el inventario puro no
pretende abarcar todo módulo con una clase ORM. Tres preloads adicionales no dieron una mejora incremental estable y
se descartaron. El segundo cambio reúne las lecturas del catálogo de arranque en un viaje,
conservando el comprobador completo de RLS y ACL separada. Veintiséis pruebas diferenciales
(psycopg/pg8000) comparan los mismos inputs con las cuatro lecturas originales, incluidos estados
inseguros, propiedad, tablas ausentes y políticas de relaciones particionadas. Focal ampliado:
78 aprobadas; frontera/listeners: 11 aprobadas; Workers: 9 API + 4 compatibilidad + 1 tareas;
27 migraciones aprobadas sin cambios de schema. Metadata nativa completa: 97 tablas y 202
índices idénticos, incluyendo el modelo de transferencias diferido. Las suites completas finales
con ambos controladores están en ejecución. CI/publicación y medición remota pendientes;
no se declara resuelta la demora fría.

## Aceptación de PR #221 y latencia todavía abierta

PR #221 fue aceptada el 19 de octubre a las 14:32 CDMX (20:32 UTC), SHA
`2df276612e661b2b6652f65ee9edaaec4b869a8c`, versión API
`c96a1fb3-6aaa-4860-973b-9fa653656306`. CI y publicación completos aprobaron. El arnés
RLS final utiliza el controlador real de cada perfil: once escenarios de catálogo y cuatro de
fallo cerrado por perfil, sin exigir el proveedor opcional del otro job ni omitir escenarios.
El perfil nativo también aprobó bloqueando explícitamente la importación de pg8000.

Verificador estricto: frontend/proxy/API/base de datos alcanzables con ese mismo SHA.
QA pública: 32 navegaciones en cuatro tamaños, 12 GET protegidos con 401/no-store, cero errores
JavaScript/desbordamientos. No se usaron sesiones de clientes ni escrituras del negocio. El
intento de refresh sin credencial se permitió únicamente para exigir 401 sin cookies de auth.

La cohorte posterior (17:49 CDMX) aprobó 32/32 contratos y verificó identidad antes/después, pero
no resolvió la demora. Primeras consultas directas de cola: 6,828/14,499/5,707/238 ms; mediana
6,267.5 ms. Repeticiones directas: mediana 208 ms (184–240). Las sesiones iniciales ya estaban
calientes: mezclar sus tiempos con cola daría una mediana engañosa de 232 ms. Estos son primeros
accesos observados, no arranques fríos forzados ni un SLA.

## Siguiente corte: descubrimiento del dialecto, sin saltar guards

La primera conexión SQLAlchemy ejecuta cuatro sondeos de versión, schema, aislamiento y strings.
Se agrupan en una consulta de valores vivos de la misma conexión para el dialecto Workers;
`super.initialize` conserva el parser y las capacidades originales. Las lecturas GUC se califican
con `pg_catalog` para conservar la semántica de SHOW sin depender de search_path. Los proxies
sólo viven en el stack de inicialización y las consultas desconocidas se delegan a la conexión.
Lecturas de aislamiento posteriores vuelven al comportamiento upstream.

El alias se aplica únicamente a los motores Workers runtime y privilegiado. El creador/binding,
NullPool, sesiones, transacciones, normalización de errores y comprobadores RLS/ACL permanecen
intactos. Se descartó el adaptador de catálogo directo: habría trasladado los sondeos a la primera
petición autenticada. También se descartó precargar SDK ASGI: sólo ahorró 3 ms en el experimento.

Validación del nuevo corte: 30 focales por controlador, OpenAPI sin cambios, Ruff/diff-check y
Workers 9 API + 4 compatibilidad + 1 tareas aprobados. Suites completas finales en ejecución;
publicación y medición productiva pendientes. No se declara eliminada la espera de diez segundos.
