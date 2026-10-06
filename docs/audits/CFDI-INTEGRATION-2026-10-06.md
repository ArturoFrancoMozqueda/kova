# Auditoría para emisión individual CFDI con Facturapi

Corte: 2026-10-06 UTC, base desplegada `a22eedeb4b0fc58038073f5b78e121565e395a78`.
Rama `feature/cfdi-integration-audit-20261006`, worktree
`/workspace/kova-wt-cfdi-audit`. Esta auditoría verifica código; no ejecuta
emisión, cancelación, alta de organización ni validación externa del proveedor.
Los nombres de campos, garantías de idempotencia, catálogos y respuestas de
Facturapi deben fijarse con documentación actual antes de implementar el adaptador.

## Base existente y brechas concretas

| Punto de integración | Evidencia actual | Cambio imprescindible |
|---|---|---|
| `backend/app/integrations/service.py:create_request` | Bloquea la venta, reserva idempotencia local y congela emisor/receptor/importes. Sólo registra solicitudes. | Conservar solicitud operativa y añadir ejecución durable/conciliable; separar la transacción local de la llamada externa. |
| `backend/app/integrations/models.py:InvoiceRequest` | `status = pending_provider`, `UNIQUE(tenant_id, order_id)` y FK compuesta a venta/sucursal. | Estados reales y evidencia de proveedor mediante migración aditiva. Un único padre operativo por venta puede mantenerse; intentos/artifactos requieren ambiente separado. |
| `backend/app/fiscal/repository.py:capture_baseline_snapshot` | Importes concilian; claves SAT de producto/servicio, unidad y objeto de impuesto son NULL; impuesto no clasificado, `not_calculated`. | Construir snapshot fiscal explícito y versionado por concepto antes de emitir; no convertir el porcentaje cobrado en una clasificación SAT supuesta. |
| `backend/app/fiscal/repository.py:eligible_order_snapshots` | Excluye el último evento individual `confirmed`. No excluye solicitudes preparadas. | Sólo una emisión LIVE verificada produce confirmación fiscal; sandbox, timeout y validación fallida no afectan el cierre global real. |
| `backend/app/fiscal/service.py:record_individual_invoice_status` | Owner puede confirmar con referencia manual o reabrir una confirmación sin consultar proveedor. | Impedir reapertura manual mientras una factura del proveedor siga vigente o su cancelación esté pendiente/desconocida. Conservar la función para referencias externas sin permitir alterar estado de CFDI gestionados. |
| `backend/app/fiscal/repository.py` ajustes tardíos | `confirmed` excluye saldo; `reopened` reincorpora saldo neto por reembolsos; lotes originales permanecen inmutables. | Reutilizar eventos tras confirmación/cancelación definitiva para conservar esta conciliación. No reescribir lotes cerrados. |
| `backend/app/orders/service.py:create_refund` | Reembolso usa importe histórico y bloqueo de venta; una devolución parcial no cambia la venta a no completada. | Definir rechazo inicial de ventas con reembolsos o flujo explícito de documentos fiscales relacionados. No emitir por el total original ignorando devoluciones. |
| `backend/app/account_lifecycle/service.py` | Exporta solicitudes/perfil y borra explícitamente el grafo. Tablas desconocidas detienen purge. | Incluir documentos/estados nuevos en exportación sin secretos; decidir retención de CFDI reales y tratamiento de operaciones pendientes antes de habilitar el borrado. |

La validación actual de RFC, código postal, régimen y uso sólo verifica formato.
No acredita datos SAT válidos, CSD vigente, organización configurada ni derecho a
emitir para el RFC. `ReadinessResponse` expresa correctamente esa limitación.

## Contrato mínimo previo a implementación

1. **Identidad y ambiente.** Vinculación server-side del tenant con organización,
   RFC y credencial de Facturapi, validada sin confiar en IDs enviados por el
   navegador. Sandbox y live tienen credenciales, IDs de documentos, intentos,
   status y artefactos separados; modo sandbox visible en toda la UI. Nunca
   escribir una clave en `fiscal_data`, respuesta, logs o exportación. Permitir
   preparar/validar sin activar emisión LIVE automáticamente.
2. **Conceptos fiscales.** Definir claves SAT y régimen/uso compatibles, objeto de
   impuesto, traslado/retención/exento/tasa cero, unidad, cantidad, descuento y
   precio con o sin impuesto. Congelar los conceptos aprobados para esa solicitud,
   sin reconstruir ventas históricas desde un catálogo mutable. Mantener Decimal
   y reconciliar total de conceptos, descuento e impuestos con lo efectivamente
   cobrado; rechazar discrepancias, faltantes y redondeos no acordados.
3. **Pago.** La venta admite pagos mixtos. Acordar forma/método de pago CFDI con
   trazabilidad y validación; no inferir PUE/PPD ni un código SAT simplemente por
   registrar “tarjeta” o “transferencia”. Documentar alcance inicial y rechazar
   combinaciones no soportadas antes de tocar al proveedor.
4. **Concurrencia.** Emisión, devolución, anulación, registro individual manual y
   cierre global necesitan una política única de serialización por venta y tenant.
   Reservar durablemente emisión mientras se comprueba elegibilidad. Una venta ya
   incluida en un borrador global exige ajuste; una factura global realmente
   timbrada requerirá un flujo distinto y queda fuera del borrador actual.
5. **Referencia estable.** Antes del POST remoto, persistir intento, ambiente,
   hash de payload fiscal, referencia recuperable y estado `issuing`. Una nueva
   clave local no permite otra factura activa para la misma venta/ambiente. Los
   retries reutilizan la identidad externa estable sólo si el contrato del
   proveedor garantiza esa conducta; documentar explícitamente esa garantía.
6. **Resultado desconocido.** Timeout, respuesta incompleta o fallo DB después de
   aceptación remota llevan a `needs_reconciliation`, no a “falló, vuelve a
   emitir”. Buscar y verificar el documento remoto por referencia estable y
   organización/ambiente antes de otro POST. Persistir estado antes de la llamada
   evita perder el intento al hacer rollback. Sin recuperación verificable,
   mantener bloqueo y revisión del owner; nunca reintentar a ciegas.
7. **Confirmación.** Validar ID externo, UUID fiscal, estado, RFC emisor/receptor,
   moneda e importes; guardar evidencia/artefactos autorizados. Persistir resultado
   y evento `confirmed` LIVE una sola vez y en transacción coherente. El ledger
   fiscal no se actualiza por mera respuesta HTTP 200, sandbox ni callback no
   autenticado. Mostrar estado real y enlace seguro a XML/PDF.
8. **Cancelación.** Solicitud aceptada significa `cancellation_pending`, no
   `cancelled`. Motivo y UUID de sustitución son explícitos cuando corresponda;
   validarlos contra el contrato SAT/proveedor. Consultar hasta conocer resultado
   definitivo; rechazo/timeout mantiene factura vigente y exclusión global.
   Sólo cancelación confirmada LIVE permite evento `reopened`; la cancelación no
   hace devolución de caja automáticamente. Reemplazos requieren historia y
   referencias entre documentos, sin borrar el UUID original.

## Permisos, datos y seguridad

- Rutas existentes usan cookies, CSRF, acceso comercial y `FISCAL_MANAGE` (owner);
  managers sólo tienen `FISCAL_VIEW`. Preservar esas fronteras; lectura de PDF/XML
  y cancelación deben validar tenant, sucursal, ambiente y documento server-side.
- Mantener FK compuesta tenant/sucursal/venta y unicidad de factura activa por
  venta/ambiente. Para todas las tablas nuevas, añadir RLS + FORCE + USING/WITH
  CHECK tenant, revocar PUBLIC/anon/authenticated y conceder al runtime sólo los
  verbos/columnas necesarios. No otorgar UPDATE sobre snapshots o artefactos
  fiscales inmutables para actualizar estados de ejecución.
- Actualizar `app/db.py` registro/políticas, `provision_app_role.sql`, fixtures RLS,
  `migration_tests/test_0065_tenant_hardening.py`, exportación/purge y OpenAPI con
  cada tabla/campo real. Las migraciones preservan datos históricos y rechazan
  rollback destructivo después de uso; pruebas de reversibilidad vacía siguen CI.
- Worker de recuperación y webhook, si se implementa, necesitan contexto de
  tenant/branch explícito, autenticación del evento según contrato actual,
  deduplicación y resolución server-side de organización/documento. Nunca aceptar
  un tenant arbitrario incluido en el callback. Logs usan IDs técnicos y códigos
  saneados; no dumps de payloads con RFC/email, certificados ni Authorization.
- Gestionar descarga/almacenamiento de XML/PDF como datos privados: autorización,
  límites de tamaño, content-type, destino confiable y retención. Mantener sesión
  cookie y evitar exposición de claves al frontend. Exportación de CFDI debe
  incluir evidencia útil, pero nunca la credencial/certificado del emisor.

## Pruebas que deben demostrar el flujo

| Escenario | Aceptación |
|---|---|
| Venta legacy/impuestos incompletos/reembolso previo | Rechazo explicado antes de POST externo; venta y dinero no cambian. |
| Cambia catálogo después de solicitud | Documento conserva conceptos/importes aprobados e históricos. |
| Dos emisiones con claves iguales/distintas | Un efecto externo por venta/ambiente; replay o conflicto sin duplicados. |
| Timeout después de timbrado / crash antes de guardar respuesta | Reconciliación encuentra el mismo documento; ningún segundo CFDI. |
| Sandbox y luego live para misma venta | Artefactos separados; sandbox nunca modifica el cierre global real. |
| Cancelación pendiente/rechazada/desconocida | Factura permanece excluida del global y no se habilita reapertura manual. |
| Cancelación definitiva repetida | Un evento de reapertura/ajuste tardío; importes y UUID histórico conservados. |
| Refund/void/global-close concurrentes con emisión | Resultado determinista sin doble inclusión ni importe fiscal desactualizado. |
| IDs ajenos y branch restringida | Sin consulta/documento/clave del otro tenant; RLS probada con rol runtime. |
| Reprovision/export/purge/upgrade con datos reales | Grants mínimos, historia conservada y exportación sin claves; retención definida. |

Tests existentes a conservar: `test_integrations_readiness.py`,
`test_fiscal_global_drafts.py`, `test_account_lifecycle.py`, RLS/grants y
`migration_tests/test_0073_pos_expansion.py`. Esta auditoría no declara probado
un flujo de Facturapi ni define todavía sus nombres de campo o contratos externos.
