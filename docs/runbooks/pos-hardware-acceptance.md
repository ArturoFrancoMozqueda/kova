# Aceptación de equipos por negocio

No declarar compatibilidad por marca ni vender un kit certificado hasta completar esta matriz con
el modelo físico. La evidencia de PDF o navegador no prueba papel, corte, pulso ni lectura óptica.
Contrato del cajón: [cash_drawer.md](../../specs/shifts/cash_drawer.md).

## Equipo disponible y faltante

El dueño confirmó tablets, una laptop Windows y una Mac el 2 de noviembre de 2026. Faltan modelos,
sistemas y navegadores para registrar aceptación. Se pueden reutilizar esos equipos para la caja;
no hace falta comprar otra computadora para empezar las pruebas.

| Equipo para probar | Qué comprobar antes de adquirirlo |
|---|---|
| Impresora térmica de 58 u 80 mm, con rollos | Driver para el sistema que la usará; tamaño de papel y margen imprimible. Si también manejará el cajón actual, debe ofrecer ESC/POS y TCP RAW accesible desde el equipo del conector. |
| Cajón con llave y cable | Compatibilidad eléctrica, voltaje, pin y cable confirmados en el manual de la impresora y del cajón. Un conector del mismo tamaño no acredita compatibilidad. |
| Lector 2D USB HID | Emula teclado, lee los códigos reales del catálogo y permite configurar Enter al final. Verificar puerto/adaptador del equipo; USB HID no certifica uso directo en todas las tablets. |
| Red del negocio | Impresora y conector alcanzables; registrar comportamiento ante pérdida de internet y energía. Si se requiere continuidad durante un apagón, incluir la alimentación del router y del equipo en la prueba. |

La impresión actual abre el diálogo del navegador y usa el driver del sistema. No incluye impresión
silenciosa ni un SDK USB/Bluetooth. Una tablet puede necesitar un mecanismo de impresión del sistema
o imprimir desde la laptop; no asumir que cualquier impresora de red aparece en el diálogo móvil.
El cajón usa un proceso Python 3.12+ en Windows/Mac/Linux con internet y acceso a la impresora;
una tablet por sí sola no ejecuta ese conector. Offline se usa la llave del cajón.

## Matriz de aceptación

Registrar equipo/modelo, conexión, OS, navegador/versión, ancho de papel, fecha, responsable y
resultado. Usar un negocio de QA separado del negocio operativo y no guardar tokens ni datos de
clientes en la evidencia.

1. **Caja:** abrir turno, buscar y añadir productos por nombre/SKU; teclado y touch; cambiar
   cantidades; retirar un producto; cobrar efectivo y dividido; cambio y devolución. Repetir a
   390 y 1440 px, en la tablet real y con zoom 200 %. Ningún control de cobro debe quedar oculto.
2. **Lector:** escanear productos existentes, uno desconocido y códigos repetidos rápidamente;
   comprobar foco, sufijo Enter y cantidades. Un lector 1D no acredita lectura del QR de lealtad.
3. **Ticket:** elegir el driver y papel correctos, escala 100 %, sin cabeceras/pies del navegador;
   imprimir ticket corto y largo, nombres extensos, acentos, descuento, efectivo/cambio, pago
   dividido y devolución. Confirmar último renglón, legibilidad, ancho sin recortes, avance/corte
   y reimpresión sin otra venta ni cobro. Repetir el corte de turno.
4. **Cajón:** vincular con automático apagado, probar físicamente y después activarlo. Efectivo
   y dividido abren una vez; tarjeta, reimpresión y sincronización antigua no abren. Probar
   impresora apagada, desconexión, revocación y recuperación; no debe abrir tarde ni duplicar
   ventas. Seguir la [instalación y QA](../../specs/shifts/cash_drawer.md#instalación-y-qa-física-pendiente).
5. **Offline:** seguir el [checklist](../claude/manual-qa-checklist.md#offline-funciona-sin-internet)
   en cada dispositivo real: recarga sin red, venta pendiente, reconexión y una sola venta/pago/
   salida de inventario. No borrar el almacenamiento ni reinstalar la PWA con ventas pendientes.
6. **Cierre:** contar efectivo humano, conciliar ventas/devoluciones y verificar reporte/exportación.
   Anotar fallas y repetir el escenario después de corregir; no marcar aprobado por inferencia.

La terminal bancaria integrada sigue fuera del alcance vigente: registrar «tarjeta» en Caja no
procesa un cargo. No se requiere contratar una terminal para validar el núcleo POS con efectivo;
cualquier promesa de cobro integrado exige su propio proveedor, contrato y aceptación.
