# Revisión de experiencia para dueños, operadores y cajeros

Fecha: 2026-10-26, Ciudad de México. Corte local posteriormente publicado y aceptado:
[evidencia productiva](KOVA-PRODUCTION-ORDER-FLOW-2026-10-26.md).
Complementa [el recorrido de pedidos](KOVA-ORDER-FLOW-UX-2026-10-26.md).
Riesgo: copy/UI, continuidad de formularios, presentación de inventario y reportes;
el cambio privado del detalle de pedidos es aditivo y no requiere migración.

## Alcance y método

Se recorrió la sesión del propietario en el navegador de Codex de `kovasuite.com`,
incluido el menú público que dejó abierto. La revisión productiva fue de lectura.
Las altas, ventas, cierres y cambios de pedidos se ejecutaron exclusivamente en
negocios efímeros locales, con frontend compilado, API real y PostgreSQL. El servidor
de aceptación usa un rol runtime sin propiedad de tablas ni BYPASSRLS; la preparación
de cuentas usa el acceso privilegiado del entorno desechable.

| Persona o área | Recorrido revisado y evidencia |
|---|---|
| Dueño | Panel, alcance por sucursal, análisis, configuración, suscripción y permisos. Login, venta, cambio, cierre y logout reales. |
| Gerente | Acceso al panel, venta y cierre reales; administración de empleados rechazada por API. |
| Cajero | Entrada a Caja, turno, venta de efectivo, cambio, cierre, Pedidos y logout; acceso comercial y empleados rechazados por API. |
| Colaborador (`staff`) | Entrada a Caja, venta con tarjeta manual, Pedidos y logout; sin apertura/cierre de turnos, acceso comercial ni administración de empleados. |
| Cliente | Menú móvil → solicitud → seguimiento automático → revisión por negocio → reserva → preparación/listo → cobro → entrega. Notas conservadas y sin datos privados en seguimiento. |
| Abastecimiento | Inventario, reposición, compra, proveedor y recepción parcial/total; reservas, dinero y existencias conciliados contra API. |
| Servicio | Cliente → cita y cambio de horario → venta vinculada → historial; atención postventa y lealtad con devolución y canje reales. |
| Operación | Pendientes, oportunidades, cotizaciones, bandeja, postventa, automatizaciones y conciliación. Lectura productiva y escenarios locales. |
| Configuración | Perfil, sucursales/traspasos, recibo/cajón, empleados, formato/zona, solicitudes fiscales, suscripción y ventas pendientes. Sin mutar configuración productiva. |

Se verificaron layouts de 320/390/768/1440 px en los escenarios aplicables;
la aceptación adicional de los cuatro roles conserva capturas a 390/768/1440 px.
Las suites de navegador cubren teclado, foco, axe, movimiento reducido, errores,
sin conexión, roles y estados de suscripción. No se realizó una sesión con lector
de pantalla ni una prueba de impresora/cajón físico.

## Fricciones corregidas

1. **Pedidos sin siguiente paso para el cliente.** El envío con seguimiento válido abre
   directamente el estado. La consulta periódica se pausa sin conexión/con pestaña oculta,
   evita solicitudes simultáneas y se detiene en estados finales. Se puede copiar el enlace.
   Consultas generales y respuestas antiguas conservan confirmación. Véase auditoría vinculada.
2. **Recaptura durante la revisión.** Se registra y selecciona al cliente dentro del diálogo;
   productos, notas y confirmación explícita se conservan. Las indicaciones originales llegan
   al detalle privado y al cajero autorizado; se elimina el UUID de la nota generada.
3. **Horas destacadas sin ventas.** El panel usaba un ordenamiento diferente de Análisis y
   destacaba horas con $0 o valores negativos. Ahora reutiliza `reports/hours`: sólo ventas
   netas positivas, mismo orden y cierre de medianoche `23:00–00:00`. No cambia métricas.
4. **Inventario disponible confundido con físico.** Las alertas usan `available_quantity`,
   muestran cuándo todo está reservado y las filas distinguen disponible/reservado.
   La cifra física y el cálculo del ajuste siguen usando existencias físicas.
5. **Agenda bloqueada antes de comenzar.** El CTA vacío abre el alta de persona/espacio y
   enfoca su nombre. Carga y error no se interpretan como ausencia de recursos.
6. **Pérdida de continuidad al dar de alta un proveedor.** Desde la compra se abre el alta;
   al guardar, se selecciona el proveedor devuelto por el backend y se vuelve a la compra
   conservando productos, cantidades, costos y notas. Se mantiene revisión antes de crearla.
7. **Reposición deshabilitada sin explicación inmediata.** Indica si falta selección,
   proveedor o cantidades/costos válidos. Se conserva la revisión y aprobación en dos pasos.
8. **WhatsApp con checklist para desarrolladores.** La respuesta de preparación conserva
   claves/estados/gates, con instrucciones para el negocio. La guía queda plegada y se añade
   un enlace de soporte. Abrir la guía o pedir ayuda no activa ni envía mensajes.
9. **Diagnósticos y términos internos en tareas diarias.** Pendientes explica dónde continuar;
   los conflictos solicitan revisar datos actualizados. El panel resume las ventas pendientes
   del equipo sin enumerar contadores vacíos; conserva errores y recuperación con soporte.
10. **Roles y suscripción poco claros.** `staff` se presenta como Colaborador, el estado de
    conexión como En línea y la suscripción activa evita “checkout”. La descripción del gerente
    ya no promete administrar empleados; el permiso real continúa siendo sólo del propietario.

## Archivos y contratos

- `frontend/src/{dashboard,inventory,appointments,purchasing,replenishment,operationsQueue}`:
  instrucciones, CTA, continuidad y presentación de datos reales.
- `frontend/src/{layout,messaging,automations,i18n}`: roles, lenguaje y guía de conexión.
- `frontend/src/{storefront,orderTracking,crm,customerOrders,onboarding}` y
  `backend/app/{crm/order_intake.py,customer_orders/{service,schemas}.py}`:
  continuidad del pedido documentada en la auditoría previa.
- `backend/app/messaging/readiness.py`: sólo títulos/descripciones del checklist existente.
- Pruebas unitarias de las áreas modificadas; E2E de pedidos y compras;
  `specs/openapi.json`, `specs/storefront/order_acceptance_tracking.md` y contrato UX.

No se cambian migraciones, semillas, precios, planes, impuestos, permisos, RLS,
autenticación por cookies, gates de facturación ni semántica de pagos/devoluciones.
Se conserva la separación entre solicitar, confirmar, reservar, cobrar y entregar.

## Validación del corte

- Backend completo: **2,232 pruebas y 6 subpruebas aprobadas**, PostgreSQL UTF-8 aislado.
- Frontend completo: **1,660 pruebas aprobadas en 217 archivos**.
- Navegador sobre build: **332 escenarios aprobados**, 20 integraciones omitidas en ese
  modo y ejecutadas por separado con backend real. Sin reintentos que oculten fallos.
- Integración real: **20 recorridos aprobados**, sin interceptar APIs. Incluye aislamiento
  entre negocios, menú a entrega/postventa, agenda, lealtad y conciliación.
- Aceptación adicional por rol: **4 recorridos aprobados**, cuentas locales verificadas;
  cuatro ventas de $35.50, tres con efectivo/cambio $14.50 y cierre por $135.50,
  una tarjeta manual. Panel real: $142.00, cuatro tickets, cero turnos abiertos.
- Contratos de release: **128 aprobados y uno omitido por requerir Windows**.
- TypeScript, build/SSR/prerender, ESLint, Ruff, OpenAPI y revisión de bundle:
  **aprobados**. Bundle: 128 archivos JS sin patrones de secretos detectados.

Las expectativas actualizadas prueban el comportamiento solicitado: navegación automática,
estado de seguimiento dentro de su región y regreso automático a la compra con proveedor
seleccionado. Las aserciones de suscripción usan el nuevo texto sin “checkout” y conservan
la prohibición de iniciar una segunda contratación. El E2E de compra conserva payload, idempotencia y
recepción parcial, añadiendo la conservación del borrador. No se cambian fixtures ni se
debilitan expectativas financieras o de acceso para ocultar fallos.

El primer backend completo tropezó con bases temporales SQL_ASCII heredadas del clúster
local; se repitió íntegramente en un clúster UTF-8 nuevo. El escenario de compras anterior
cerraba el formulario al pulsar un CTA que ahora ya estaba abierto: se actualizó el recorrido
para comprobar la continuidad pedida. La aceptación temporal por rol corrigió una ruta de
lectura inexistente y un selector de botón que correspondía a un radio. No requirió cambiar
implementación de autenticación o permisos.

## Criterios de producto y publicación

Como referencia de continuidad se consultaron la
[página de estado de Shopify](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/order-confirmation-numbers)
y la [operación de caja de Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session).
Se aplicaron a orientación y claridad; no se adoptaron proveedores ni se prometieron sus capacidades.

La producción contiene registros persistidos con nombres de QA/prueba. No son mensajes
de la interfaz. No se ocultan ni eliminan registros operativos/financieros durante esta revisión;
su depuración es trabajo separado con decisión del dueño y trazabilidad.

La salida se publicó mediante el PR #283 y el release `4ae7c8f7182d`; backend y frontend
están coordinados por el campo opcional del mensaje original. La aceptación productiva
del recorrido está en la evidencia vinculada. Stripe live, entrega de correo, WhatsApp, CFDI y hardware físico
conservan sus verificaciones externas; esta aceptación local no acredita esos proveedores.

En futuras publicaciones: comprobar el menú y acceso, envío de un pedido autorizado al
seguimiento, revisión/confirmación, reserva, cobro y entrega; revisar consola/errores de API,
permisos del cajero y lectura del estado desde otro navegador. No crear un cobro bancario
ni activar proveedores como parte del smoke sin su aceptación específica.
