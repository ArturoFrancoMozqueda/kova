# Aceptación y medición de los planes comerciales

Guía para preparar Esencial/Gestión sin modificar precios ni suscripciones productivas. La
dirección aprobada está en [ADR-019](../adr/ADR-019-commercial-plan-design.md). Una lista revisada
no acredita implementación, publicación, aceptación de Stripe ni rentabilidad observada.

## Evidencia y entorno

- Registrar el commit, entorno, fecha y resultado de cada prueba. Separar validación local,
  integración con sandbox y aceptación productiva.
- Usar PostgreSQL desechable, cuentas sintéticas y el sandbox dedicado. No reutilizar una cuenta
  live para completar una prueba pendiente. El [drill de Stripe](stripe-sandbox-drill.md) vigente
  valida Standard; no dar por probado el nuevo catálogo solo porque ese drill pase.
- Mantener fuera de git claves, cookies, direcciones de clientes, IDs de tenant y capturas con
  datos reales. Conservar evidencia operativa privada y publicar solo resultados agregados.
- La aprobación de diseño no contrata ampliaciones de proveedores ni autoriza publicar la oferta.

## Qué debe demostrar la aceptación

| Caso | Evidencia necesaria |
|---|---|
| Oferta apagada | Un alta normal conserva la oferta anterior y no ve precios futuros ni pierde funciones |
| Standard anterior | Conserva importe, acceso, renovación y funciones comprometidas |
| Cortesía permanente | No vence, no ofrece checkout, no aparenta una suscripción pagada y conserva su alcance |
| Esencial | Caja, turnos, inventario básico, tickets, clientes, catálogo/QR y offline siguen operables |
| Gestión | Las funciones adicionales se resuelven por el servidor, además de sus permisos RBAC y rollout |
| Acceso directo | Abrir una URL o llamar una API no concede una función excluida del plan |
| Otras superficies | Panel, asistente, catálogo público y trabajos no eluden los mismos permisos comerciales |
| Checkout | Solo precios admitidos y correspondientes al entorno; nunca un importe enviado por el cliente |
| Dos contrataciones | Pestañas, administradores y claves distintas convergen al mismo intento; un timeout no abre otro y solo se reemplaza tras expiración verificada |
| Confirmación | Volver desde Stripe no activa por sí solo acceso ni funciones de pago |
| Checkout concurrente | Dos pestañas o administradores comparten un intento durable y una sesión; cambiar de oferta pendiente muestra conflicto |
| Resultado incierto | Timeout y pérdida del proceso conservan clave/payload; sin ID después de 23 horas se exige conciliación, sin un nuevo cobro |
| Webhooks | Firma, modo, duplicados y orden temporal conservan sus controles |
| Plan desconocido | No se inventa un plan ni se concede Gestión por un dato que no puede verificarse |
| Oferta desactivada después | Desactivar nuevas altas no amplía permisos de una asignación Esencial existente |
| Historial | Reducir un plan no elimina registros ni impide el ejercicio de exportación de la cuenta |
| Compromisos pendientes | La política de transición trata pedidos, compras y recompensas pendientes de forma explícita |
| Lealtad diferida | El trabajo materializa puntos ganados en ventas elegibles previas; las ventas Esencial no acumulan puntos al volver a Gestión |
| Fotos | Cuenta originales del tenant completo; permite sustituir por igual o menor tamaño sobre cuota y bloquea aumentos |
| Offline | Cambio de plan y revalidación preservan UUID, cola, importes históricos e idempotencia de ventas |
| Caducidad comercial | Perder acceso por falta de pago conserva el gate de facturación, aunque exista historial |
| Datos ajenos | Planes y límites siempre usan el tenant de sesión; RLS/RBAC y las sucursales siguen vigentes |

La transición de un plan, el límite de imágenes y la concurrencia se prueban únicamente contra el
contrato realmente implementado. Si no están disponibles, registrarlos pendientes y no anunciarlos
como prestaciones garantizadas. No introducir una reducción productiva para probar esos casos.

## QA de interfaz

Revisar a 390 y 1440 px y con teclado:

- Suscripción explica el plan, precio final, estado verificado y acción disponible sin exponer IDs.
- La navegación no promete funciones que la sesión no tiene. Una restricción de plan se distingue
  de falta de permiso, carga, error y ausencia de datos.
- Lectura y exportación del historial respetan la política de transición; ninguna pantalla induce
  a volver a pagar una suscripción existente con deuda.
- Cada plan permite vender, imprimir el ticket y cerrar caja con su flujo completo. El hardware se
  acepta por separado según la [matriz de equipos](pos-hardware-acceptance.md).
- Sin conexión, las ventas conservan el [contrato offline](../../specs/orders/offline_sync.md);
  recuperar red revalida sesión antes de sincronizar.
- No ofrecer Gastos, CFDI, WhatsApp, inferencia externa ni garantías de hardware solo por aparecer
  en un catálogo de planes. Consultar [el estado real](../current-sprint.md).

## Oferta pública y SEO antes de activar

El controlador nativo fija `BILLING_TIERED_PLANS_ENABLED=false` y
`BILLING_PORTAL_ENABLED=false` en esta publicación, incluso ante valores externos diferentes.
La activación futura requiere otro cambio revisado que retire esa protección, además de la
configuración y aceptación de Stripe. No modificar el Price de Standard ni migrar acuerdos.

Esta verificación no activa la oferta ni cambia Stripe. En un entorno controlado:

- Con la oferta apagada, landing, registro y facturación presentan el catálogo público vigente;
  títulos, descripciones, datos estructurados y HTML prerenderizado no anuncian precios futuros.
- Al probar la activación con configuración completa, el catálogo público presenta los mismos
  nombres, moneda, periodicidad e importes finales que las ofertas validadas por el backend.
- Revisar HTML inicial, metadatos SEO y contenido tras hidratar o recargar. Verificar también una
  sesión anterior y un negocio Standard: la publicidad nueva no modifica su acuerdo.
- Si falla la consulta del catálogo, mostrar carga o un error recuperable; no inventar un precio
  de respaldo ni presentar una oferta de otro entorno. Comprobar la invalidación de caché para que
  una activación o desactivación no mantenga copy y precios contradictorios.

La aprobación de QA local no sustituye la aceptación fiscal, Stripe sandbox ni la autorización
separada para publicar precios y ofertas productivas.

## Evidencia local del 2 de noviembre de 2026

Evidencia obtenida del árbol de trabajo antes del commit y la publicación. PostgreSQL 16 desechable;
sin datos comerciales ni credenciales productivas. Las interacciones de Stripe en estas pruebas
usan dobles controlados: no acreditan aceptación del proveedor.

- Primera ejecución conjunta: **47 pruebas aprobadas** en `test_billing_tiered_plans.py` (29),
  `test_commercial_plan_boundaries.py` (14), `test_commercial_plan_image_concurrency.py` (1) y
  `migration_tests/test_0100_commercial_plans.py` (3).
- La carrera de imágenes usa dos conexiones reales del rol `kova_app`, sujeto a RLS: la segunda
  espera el lock y no puede rebasar la cuota después del commit de la primera.
- Las regresiones existentes de facturación, ventas, lealtad, dashboard, CRM, catálogo público,
  asistente, imágenes y aislamiento entre tenants aprobaron en lotes separados. No sumar esos
  lotes como pruebas únicas: algunos escenarios se repitieron tras las correcciones.
- Ruff de backend y los 28 tests del controlador nativo aprobaron. El contrato OpenAPI se
  regeneró para la API ampliada.
- Tras cerrar el riesgo de dos contrataciones cobrables, aprobaron **250 pruebas de facturación
  y ciclo de cuenta** sobre PostgreSQL, incluidas recuperación ante timeout y eliminación pendiente.
  Además aprobaron dos pruebas de migración 0101 y una carrera real entre administradores con
  conexiones `kova_app`, que verifica la reserva durable antes del HTTP y una sola sesión Stripe.
- Cierre de backend: **105 pruebas conjuntas aprobadas** de planes, fronteras comerciales,
  recuperación de Checkout, ambas migraciones, carreras de cuota/contratación y postura RLS.
  Ruff completo y `export_openapi.py --check` aprobaron sobre el estado final.
- Frontend: build cliente/SSR/prerender, tipos, lint y contrato API aprobados. **34 pruebas de
  Playwright sobre build** cubren planes, acuerdos anteriores y SEO a 390/1440 px. Las APIs externas
  están simuladas. Se revisaron capturas; esto no acredita un dispositivo ni una impresora física.
  La suite unitaria completa pasó 1732 de 1734 inicialmente; tras corregir dos contextos de prueba,
  sus 18 casos pasaron al repetir ambos archivos. No se repitió toda la suite. El último ajuste
  de guía de Checkout en conflicto pasó sus 26 pruebas de Billing y se incluyó en un nuevo build.

Un intento incierto sin ID después de 23 horas o un resultado cobrable no resuelto detiene la
creación de otro Checkout y el purge de la cuenta. Requiere conciliación operativa con Stripe;
no se borra la fila ni se inventa un estado terminal para desbloquearlo. La solicitud de
eliminación y los datos permanecen conservados mientras el trabajo de purge reporta el incidente.

Pendientes antes de activar: aceptación Stripe sandbox del catálogo/Portal y sus transiciones,
validación fiscal, autorización para publicar y seguimiento de consumo/atención. Cajas
simultáneas y hardware siguen sujetos a su aceptación específica.

## Preparación de Stripe del 3 de noviembre de 2026

Se prepararon dos productos y precios nuevos en el sandbox privado existente: Esencial de
MXN 399.00 y Gestión de MXN 699.00, mensuales, con `tax_behavior=inclusive`. Se conservaron los
productos y precios anteriores. Los IDs de configuración y capturas quedan como evidencia
operativa privada, fuera de git.

Se crearon dos configuraciones de Portal: una sin cambios de plan para acuerdos anteriores y
otra que admite únicamente los dos precios nuevos, sin cantidades ajustables. Esta última usa
`always_invoice` para mejoras y programa las reducciones al final del periodo. No se generó
una página de acceso público al Portal.

Con identidades y tarjetas sintéticas, el proveedor confirmó:

- Checkout pagado de Esencial por MXN 399.00.
- Mejora a Gestión con factura de prorrateo pagada y mensualidad de MXN 699.00.
- Reducción programada a Esencial, conservando Gestión durante el periodo pagado.
- Cancelación programada al final del periodo.
- Configuración de acuerdos anteriores sin acción para cambiar de plan.
- Checkout de Gestión rechazado que siguió pendiente y se recuperó en la misma sesión, con
  pago confirmado por MXN 699.00.

Esto acredita recorridos alojados de Stripe, no la sincronización de esos estados con Kova.
No se vinculó ningún tenant productivo ni se probaron renovaciones de los nuevos planes. La
programación de una reducción no acredita su aplicación efectiva al vencer: adelantar un Test
Clock de Stripe no adelanta el reloj del backend.

Se deshabilitó únicamente el webhook del sandbox que apuntaba al despliegue retirado de Fly.
El drill usa un receptor efímero aislado; no debe sustituirse ese destino por la API productiva.
El webhook live se revisó sin modificaciones y conserva el destino de la API vigente de Kova.

La aceptación mostró que Stripe omite los productos del Portal si no se solicitan con
`expand[]=features.subscription_update.products`. El cliente de Kova ahora solicita esa
expansión y la validación rechaza cantidades ajustables. Cinco pruebas aisladas verifican el
request HTTP y esas restricciones sin usar credenciales ni una base de datos.

La cuenta real reportó cobros y depósitos habilitados, sin requisitos vencidos, pero no se
encontraron registros fiscales activos en Stripe Tax. No se activó cálculo automático ni se
crearon registros fiscales. El comportamiento inclusivo del precio no sustituye esa validación.

La oferta productiva sigue apagada y Standard conserva MXN 299.00. El runner ya admite seleccionar
Standard, Esencial o Gestión y comprueba los importes, funciones y acceso de Kova, según el
[runbook del simulacro](stripe-sandbox-drill.md). Sus 64 pruebas aisladas pasaron; su ejecución con
el proveedor para los planes nuevos sigue pendiente de instalar la clave del sandbox directamente
en el Secret store, nunca en chat ni archivos. Las referencias a ambos precios nuevos ya están
configuradas únicamente en el entorno `stripe-sandbox` de GitHub.

Se eliminaron los dos clientes sintéticos de los recorridos alojados, cancelando sus suscripciones
de prueba; se conservaron el catálogo y las configuraciones del Portal para la aceptación posterior.
El perfil heredado del sandbox todavía reporta requisitos de dirección vencidos y capacidades
inactivas, aunque permitió completar pagos simulados. Esto no acredita habilitación de cobros ni
depósitos en ese sandbox; la revisión de habilitación live descrita arriba corresponde a otra cuenta.

Permanecen pendientes la aceptación integrada de ambos planes, las transiciones mediante el Portal
de Kova, su aplicación efectiva al vencer, la validación fiscal y la autorización para publicar
la oferta. La evidencia del proveedor y las pruebas locales no cierran esos gates por sí solas.

## Registro de trabajo y consumo

Responsable: el dueño o la persona que designe. Usar un registro operativo protegido fuera del
repositorio. No se requiere contratar otra herramienta; Kova Ops no se presenta como un registro
de horas ya implementado.

### Atención y trabajo

Registrar por intervención:

| Campo | Significado |
|---|---|
| Fecha | Día de la intervención y periodo de medición |
| Referencia interna | Negocio o caso, sin copiar nombres, correos ni mensajes en el reporte agregado |
| Categoría | Alta, migración, capacitación, falla, mantenimiento o desarrollo nuevo |
| Minutos | Trabajo efectivamente realizado, separado de espera y tiempo automático de herramientas |
| Alcance | Por negocio o compartido por la plataforma |
| Resultado | Resuelto, pendiente o requiere seguimiento |

Separar trabajo inicial de atención recurrente y correcciones de nuevas funcionalidades. Conservar
las horas aunque todavía no exista tarifa. La remuneración del dueño debe elegirse explícitamente;
no asignar $300/h, 20 horas mensuales ni una mensualidad de mantenimiento por defecto.

### Proveedores

Conservar proveedor, periodo, moneda original, factura o lectura de consumo, unidad y tratamiento
de impuestos. Distinguir importe pagado, consumo acumulado, crédito comprado y proyección. Una
factura de migración no equivale al costo futuro de un mes estable.

Si la unidad no se puede atribuir de forma fiable a un negocio, marcarla compartida. Un reparto de
esa factura por cantidad de clientes es una asignación de presupuesto, no un consumo medido por
tenant. Excluir actividad de QA al estimar demanda comercial, o declararla explícitamente.

La transferencia de la base, la cuota diaria de correo y los costos de errores o contracargos se
revisan separados. No confundir saldo de Stripe, ingreso sin impuestos, caja disponible después del
cobro, contribución y utilidad final. Los gastos desconocidos permanecen pendientes, no en cero.

## Revisión comercial

Revisar los registros con los primeros pagos y renovaciones: oferta presentada, elección conocida,
atención por negocio, consumo compartido y renovaciones confirmadas. Una muestra pequeña orienta;
no demuestra una tasa estable de conversión, soporte o contracargos.

Antes de afirmar rentabilidad, completar costos pendientes, definir la remuneración elegida y
separar implementación inicial, adquisición y operación recurrente. No reutilizar la estimación
retirada de $9,600 mensuales ni el supuesto de equilibrio en 32 clientes como hechos del negocio.
