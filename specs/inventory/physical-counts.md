# Conteo físico de inventario

## Problema y valor

El dueño o encargado necesita registrar las unidades que contó sin confundir un campo vacío
con cero ni el saldo del sistema con una observación física. Un conteo guardado cambia existencias;
abrir el formulario o escribir el motivo no debe producir una cantidad implícita.

## Operación y errores

- El conteo ordinario inicia vacío y exige una cantidad entera entre 0 y 2 147 483 647.
  Escribir cero explícitamente permite registrar que no hay unidades.
- Los productos con lotes exigen capturar cada lote, incluidos los que tengan cero unidades.
  No se precargan las existencias del sistema. El total calculado permanece vacío hasta completar
  todos los campos y cada cantidad debe cumplir el mismo rango entero no negativo.
- Se bloquea Guardar mientras falten cantidades, los lotes estén cargando o falle su lectura.
  Un error de consulta se explica sin presentar una lista vacía como un conteo válido.
- Se exige motivo y se bloquea la edición mientras se guarda. Una falla conserva el formulario
  y los reintentos mantienen la identidad idempotente de la misma operación.
- Se mantienen etiquetas, teclado y controles compartidos a 390 y 1440 px.

## Datos, API, permisos y auditoría

Sin cambios de esquema ni contrato HTTP. Se conservan los endpoints de conteo, la cantidad total,
el desglose por lote y `Idempotency-Key`. La sesión del servidor resuelve el negocio y la sucursal;
`inventory.adjust`, acceso comercial, CSRF y RLS siguen vigentes. El backend conserva la validación
autoritativa y registra el movimiento y auditoría existentes. Ver [lotes](lots.md).

Sin conexión no se registra ni se encola un conteo como venta. Una lectura fallida no autoriza
inventar existencias; debe recuperarse la conexión y reintentarse.

## Escenarios y aceptación

```gherkin
Scenario: No convertir un campo sin capturar en cero
  Given un producto con existencias y el formulario de conteo recién abierto
  When el encargado escribe sólo el motivo e intenta guardar
  Then no se envía un conteo ni se modifican existencias

Scenario: Registrar un cero declarado
  Given un conteo físico de cero unidades
  When el encargado escribe 0 y el motivo y guarda
  Then se envía el cero explícito con una clave idempotente

Scenario: Completar todos los lotes antes de registrar
  Given dos lotes con saldo previo
  When se captura sólo el primer lote
  Then no se asume cero ni el saldo del sistema para el segundo
  And guardar permanece bloqueado

Scenario: Validar cada lote antes de sumar
  Given cantidades negativas o fraccionarias cuya suma es un entero positivo
  When el encargado intenta guardar
  Then no se envía el conteo
```

Matriz: `InventoryView.test.tsx` cubre captura ordinaria, cero, campos incompletos, cantidades por
lote inválidas, error de consulta y reintentos. `test_inventory_lots.py` verifica conciliación por
lote, integridad y RLS del backend. La aceptación de estas pruebas no sustituye el conteo físico
del negocio ni acredita publicación.
