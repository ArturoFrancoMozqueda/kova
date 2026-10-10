# Operaciones reales: catálogo, compras, inventario y pedidos

Fecha: 10 de octubre de 2026. Entorno: `https://kovasuite.com`. Negocio:
Cafetería Sweet Home. El usuario autorizó expresamente las operaciones reales de
prueba. Se usó el inicio de sesión normal de propietario y los formularios de
producción, sin mocks, SQL, datos analíticos fabricados ni archivos de sesión.
Los registros se identificaron con `QA-20261010` y conservan su historial.

## Catálogo e inventario

Se crearon tres productos por UI, con respuesta `201` y persistencia verificada:

| Producto | ID | Precio/costo MXN | Uso |
| --- | --- | --- | --- |
| QA-20261010 POS | `cd8d95e7-a0b2-450f-bead-0389cbfc82e6` | 10.00 / 3.00 | Se entregó al equipo de caja con 30 unidades; sus ventas y reversos se documentan por separado. |
| QA-20261010 Inventario | `cee0937c-e75d-4051-80aa-b29702471e53` | 10.00 / 4.00 final | Ajuste +12, recepción +2, conteo -1, recepción +2: saldo 15, reservas 0. |
| QA-20261010 Lotes | `9f91c100-d223-481c-8a1a-54d7c8e9dab2` | 12.00 / 4.00 | Entrada de seis unidades, reclasificación y reservas; checkout y reverso coordinados con caja. |

El producto de inventario comenzó en cero, con costo 3.00. La recepción parcial
actualizó su costo a 4.00 al marcar la opción explícita del formulario. El conteo
registrado de prueba cambió 14 a 13. Cambiar el umbral a 14 activó la alerta de stock bajo; la
siguiente recepción dejó 15 y retiró la alerta. Repetir la petición de umbral con
la misma clave idempotente devolvió `200` sin efectos adicionales.

## Compras y proveedores

Se creó el proveedor `QA-20261010 Proveedor`
(`c2396804-236d-4d89-b6ce-06f98e19fcd3`) sin datos de contacto ni comunicaciones.

- Compra `0e4dabd0-bb68-4dbc-82f4-82ee78e82ec6`: cinco unidades a 4.00; se
  recibieron dos y luego se cancelaron las tres pendientes. Los estados
  `pending → partial → cancelled` persistieron al recargar y conservaron las dos
  unidades recibidas.
- Compra `1588c7b8-c314-4d81-86e4-a25635302010`: dos unidades a 4.00,
  `pending → received`. Repetir la recepción con la misma clave idempotente
  devolvió `200`. La lectura posterior mostró una sola entrada de dos unidades,
  no una segunda recepción.

El inventario final de este producto concilió exactamente con sus cuatro
movimientos persistidos: `12 + 2 - 1 + 2 = 15`.

## Lotes, reservas y pedidos

Crear un lote mantuvo sus existencias en cero. Con elaboración 10 de octubre y
reglas de 7/15 días, las sugerencias guardadas fueron consumo preferente 17 de
octubre y caducidad 25 de octubre. Se ingresaron seis unidades al lote A y luego
se reclasificaron dos al lote B; el total siguió en seis.

- Lote A: `95caf566-0a49-40be-9c4f-12a09e9ed8c5`.
- Lote B: `92ed0915-0d28-4774-b590-5387654ee972`.
- Pedido `PED-3E0D077F` (`21b4a303-4f7d-4f63-806f-e6063e0d077f`): dos
  unidades del producto de inventario, total 20.00. Confirmarlo reservó dos;
  cancelarlo liberó ambas, conservó el saldo físico y no creó una venta.
- Pedido `PED-4DBD63DC` (`81fc060d-56bf-4444-a84f-c44d4dbd63dc`): se
  confirmaron cinco unidades con reservas A4/B1. Una merma física A-4 dejó dos
  unidades físicas, produjo `stock_conflict` y deshabilitó el cobro. Restituir A+4
  corrigió el conflicto. Editar cinco a una unidad recalculó las reservas a A1.
  Avanzar a preparación y listo persistió; entregar estuvo bloqueado antes del
  pago. Se entregó al equipo de caja en versión 5, total 12.00, saldo seis y
  reserva una para comprobar checkout y reverso financiero.

El equipo de caja cobró ese pedido por transferencia y creó la venta
`80de2cf8-6850-43d2-b021-32ac612aa909`: las existencias pasaron de seis a cinco y
la reserva a cero. Registró una devolución total de 12.00
(`b7c89190-59df-4a68-849e-6b3178f00fd1`); las existencias siguieron en cinco,
como exige la política de lotes. Después, el formulario permitió cancelar el
pedido totalmente devuelto (`cancelled/refunded`, versión 7) sin borrar la venta
vinculada. Un ajuste explícito +1 al lote A
(`93beb084-ffed-4435-ae0d-f595f568eb3c`) dejó otra vez A4/B2, total seis y reservas
cero, y conservó el historial de venta, devolución y restitución.

Las mermas y restituciones de prueba quedaron como movimientos normales
auditables; no se borraron registros para ocultarlas.

## Hallazgos y validación del código

El historial real mostró las recepciones de compra como el genérico
“Movimiento”. El backend devolvía correctamente `movement_type: purchase`, pero
el frontend no tenía su etiqueta ni las de traspaso. Se añadieron “Compra”,
“Traspaso de entrada” y “Traspaso de salida” en `InventoryView.tsx` y
`i18n/messages.ts`, con tres regresiones en `InventoryView.test.tsx`. Pasaron las
30 pruebas de ese archivo, ESLint de los archivos modificados y TypeScript.
Esta comprobación local requiere publicación y verificación posterior del
frontend para acreditar la corrección en producción.

En viewport Chromium de 390 × 844, los cuatro módulos cargados con estos datos
reales no tuvieron desbordamiento horizontal. Axe encontró una infracción de
jerarquía de encabezados en catálogo y otra en inventario (`h1 → h3`), y cero en
compras y pedidos. La verificación esperó las filas persistidas; una revisión
durante el estado de carga no se cuenta como evidencia del contenido final.
Se corrigieron los encabezados de sección a `h2` en los dos módulos, preservando
su estilo. Inventario incluye también un título accesible de su listado para
mantener la jerarquía aunque no haya alertas. Las regresiones comprueban la
estructura y ejecutan la regla axe de encabezados con y sin alertas. Pasaron
39 pruebas en los tres archivos de catálogo/inventario, ESLint y TypeScript.
La revisión de React comprobó que los cambios no añaden dependencias, peticiones,
estado, listeners, efectos ni cambios de contratos o permisos.

El título accesible nuevo del listado, “Productos con inventario”, hizo ambiguos
tres selectores antiguos que buscaban cualquier encabezado con “inventario”. Se
precisó `level: 1` en las comprobaciones del título de página de
`e2e/inventory.spec.ts` y `e2e/mobile.spec.ts`. Es un ajuste legítimo al cambio de
jerarquía: se sigue exigiendo el mismo título visible y se conservan todas las
comprobaciones de filtros, ajustes, conteos, umbrales y navegación móvil; las
nuevas regresiones axe exigen además que exista el encabezado de sección correcto.

El selector de ordenación también suponía que el primer `h3` era el encabezado
de alertas; ahora ese encabezado es un `h2`. El test identifica el listado por su
región accesible y sigue exigiendo exactamente los mismos tres productos en el
mismo orden descendente de existencias, sin índices dependientes de encabezados
ajenos al listado.

Las devoluciones parciales reales permitieron observar otra narrativa errónea
en el panel: siete eventos sobre cinco órdenes se presentaban como “140% de las
órdenes”. La fuente del backend cuenta eventos (`len(refunds)`), no órdenes
distintas con devoluciones. Se conserva esa definición y el cálculo del score,
y se expresa “140 eventos por cada 100 órdenes”; la explicación aclara que una
orden puede tener varias devoluciones parciales. La leyenda del panel también
usaba enums en inglés; reutiliza ahora las etiquetas existentes “Efectivo”,
“Transferencia” y “Tarjeta manual”. Las regresiones prueban frecuencias de 20 y
140, el caso sin devoluciones y los tres métodos de pago. No se limitaron tasas
ni se modificaron importes, denominadores, contratos o agregaciones.

El panel tenía el mismo salto de encabezados. Se corrigieron a `h2` los títulos
de sus secciones y de “Qué hacer ahora” en `InsightStrip`, sin modificar el
componente compartido. Una prueba de la vista cargada mantiene sus tarjetas
reales de salud y acciones, exige los cinco títulos de sección en nivel dos y
comprueba la regla axe de jerarquía. “Cómo te pagaron” conserva cobros brutos y
ahora aclara “Cobros antes de devoluciones”, para distinguirlos de ventas netas.

## Alcance de esta evidencia

Este documento acredita operaciones comerciales reales dentro del tenant,
reservas, inventario, compras e idempotencia. Las ventas POS, caja, reembolsos,
anulaciones, checkout final del pedido y publicación se documentan por el equipo
responsable de esos flujos. No acredita cargos en un procesador externo, CFDI
ante el SAT, impresión física, lector físico, Safari ni iOS.
