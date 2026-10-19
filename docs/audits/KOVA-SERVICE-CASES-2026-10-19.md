# Atención postventa interna: entrega local

Fecha: 2026-10-19, America/Mexico_City. El propietario autorizó continuar la automatización con
agentes y avanzar sin conectar cuentas externas. Estado de este informe: implementación y QA
locales finalizadas; CI, merge y aceptación del release se registran por separado. No acredita
producción ni cierre del horizonte E2E completo.

## Resultado para el negocio

`/service-cases` permite al dueño o gerente registrar una atención con cliente explícito, nota
inicial, responsable y vencimiento manual opcionales. Una venta o pedido sólo se ofrece si su
cliente pertenece al mismo negocio/sucursal y está identificado por datos de dominio; coincidencias
de nombre/teléfono no autorizan el vínculo. También admite orígenes históricos anulados/cancelados
para aclarar una operación, sin cambiarla.

El equipo puede poner el caso en atención, resolverlo, reabrirlo o cancelarlo conforme al estado
vigente. Cancelación es terminal para transiciones; notas y cambios de responsable/vencimiento
siguen documentándose. Cada modificación conserva autor y versión en un evento inmutable. El
historial muestra autor identificable y notas anteriores; un responsable que perdió acceso se
señala aunque su correo siga en caché. `overdue` se calcula con el reloj del servidor sólo para
casos activos, sin prometer SLA ni enviar recordatorios.

No crea compensaciones, devoluciones, descuentos, movimientos de stock, puntos ni mensajes.
Las incidencias sencillas ya existentes en `/crm/followups` conservan su historial y no se migran
ni se fusionan silenciosamente con casos nuevos.

## Archivos y contratos

- `backend/app/service_cases/`: modelos, DTOs prefijados `ServiceCase*`, consultas y comandos
  privados con RBAC/billing, idempotencia y control de versión.
- `backend/alembic/versions/0090_service_cases.py`: dos tablas FORCE RLS y relaciones compuestas
  tenant/sucursal. Runtime SELECT/INSERT; UPDATE sólo en campos de workflow del caso. Sin permisos
  de modificación/borrado del historial ni edición de cliente, título u origen.
- `backend/app/main.py`, `db.py`, provisioning, fixture de rol y `account_lifecycle/service.py`:
  routers, inventario de RLS, permisos y grafo explícito de exportación/purga. Eventos se purgan
  antes de casos y sus padres; el downgrade rechaza descartar historial existente.
- `frontend/src/serviceCases/`, rutas y navegación: alta/revisión/notas, selección paginada de
  responsables y referencias elegibles, fechas con zona explícita, filtros y estados vacíos.
  Identidad/sucursal desmontan el workspace; respuestas tardías no reponen datos anteriores.
- `specs/openapi.json`: seis paths nuevos, con paths/schemas anteriores estructuralmente idénticos.
  [Contrato y BDD](../../specs/service_cases/internal_service.md).

Notas y títulos no se guardan en auditoría; ésta conserva identidad, estado, versión y nombres de
campos. Resolver concurrentemente el mismo caso sólo produce una versión/evento; el otro intento
recibe conflicto. Reintentos de una nota con respuesta incierta conservan clave y versión para
recuperar el efecto original antes de preparar una operación nueva.

## Validación local

- Backend completo: **1,746 pruebas aprobadas** con fuente final.
- Migraciones: **25 pruebas aprobadas**. Incluyen la ampliación exacta del grafo/verbos de dos
  tenants, conservación de ventas, downgrade vacío reversible y protección contra pérdida de casos.
- Dominio de atención: **11 pruebas aprobadas**, repetidas con pg8000, incluidas concurrencia real
  con dos conexiones `kova_app`, origen verificable, baja de responsable, reloj, RBAC/billing y RLS.
- Runtime Python Durable Objects: **ocho pruebas aprobadas**, con cobertura de atención interna.
- Frontend completo: **1,087 unitarias aprobadas**; **14 focales** de atención aprobadas.
- Chromium: **cuatro tamaños aprobados** (1440/768/390/320 px), revisión axe A/AA, overflow, errores
  JavaScript y foco al abrir/cerrar el detalle. Se corrigió el ancho del filtro en 320 px.
- Recorrido local sin mocks: **1/1 aprobado** con navegador → API → PostgreSQL y rol runtime RLS;
  alta, referencia propia, nota, resolución y privacidad entre negocios; verifica venta/pagos intactos.
- TypeScript, ESLint, build Vite, SSR/prerender de cinco rutas y escaneo de **118 chunks JavaScript**
  aprobados. Ruff, comparación estructural OpenAPI, comprobador de exportación y diff-check aprobados.

No se repitieron operaciones financieras reales de clientes ni se usaron sus credenciales. Estos
resultados corresponden a entornos locales/sintéticos aislados, no a una sesión autenticada de
negocio en producción.

## Pendientes y siguiente corte

La atención implementada sigue siendo interna. Faltan, según su contrato y fase, captación de casos
desde canales externos, respuestas/entrega de mensajes, avisos de vencimiento y escalamiento,
compensaciones de dominio y relación explícita entre conversación, tarea sencilla y caso. Tampoco
se atribuye una recompra o satisfacción al cierre de un caso.

La continuación independiente de cuentas ya incorpora el backend de la
[cola operativa interna de sólo lectura](../plans/PLAN-COLA-OPERATIVA-INTERNA.md), con fuentes de
casos, oportunidades, seguimiento y agenda. Endpoint y pruebas locales están implementados sin
migraciones; la UI también está validada localmente. [Evidencia y límites](KOVA-OPERATIONS-QUEUE-2026-10-19.md).

Crédito/cartera, recetas/KDS, voz, firma, cursos y franquicias siguen requiriendo dominios propios.
WhatsApp/Meta, correo del dominio, PSP y PAC conservan sus dependencias de configuración y
aceptación reales. No son requisitos para consultar la cola interna implementada localmente.
