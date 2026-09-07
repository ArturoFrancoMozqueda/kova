# Auditoría backend: billing, auth, equipo y privacidad

Fecha: 2026-09-06, America/Mexico_City. Revisión estática del checkout actual, dos reproducciones offline de ramas de código y validaciones adicionales sobre PostgreSQL 17 desechable local. No se accedió a producción, Stripe autenticado, correo real, secretos ni archivos `.env`. Sólo se entrega documentación; no se cambió implementación, contratos, migraciones ni tests existentes.

## Alcance y fuentes

Se revisaron `AGENTS.md`, `.claude/rules/`, contexto de arquitectura, checklist GA, `AUDIT-BILL-REMEDIATION-2026-08-13.md`, `AUDIT-SEC-REMEDIATION-2026-08-13.md`, servicios/rutas/modelos de auth, employees, account_lifecycle y billing, dependencias RLS, grants y migraciones relacionadas. El riesgo cubierto es backend/API, auth/RBAC, billing y ciclo de vida de datos.

Los controles implementados en auditorías previas no se presentan nuevamente como faltantes. Los hallazgos siguientes identifican escenarios distintos que siguen presentes. Las referencias `archivo:línea` son relativas a la raíz del repositorio.

## Hallazgos verificados

| ID | Severidad | Hallazgo | Confianza | Evidencia alcanzada |
|---|---|---|---|---|
| BAP-01 | P1 | La cancelación dentro del borrado pierde el contexto RLS antes de registrar la solicitud | Alta | Cadena de llamadas, configuración transaccional y policy |
| BAP-02 | P1 | La purga no elimina refund_items y falla por FK; el resto carece de orden de dependencias | Alta | PostgreSQL desechable: fallos por order_items_product_id_fkey y refund_items_refund_id_fkey |
| BAP-03 | P1 | Exportar la cuenta expone notas internas Ops asociadas al tenant | Alta | Reproducción offline con funciones reales y grants/migración |
| BAP-04 | P1 | Un pago antiguo reactiva una suscripción cancelada por un evento posterior | Alta | Reproducción offline con funciones reales |
| BAP-05 | P2 | El export de cuenta omite el detalle de devoluciones | Alta | Selección de tablas y esquema refund_items |
| BAP-06 | P2 | Reinvitar a un empleado desactivado choca contra la restricción de membresía única | Alta | Flujo activo-only + INSERT + constraint |
| BAP-07 | P2 | Dos cambios concurrentes pueden dejar el negocio sin propietarios activos | Alta sobre la carrera; pendiente reproducción DB | Check-then-write sin bloqueo de tenant |
| BAP-08 | P2 | Los errores SQL pueden copiar datos personales de parámetros/filas a logs | Alta; condicionada a error con datos sensibles | Canario sintético DB + formatter real |

No se identificó un P0 demostrado en este alcance. P1 requiere corrección antes de considerar confiables la privacidad/cancelación y la convergencia comercial; P2 afecta un flujo operativo concreto. No se afirma que estos incidentes ya hayan ocurrido en producción.

### BAP-01 — La cancelación rompe la transacción tenant de la solicitud de borrado

**Evidencia:** `backend/app/shared/dependencies.py:38` establece `set_config('app.tenant_id', ..., true)` una vez por request; `backend/app/db.py:82` usa `sessionmaker` normal, sin hook para restaurar el contexto en cada transacción. `backend/app/account_lifecycle/service.py:191` llama a `billing_service.cancel_subscription`; `backend/app/billing/service.py:474` hace `commit`. El flujo vuelve a leer la suscripción y crea/actualiza el pedido de borrado después de ese commit (`account_lifecycle/service.py:192`, `:200`, `:215`). La policy de `account_deletion_requests` exige el tenant tanto en lectura como escritura (`backend/alembic/versions/0050_account_deletion_requests.py:52`).

**Escenario:** propietario de una cuenta con suscripción Stripe aún no cancelada solicita borrar su cuenta. La llamada externa configura cancelación al cierre del período, y el servicio la confirma en DB; termina entonces la transacción que contenía `app.tenant_id`. Las consultas siguientes usan una nueva transacción sin tenant, de modo que RLS oculta la suscripción o impide guardar el pedido de borrado. Puede quedar una cancelación comercial efectiva sin solicitud de eliminación persistida y una respuesta 500.

**Variante:** incluso sin commit intermedio, `schedule_deletion` y `cancel_deletion` hacen `db.refresh(request)` inmediatamente después de su propio commit (`:225-226`, `:246-247`). En el rol runtime esto puede producir error después de haber guardado el cambio. Employees también refresca entidades tenant después del commit (`backend/app/employees/service.py:151`, `:319`, `:353`). Es un problema del ciclo transaccional, no un motivo para debilitar RLS.

**Prueba de aceptación:** POST/DELETE de borrado con dos conexiones reales: privilegiada sólo para sembrar y `kova_app` para el endpoint; probar cuenta sin suscripción, activa, cancelada al cierre, solicitud repetida y cancelación reversible. Afirmar respuesta, fila persistida, período pagado respetado y tenant ajeno invisible antes/después de commits. Evitar que una fixture con transacción exterior/SAVEPOINT o rol owner oculte el reset de `SET LOCAL`.

**Remediación sugerida:** mantener una unidad de trabajo para el caso de uso y/o reinstalar el contexto desde un tenant validado en cada transacción de la misma sesión; materializar las respuestas sin consultas tenant posteriores al commit cuando corresponda. Manejar explícitamente recuperación si Stripe confirma y falla persistir el pedido. No requiere asumir un cambio de policy o migración.

### BAP-02 — La purga de cuentas con devoluciones no puede completarse

**Evidencia:** `backend/app/account_lifecycle/service.py:280` descubre exclusivamente tablas con `tenant_id`, y `:284-291` ejecuta DELETEs en el orden no especificado del catálogo. `backend/app/orders/models.py:120` define `RefundItem` sin `tenant_id`; la migración `backend/alembic/versions/0009_refunds_voids.py:36` confirma ese esquema y `:44-45` crea FK a refunds y order_items sin `ON DELETE CASCADE`. `backend/alembic/versions/0036_force_rls.py:39` confirma que su aislamiento se deriva mediante EXISTS(refunds), no por una columna tenant propia.

**Escenario determinista:** una cuenta tiene una devolución con al menos un refund_item. El algoritmo nunca borra ese hijo, por lo que borrar el refund o la venta (incluyendo sus order_items) viola FK. Cambiar únicamente el orden de las tablas descubiertas no arregla este caso.

**Otros bordes:** aun sin devolución, `order_items.product_id` y `inventory_movements.product_id` son RESTRICT (`backend/alembic/versions/0007_orders.py:42`, `:77`), y las relaciones fiscales añaden RESTRICT (`backend/alembic/versions/0058_fiscal_snapshots_global_drafts.py:335`; `0062_accountant_close_packages.py:148`). Una lista no ordenada no ofrece garantía de borrar hijos antes que padres. Toda la lista de cuentas vencidas comparte un commit final (`account_lifecycle/service.py:306`); una cuenta que falla puede revertir también el trabajo anterior del lote.

**Impacto:** incumplimiento operativo de la eliminación solicitada, reintentos permanentemente fallidos y acumulación de cuentas pendientes. Es independiente de que el endpoint interno requiera una clave válida.

**Prueba de aceptación:** dos tenants, uno con venta, devolución parcial, refund_items, movimientos de inventario y cierre fiscal; otro intacto. Ejecutar una purga privilegiada sólo en DB desechable, verificar eliminación completa y tombstone anónimo, sin tocar el segundo tenant. Agregar un lote con una cuenta que falla y comprobar aislamiento/reporte por cuenta. El test existente `test_due_purge_removes_only_requested_tenant` cubre una cuenta casi vacía y borrador fiscal de importe cero, no esta red de relaciones.

**Remediación sugerida:** inventario explícito de propiedad directa e indirecta y borrado ordenado por dependencia, incluyendo hijos por join; transacción por cuenta con estado auditable del fallo. No convertir RESTRICT fiscales a CASCADE indiscriminadamente. Cualquier cambio de FK debe ser una migración nueva y conservar integridad fuera de la purga autorizada.

### BAP-03 — El ZIP de cuenta entrega notas internas Ops

**Evidencia:** `backend/app/account_lifecycle/service.py:27` excluye sólo sessions, idempotency_keys y webhook_events; `:75-82` descubre todas las tablas con tenant_id y `:98` usa SELECT *. La tabla `ops_notes` declara `tenant_id`, `body`, autor y referencias de entidad en `backend/alembic/versions/0060_ops_notes_incident_states.py:28-41`, y se describe como interna/sin RLS en `backend/app/ops/models.py:1`. El provisioning concede SELECT sobre todas las tablas presentes y futuras al rol app (`backend/scripts/provision_app_role.sql:47`, `:53`).

**Escenario:** un operador interno deja una nota asociada al tenant. Su propietario invoca `GET /api/v1/export/account`; el ZIP incorpora `datos/ops_notes.csv` con el cuerpo de la nota y metadatos internos. La reproducción offline ejecutó `build_account_export` real con una fila sintética y confirmó el archivo y contenido.

**Límite del hallazgo:** el SELECT mantiene `WHERE tenant_id = :tenant_id`; no se demostró fuga de notas de otros tenants ni extracción de secretos. La falla es de frontera entre administración interna y export público del propio negocio. Si los grants reales difirieran del script, debe verificarse su efecto, no asumir que esa diferencia protege la arquitectura.

**Prueba de aceptación:** sembrar notas internas del tenant A, B y generales, exportar A/B con rol runtime y afirmar que ninguna nota Ops está presente. Verificar también columnas sensibles en tablas que sí pertenecen al contrato exportable. El test existente verifica ZIP/products/miembros/sessions; no inspecciona notas internas.

**Remediación sugerida:** catálogo explícito de tablas y columnas exportables, separado de inventario RLS; omitir datos de operaciones internas y validar exhaustividad por relaciones de negocio. Revisar grants internos con migración o provisionamiento específico sin bloquear los endpoints Ops privilegiados.

### BAP-04 — Watermarks por familia no protegen el campo compartido status

**Evidencia:** `backend/app/billing/service.py:726` clasifica eventos por familia; `:739-752` lee watermark exclusivamente de esa familia. `:784-785` acepta si esa familia aún no tiene watermark. La rama `invoice.paid`/`invoice.payment_succeeded` escribe `subscription.status = 'active'` en `:985`. Ambas familias modifican status, aunque su antigüedad se compara por separado.

**Reproducción confirmada:** partir de una suscripción cancelada por lifecycle t=200 y sin watermark payment; procesar invoice.paid t=100. `_process_temporal_event` devuelve processed y cambia a active. No ejecuta reconciliación autoritativa del estado; `_retrieve_live_period` sólo recupera fechas. `backend/app/billing/access.py:57` permite uso comercial para active, de modo que un pago viejo puede restaurar acceso que una cancelación posterior ya había terminado.

**Otros bordes:** invoice.payment_failed antiguo después de lifecycle activo/pagado; reconciliación interna/cancelación API actualiza únicamente lifecycle y deja vigente la misma ventana; duplicados con distinto tipo para la misma factura pueden enviar dos recibos si sus created difieren. Esta última posibilidad requiere una prueba separada antes de clasificarla como hallazgo confirmado.

**No duplica lo ya corregido:** la deduplicación por event.id, bloqueo y orden dentro de una misma familia sí existen y `test_billing_temporal_order.py` los cubre. Falta la interacción entre familias que escriben el mismo estado. La regla documental de que ningún webhook anterior deshaga una lectura autoritativa no se cumple para la familia opuesta.

**Prueba de aceptación:** matriz de arrival order lifecycle × payment con fechas anteriores/iguales/posteriores, cancelación terminal y deuda recuperada; comprobar estado comercial, gracia, audit y recibos. Simular Stripe autoritativo localmente, sin llamadas de pago reales. Una lectura autoritativa más reciente debe impedir mutaciones incompatibles de cualquier familia.

**Remediación sugerida:** definir autoridad y antigüedad por campo compartido o reconciliar el estado antes de modificarlo desde eventos de factura que contradigan el lifecycle conocido. La fecha de factura no basta para reactivar una suscripción terminal. Valorar migración sólo si se necesita persistir una versión/observación global adicional.

### BAP-05 — Exportar una cuenta no incluye el detalle de las devoluciones

**Evidencia:** mismo selector `account_lifecycle/service.py:75`; `refund_items` carece de tenant_id (`orders/models.py:120-128`). El único enriquecimiento indirecto del export es la consulta de usuarios vía membresías (`account_lifecycle/service.py:128`); no hay consulta que incluya refund_items mediante refunds.

**Impacto:** el dueño obtiene cabeceras y totales de devolución, pero pierde relación con los renglones de venta, cantidades y precios reembolsados. El archivo no permite reconstruir completamente su historial transaccional pese a presentarse como export de cuenta. No es una fuga; es pérdida de completitud del producto de portabilidad.

**Prueba de aceptación:** una devolución parcial de dos productos del tenant A y una del B; ZIP A debe incluir exclusivamente los refund_items de A con importes exactos. Reconciliar totales del ZIP contra la DB desechable. Agregar joins explícitos, no duplicar tenant_id sin evaluar la integridad de ese cambio de esquema.

### BAP-06 — Un empleado desactivado no puede regresar por invitación

**Evidencia:** `employees/service.py:101-111` permite invitar de nuevo al buscar sólo membresías activas. Al aceptar, `:251-260` usa `auth_repo.get_membership`, que también filtra `Membership.is_active == True` (`auth/repository.py:66-75`), e intenta `create_membership` si no encuentra una. La fila desactivada sigue existiendo y `backend/alembic/versions/0002_tenants_users_memberships.py:58` impone unicidad `(tenant_id, user_id)`.

**Escenario:** propietario desactiva un cajero, vuelve a invitar el mismo correo y el cajero acepta el enlace. El INSERT viola la restricción y el flujo falla, en lugar de reactivar esa membresía con el rol autorizado por la nueva invitación. La desactivación original sí revoca el acceso a endpoints mediante la consulta de membresía activa.

**Prueba de aceptación:** desactivar → reinvitar → aceptar para misma persona/tenant; afirmar una sola membresía, rol de la invitación, historial conservado y acceso restaurado. Probar invitación revocada, vencida, aceptación repetida y dos aceptaciones concurrentes. No quitar el unique constraint para evitar el error.

**Remediación sugerida:** resolver membresía incluyendo inactivas y reactivar explícitamente dentro de una transacción bloqueada, preservando permisos y dejando audit. No requiere nueva migración por defecto.

### BAP-07 — La protección del último propietario no es atómica

**Evidencia:** `employees/service.py:26-35` cuenta propietarios activos sin bloquear; `:301-308` y `:336-343` comprueban el conteo antes de cambiar otra fila. No hay lock por tenant ni constraint que mantenga al menos un propietario activo.

**Escenario:** tenant con dos owners A y B; simultáneamente A se degrada y B se degrada. Ambas transacciones ven 2 propietarios y cada una cambia su propia fila. Ninguna bloquea a la otra al hacer el conteo, y ambas pueden confirmar, dejando 0 propietarios. También existe variante donde A desactiva B mientras B desactiva A. Los controles secuenciales existentes no demuestran seguridad concurrente.

**Impacto:** bloqueo de billing, gestión de usuarios, export y eliminación para el negocio. Se trata de consistencia bajo concurrencia autorizada; no se demostró escalamiento desde cashier/manager.

**Prueba de aceptación:** dos sesiones DB independientes con barrera antes del conteo; realizar degradaciones simultáneas. Al menos una operación debe rechazarse y el tenant conservar un owner activo. Repetir con desactivación cruzada. No basta con un test secuencial de último owner.

**Remediación sugerida:** serializar cambios de propietarios por tenant y volver a comprobar la invariancia dentro del lock; evaluar constraint diferida sólo si existen otras rutas de escritura que necesiten la misma garantía.

## Auth y seguridad: controles presentes y pendientes de prueba

- Las credenciales de sesión están en cookies HttpOnly con SameSite Lax y paths diferenciados (`auth/router.py:37-48`). El acceso normal toma token exclusivamente de cookie; consulta sesión revocada, usuario activo y membresía activa (`shared/dependencies.py:19-58`). No se propone usar localStorage ni ampliar el bypass RLS.
- La verificación de correo no bloquea login por decisión de producto documentada; no se clasifica automáticamente como falla. Billing conserva su guardia de verificación, que debe mantenerse.
- Los tokens de verificación consumibles sí se bloquean con FOR UPDATE (`auth/repository.py:164`). El refresh consulta sin FOR UPDATE (`:107`) y gira el hash en la misma fila; dos refresh simultáneos pueden entregar dos cookies nuevas de las cuales una queda inválida. Requiere prueba DB concurrente y validación del control frontend de refresh antes de asignar prioridad independiente.
- `refresh_session` no valida nuevamente usuario/membresía activos, pero el guard de cada endpoint sí lo hace; no se afirma acceso indebido sólo por obtener un nuevo access token.
- Signup/login eligen la primera membresía activa sin selector de negocio; probar el caso usuario existente invitado a un segundo tenant. No se pudo establecer aquí si multitenancy por usuario es un contrato UX soportado o una limitación intencional.
- Rate limiting del endpoint de eliminación con password, consumo concurrente de invitaciones y una matriz completa de sesión vencida/cambio de rol/logout_all entre tenants quedan como QA adicional, sin declarar exploit no demostrado.

## Validación realizada y siguiente validación

Ejecutadas dos reproducciones con Python 3.12 y funciones fuente extraídas por AST: **2/2 confirmadas**, código de salida 0. Se documentan código, entorno y salida en [BILLING_PRIVACY_REPRODUCTIONS.md](BILLING_PRIVACY_REPRODUCTIONS.md). No importan settings, no conectan DB/red y sólo usan datos sintéticos. Son pruebas de ramas/control y no sustituyen la integración con RLS, locks o migraciones.

La suite pytest original no se ejecutó desde este subtrabajo: `backend/app/tests/conftest.py:45` construye engine desde settings y `:77` ejecuta migraciones automáticamente. El coordinador prepara una copia aislada y PostgreSQL desechable; sus resultados se reportarán en la auditoría integral. Tests revisados: account_lifecycle, billing_temporal_order, employee_rbac, auth_hardening y conftest.

Antes de cerrar remediación, ejecutar las regresiones propuestas con esquema completo, runtime `kova_app` y commits reales; después QA manual en staging desechable para export, solicitud/cancelación de borrado y empleado reactivado. La prueba externa Stripe debe ser test mode y no requiere cambios live. No se han validado producción, configuración efectiva de proveedores, envío de correos, cumplimiento legal de retención o ejecuciones de purga en producción.



## Validación adversarial adicional con DB desechable

Se creó exclusivamente `kova_privacy_audit` dentro del PostgreSQL local desechable del coordinador (`127.0.0.1:55469`, PostgreSQL 17, datos sintéticos). Se aplicaron todas las migraciones hasta `0062_accountant_packages` desde la copia `git archive` sin `.env`, limpiando primero del entorno los campos definidos en Settings. No se usó `kova_audit` donde corría pytest. Se ejecutó con el Python de `.venv-win` y terminó con código 0.

```text
RUNTIME_EXPIRED_IDEMPOTENCY DataError InvalidTextRepresentation
PURGE_WITH_REFUND IntegrityError order_items_product_id_fkey
PURGE_AFTER_ROLLBACK 1 tenant retained
DIRECT_REFUND_DELETE refund_items_refund_id_fkey
LOG_CANARY_PRESENT True NO_REAL_PII_USED
```

La purga real del servicio sobre un tenant con venta y devolución falla primero al borrar products antes de order_items. El rollback conserva el tenant. Un DELETE directo del refund confirma además que refund_items bloquea esa eliminación, independientemente del primer error de orden. Esto eleva BAP-02 de evidencia estática a reproducción PostgreSQL.

**Corrección de interpretación del hallazgo POS sobre idempotencia expirada:** el 201 con UUID no persistido está demostrado con owner/BYPASSRLS. Con el rol productivo `kova_app`, el mismo caso falla con `DataError InvalidTextRepresentation`: el rollback dentro de `idempotency.store` elimina el contexto y la consulta de recuperación hace cast de UUID vacío. Por tanto, el error de rollback y pérdida del trabajo son actuales; el falso éxito es latente bajo runtime una vez se restaure RLS, y no debe presentarse como una respuesta 201 ya demostrada en producción. No se debilita el hallazgo de integridad del servicio, pero sí se acota su manifestación por rol.

Se revisó adversarialmente la devolución duplicada: `RefundCreate.items` no tiene validator de unicidad, y las constraints de refund_items sólo exigen cantidad positiva e importes no negativos. La protección monetaria por medio de pago no suma cantidades repetidas del request y no invalida la reproducción de una línea de $5 duplicada dentro de una venta de $20. La prueba del batch offline con `SET LOCAL` y commits reales representa el contexto que establece `get_current_session`; no se identificó un mecanismo posterior que restaure el tenant entre elementos.

### BAP-08 — Los errores de base de datos pueden registrar datos personales

**Evidencia:** `backend/app/main.py:178-182` usa logger.exception para SQLAlchemyError; `backend/app/observability/logging.py:38-39` agrega el traceback completo mediante formatException sin saneamiento. Ambos engines de `backend/app/db.py:69`, `:90` se crean sin hide_parameters. El error SQLAlchemy incluye los parámetros SQL por defecto y el diagnóstico PostgreSQL puede incluir valores de la fila que rechazó una constraint. La configuración `send_default_pii=False` en Sentry no elimina estos datos del logger de stdout.

**Reproducción:** tabla temporal sintética con columna email y CHECK false; se provoca el error con un correo `example.invalid`, se formatea usando JsonFormatter real y se confirma la presencia del canario. No se imprimió el traceback ni datos personales reales. Es prueba de capacidad de fuga por la ruta de errores, no evidencia de datos de clientes ya registrados.

**Impacto condicionado:** si falla una operación con correo, teléfono, dirección, referencia de pago u otro dato personal como parámetro o en una fila descrita por el servidor, esos valores pueden llegar al sistema de logs y sus proveedores. Severidad P2 mientras no se demuestre un error accesible que exponga una categoría más sensible; escalar si la revisión con canarios revela contraseñas, tokens o payloads de pago. El JSON HTTP de error sigue siendo genérico, por lo que no se demuestra exposición directa al cliente.

**Remediación y aceptación:** configurar hide_parameters en conexiones SQLAlchemy como defensa inicial, y sanear diagnósticos/tracebacks de DB antes de enviarlos al logger; hide_parameters por sí solo no elimina el texto `DETAIL: Failing row contains ...` emitido por PostgreSQL. Probar canarios sintéticos en login/signup, invitación, cliente, referencia de pago y webhook fallido; afirmar su ausencia en stdout y payloads de observabilidad mientras se preservan clase de error, SQLSTATE, request_id y señal operativa útil.

**Matiz postcommit:** catalog y customer_orders suelen materializar un dict antes de commit y devolverlo, por lo que el patrón no vuelve automáticamente insegura cada API. Business settings ya restaura tenant expresamente mediante `_refresh_with_tenant_context` (`business_settings/service.py:14`). Employees, account lifecycle y billing sí presentan lecturas/refresh posteriores; el batch sync requiere reinstalarlo después tanto de commit como de rollback. No debe corregirse cambiando todo RLS a contexto de conexión persistente.
