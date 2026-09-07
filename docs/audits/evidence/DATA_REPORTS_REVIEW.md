# Revisión de datos, RLS, reportes, pedidos e importaciones

Fecha: 2026-09-06. Auditoría estática del checkout local y validación de migración en PostgreSQL local desechable. No se consultó producción, no se leyeron secretos ni `.env` y no se modificaron implementación ni tests. Las referencias son relativas a la raíz del repositorio. La existencia de migraciones y tests no certifica su aplicación ni su resultado en producción.

## Hallazgos priorizados

### DATA-001 — Upgrade poblado a 0062 bloqueado por el trigger de inmutabilidad

- Severity **P1**, confidence **HIGH**, category **DEVOPS / DATA**, esfuerzo **S**.
- Evidencia: `backend/alembic/versions/0062_accountant_close_packages.py:113` ejecuta `UPDATE fiscal_global_draft_batches SET adjusted_net_amount = net_total_amount`. La migración `0058_fiscal_snapshots_global_drafts.py:20` incluye esa tabla en `_IMMUTABLE_TABLES`; líneas 383–403 crean un trigger BEFORE UPDATE OR DELETE que siempre rechaza UPDATE con SQLSTATE 55000. La única excepción es DELETE autorizado por setting. 0062 no suspende ni reemplaza el trigger para el backfill.
- Escenario: instalación en 0061 con al menos un cierre fiscal → deploy ejecuta 0062 → primer UPDATE dispara rechazo → upgrade transaccional aborta. Una DB vacía puede migrar correctamente, ocultando el problema en CI.
- Corrección mínima: estrategia explícita de backfill en migración autorizada, suspendiendo exclusivamente el trigger necesario dentro de la transacción y restableciéndolo; comprobar después inmutabilidad y valores. No desactivar la protección del runtime.
- Aceptación: prueba upgrade 0061→head con un lote existente, además de fresh install. Verificar rollback ante fallo y posterior rechazo de UPDATE runtime. **REPRODUCIDO** en PostgreSQL 17 local, base dedicada `kova_migration_audit`, host 127.0.0.1:55469; código de copia aislada sin `.env`, entorno del proceso limpiado y URL local explícita. Se migró hasta 0061, insertó un tenant/lote sintético y ejecutó upgrade head. Resultado: `psycopg.errors.ObjectNotInPrerequisiteState: fiscal_global_draft_batches is immutable; use an audited compensating workflow` en el UPDATE de 0062. Tras el fallo, revisión siguió en 0061, lote siguió existiendo y columna `adjusted_net_amount` no existía: rollback DDL confirmado. La base principal de pytest no se tocó.

### DATA-002 — Venta offline tardía puede quedar fuera de todos los paquetes del contador

- Severity **P1**, confidence **HIGH**, category **CORRECTNESS / DATA**, esfuerzo **M**.
- Evidencia: `backend/app/fiscal/repository.py:164` selecciona elegibles por `coalesce(occurred_at, created_at)` y ventana cerrada (195–196); `backend/app/fiscal/service.py:309` encuentra lote existente y lo devuelve (316–331), sin reconciliar ventas nuevas; `backend/app/fiscal/repository.py:562` produce ajustes únicamente a partir de refunds y eventos de factura individual. La venta normal captura snapshot en `backend/app/orders/service.py:259`.
- Escenario: existe cierre del lunes; el martes se sincroniza una venta offline del lunes. Su snapshot queda con fecha operativa del lunes. Reabrir cierre devuelve el paquete anterior; cerrar martes no selecciona la venta y no hay ajuste por llegada tardía. Reportes operativos sí incorporan la venta al lunes.
- Corrección: reconciliación de snapshots elegibles sin asignación cuyo periodo ya cerró; ajuste explícito de venta tardía con referencia única y trazabilidad. Preservar el lote original. Incluir watermark o alerta de operaciones pendientes; no afirmar que el watermark elimina retrasos indefinidos.
- Aceptación: cierre → sync de venta ocurrida antes del cierre → cierre posterior → importe incorporado exactamente una vez; repetir y cambiar frecuencia sin duplicar. El test `test_offline_legacy_replay_creates_one_snapshot` (`test_fiscal_global_drafts.py:522`) prueba snapshot/replay, no este cruce.

### DATA-003 — Ajustes fiscales no cubren void tardío y usan bruto para exclusiones de ventas reembolsadas

- Severity **P1**, confidence **HIGH** para ausencia de void y fórmula; impacto contractual a confirmar, category **CORRECTNESS**, esfuerzo **M**.
- Evidencia: `backend/app/fiscal/repository.py:562` no consulta `Void`; `backend/alembic/versions/0062_accountant_close_packages.py:178` solo admite `late_refund`, `late_inclusion`, `late_exclusion`; `backend/app/orders/service.py:812` cambia venta a voided sin emitir ajuste fiscal. `backend/app/fiscal/repository.py:724` siempre usa `snapshot.total_amount` para exclusión/inclusión. El lote original ya descuenta refunds, líneas 262–276 y 310–311.
- Escenario A: venta $100 incluida en lote; se anula después; el lote original queda correctamente inmutable, pero el siguiente no contiene compensación. La suma histórica de paquetes conserva $100 de venta anulada.
- Escenario B: venta $100 con refund $30 dentro del periodo queda en lote por neto $70; después se confirma factura individual y el siguiente lote resta $100: acumulado global −$30 en vez de cero para esa venta. Lo mismo requiere examinar refunds posteriores a una exclusión y reaperturas sucesivas.
- Corrección: especificar ledger de inclusión global y saldo restante de cada operación; compensar el importe efectivamente incluido y evitar doble resta de refunds/exclusiones. Añadir void tardío como evento explícito.
- Aceptación: pruebas de secuencias venta→refund→close→confirmación individual, close→void, close→exclusión→refund y reapertura; reconciliación acumulada por venta. Los tests existentes de ajuste tardío (`test_fiscal_global_drafts.py:1027`, `1114`) cubren ejemplos aislados.

### DATA-004 — Checkout de pedido valida existencias antes del bloqueo que las estabiliza

- Severity **P1**, confidence **HIGH** del interleaving estático, category **CORRECTNESS / EDGE_CASE**, esfuerzo **S**.
- Evidencia: `backend/app/customer_orders/service.py:813` llama `_stock_conflict`; después bloquea reservas y productos (821–839). Tras obtener esos locks solo compara cantidad reservada con cantidad solicitada (866–874). `backend/app/orders/service.py:186` persiste venta de líneas confiadas sin volver a consultar stock; crea movimiento negativo en 232–239. Ajustes manuales bloquean producto pero admiten reducción a cero sin impedir pérdida de reservas (`backend/app/inventory/service.py:204`).
- Escenario determinístico con barreras: stock 1, reserva 1. Checkout pasa `_stock_conflict`; ajuste concurrente obtiene lock de producto, registra −1 y confirma; checkout obtiene después el producto, ve reserva 1 válida y descuenta otra unidad → stock −1. Ningún constraint agregado del ledger lo impide.
- Corrección: adquirir locks de productos en orden estable y entonces releer stock/reservas; validar invariantes en esa misma transacción antes de persistir venta. Conservar stock-conflict de UI para explicar daños/mermas reales.
- Aceptación: dos conexiones reales, barrera entre precheck y lock; debe rechazar checkout sin venta, pagos ni movimientos parciales. `test_customer_orders.py:171` demuestra checkout con precio congelado y costo actual; no concurrencia.

### DATA-005 — RLS protege tenant de fila, pero muchas relaciones permiten enlazar otra empresa

- Severity **P2**, confidence **HIGH**, category **SECURITY / DATA**, esfuerzo **M**.
- Evidencia: FKs simples en `backend/alembic/versions/0007_orders.py:40` (items/order/product), `:58` (payment/order), `:76` (movement/product/order); `0009_refunds_voids.py:30` (refund/order), `:44` (refund_item/refund y order_item); `0056_customer_orders.py:86` (sale_order_id), `:122`/`:125` (pedido item/parent/product), `:185`/`:188` (reserva/parent/product). La migración 0019 endurece modifiers con FKs compuestas y 0058/0062 hacen lo propio para varias relaciones fiscales, pero no generalizan a las anteriores.
- Escenario de garantía DB: conexión runtime con tenant A puede insertar fila A referenciando UUID existente de padre B si posee el UUID y satisface las demás columnas. La policy comprueba tenant A de la fila, no el tenant del padre; la FK simple garantiza existencia, no pertenencia. Esto **no prueba un exploit de endpoint**: las rutas revisadas filtran padres en aplicación.
- Corrección: agregar FKs compuestas `(tenant_id, foreign_id)` a padres `(tenant_id,id)` de operaciones monetarias e inventario, tras auditoría de datos. Mantener los filtros de aplicación. Especial atención a `refund_items`, cuya policy hereda tenant del refund pero no comprueba pertenencia de `order_item_id`.
- Aceptación: SQL como kova_app, tanto INSERT como UPDATE, enlazando fila propia a padre B debe fallar; relaciones legítimas deben persistir. No basta probar inserción con `tenant_id=B`.

### DATA-006 — Postura RLS incompleta para tablas internas y referencia

- Severity **P2**, confidence **HIGH** sobre migraciones/grants; acceso remoto **NEEDS VERIFICATION**, category **SECURITY**, esfuerzo **S/M**.
- Evidencia: `0060_ops_notes_incident_states.py:27` y `0061_ops_founder_mfa.py:25` crean cuatro tablas internas sin ENABLE RLS ni revocación de grants. `backend/scripts/provision_app_role.sql:45` y `:51` otorgan CRUD a todas las tablas públicas existentes/futuras. `backend/app/db.py:12` no inventaría tablas ops ni tablas globales. `0003_rbac.py:55` y `0004_sessions_tokens.py:44` tampoco garantizan RLS en roles/permissions/role_permissions/verification_tokens, pese al claim de ADR-009 de que están habilitadas sin policies.
- Riesgo: runtime ordinary conserva permisos SQL innecesarios sobre estados operativos, factores MFA/códigos de recuperación y referencia RBAC. Un fallo de acceso SQL tiene mayor alcance. En Supabase debe verificarse independientemente si anon/authenticated heredaron grants y si esas tablas están expuestas; **no se afirma filtración pública comprobada**.
- Corrección: inventario explícito de tablas privilegiadas; revocar runtime CRUD donde solo usa privileged engine, restringir roles referencia a SELECT, denegar anon/authenticated; hacer reconciliable el script de provisionamiento con los grants mínimos (no reabrir por blanket GRANT).
- Aceptación: pruebas de permisos por rol y tabla tanto en fresh install como tras reprovisionar runtime. Actualizar ADR para distinguir estado deseado, migraciones y postura operacional verificada.

### DATA-007 — Arranque y suite RLS prueban presencia y ejemplos, no toda la semántica

- Severity **P2**, confidence **HIGH**, category **TESTING / SECURITY**, esfuerzo **M**.
- Evidencia: `backend/app/db.py:168` agrega `bool_or(polqual IS NOT NULL)` / `bool_or(polwithcheck IS NOT NULL)`; una policy `USING(true) WITH CHECK(true)` o policy permisiva adicional satisface el chequeo. No comprueba command, roles, expresiones ni todas las tablas existentes. `backend/app/tests/test_rls_enforcement.py:207`–`:491` cubre SELECT de algunas tablas, INSERT/UPDATE/DELETE principalmente productos, INSERT customer_orders/expenses y algunos contextos vacíos; no matriz completa de 42 tablas y operaciones.
- Corrección: conservar fail-closed por role/RLS/FORCE, complementar con catálogo de policies esperado y pruebas reales table-driven SELECT/INSERT/UPDATE/DELETE, contexto inexistente/vacío y ciclos commit/rollback. No llamar al chequeo actual garantía semántica completa.
- Nota de documentación: comentario de 0036 dice que USING sin WITH CHECK no protege writes; en PostgreSQL las policies ALL/UPDATE usan USING como WITH CHECK implícito cuando se omite. El valor real de 0036 está en FORCE, explicitar contratos y restaurar invitations; no atribuirle una vulnerabilidad INSERT histórica sin prueba. Semántica contrastada con [PostgreSQL 17 CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html).

### DATA-008 — Métricas mezclan fecha de venta con fecha del evento de devolución

- Severity **P2**, confidence **HIGH**, category **PRODUCT / CORRECTNESS**, esfuerzo **S/M**.
- Evidencia: `backend/app/reports/repository.py:59` carga todos los refunds de ventas del rango, sin acotar fecha. `:162` agrupa motivos por `Refund.created_at`; `:45` cuenta void por su fecha. `backend/app/reports/service.py:168` usa aquellos refunds en resumen y `:1137` dice que las devoluciones fueron registradas “en este periodo”.
- Escenario: venta lunes $100, devolución martes $30. Resumen lunes cambia a neto $70 y muestra 1 devolución; motivos lunes muestra cero. Resumen martes puede decir cero devoluciones mientras motivos martes muestra $30. Es coherente como cohorte de ventas frente a eventos, pero copy/contrato no diferencia ambas bases y puede confundirse con flujo de caja.
- Corrección: documentar explícitamente ventas de periodo netas de devoluciones acumuladas frente a devoluciones realizadas en periodo; nombrar/copy coherentes, y ofrecer conciliación por fecha de movimiento solo si producto lo necesita. No cambiar silenciosamente la definición histórica.
- Aceptación: pruebas cruzando medianoche, periodo y zona horaria, con devolución/void posterior; señales y motivos deben declarar su base temporal.

### DATA-009 — Importador XLSX convierte cero numérico en dato ausente

- Severity **P2**, confidence **HIGH**, category **CORRECTNESS / UX**, esfuerzo **XS**.
- Evidencia: `backend/app/imports/service.py:246` normaliza usando `str(value or '')`; openpyxl devuelve números para celdas numéricas. Precio 0 se vuelve vacío y se rechaza como obligatorio; costo 0 se vuelve None, perdiendo costo conocido cero; umbral 0 se vuelve None. CSV con texto `0` se preserva. El validador `_decimal` admite legítimamente cero.
- Verificación ejecutada sin importar app/config: extracción AST de la expresión exacta y evaluación con fila sintética. Entrada numérica `{precio:0,costo:0,umbral_stock:0}` → tres cadenas vacías; entrada texto `0` → tres `0`. No conexión DB.
- Corrección: distinguir `None` de falsy antes de convertir; probar igualdad de importación XLSX/CSV para precio/costo/umbral/stock cero.
- Adicional P3: `_integer` (`:61`) carece de máximo DB Integer; cifras enormes pasan preview y fallan en commit. La transacción evita parcialidad, pero el mensaje no identifica la fila. Agregar límite alineado al schema y casos adversos.

### DATA-010 — Locks de pedidos en orden de entrada y consultas por fila limitan fiabilidad/escala

- Severity **P2** para deadlocks, **P3** para carga, confidence **HIGH** del patrón / **MEDIUM** de frecuencia, category **RELIABILITY / PERFORMANCE**, esfuerzo **S/M**.
- Evidencia: `_replace_items` (`backend/app/customer_orders/service.py:215`–`:235`) bloquea productos según orden enviado; `_reserve_inventory` usa orden estable posteriormente, pero ya posee locks previos. Dos pedidos distintos con productos [A,B] / [B,A] pueden deadlock. No se encontró retry específico en ese servicio.
- Evidencia carga: `serialize_customer_order` hace consulta modifiers por item (`:150`); lista hace `_stock_conflict` por pedido (`:455`), y esta hace dos consultas por reserva (`:123`). `backend/app/reports/repository.py:30` materializa todas las ventas y posteriores `.in_(order_ids)` materializan items/refunds; tope 92 días limita tiempo, no número de filas. No se midió latencia: no afirmar un umbral preciso.
- Corrección: bloquear productos únicos ordenados antes de preparar líneas; prueba deadlock con dos conexiones. Después medir query counts y volumen real; batch-load para listados antes de introducir cache/infra adicional.

### DATA-011 — Grants fiscales impiden los locks de cierre y registro individual en runtime

- Severity **P1**, confidence **HIGH / REPRODUCIDO**, category **CORRECTNESS / RELIABILITY**, esfuerzo **S**.
- Evidencia: `backend/alembic/versions/0058_fiscal_snapshots_global_drafts.py:46`–`:69` revoca grants a anon/authenticated/service_role y concede explícitamente SELECT, INSERT a kova_app sobre snapshots, batches y assignments; **no revoca otros grants que kova_app pueda heredar previamente**. `backend/app/fiscal/repository.py:138`–`:149` busca lote superpuesto con `with_for_update()`; elegibles también se bloquean en `:202`. `backend/app/fiscal/service.py:441` solicita snapshot bloqueado para registrar factura individual. En PostgreSQL SELECT FOR UPDATE requiere privilegio UPDATE además de SELECT; el privilegio de INSERT no basta.
- Escenario condicionado a grants: instalación con rol kova_app existente y sin default privileges CRUD del owner de migraciones, de modo que solo recibe los grants explícitos fiscales → cierre manual o registro de factura individual falla con `permission denied`. Si el owner tiene los default privileges CRUD del provisionamiento, UPDATE puede estar permitido y ese fallo no ocurre, a costa de que la restricción documental a SELECT/INSERT no sea real. Scheduler propietario y tests owner no distinguen estas posturas. La diferencia exige prueba de grants, no asumir un fallo idéntico en toda instalación.
- Reproducción: base local desechable `kova_migration_audit` en 0061, `has_table_privilege('kova_app', tabla, 'UPDATE') = false` tanto para fiscal_global_draft_batches como order_fiscal_snapshots. En transacción con `SET LOCAL ROLE kova_app` y tenant válido, `SELECT id FROM <tabla> FOR UPDATE` falla en ambas con `psycopg.errors.InsufficientPrivilege`. No se tocaron registros reales ni la DB de pytest.
- Corrección: conciliar diseño de lock con privilegios mínimos: evaluar un lock compartido apropiado junto a advisory lock que ya serializa writers fiscales, o un privilegio UPDATE acotado si resulta imprescindible, preservando trigger de inmutabilidad. No ejecutar blanket GRANT para ocultar el fallo. Revisar también FOR UPDATE de batches.
- Aceptación: ejecutar cierre manual, cierre duplicado, confirmación/reapertura individual y concurrencia como rol runtime con grants resultantes de las migraciones; comprobar inmutabilidad posteriormente. El estado de permisos debe ser idéntico antes/después del provisionamiento aprobado.

## Inventario completo de policies autoradas relevantes

Inventario reconciliado con `TENANT_SCOPED_TABLES` (42 nombres) y migraciones hasta 0062. **No es dump de pg_policies de producción**. Todas las policies de tenant indicadas son permisivas por defecto, sin `TO` explícito; los grants deciden roles capaces de operar. `ALL` indica ausencia de `FOR` específico. U/C indica USING y WITH CHECK con expresión equivalente.

| Tablas (cada nombre inventariado) | Policy final autorada / expresión | RLS / FORCE | Evidencia |
|---|---|---|---|
| cash_movements, categories, idempotency_keys, inventory_movements, memberships, order_items, orders, payments, refunds, sessions, shifts, tenant_business_profiles, tenant_onboarding_state, voids | tenant_isolation; ALL U/C `tenant_id = current_setting(...,true)::uuid` | Sí / Sí | 0036:35–64, 94–111 |
| membership_invitations | tenant_isolation; ALL U/C UUID anterior | Sí / Sí | 0036:88–91 |
| audit_logs, modifier_groups, modifier_options, order_item_modifiers, product_modifier_groups | tenant_isolation; ALL U/C `tenant_id = (SELECT current_setting(...)::uuid)` | Sí / Sí | 0019:20–27, 237–244; 0036:67–75 |
| product_image_files | tenant_isolation; ALL U/C UUID con subselect | Sí / Sí | 0024:64–70; 0036:71 |
| tenant_logo_files | tenant_isolation; ALL U/C UUID con subselect | Sí / Sí | 0020:53–59; 0036:74 |
| refund_items | tenant_isolation; ALL U/C EXISTS refunds con refund_id y tenant actual | Sí / Sí | 0036:37–41, 102–106 |
| subscriptions, webhook_events | tenant_isolation; ALL U/C `tenant_id::text = current_setting(...,true)` | Sí / Sí | 0044:25–35; 0036 |
| tenant_receipt_settings | tenant_isolation; ALL U/C texto | Sí / Sí | 0045:21–30; 0036 |
| products | tenant_isolation; ALL U/C texto | Sí / Sí | 0054:23–31; 0036 |
| telemetry_events | telemetry_events_tenant_isolation; ALL U/C texto | Sí / Sí | 0022:38–44; 0036:73 |
| expenses | tenant_isolation; ALL U/C texto | Sí / Sí | 0049:19, 50–54 |
| account_deletion_requests | tenant_isolation; ALL U/C texto | Sí / Sí | 0050:19, 52–56 |
| customer_orders, customer_order_items, customer_order_item_modifiers, inventory_reservations | tenant_isolation; ALL U/C texto | Sí / Sí | 0056:19–34 |
| order_fiscal_snapshots, order_item_fiscal_snapshots, order_item_tax_snapshots, fiscal_global_draft_settings, fiscal_global_draft_batches, fiscal_global_draft_orders | tenant_isolation; ALL U/C texto; grants fiscal restringidos adicionales | Sí / Sí | 0058:19–43, 46–69 |
| fiscal_individual_invoice_events, fiscal_global_draft_adjustments | tenant_isolation; ALL U/C texto; grant explícito SELECT/INSERT runtime, otros grants heredados no revocados | Sí / Sí | 0062:19–31, 235–248 |
| tenants | current_tenant_visibility; SELECT USING id texto | Sí / No FORCE autorado | 0038:28–35 |
| users | tenant_membership_visibility; SELECT USING EXISTS active membership en tenant texto | Sí / No FORCE autorado | 0038:38–51 |
| anonymous_telemetry_events | anonymous_telemetry_events_insert; INSERT CHECK event_name allowlist y ausencia de propiedades PII prohibidas; sin SELECT/UPDATE/DELETE policy | Sí / No FORCE autorado | 0043:19; 0055:36–96 |
| roles, permissions, role_permissions, verification_tokens, alembic_version | Sin policy autorada; ENABLE RLS no garantizado por estas migraciones pese a ADR-009 | UNKNOWN runtime | 0003; 0004; ADR-009 |
| ops_notes, ops_incident_states, ops_mfa_factors, ops_mfa_recovery_codes | Sin policy ni ENABLE RLS autorados | No en migración | 0060, 0061 |

Las policies UUID que aún permanecen pueden arrojar error al evaluar setting vacío; las correcciones 0044/0045/0054 solo arreglan subconjuntos. Esto agrava pérdida de contexto después de commit/rollback detectada por el auditor principal; no se duplica aquí como nuevo hallazgo. `refund_items` puede heredar también ese fallo. El contexto vacío debe denegar de forma limpia y verificable en todas las tablas.

## Garantías útiles a conservar

- Dinero Decimal/Numeric y snapshots reales. `capture_baseline_snapshot` reconcilia suma de líneas y explicita impuestos `not_calculated`; no afirma timbrado CFDI. No introducir cálculo fiscal supuesto para rellenar ese campo.
- Pedidos guardan precio acordado y costo actual al checkout; versionado + lock del pedido previenen sobrescritura normal; venta, reservas consumidas, auditoría e idempotencia comparten commit (`customer_orders/service.py:876`–`:920`).
- Importación valida de nuevo al commit; solo confirma si todas las filas son válidas, agrega ledger inicial y un único commit. Tests existentes incluyen fallo intermedio + rollback (`test_catalog_import.py:192`) y replay (`:92`), por lo que no se halló importación parcial confirmada.
- XLSX limita tamaño, componentes ZIP y expansión; rechaza macros y fórmulas; no evalúa fórmulas. CSV fiscal escapa valores peligrosos (`fiscal/service.py:575`).
- Cierres fiscales usan advisory lock por tenant y unicidad de asignación de venta; los paquetes se derivan de snapshots inmutables y tienen checks de reconciliación. Mantenerlos al agregar eventos faltantes.
- Reportes usan datos persistidos y estados vacíos, hora de ocurrencia para sync y timezone compartida. No requieren reescritura ni datos artificiales.

## Matriz de invariantes y validación pendiente

| Invariante | Capa actual | Estado y prueba necesaria |
|---|---|---|
| Fila de A no visible/escribible como B | API filtros + policies + role runtime | Parcialmente probado SQL; matriz completa y grants pendientes |
| Padre e hijo siempre mismo tenant | API; FK compuestas solo algunos dominios | No garantizado DB en relaciones listadas en DATA-005 |
| Pedido confirmado no descuenta stock; checkout consume una vez | Reserva ledger + venta única + transacción | Happy path/replay existentes; concurrencia stock DATA-004 pendiente |
| Precio acordado no cambia al cobrar pedido | Snapshot pedido | Test existente; conservar |
| Paquete cerrado es inmutable | Trigger DB + grants | Sí en diseño; migración poblada viola procedimiento DATA-001 |
| Toda venta eventual y reversión entra exactamente una vez en paquetes | Snapshot/assignment/ajustes | FAIL estático para offline tardío y void; composición refund/exclusión no reconcilia |
| Mismo contenido CSV/XLSX produce valores iguales | Pipeline compartido | FAIL demostrado para números cero |
| Fallo de import no confirma productos/movimientos parciales | Un commit + cierre sesión/rollback | Test de fallo inyectado existente; concurrencia y rollback real runtime pendientes |
| Ventana de reporte y copy describen misma base temporal | Service/repository | Mixto venta/evento; requiere contrato y prueba transperiodo |

La suite ordinaria declara usar owner DB; no correrla sin aislamiento. Las pruebas reales RLS son un subconjunto valioso, no evidencia de concurrencia ni aplicación de migraciones en producción. No se ejecutó pytest por cuenta de este subagente; el coordinador prepara las validaciones seguras. Manual QA propuesto: cierre fiscal+sync tardío, devolución/void posterior, pedido reservado+merma concurrente y XLSX con ceros.
