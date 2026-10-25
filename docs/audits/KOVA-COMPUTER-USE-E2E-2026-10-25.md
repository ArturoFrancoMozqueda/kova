# Aceptación con Computer Use — 25 de octubre de 2026

## Resultado

El circuito POS probado en producción funciona: login → venta manual → sincronización → recibo persistente → inventario → análisis → devolución. También pasaron la reserva/cancelación de un pedido vinculado a cliente y el ingreso de una solicitud desde el menú público móvil hasta la bandeja del negocio.

Se observó una inconsistencia de prioridad media en los mensajes de Análisis. Los cálculos financieros comprobados conciliaron. Esta aceptación es acotada a los escenarios descritos; no certifica todas las funciones, proveedores externos ni aislamiento entre negocios.

## Entorno y ejecución

- Destino: `https://kovasuite.com`, tenant Cafetería Sweet Home, Sucursal principal, rol Propietario. Periodo Hoy, 25 de octubre, America/Mexico_City (UTC-6).
- Cortes horarios observados: línea base 12:14, venta 12:15, pedido 12:17, solicitud 12:19 y pendientes 12:20, hora del negocio.
- Navegación e interacciones exclusivamente mediante Computer Use (`cua_repl`) en el navegador integrado; sin interceptar respuestas, sustituir datos, invocar APIs directamente ni preparar datos por SQL.
- Agent Teams: dos agentes revisaron planning, contratos, tests y el hallazgo. Intentaron abrir sus propias sesiones CU, pero no tenían navegadores disponibles. La sesión principal realizó todas las acciones UI. No se atribuye ejecución de navegador a los subagentes.
- La contraseña no se guarda en este informe ni en las capturas. No hubo edición de implementación, despliegue ni ejecución de suites automatizadas.
- La documentación de sprint era un snapshot anterior: la UI vigente ya presenta menú digital y navegación conectada. No se verificó el SHA desplegado en esta ronda.

## Matriz de aceptación observada

| Escenario | Evidencia UI | Resultado |
|---|---|---|
| Autenticación | Login abre Cafetería Sweet Home con Propietario. Recarga de detalle conserva acceso. Logout final y visita directa a `/dashboard` terminan en `/login`. | Pasa |
| Línea base | Análisis Hoy: $0 netos, 0 tickets. Producto existente `QA-20261010 POS`: precio $10, costo $3, 30 en stock. | Pasa |
| Producto agotado | Alfajores aparece agotado y deshabilitado tanto en Caja como en menú público. | Pasa |
| Enter seguro en Caja | Enter en descuento no registra venta. En móvil, Enter en efectivo recibido conserva carrito y botón Cobrar, sin venta adicional. | Pasa |
| Venta manual | Una unidad QA, cliente existente de prueba Ana, transferencia manual, referencia `QA-E2E-20261025-AGENT-TEAM`, total $10. | Pasa |
| Sincronización | Primero aparece folio local `171FA605` pendiente; después “Venta completada” y enlace a orden persistida. | Pasa en línea; no acredita corte de red |
| Persistencia y unicidad observada | Recarga del detalle conserva venta. Lista Hoy muestra exactamente una venta; Análisis confirma 1 ticket. | Pasa en este recorrido |
| Conciliación de venta | Reportes muestran $10 netos, ticket promedio $10, 1 unidad neta, transferencia $10 y stock 29. | Pasa |
| Historial de cliente | La ficha de Ana contiene la venta exacta; tras devolución muestra $10 y Devuelto: $10 por separado. | Pasa |
| Devolución | Se registra 1 unidad por transferencia manual, motivo Otro. Recibo muestra “Devuelta total”, Devuelto −$10 y Neto $0. | Pasa |
| Conciliación final | Reportes: bruto $10, devoluciones $10, neto $0, 1 ticket. Inventario vuelve a 30. | Pasa |
| Cliente → pedido | “Nuevo pedido” desde ficha conserva cliente registrado y nombre; se guarda y confirma una unidad QA con nota de prueba. | Pasa |
| Reserva | Pedido confirmado sigue pendiente de cobro. Inventario físico 30; otro formulario de pedido muestra 29 disponibles para el producto QA. | Pasa |
| Cancelación de pedido | Cancelación con motivo y nota QA conserva registro cancelado; después hay 30 disponibles. | Pasa |
| Menú móvil | A 390×844: selección de Agua mineral $32, revisión separada, subtotal correcto y conservación de contacto/notas al volver al menú. | Pasa |
| Acceso público sin login | Después del logout y de comprobar la protección de `/dashboard`, el enlace vigente carga los 13 productos y sus controles sin sesión autenticada. | Pasa en lectura |
| Solicitud pública → bandeja | Confirmación pública con UUID; bandeja recibe el nombre QA, origen A distancia, 1 × Agua mineral, subtotal $32 y notas exactas. Posteriormente queda Descartada. | Pasa |
| Sin efectos comerciales adicionales | Comprobación final mantiene 1 ticket, bruto $10, devolución $10, neto $0; Agua mineral conserva 6 existencias y 0 reservas en el desglose consultado. | Pasa |
| Caja móvil | Resumen de venta, métodos de pago, efectivo recibido $20, cambio $10 y botón Cobrar visibles. Se vacía carrito sin cobrar. | Pasa |
| Suscripción | Standard Plan, $299 MXN/mes, Activo; UI indica que no necesita otro checkout. | Lectura correcta; no prueba gates de impago |
| Canales / facturación | WhatsApp Sin conectar; CFDI y terminal Sin conectar; datos fiscales pendientes, Test sin conectar y Live pendiente. No se activan proveedores. | Estado explícito, E2E externo pendiente |
| Agenda / bandeja / operación | Cargan estados vacíos reales de citas, recordatorios y conversaciones, y oportunidad existente en pendientes. | Smoke de lectura |

## Hallazgo QA-01 — prioridad media

**Impacto:** el dueño recibe mensajes contradictorios al revisar una devolución total. La recomendación principal transmite tranquilidad mientras el detalle pide atención.

**Reproducción observada:** una venta de $10 y una devolución de $10 en Hoy. Análisis muestra simultáneamente:

- “No hay alertas fuertes en este rango. Mantén el ritmo…” en Prioridades.
- “100%”, “$10.00 devueltos de $10.00 en ventas brutas” y “Nivel alto: revisa los motivos abajo” en devoluciones.

Los valores bruto/devolución/neto son correctos; el defecto es de interpretación y consistencia del mensaje.

**Código contrastado:** `frontend/src/reports/utils/recommendations.ts:147` requiere `refund_count > 1` para R3 incluso con tasa de 100%; `frontend/src/reports/utils/calculations.ts:11` clasifica tasa superior a 5% como `high`; `frontend/src/reports/components/PriorityActionCard.tsx:51` usa el mensaje de tranquilidad cuando no hay recomendación.

**Corrección propuesta, sin implementar en esta ronda:** compartir el criterio de severidad con la recomendación y reconocer la muestra pequeña sin afirmar una tendencia. Añadir regresión para una devolución con tasa de 100%, manteniendo el caso de una devolución pequeña sin alarma.

**Aceptación del arreglo:** el caso descrito no debe mostrar tranquilidad incompatible con el detalle; cantidades, neto y filtros permanecen iguales.

## Enlace público vigente

La URL histórica documentada `/catalogo/cafeteria-sweet-home` muestra “Menú no disponible”. La configuración autenticada publica actualmente **https://kovasuite.com/catalogo/cafeteria-sweet-home-2**, que sí funciona y recibió la solicitud QA. No se cambió la publicación ni se regeneró el enlace. La indisponibilidad del enlace antiguo no se clasifica como defecto sin comprobar su historial de revocación; sí debe usarse el enlace vigente para nuevas pruebas.

## Registros creados y cierre de prueba

| Registro | Identificador | Estado final |
|---|---|---|
| Venta QA | `4531fade-c317-429a-b787-13578d1b7700`, recibo `8D1B7700` | Completada, devuelta total, neto $0; historial conservado |
| Pedido QA | `8c05be49-fec4-44a2-b8e4-4f2c385ec592`, `PED-385EC592` | Cancelado con nota QA; reserva liberada |
| Solicitud del menú | `77abb0d4-5f69-49f1-a0c7-d2e635f61973` | Descartada; sin oportunidad/pedido/cobro generado por esta solicitud |

Se reutilizaron producto y cliente de prueba existentes. No se agregaron productos ni clientes, ni se enviaron mensajes al cliente. Transferencia y devolución fueron registros manuales de QA, sin movimientos bancarios. Ambos carritos quedaron vacíos. Sesión cerrada y viewport temporal restaurado. La venta y devolución permanecen en auditoría y afectan sus conteos históricos; no se borraron registros para ocultar la prueba.

## Evidencia visual local

Capturas en `output/qa/computer-use-2026-10-25/`:

- [Reportes después de venta](../../output/qa/computer-use-2026-10-25/01-venta-reportes.jpg).
- [Venta devuelta y recibo neto cero](../../output/qa/computer-use-2026-10-25/02-devolucion.jpg).
- [Análisis tras devolución, incluido hallazgo](../../output/qa/computer-use-2026-10-25/03-reportes-devolucion.jpg).
- [Stock restaurado](../../output/qa/computer-use-2026-10-25/04-stock-restaurado.jpg).
- [Pedido confirmado pendiente de cobro](../../output/qa/computer-use-2026-10-25/05-pedido-reservado.jpg).
- [Menú móvil](../../output/qa/computer-use-2026-10-25/06-menu-movil.jpg).
- [Solicitud pública recibida](../../output/qa/computer-use-2026-10-25/07-solicitud-recibida-movil.jpg).
- [Caja móvil y cambio](../../output/qa/computer-use-2026-10-25/09-caja-movil.jpg).

## Pendientes y límites

No se probaron: pagos bancarios, Stripe checkout/cancelación real, CFDI Test/Live, WhatsApp/Meta, impresión física, pérdida de red y reintentos offline, otro tenant/roles, importaciones, altas de empleados, agenda con recursos, cotización→pedido→venta completa, agenda→venta, lectores de pantalla, zoom 200% ni dispositivos físicos. La solicitud entró por la UI pública mientras existía sesión del propietario; la lectura del menú también se comprobó después de cerrar sesión, sin volver a enviar otra solicitud. No se usaron endpoints privados para el ingreso de la solicitud.

Esta ronda no corrige el hallazgo ni publica cambios locales existentes. Archivos de implementación y contratos se mantuvieron intactos. Validación realizada: QA manual por navegador y revisión de contratos/código por el equipo.
