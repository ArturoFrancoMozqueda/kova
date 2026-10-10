# Operaciones reales de POS y caja en Sweet Home

Fecha: 10 de octubre de 2026. El usuario autorizó operaciones reales en su tenant de
evaluación. Producción inicial verificada: `960f17fbff6a85743125012a804b523abe881e1c`.
Pruebas mediante Chromium, UI y API reales de `https://kovasuite.com`, inicio de
sesión normal, sin interceptar escrituras, SQL directo ni autenticación persistida.
Los productos `QA-20261010` identifican operaciones de aceptación: son registros
reales en Kova y no acreditan entrega física ni movimiento bancario.

## Ventas y reversos

Producto POS `cd8d95e7-a0b2-450f-bead-0389cbfc82e6`: precio 10.00, costo 3.00,
stock inicial de prueba 30. Se comprobaron recibos y persistencia después de recargar.

| Flujo | Orden | Total MXN | Resultado final |
| --- | --- | --- | --- |
| Efectivo, dos unidades, recibido 50/cambio 30 | `e3bc7a72-aded-45c1-91ce-2c7ed0329c97` | 20.00 | Dos devoluciones de 10.00; la UI mostró máximo restante uno tras la primera. |
| Transferencia registrada | `f904f29e-ca54-4b1c-8470-d375e4adce92` | 10.00 | Devolución total por transferencia. |
| Tarjeta manual registrada | `92b70010-368f-4831-93f2-7337e38be869` | 10.00 | Devolución total por tarjeta manual. No hubo cargo en un procesador. |
| Dividido: efectivo 8, recibido 10/cambio 2; transferencia 12 | `ba9d7afb-62e8-405e-8506-204c974620f1` | 20.00 | Anulada; inventario y efectivo revertidos. |
| Offline, efectivo exacto | `23fb6e19-a681-43c2-b1f5-5d646b3aadfa` | 10.00 | Sincronizada y después anulada. |
| Dos unidades, descuento 2, impuesto adicional 16% | `f7e57043-f0b7-43b5-bb20-3a2e762e4547` | 20.88 | Impuesto 2.88 y cambio 9.12 sobre recibido 30. Dos devoluciones de 10.44 conciliaron el total. |
| Pedido con lote, transferencia | `80de2cf8-6850-43d2-b021-32ac612aa909` | 12.00 | Devolución total. Stock no repuesto por devolución, conforme a contrato de lotes. |

El pedido `81fc060d-56bf-4444-a84f-c44d4dbd63dc` quedó vinculado a su venta:
`ready/unpaid` versión 5 → `ready/paid` versión 6 → `cancelled/refunded` versión 7.
La reserva se consumió una vez. Su restitución de inventario se hizo mediante ajuste
explícito auditable, documentado en la [auditoría de negocio](KOVA-PRODUCTION-BUSINESS-2026-10-10.md).

## Offline e idempotencia

Se cortó la red del contexto Chromium antes de cobrar. El recibo mostró folio local
`CB09512D`, pendiente de sincronizar. Recargar sin red preservó la cola y el catálogo
guardado; Kova mantuvo el modo local seguro y bloqueó efectivo sin comprobar el turno.
Reconectar y recargar con sesión verificada permitió sincronizar el UUID
`cb09512d-ce46-42a3-a28f-8ed21c50880d` a una sola orden.
Se inspeccionó IndexedDB sólo en memoria: todas las entradas del contexto acabaron
`synced`; no se exportaron estados de sesión ni trazas.

Repetir la petición original del pago dividido (UUID
`70abb380-c8b5-4e50-b5ff-09d7af62858a`) devolvió la misma orden. Antes/después:
cinco órdenes completadas, neto 50.00 y efectivo esperado 56.00, sin cambios.
La devolución de tarjeta se repitió con su clave original: HTTP 201, mismo ID de
devolución y stock 30 antes/después, sin otra devolución.

Los timeouts de localizadores del harness no se trataron como fallos de producto ni
provocaron nuevos cobros: se consultó el recibo/orden existente antes de continuar.
Se aisló el proceso de navegador para evitar reinicios de kernel compartido entre agentes.

## Conciliación del día y turnos

Después de siete devoluciones y dos anulaciones, API real del 10 de octubre:

- Bruto de órdenes no anuladas: 72.88; devuelto: 72.88; neto: 0.00.
- Cinco órdenes completadas, siete devoluciones y dos anulaciones.
- Desglose: transferencia 22.00/22.00 devuelto; efectivo 40.88/40.88;
  tarjeta manual 10.00/10.00. Neto cero en los tres métodos.
- Stock POS nuevamente 30, reservas cero.

El turno antiguo `12eb0b62-fc93-42bd-baa0-5393ed4db7a0` estaba abierto desde
13 de septiembre y esperaba 38.00. Entrada 5.00 y salida 5.00 guardadas por UI
con motivo de QA compensado conservaron ese saldo. Ventas, devoluciones y anulaciones
lo regresaron también a 38.00. Se cerró con declaración de prueba 38.00:
`balanced`, diferencia 0.00.

Turnos nuevos de aceptación, con importes declarados de prueba:

- `74b8b2c2-ff58-467c-9f31-3342ab723f76`: apertura 5.00, declaración 6.00,
  `overage`, diferencia +1.00.
- `ffee886b-e219-4aad-8975-d37e561c2861`: apertura 5.00, declaración 4.00,
  `shortage`, diferencia -1.00.
- `fdd27022-504f-4578-a4a9-8222867d4215`: nuevo turno abierto con 0.00.

Los cortes guardados prueban cálculo y persistencia; **no son un conteo físico de
billetes**. Historial y productos de prueba se conservan, sin borrar ventas para
ocultar actividad. La caja queda con turno nuevo, sin ventas locales pendientes.

## Correcciones y límites

La búsqueda de tablas en tres triggers de lotes permitía shadowing mediante tablas
temporales. Una nueva migración fija `pg_catalog, public, pg_temp` sin cambiar permisos
ni RLS; tres regresiones adversariales fallaban antes y pasan después.
También se corrigieron accesibilidad de análisis/catálogo/inventario y etiquetas de
movimientos, con pruebas descritas en las auditorías de cada equipo.

La pestaña integrada del usuario permitió comprobar su sesión existente y encontrar
dos defectos adicionales del panel: métodos de pago en inglés y una frecuencia de
140% presentada incorrectamente como porcentaje de órdenes. Se corrigieron las
etiquetas y se describen ahora eventos por cada 100 órdenes: múltiples devoluciones
parciales pueden pertenecer a una venta. No cambian los campos, el score ni los
datos. Panel y análisis aclaran que el desglose de pagos es bruto; análisis presenta
también bruto, devoluciones y neto cuando hay reembolsos.

Verificación local: 1,477 pruebas backend antes del último copy, 962 frontend sobre
las fuentes finales, 209 de navegador compilado (seis skips de integración que
requieren stack efímero), TypeScript, ESLint, build/SSR/prerender, contrato OpenAPI y
100 archivos JS del bundle sin patrones de secretos. Scripts operativos: 60 pruebas;
publicación: 24 aprobadas y un skip específico de Windows. El último copy tiene
tres regresiones nuevas; CI valida de nuevo el backend y el stack real antes de
integrar. Las pruebas de navegador actualizan
selectores de título a nivel uno y del listado de productos para reflejar los nuevos
encabezados accesibles, conservando la comprobación de ordenación y los flujos.
Logout normal de la sesión de prueba: HTTP 204, cookies eliminadas y `auth/me` 401;
la sesión del usuario en el navegador integrado se conservó.

Los backups reales recientes tienen dump, subida, checksum, retención y limpieza
aprobados. Se añade un drill manual con destino PostgreSQL 17 aislado en GitHub Actions:
su implementación y prueba sintética no acreditan aún restauración de un dump real.
No sustituye recuperación regional de Supabase ni prueba de RTO/RPO completa.

El usuario confirmó ausencia de cuenta Facturapi e identidad/CSD del tenant. No se
inventaron datos fiscales ni se emitieron CFDI reales. La cuenta de plataforma y
los requisitos del emisor siguen necesarios. Terminales/cargos externos, Safari/iOS
y periféricos físicos no se declaran certificados. La publicación de los fixes
requiere CI y comprobación posterior de la versión realmente servida.
