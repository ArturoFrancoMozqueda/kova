# Lotes y fechas

Capacidad opcional por producto, para productos terminados en unidades enteras.
No cambia precios, suscripciones, autenticación ni el contador de inventario:
las existencias siguen siendo la suma de `inventory_movements`.

## Operación

- Activar exige control de inventario y existencias/reservas conciliadas en todas
  las sucursales. Los movimientos anteriores reciben el lote desconocido sin
  cambiar cantidades, importes ni fechas históricas.
- El lote pertenece al producto y negocio; sus existencias y reservas pertenecen
  a cada sucursal. Traspasar conserva identidad, elaboración y fechas límite.
- Elaboración, rotación y caducidad son fechas distintas. Rotación se denomina
  consumo preferente o fecha objetivo según la configuración del producto.
- Las duraciones, opcionales, se expresan en días desde elaboración. Kova sugiere
  fechas para lotes nuevos; guardarlas exige confirmación. Cambiar una regla no
  recalcula lotes existentes. Corregir un lote deja auditoría.
- La caducidad y la rotación solo advierten. La prioridad es caducidad, rotación,
  elaboración y finalmente lotes sin fechas; el operador puede corregirla.
- Entradas, compras, ventas, ajustes, conteos y traspasos registran asignaciones.
  Una línea puede consumir varios lotes. El desglose debe conciliar con el movimiento.
- Confirmar pedidos reserva lotes. Cobrar consume esa reserva; una revisión
  explícita puede reasignarla antes del cobro. Una merma real puede causar faltantes
  reservados; el pedido afectado no puede cobrarse sin conciliarlos.
- Reembolsar una venta realizada con lotes no devuelve existencias. Anular exige
  indicar si hubo entrega y solo repone los lotes originales cuando no la hubo.
  Las ventas anteriores mantienen su tratamiento; la modalidad queda en la venta.
- Desactivar exige saldo cero en todas las sucursales y ninguna reserva activa.
  Los registros históricos permanecen. Una anulación posterior que necesite reponer
  lotes exige reactivar su control.
- Clasificar existencias libres entre lotes utiliza dos movimientos compensados
  y auditados. Las unidades reservadas no se reclasifican por ese flujo.

## Persistencia, seguridad y compatibilidad

Migración Alembic `0077_inventory_lots`: identidad, asignaciones y reservas por lote,
claves compuestas de propiedad, RLS forzada y permisos mínimos. Las asignaciones de
movimientos se insertan; el runtime no puede editarlas ni borrarlas. PostgreSQL
comprueba conciliación, signo y ausencia de saldos negativos al terminar la transacción.
Los escritores comparten bloqueos de producto y ordenan lotes por identificador.

Los endpoints de inventario existentes aceptan campos adicionales de asignaciones
o conteos únicamente para productos con lotes. Los productos ordinarios mantienen
su comportamiento. Se conservan los hashes idempotentes de solicitudes antiguas
que no incluían los nuevos campos. OpenAPI registra los contratos completos.

Las tablas y columnas nuevas participan en exportación y eliminación del negocio;
sus permisos se incluyen en el provisionamiento y las pruebas con el rol runtime.

## Sin conexión

IndexedDB v6 conserva la cola anterior y añade snapshots por negocio/sucursal.
Guardar una venta y descontar sus lotes locales es una sola transacción; varias
pestañas no pueden consumir la misma última unidad guardada. Un registro por
`client_uuid` mantiene descuentos hasta que el snapshot acredita la venta aplicada,
incluso si la cola sincronizada se depura. Los pendientes reconstruyen ese registro
después de limpiar el catálogo al cerrar sesión. Un snapshot anterior no reemplaza
uno más reciente.

El snapshot requiere conexión inicialmente. Al cobrar, se persisten los lotes
elegidos. Un rechazo conserva venta, comprobante y asignaciones; no devuelve una
venta con lotes al carrito para cobrarla de nuevo. La cola explica el conflicto y
permite revisar inventario y reintentar con la misma identidad.

Para ventas de versiones anteriores sin lotes, un usuario con permiso de ajustar
inventario puede agregar una conciliación explícita. Esta no modifica la venta
original ni sustituye asignaciones ya existentes; el servidor la valida y audita.

## Verificación y publicación

Pruebas: `test_inventory_lots.py`, regresiones de inventario, compras, reservas,
traspasos, devoluciones, RLS, portabilidad y sync; persistencia real IndexedDB en
`lotStock.test.ts`; recorrido de creación con reglas en `inventory-lots.spec.ts`
a 390 y 1280 px, más los escenarios de inventario existentes.

La verificación es local y los escenarios UI usan APIs de prueba declaradas.
No acredita publicación ni QA de dispositivos físicos o producción. Antes de
publicar: migración aditiva, backend antes del frontend, conciliación por producto
y sucursal y revisión del flujo offline real. Tras registrar lotes, el downgrade
se rechaza: cualquier rollback debe conservar esquema y usar una aplicación compatible.

### Evidencia local — 8 de octubre de 2026

- 93 pruebas de backend pasaron sobre PostgreSQL aislado, creado desde cero con
  todas las migraciones. Incluyen 17 casos de lotes, concurrencia real entre dos
  conexiones, permisos del rol `kova_app` y RLS entre negocios.
- 157 pruebas de frontend pasaron, incluidas siete de inventario local con
  IndexedDB real de prueba: consumo atómico, separación por sucursal, créditos de
  sincronización, conciliación histórica, reconstrucción al cerrar sesión y
  rechazo de snapshots anteriores.
- Cinco escenarios Chromium pasaron: creación de lotes a 390 y 1280 px y tres
  regresiones de inventario. Se revisó visualmente la presentación móvil; las
  APIs de estos escenarios son mocks declarados. Crear el lote dejó en ocho las
  existencias del producto y en cero las del lote nuevo.
- Compilación completa, TypeScript, ESLint de los módulos modificados, Ruff y
  comprobaciones del contrato OpenAPI pasaron.
- La migración completa y el ciclo `0077 → 0076 → 0077` pasaron en una base vacía.
  No se ejecutó migración, publicación ni QA en producción o dispositivos físicos.
- Las 15 pruebas de migraciones pasaron. La matriz global de permisos incluye
  las tres tablas nuevas y prueba operaciones reales con dos negocios, además de
  negar cambios a identidad/asignaciones y limitar la corrección a columnas de
  identificación y fechas. Se amplió el grafo de datos de prueba para este esquema;
  las comprobaciones de los permisos existentes se conservaron.

Los cambios se concentran en `backend/app/inventory/{lots,lot_router,lot_schemas,models}.py`,
la migración `0077_inventory_lots.py`, los servicios de catálogo, ventas, pedidos,
compras, traspasos y sync, sus contratos y el ciclo de vida del negocio.
El frontend integra `inventory/LotControls.tsx`, el registro y sus flujos de
inventario, junto con `offline/{lotStock,queue,sync,LotConflictRecovery}`.
`specs/openapi.json` y `docs/current-sprint.md` registran la capacidad y su alcance.
