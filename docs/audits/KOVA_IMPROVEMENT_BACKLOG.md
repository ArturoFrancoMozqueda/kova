# KOVA IMPROVEMENT BACKLOG

Backlog derivado de [KOVA_COMPREHENSIVE_AUDIT.md](KOVA_COMPREHENSIVE_AUDIT.md), commit `837cf3f21c8b511aedf91b70ba61484fc08dee1f`, 2026-09-06. **36 tareas asociadas a hallazgos y 4 propuestas de seguimiento de producto/escala, todas pendientes; ninguna corrección está implementada por esta auditoría.** La prioridad refleja riesgo del negocio, no limpieza estética.

Este archivo permite convertir cada item en una tarea individual de Codex. Antes de ejecutarla, leer AGENTS.md/reglas del área, evidencia vinculada y archivos reales; confirmar estado actual del repositorio. Hacer el cambio mínimo, mantener contratos salvo modificación explícita necesaria, agregar tests que demuestren conducta y reportar QA/límites. No leer secretos ni usar producción para pruebas. Un item no autoriza despliegue, cargos, emails, purgas reales o cambios en proveedores.

Las referencias de evidencia son relativas al repo. Confidence **HIGH** salvo condición explícita: carreras estáticas requieren reproducción permanente; postura proveedor **NEEDS VERIFICATION**. Effort XS<2h, S<1 día, M1–3 días, L3–10 días, XL>10 días. “S/M” indica rango según alcance de pruebas. Riesgo de implementación es alto en dinero/transacciones/migraciones y debe mitigarse con los criterios de cada tarjeta; no se confunde con severidad del hallazgo.

## Orden y dependencias

- Corte rápido independiente: KOV-006/007/002/011/009; KOV-029/033 pueden adelantarse por bajo costo.
- Núcleo coordinado: KOV-001 y KOV-004 se prueban juntos; KOV-003/019 después, con KOV-013/018 y KOV-020. No arreglar sólo contexto y dejar rollback absorbido.
- Fronteras paralelas: KOV-005 Stripe; KOV-010 identidad; KOV-008 ciclo de datos; KOV-014/015/016/017 fiscal/pedidos.
- KOV-031 es gate externo de expansión, no prerrequisito para avanzar código local. KOV-012 necesita decisión explícita de política offline y se ejecuta con seguridad/producto.
- Foundation y refactors sólo después de proteger los invariantes que tocarán. No se requiere completar las 36 tareas para cada release, pero no escalar sobre P1 relevantes no resueltos.

| Fase | Resultado exigido | Items |
|---|---|---|
| 0 Immediate risks | Dinero, cola, acceso, privacidad y upgrades críticos confiables | 001–019,031 |
| 1 Foundation | Seguridad/grants, contratos, pruebas, release y recuperación completos | 020–030,032–034 |
| 2 Maintainability | Menos costo de cambio y queries medidos | 035–036 y extracción transaccional posterior |
| 3 Product improvements | Recuperación y relato de negocio comprensibles con piloto | Continuidad012/028/032 y seguimiento descrito al final |
| 4 Scale readiness | Capacidad/costo medidos antes de infraestructura adicional | Seguimiento descrito al final |

## KOV-001 — Contexto tenant por transacción y respuesta postcommit

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** M · **Responsable sugerido:** Backend / seguridad.

**Por qué / impacto esperado:** Lotes sync y lifecycle fallan después de commit/rollback; una operación persistida puede reportarse fallida. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/shared/dependencies.py; db.py; sync/service.py; account_lifecycle/service.py; employees/service.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Definir frontera de transacción por caso de uso y reinstalar contexto desde identidad previamente validada cuando una nueva transacción lo requiera. Materializar respuestas antes de commit cuando proceda. No cambiar a engine privilegiado ni desactivar RLS.

**Criterios de aceptación:** Como kova_app, lote de 2+ ventas válidas queda synced; una inválida entre válidas no contamina las siguientes. Schedule/cancel deletion y cambios employees responden y persisten. Después de rollback/commit A no ve B.

**Validación / manual QA:** Dos sesiones runtime sin SAVEPOINT externo; éxito, rechazo, error DB y postcommit. Revisar cada consulta posterior a commit; QA de cola y eliminación en staging.

## KOV-002 — Cantidad agregada de devolución dentro del payload

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** S · **Responsable sugerido:** Backend POS.

**Por qué / impacto esperado:** Una misma línea repetida puede devolver más unidades que las vendidas sin violar techo monetario. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/orders/service.py:561; schemas.py:RefundCreate`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Rechazar IDs duplicados con error específico o agregarlos antes de comprobar cantidad acumulada, conservando bloqueo de order y techo por método.

**Criterios de aceptación:** Venta $20 con línea$5 qty1 y otra$15: refund de línea$5 repetida no genera qty2 ni payout10. Payloads normales y nuevas devoluciones permitidas siguen funcionando.

**Validación / manual QA:** Test de API con duplicados, cantidades diferentes, refund previo, cash/transfer y rollback completo; verificar ledger.

## KOV-003 — Serializar cierre de turno con todas sus escrituras

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** M · **Responsable sugerido:** Backend POS.

**Por qué / impacto esperado:** Cierre puede congelar80 mientras ledger suma90 por movimiento concurrente. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/shifts/service.py; repository.py; calculator.py; orders/service.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001, KOV-004. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Definir orden de locks y bloqueo común de turno para close, ventas realtime, refunds cash y movimientos. Acordar compensación visible de sync tardío preservando cierre histórico.

**Criterios de aceptación:** Intercalado close+cash_in/venta/refund produce un snapshot que incluye escritura anterior o rechaza escritura posterior, nunca diferencia técnica silenciosa. Dos cierres distintos no sobrescriben conteo.

**Validación / manual QA:** Barreras con conexiones independientes; comprobar orden de lock contra productos/orders para no crear deadlock. QA cierre desde otro dispositivo.

## KOV-004 — Idempotencia sin rollback absorbido ni falsa respuesta

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** M · **Responsable sugerido:** Backend.

**Por qué / impacto esperado:** La clave vencida sigue unique; get la oculta y store revierte toda operación. Runtime falla; owner puede devolver UUID inexistente. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/idempotency/service.py; modelos/migración0005; callers orders/catalog/inventory/shifts/billing`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001 coordinado. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Diseñar claim/resolución canónica antes del efecto y política de TTL separada de expiración de tokens auth. Ningún helper puede ocultar rollback del caller. Resolver misma clave/hash, clave/hash distinto, expiración y ganador concurrente.

**Criterios de aceptación:** Cada respuesta exitosa referencia operación persistida; replays devuelven identidad ganadora. Clave expirada tiene comportamiento explícito sin side effects dobles ni 201 falso, con owner y runtime.

**Validación / manual QA:** Dos requests simultáneos y timeout posterior al commit, producto último stock, clave >24h y rollback. No borrar idempotency/venta histórica para hacer pasar tests.

## KOV-005 — Convergencia Stripe entre familias de eventos

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** M · **Responsable sugerido:** Backend billing.

**Por qué / impacto esperado:** Invoice viejo cambia canceled reciente a active pese a los watermarks por familia. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/billing/service.py:739-999; repository.py; access.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Definir autoridad temporal por campo compartido o reconciliar contradicciones con estado Stripe. Terminal/cancelación y observación autoritativa más nueva no deben revertirse por una factura antigua.

**Criterios de aceptación:** Lifecycle canceled t200 + invoice.paid t100 conserva estado correcto; invertir llegada/fechas y combinar past_due, renovación y cancel_at_period_end converge al estado autoritativo.

**Validación / manual QA:** Proveedor simulado; probar families, timestamps iguales, evento sin created, errores y duplicados. Luego QA Stripe test mode en entorno separado.

## KOV-006 — Upgrade fiscal con historia poblada

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** DEVOPS · **Effort:** S/M · **Responsable sugerido:** Backend datos / release.

**Por qué / impacto esperado:** 0062 intenta actualizar filas protegidas por trigger immutable y bloquea deploy. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/alembic/versions/0062_accountant_close_packages.py:113; 0058_fiscal_snapshots_global_drafts.py:383`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Revisar estado aplicado en cada entorno antes de elegir corrección del procedimiento de migración. Preparar mecanismo acotado de backfill que conserve inmutabilidad de runtime; no reescribir historia desplegada indiscriminadamente.

**Criterios de aceptación:** Base0061 con cierres reales sintéticos migra a head, importes conservados y triggers activos. Fallo a mitad revierte sin schema parcial. Old app compatible durante expansión.

**Validación / manual QA:** Test upgrade poblado con snapshots/refunds/batches y grants de runtime; ensayar rollback de aplicación sin downgrade destructivo. Deploy no autorizado por este backlog.

## KOV-007 — Separar datos exportables de información Ops

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** PRIVACY · **Effort:** S · **Responsable sugerido:** Backend lifecycle / seguridad.

**Por qué / impacto esperado:** Descubrir por tenant_id y SELECT* entrega notas internas del propio negocio al dueño. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/account_lifecycle/service.py:27,75-113; ops/models.py; migración0060`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Introducir allowlist explícita de tablas/columnas exportables con ownership del dominio; excluir Ops, MFA, tokens y detalles internos. Coordinar con completitud KOV-022.

**Criterios de aceptación:** Export A no contiene notas de A/B/generales ni canarios internos. Conserva todos los datos comerciales aprobados y fórmulas peligrosas escapadas.

**Validación / manual QA:** Dos tenants, notas internas y usuarios distintos; inspección ZIP completa como runtime. QA dueño descarga/abre archivo.

## KOV-008 — Purga ordenada de propiedad directa e indirecta

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** PRIVACY · **Effort:** M · **Responsable sugerido:** Backend lifecycle / datos.

**Por qué / impacto esperado:** FK por orden de borrado y refund_items omitido hacen fallar purga de cuentas pobladas; un fallo revierte lote. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/account_lifecycle/service.py:250-306; migraciones0007/0009/0058/0062`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001, KOV-007. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Modelar grafo de borrado incluyendo hijos sin tenant_id y respetar RESTRICT fiscales. Una transacción por cuenta, resultado observable por fallo; mantener tombstone y política de retención aprobada.

**Criterios de aceptación:** Cuenta con venta/refund/items/movimientos/pedidos/fiscal se purga íntegra; tenant B intacto. Cuenta fallida no impide procesar otra y deja diagnóstico sin PII. Gracia y período pagado respetados.

**Validación / manual QA:** DB desechable con grafo completo y fallos inyectados, cuenta compartiendo user con otro tenant. Revisión legal de retención separada de corrección técnica.

## KOV-009 — Actualización PWA en punto seguro

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** RELIABILITY · **Effort:** S/M · **Responsable sugerido:** Frontend POS.

**Por qué / impacto esperado:** Listeners SW recargan /register aun con carrito y efectivo en memoria. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/main.tsx:94,141; pwaUpdate.ts; register/RegisterView.tsx`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Centralizar guard de recarga para version probe, updatefound, controllerchange y acción manual. Diferir actualización mientras haya operación/edición sin preservar.

**Criterios de aceptación:** Todos los disparadores conservan carrito y campos; tras terminar/cancelar deliberadamente, update funciona. Las ventas en IndexedDB permanecen y sincronizan una vez.

**Validación / manual QA:** Prueba listeners reales más navegador con dos builds/SW; caja, pedido, formulario catálogo y modo offline. No conformarse con test helper de path.

## KOV-010 — Coherencia de identidad entre pestañas

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** SECURITY · **Effort:** M · **Responsable sugerido:** Frontend auth / API.

**Por qué / impacto esperado:** Cookies B pueden operar desde una UI/caches todavía A. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/auth/AuthContext.tsx; offline/activeTenant.ts; API clients; backend/shared/dependencies.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Coordinar cambio/logout/revalidación entre tabs y precondición de tenant/sesión esperado en mutaciones. Precondición sólo compara identidad, nunca autoriza. Abortar/descartar respuestas viejas y limpiar caches correctamente.

**Criterios de aceptación:** Dos páginas mismo perfil: A abierto y login B en otra; crear/editar/sync desde A se bloquea hasta identidad coherente, sin escribir B ni cachear B bajo A. Cambio de rol en mismo tenant se refleja.

**Validación / manual QA:** Browser multi-page con API real local y requests demorados. Cubrir cookie CSRF recién rotada y carrera entre comprobación y envío.

## KOV-011 — Reintento manual recupera presupuesto sin cambiar UUID

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** RELIABILITY · **Effort:** S · **Responsable sugerido:** Frontend offline.

**Por qué / impacto esperado:** Venta agotada retorna failed sin siquiera enviar HTTP al pulsar Reintentar. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/offline/queue.ts:131; syncWorker.ts:76`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Separar contador histórico y presupuesto actual o reiniciar presupuesto al retry manual; preservar tenant/UUID y lease transaccional.

**Criterios de aceptación:** Failed con attempt_count6 → retry manual → al menos una petición con UUID original → synced cuando backend acepta; no loop automático infinito.

**Validación / manual QA:** Módulos reales+fake-indexeddb y navegador; 429 no consume intento, 5xx respeta backoff y dos tabs no duplican claim.

## KOV-012 — Continuidad segura al reabrir offline

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** PRODUCT · **Effort:** L · **Responsable sugerido:** Frontend / seguridad / producto.

**Por qué / impacto esperado:** Cold start transforma falla de red en logout y exige login no disponible offline. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/auth/AuthContext.tsx:47-81; RequireAuth.tsx; vite.config.ts; e2e/offline-sync.spec.ts:244`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-010, KOV-011. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Definir política de autorización local limitada por dispositivo/tenant/edad, revocación al reconectar y dispositivo compartido. Separar no disponible de no autorizado. No guardar tokens en storage ni autenticar por boolean libre.

**Criterios de aceptación:** Con dispositivo preparado según política, cortar toda red incluyendo auth y recargar/reabrir tiene resultado seguro y comprensible; nunca adopta tenant de otra sesión; cola previa intacta.

**Validación / manual QA:** PWA real, sesión expirada/revocada, storage no disponible, navegación login offline y recuperación. Si alcance decidido excluye cold start, copy debe declararlo y no testear una promesa distinta.

## KOV-013 — Clave estable por intención de devolución

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** S/M · **Responsable sugerido:** Frontend POS / backend tests.

**Por qué / impacto esperado:** Reenviar parcial después de perder respuesta genera nueva key y dos devoluciones. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/orders/api.ts:69; OrderDetail.tsx:71; RefundModal.tsx`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-004. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Mantener identidad/payload hasta resolución definitiva; reconciliar timeout y sólo crear nueva clave para nueva devolución deliberada. Revisar open/close shift donde también se crean keys por llamada.

**Criterios de aceptación:** Orden3 unidades, devolver1 con respuesta perdida y reenviar dos veces produce refund1 y stock/payout1. Luego nueva intención puede devolver otra unidad.

**Validación / manual QA:** Test frontend→API con commit exitoso y respuesta perdida. Error de receipt/render no debe reabrir una operación ya confirmada.

## KOV-014 — Alinear locks fiscales y grants mínimos

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 condicional · **Category:** RELIABILITY · **Effort:** S · **Responsable sugerido:** Backend datos / seguridad.

**Por qué / impacto esperado:** FOR UPDATE requiere UPDATE pero ciertas instalaciones sólo reciben SELECT/INSERT. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/fiscal/repository.py:138,202; service.py:441; migración0058:46-69`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-006, KOV-026. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Determinar postura esperada y escoger lock/privilegio mínimo compatible con trigger/advisory lock. No dar CRUD global para tapar fallo.

**Criterios de aceptación:** Cierre manual, confirmación/reapertura y replay funcionan como runtime con grants de migraciones, y update/delete de historia siguen prohibidos. Antes/después de provisioning es consistente.

**Validación / manual QA:** Dos posturas de default privileges en DB desechable. Validación efectiva del entorno es externa y sólo read-only cuando autorizada.

## KOV-015 — Revalidar stock de pedido bajo locks

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** S/M · **Responsable sugerido:** Backend pedidos / inventario.

**Por qué / impacto esperado:** Merma después de precheck antes de lock deja stock negativo al checkout. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/customer_orders/service.py:813-874; orders/service.py:persist_completed_order; inventory/service.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-020. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Adquirir productos únicos en orden estable y releer stock/reservas dentro de la misma transacción definitiva.

**Criterios de aceptación:** Stock1/reserva1, ajuste−1 intercalado: checkout rechaza sin order/payment/movement parcial. Si checkout gana, ajuste tiene resultado coherente.

**Validación / manual QA:** Dos conexiones/barrier en precheck; reservar/cancelar/modificar/checkout concurrentes, manteniendo precio acordado.

## KOV-016 — Incluir venta offline tardía en paquetes fiscales

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** DATA · **Effort:** M · **Responsable sugerido:** Backend fiscal / producto.

**Por qué / impacto esperado:** Venta cuyo occurred_at pertenece a período ya cerrado puede no incluirse nunca. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/fiscal/repository.py:153,562; service.py:close_global_draft`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-006, KOV-014. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Diseñar inclusión compensatoria trazable por venta/período de origen sin mutar paquete cerrado ni asignar dos veces.

**Criterios de aceptación:** Cerrar díaD; sync venta de D al díaD+1; cierre siguiente incluye ajuste único por importe correcto. Repetir sync/cierre/frecuencia no duplica.

**Validación / manual QA:** Datos sintéticos con límites mes/año/timezone; export del contador explica origen y fecha de ajuste.

## KOV-017 — Ledger fiscal coherente para void/refund/exclusión

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** M · **Responsable sugerido:** Backend fiscal / producto.

**Por qué / impacto esperado:** Void tardío no compensa y exclusión por bruto puede restar más del neto incluido. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/fiscal/repository.py:562,724; migración0062; orders/service.py:create_void`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-016. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Definir saldo incluido por venta y eventos compensatorios exact-once para void, refund, individual confirmation y reapertura. No asumir impuesto calculado.

**Criterios de aceptación:** Venta100-refund30-close-exclusión individual deja contribución global0, no−30. Close→void compensa; exclusión→refund/reapertura no resta dos veces.

**Validación / manual QA:** Pruebas de secuencias/permutaciones con reconciliación acumulada por venta y paquete; copy conserva carácter operativo/noCFDI.

## KOV-018 — Revertir sólo consumo original de inventario

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** DATA · **Effort:** S/M · **Responsable sugerido:** Backend POS / inventario.

**Por qué / impacto esperado:** Refund/void de no-tracking crea stock que nunca salió; flag actual no describe pasado. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/orders/service.py:646,817; repository.create_inventory_movement`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-002. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Usar consumo original/snapshot verificable para reposición; clasificar reversión semánticamente sin alterar registros históricos a ciegas.

**Criterios de aceptación:** Venta no-tracking→refund/void no crea stock positivo; tracking→cambio flag→refund revierte exactamente consumo original. Replays no duplican.

**Validación / manual QA:** Tests de toggles, productos desactivados y partial refund. Medir diagnóstico de datos existentes sólo con consulta autorizada, sin reparación automática.

## KOV-019 — Movimientos de caja idempotentes

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 · **Category:** CORRECTNESS · **Effort:** S/M · **Responsable sugerido:** Backend / frontend caja.

**Por qué / impacto esperado:** Una salida física puede registrarse dos veces tras timeout/doble envío. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/shifts/router.py:105; service.py:254; frontend/src/shifts/api.ts`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-003, KOV-004. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Añadir identidad por intención frontend/API y resolución canónica con lock turno. Definir advertencia/bloqueo de retiro mayor a esperado según necesidad real.

**Criterios de aceptación:** Repetición después de commit produce un movimiento y mismo ID; cambio de body rechaza. Caja cerrada impide escritura realtime. Ningún error visual invita a repetir side effect.

**Validación / manual QA:** Cash_in/out, dos tabs, respuesta perdida y cierre concurrente. QA conteo de efectivo.

## KOV-020 — Orden estable de locks de producto

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** RELIABILITY · **Effort:** S · **Responsable sugerido:** Backend.

**Por qué / impacto esperado:** Carritos/pedidos A,B y B,A pueden deadlock y transformarse en cola fallida. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/orders/service.py:294; customer_orders/service.py:215`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-004. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Prelock conjunto de productos en orden de UUID y documentar orden frente a pedido/order/shift. Retry transaccional acotado sólo cuando seguro.

**Criterios de aceptación:** Dos ventas/pedidos de orden inverso terminan sin deadlock evitable, stock e identidad correctos; un conflicto legítimo sigue siendo error de negocio.

**Validación / manual QA:** Concurrencia real con timeout acotado; no test que sólo inspeccione sorted en fuente.

## KOV-021 — Evitar datos sensibles en excepciones/logs

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** PRIVACY · **Effort:** S/M · **Responsable sugerido:** Backend observabilidad / seguridad.

**Por qué / impacto esperado:** Parámetros SQL y PostgreSQL DETAIL alcanzan stdout JSON incluso con send_default_pii=false. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/db.py; main.py:178; observability/logging.py:38; sentry.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Ocultar parámetros y sanear diagnósticos/tracebacks antes de cada sink. No sólo hide_parameters: DETAIL puede incluir fila. Mantener error class/request_id/trace segura.

**Criterios de aceptación:** Canarios sintéticos de email/token/nombre/referencia nunca aparecen en logs ni eventos Sentry ante errores de constraints/DB; diagnóstico aún localizable.

**Validación / manual QA:** Capturar todos los sinks con proveedor simulado. No leer/mostrar secretos reales ni volcar payloads de clientes.

## KOV-022 — Export completo de devoluciones y relaciones indirectas

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** DATA · **Effort:** S · **Responsable sugerido:** Backend lifecycle.

**Por qué / impacto esperado:** Export omite refund_items y no permite reconstruir cantidades/precios reembolsados. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/account_lifecycle/service.py:75; orders/models.py:RefundItem`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-007. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Añadir joins tenant-safe de propiedad indirecta al catálogo exportable; declarar binarios omitidos y versión del formato.

**Criterios de aceptación:** ZIP A incluye sólo detalles refunds de A; sumas de cantidades/importes concilian con cabeceras y ventas. Datos B y Ops ausentes.

**Validación / manual QA:** Dos tenants, refunds parciales/múltiples, apertura Excel/CSV y comprobación fórmula injection.

## KOV-023 — Reactivar empleado por invitación válida

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** UX · **Effort:** S · **Responsable sugerido:** Backend equipo.

**Por qué / impacto esperado:** Membresía inactiva invisible al lookup provoca INSERT duplicado. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/employees/service.py:101,251; auth/repository.py:66`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Buscar membresía incluyendo inactivas y reactivar explícitamente bajo lock, tomando rol autorizado actual de invitación.

**Criterios de aceptación:** Deactivate→reinvite→accept genera una sola membership activa, historial conservado y rol correcto. Invitación vieja/reused/vencida no concede acceso.

**Validación / manual QA:** Prueba API y aceptación concurrente; QA empleado que regresa al negocio.

## KOV-024 — Conservar propietario bajo cambios concurrentes

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** SECURITY · **Effort:** S · **Responsable sugerido:** Backend equipo.

**Por qué / impacto esperado:** Checks independientes pueden dejar cero owners. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/employees/service.py:26,301,336`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Bloquear tenant antes de contar/modificar owners; aplicar a degradación y desactivación, conservando roles existentes.

**Criterios de aceptación:** Dos owners degradándose o desactivándose mutuamente dejan al menos uno activo; una petición rechaza controladamente.

**Validación / manual QA:** Dos conexiones con barrera. Validar ningún cashier/manager obtiene nuevos permisos.

## KOV-025 — FKs compuestas de pertenencia tenant

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** DATA · **Effort:** M/L · **Responsable sugerido:** Backend datos.

**Por qué / impacto esperado:** Una FK sólo por ID no garantiza mismo tenant padre/hijo. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/alembic/versions/0007_orders.py; 0009_refunds_voids.py; 0056_customer_orders.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-027. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Inventariar relaciones monetarias/stock prioritarias, diagnosticar inconsistencias y añadir constraints compuestas mediante migraciones compatibles. Tratar refund_items ownership derivado.

**Criterios de aceptación:** SQL runtime A no puede insertar/update hijoA con padreB; legítimos y datos anteriores pasan. RLS y filtros permanecen.

**Validación / manual QA:** Matriz SQL por relación; upgrade poblado. No usar real DB para exploración destructiva.

## KOV-026 — Grants mínimos coherentes con provisioning

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** SECURITY · **Effort:** M · **Responsable sugerido:** Backend datos / plataforma.

**Por qué / impacto esperado:** CRUD global runtime alcanza Ops/MFA y puede contradecir grants fiscales restringidos. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/scripts/provision_app_role.sql:45-55; migraciones0060/0061; ADR009`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Crear inventario de roles/tablas públicas/internas y concesiones específicas. Evitar que reprovisionamiento reabra grants. Verificar Data API como cuestión independiente.

**Criterios de aceptación:** Runtime no consulta ni modifica Ops/MFA salvo paths autorizados por diseño; privileged puede operar; anon/authenticated denegados según contrato. Reprovision idempotente.

**Validación / manual QA:** Fresh install y upgrade, distintos owners/default privileges. Estado Supabase efectivo requiere evidencia read-only externa.

## KOV-027 — Harness de RLS semántico y commits reales

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** TESTING · **Effort:** M/L · **Responsable sugerido:** QA / backend seguridad.

**Por qué / impacto esperado:** Startup comprueba presencia; suite owner no prueba toda la frontera real. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/tests/conftest.py; test_rls_enforcement.py; db.py:168`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-001. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Añadir matriz de acceso y casos de uso runtime sin SAVEPOINT exterior; catalogar policies esperadas y detectar permisivas inesperadas. Mantener suite rápida existente.

**Criterios de aceptación:** Todas tablas relevantes/verbs y contexto vacío/ausente/commit/rollback cubiertos; policy true adicional o rol BYPASSRLS hace fallar gate.

**Validación / manual QA:** Dos tenants y datos sintéticos completos. Medir ejecución para mantener gate práctico; no depender sólo de string matching.

## KOV-028 — Definición temporal consistente de reportes

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** PRODUCT · **Effort:** S/M · **Responsable sugerido:** Backend reportes / producto.

**Por qué / impacto esperado:** Resumen cohorte netea refund posterior; motivos filtra fecha evento; copy dice mismo período. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/reports/repository.py:59,162; service.py:1137; frontend reports`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Documentar métricas cohorte vs flujo y ajustar copy/presentación o contrato tras decisión explícita. Evitar cambiar fórmulas históricas sin acuerdo.

**Criterios de aceptación:** Venta lunes100/refund martes30 muestra bases temporales explicadas y conciliables en lunes/martes; midnight/mes/año/local timezone coherentes.

**Validación / manual QA:** Tests KPI/story/payment/products/refund reasons y QA dueño entiende cambio de cifra histórica.

## KOV-029 — Conservar cero numérico en XLSX

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** CORRECTNESS · **Effort:** XS/S · **Responsable sugerido:** Backend imports.

**Por qué / impacto esperado:** value or '' pierde precio/costo/umbral cero y diverge de CSV. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/imports/service.py:246`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Distinguir None de0 al normalizar; preservar pipeline común; validar enteros contra límites persistibles.

**Criterios de aceptación:** Mismo contenido XLSX/CSV con ceros produce mismo preview/commit y costo conocido0. Vacío sigue significando ausencia cuando corresponde.

**Validación / manual QA:** XLSX numérico y texto, CSV, fórmulas/macros rechazadas; error por fila para extremos.

## KOV-030 — Recuperación de release por fase

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** DEVOPS · **Effort:** M · **Responsable sugerido:** Plataforma.

**Por qué / impacto esperado:** Fallo promoción/acceptance posterior no activa rollback definido; imagen previa puede faltar. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `.github/workflows/ci.yml:282,350-379; frontend/scripts/verify-deployment.mjs`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-006, KOV-033. **Riesgo de implementación:** Alto si altera contratos, transacciones, grants o datos; usar regresiones y migraciones compatibles.

**Trabajo concreto:** Modelar estado del release y recuperación de Fly/Vercel según fase; decidir fail-closed si falta rollback artifact. Validar sitio y API proxy además de SHA JSON.

**Criterios de aceptación:** Fallos candidate/promoción/acceptance dejan combinación coherente conocida o incidente bloqueante explícito. Captura vacía no permite release inseguro.

**Validación / manual QA:** Simulación con herramientas/proveedores falsos y luego staging desechable; nunca auto-downgrade destructivo.

## KOV-031 — Simulacro real de restore y operación

**Estado:** PENDING · **Fase:** 0 · **Severity:** P1 gate · **Category:** RELIABILITY · **Effort:** M + externo · **Responsable sugerido:** Operaciones / datos.

**Por qué / impacto esperado:** Backups programados no demuestran que datos/roles/servicio puedan recuperarse. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `docs/runbooks/restore-supabase-backup.md; ops-beta-gate.md; db-backup.yml`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** Destino desechable y acceso específico a backup autorizados. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Ejecutar runbook con copia de respaldo autorizada en destino desechable; validar integridad descargada, roles/RLS, extensiones, conteos e invariantes. Medir RPO/RTO, sin ampliar SLA.

**Criterios de aceptación:** Informe fechado de restore completo y smoke read-only, cobertura de binarios/retenciones clara, responsable e incidente ensayado. Gate sigue abierto sin evidencia.

**Validación / manual QA:** No usar backup real ni proveedores sin autorización específica. No crear costos/recurso productivo como parte de tarea documental actual.

## KOV-032 — Aviso y procedimiento de cuarentena legacy

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** UX · **Effort:** S/M · **Responsable sugerido:** Frontend offline / soporte.

**Por qué / impacto esperado:** Ventas legacy preservadas pueden coexistir con cola aparentemente vacía. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/offline/db.ts:42; useSyncQueue.ts; SyncQueueView.tsx`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-010, KOV-011. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Mostrar existencia de registros que requieren ayuda sin exponer payload ni asignar tenant no verificado; procedimiento de ownership/reconciliación.

**Criterios de aceptación:** Upgrade v1-v3 con pendientes anuncia recuperación, conserva íntegros registros y no los sincroniza con login arbitrario.

**Validación / manual QA:** Dos usuarios/tenants mismo dispositivo; validación guiada sintética. Bajar prioridad sólo si se demuestra que esos builds no tuvieron pendientes reales.

## KOV-033 — Actualizar contrato OpenAPI con revisión de compatibilidad

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** DX · **Effort:** XS/S · **Responsable sugerido:** Backend / frontend.

**Por qué / impacto esperado:** Check de export real falla por nuevas capacidades fiscales no versionadas. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/scripts/export_openapi.py; specs/openapi.json; fiscal/schemas.py`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** —. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Revisar diff completo, confirmar campos/rutas intended, generar archivo por script existente y probar clientes antiguos/campos nuevos. No cambiar schema sólo para que coincida archivo viejo.

**Criterios de aceptación:** Check backend y DTO frontend verdes; campos fiscales requeridos/defaults acordados y docs de API coherentes.

**Validación / manual QA:** Generación sin .env/proveedores; snapshot del contrato debe reflejar implementación aprobada.

## KOV-034 — Estabilizar pruebas y separar dev de build

**Estado:** PENDING · **Fase:** 1 · **Severity:** P2 · **Category:** TESTING · **Effort:** M · **Responsable sugerido:** QA frontend.

**Por qué / impacto esperado:** Dos unit fallan en suite y pasan aislados; siete E2E fallan preview, cinco pasan dev, SEO queda sin resolver. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `frontend/src/__tests__/App.test.tsx; customerOrders checkout test; e2e app-shell/mobile/orders/seo`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** KOV-009, KOV-033. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Investigar estado global, timers/act, lazy loading, mock API guard y diferencias prerender/SW. Separar expectativas intencionales de defectos de build; no relajar asserts.

**Criterios de aceptación:** Suite completa reproducible; dev y preview tienen suites declaradas y verdes; SEO preview realmente ejecutado. Ninguna omisión se reporta como pass.

**Validación / manual QA:** Repetición sólo justificada por diagnóstico, no retries infinitos. Conservar API request guard y semántica accesible.

## KOV-035 — Optimización dirigida por queries y volumen

**Estado:** PENDING · **Fase:** 2 · **Severity:** P3 · **Category:** PERFORMANCE · **Effort:** M · **Responsable sugerido:** Backend reportes / frontend.

**Por qué / impacto esperado:** Reservas/modifiers por fila y reportes materializados pueden saturar pool/latencia. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `backend/app/inventory/service.py:67; orders/service.py:97; customer_orders/service.py:150,455; reports/repository.py:30`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** Baseline de volumen representativo; P1 de corrección cerrados. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Medir query counts y p95; batch-load, índices según EXPLAIN y paginación/streaming dirigidos. No añadir cache que mezcle tenant/versiones.

**Criterios de aceptación:** Baja query count y latencia medida al mismo volumen, resultados exactamente iguales con refunds/offline/timezone y coste registrado.

**Validación / manual QA:** Datos sintéticos representativos; comparar antes/después, cargas pequeñas/grandes. No cifra de capacidad inventada.

## KOV-036 — Fuente canónica de arquitectura y ejecución

**Estado:** PENDING · **Fase:** 2 · **Severity:** P3 · **Category:** DX · **Effort:** S · **Responsable sugerido:** Tech lead / producto.

**Por qué / impacto esperado:** Docs dicen Supabase Auth y foco activo julio mientras varias fuentes marcan otros cierres. Resolverlo reduce el riesgo descrito; el cierre exige evidencia funcional, no sólo modificación de código.

**Evidencia / alcance:** `README.md; docs/claude/architecture-context.md; current-sprint.md; AGENTS.md/CLAUDE.md`. Ver la misma ID en la auditoría y sus anexos para reproducciones y límites.

**Dependencias:** Auditoría aprobada como referencia. **Riesgo de implementación:** Medio: preservar comportamiento existente y validar el flujo completo.

**Trabajo concreto:** Proponer índice vigente de setup/tests/runbooks/backlog y corregir stack auth real. Incorporar invariantes específicas a instrucciones sin copiar todo el reporte ni sustituir archivos automáticamente.

**Criterios de aceptación:** Nuevo dev localiza fuente de auth/DB, cómo probar seguro y gates abiertos en pocos enlaces; estados históricos siguen identificados como historia.

**Validación / manual QA:** Revisión de enlaces e instrucciones desde checkout sin secrets; no marcar tareas terminadas sin evidencia.

## Seguimiento de producto y escala: sin nuevas features automáticas

**PRODUCT-01 — Recuperación asistida y conciliación para dueños.** Fase3, PRODUCT/UX, P2, M, owner producto+frontend. Dependencias: KOV-001/003/010/011/012/019/032. Describir en español cuándo dinero ya cobrado sigue sólo local, qué falta para confirmar, quién puede resolver y qué ID compartir con soporte. Aceptación: piloto resuelve tres casos sintéticos (precio cambiado, permiso revocado, turno cerrado) sin duplicar venta ni editar DB. Riesgo: habilitar acciones que salten gates; preservar autorización server-side. Impacto: menos ventas perdidas/soporte.

**PRODUCT-02 — Relato financiero y valor del piloto.** Fase3, PRODUCT, P3, M, owner producto+reportes. Dependencia KOV-028 y corrección fiscal. Observar venta→cierre→análisis en cafetería/panadería/tienda, contrastar qué entiende el dueño con definiciones métricas, medir acciones útiles usando instrumentación existente. Aceptación: evidencia de entrevistas/observación y decisiones priorizadas; no métricas inventadas. Riesgo: añadir features sin señal; impacto esperado: claridad y retención basada en confianza.

**SCALE-01 — Baseline de SLI/costo y capacidad.** Fase4, OBSERVABILITY/COST, P3, M, owner plataforma. Dependencias: corrección de núcleo, KOV-021/031/035. Medir éxito/latencia de intenciones de venta, antigüedad cola, atraso Stripe, pool waits, errores por release, edad backup y costo por tenant activo/1000 ventas. Aceptación: baseline reproducible con volumen declarado y alertas accionables/owner; propuesta de capacidad sólo si un presupuesto falla. Riesgo: capturar PII o costos innecesarios; usar campos categóricos y stack existente. No comprar herramientas ni crear infraestructura como parte de la auditoría.

**SCALE-02 — Evolución incremental cuando el baseline lo justifique.** Fase4, ARCHITECTURE, P4, esfuerzo condicionado al cuello medido, owner tech lead. Dependencia SCALE-01. Evaluar batching/paginación/jobs/aggregates/pools antes de servicios separados; definir experimento y rollback por propuesta. Aceptación: mejora medida sin cambiar resultados ni aislamiento. No hay justificación actual para reescritura, sharding o microservicios por número de tenants solamente.

## Definición de terminado por tarea

Una tarea se cierra cuando el fallo concreto deja de reproducirse, invariantes relacionadas siguen protegidas, tests narrow y checks requeridos pasan, QA apropiado se registra y limitaciones externas permanecen explícitas. No cambiar tests/snapshots/fixtures para aceptar conducta incorrecta; si el contrato cambia legítimamente, documentar decisión y compatibilidad. No marcar gates de proveedor cerrados con pruebas locales ni sumar un retry aislado como suite verde.
