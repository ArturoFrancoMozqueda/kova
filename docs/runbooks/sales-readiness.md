# Preparación comercial y aceptación de Kova

Corte: 17 de noviembre de 2026, Ciudad de México. Este registro distingue una corrección técnica,
una prueba con datos desechables y la aceptación por un negocio. No asigna una puntuación de
preparación ni convierte una prueba automática en satisfacción, cumplimiento legal o disponibilidad
garantizada. La publicación de las correcciones se acredita por su PR y release.

## Oferta que se puede presentar

Caja, ventas, turnos, inventario, reportes y catálogo público forman el núcleo de Esencial.
Gestión incorpora las capacidades adicionales admitidas por el servidor. La fuente es
[`plans.py`](../../backend/app/billing/plans.py), el catálogo público de la API y el
[contrato comercial](../../specs/billing/commercial_plans.md), con Esencial $399 y Gestión
$699 MXN mensuales, precios inclusivos. Standard $299 corresponde a acuerdos anteriores.

La venta inicial es acompañada y sigue sujeta a las aceptaciones de cada negocio. WhatsApp,
CFDI, terminal integrada y equipos certificados conservan sus gates propios; no se ofrecen
como incluidos y listos a partir de la disponibilidad del núcleo POS.

## Evidencia y pendientes

| Frente | Evidencia disponible | Qué queda por aceptar |
|---|---|---|
| Publicación | Release `44217617849` aprobado; frontend, API y proxy observados en `606b870076a4`, base accesible. Las correcciones de este corte requieren su propio CI y release. | Comprobar la versión publicada al terminar el PR. |
| Caja y offline | Circuitos con build real, API y PostgreSQL/RLS: ventas, pagos divididos, devoluciones, corte y reconexión sin duplicados. Repetición actual aprobada entre los 23 recorridos de navegador registrados abajo. | Conteo humano en los equipos del negocio. |
| Cuenta y portabilidad | 151 pruebas backend aprobadas en este corte, incluidas exportación ZIP/CSV, neutralización de fórmulas, autorización, cancelación reversible, purga y RLS. La nueva secuencia comprueba sesión y login denegados tras la purga y otro negocio intacto. Descarga y programación/cancelación desde UI aprobadas a 390/1440 px. | Aceptación del dueño del proceso de retención. La prueba mueve sólo el vencimiento de una solicitud desechable, no espera 30 días reales. |
| Suscripción | Cobro live de Esencial, activación y cancelación ya comprobados; bienvenida desde conciliación del Checkout pagado entregada. [Alcance](commercial-plan-acceptance.md#evidencia-vigente). | Recibo actual disparado por un pago real y compra nueva posterior a las correcciones. No crear cargos ni reactivar una renovación sin autorización concreta. |
| Soporte | `soporte@kovasuite.com` reenvía a `posprojectsupport@gmail.com`; recepción real ya probada. El dueño eligió responder desde Gmail; su identidad SMTP externa se retiró y Gmail quedó como único remitente tras recargar ajustes. | Responsable, cobertura y una conversación de ida y respuesta con un piloto. No se declara tiempo de respuesta o resolución medido. |
| Correo transaccional | Dominio y plantillas disponibles; pruebas backend de recibo y bienvenida incluidas en los 151 casos. [Evidencia con fecha y cliente](../email-deliverability.md). | Enlaces y disparadores reales restantes; presentación móvil/oscura y Outlook/Hotmail. Muestras de plantilla no acreditan un disparador de pago. |
| Respaldo | Restore lógico real anterior: integridad, RLS, login, exportación y limpieza. [Procedimiento](restore-supabase-backup.md). El workflow actualizado está preparado para ejecutar una copia aislada del último backup. | Autorización para dispararlo y resultado de esta nueva ejecución. Recuperación regional, cambio de tráfico y RTO/RPO del servicio completo permanecen separados. |
| Tareas programadas | Las dos últimas ejecuciones consultadas de backup, purga, recordatorios y borradores globales concluyeron en `success`. Últimas del 17 de noviembre: [backup](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44145099785), [purga](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44139299771), [recordatorios](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44112734307) y [borradores](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44176117678). | El resultado de un job no prueba entrega de cada correo ni recuperación regional. Conservar vigilancia y atención de fallos. |
| Seguridad de dependencias | Auditoría actual de los cuatro locks aprobada con verificación de fuentes y catálogo upstream; cuatro pruebas del instalador/verificador aprobadas. Los reportes originales conservan los avisos. | Picomatch oficial sigue en 4.0.7 sin versión corregida declarada. La revisión local vence el **24 de noviembre a las 18:41:40 CDMX** y exige sustitución oficial o revisión nueva sustentada; no se prolonga por este corte. [Expediente](../audits/PICOMATCH-2026-11-17.md). |
| Claridad comercial | Acuerdo y alta alineados a Esencial/Gestión, sin ofrecer Standard a altas nuevas ni prometer corrección en cuatro horas. Textos públicos ajustados al acceso comercial y al alcance real del restore. | Revisión profesional y aceptación de las partes; completar identidades en privado. |
| Experiencia con personas | Instrumentación agregada de intentos/resultados y tiempos disponible con su [semántica](../../specs/reports/task_experience.md). Hay pruebas automáticas y QA a 390/1440 px. | Observar al dueño y pilotos completando tareas; registrar ayuda, errores y dificultad percibida sin inventar tasas. |

## Sesión de aceptación con el dueño — 30 minutos

Antes de empezar, identificar el negocio y equipo, anotar inventario inicial y efectivo contado
y acordar las operaciones. Los ensayos usan un negocio de QA separado. En un negocio real sólo
se registran ventas, devoluciones y ajustes reales autorizados; no se crean ingresos de prueba.

1. **5 minutos:** confirmar giro, productos, costo, existencias y métodos de cobro. El dueño
   explica qué entiende que incluye su plan y dónde pediría ayuda.
2. **10 minutos:** abrir turno con efectivo contado, realizar una venta y, en QA, un pago
   dividido y una devolución. Encontrar la venta y su comprobante sin ayuda inicial.
3. **5 minutos:** en el equipo de QA ya preparado, perder conexión, registrar una venta y
   reconectar. Verificar una sola venta, pago y salida de inventario. Conservar cualquier
   pendiente hasta resolver su estado; no borrar datos del navegador para ocultarlo.
4. **5 minutos:** cierre con conteo humano, diferencia explicada, inventario y reporte. En QA
   exportar la cuenta y programar/cancelar su eliminación, sin solicitarla en un negocio real.
5. **5 minutos:** por cada tarea, registrar terminado/no terminado, ayuda necesaria, error,
   tiempo observado y dificultad de 1 a 5. Preguntar qué quedó confuso y acordar seguimiento.

Registro privado por negocio: fecha, responsable, equipo/OS/navegador, plan, tareas, resultados,
diferencias de caja/inventario, defecto y reproducción, próxima acción y aceptación del dueño.
No guardar datos de clientes, contraseñas, documentos fiscales o firmas en git. La
[matriz de hardware](pos-hardware-acceptance.md) añade papel, lector y cajón cuando se ofrezcan.

## Lo que debe aportar el dueño

- Nombre e identidad legal del proveedor y contacto contractual, completados en privado con
  revisión profesional del acuerdo y aviso de privacidad. La plantilla no certifica cumplimiento.
- Responsable de soporte y escalación, aceptación del horario publicado de lunes a viernes
  de 9:00 a 19:00 CDMX y contacto del piloto que recibirá las actualizaciones.
- Modelos de computadora, tablet y teléfono; OS/navegador y, si se incluyen, impresora,
  lector y cajón disponibles para probar. No hace falta elegir ni comprar un kit para este registro.
- Un espacio de 30 minutos y un negocio de QA o una operación real autorizada, con conteo de
  efectivo y existencias. Para medir comprensión hacen falta personas, no sólo automatización.
- Para el correo de pago: elegir una compra legítima de aceptación, el plan/importe y el buzón
  propio; autorizar el cargo concreto y completar el pago. El agente no hace cobros por inferencia.
- Para Outlook/Hotmail: un buzón propio o autorizado y autorización explícita de las muestras
  y su cantidad. No se solicita acceso a buzones de terceros ni contraseñas por chat.
- Para el restore: autorizar el workflow ya revisado en `main`. Un simulacro regional completo
  necesita además destino, límites de gasto y un procedimiento revisado antes de cambiar tráfico.

## Validación de este corte

- Backend con PostgreSQL desechable: **151 casos aprobados** en cuenta, fiscal/purga, recibo,
  bienvenida, plantillas, acceso comercial, orden temporal, conciliación, Checkout y RLS.
- Frontend focalizado: **23 pruebas aprobadas** de textos públicos, Ayuda y recuperación de
  Configuración. Ruff y verificación del diff aprobados.
- Auditoría de los cuatro locks: aprobada; fuentes y regresiones de la corrección local
  verificadas, avisos originales conservados y revisión temporal sin cambios.
- Navegador sobre el build con API y PostgreSQL/RLS reales: **23 casos aprobados**, cero
  omisiones, fallos, casos intermitentes o reintentos. Incluye cuenta a 390/1440 px, Caja,
  corte, offline, catálogo, recuperación de pedidos y Pendientes. Datos y servicios locales
  desechables; no se crearon operaciones de clientes ni se enviaron correos externos.
- Lint y tipos de frontend aprobados; **35 contratos de repositorio y 3 subtests aprobados**.
- QA visual en navegador de `/terms` y `/seguridad` a 390/1440 px: texto actual visible y sin
  desbordamiento horizontal; navegación por teclado con foco visible en los enlaces legales.
- Publicación: pendiente de registrar al completar PR, CI required y release.

Este registro no prueba equipos físicos, un nuevo cobro live, un recibo real nuevo, firmas,
recuperación regional ni satisfacción de clientes. Cada fila conserva su propia aceptación.
