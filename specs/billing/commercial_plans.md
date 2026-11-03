# Planes comerciales, cohortes y capacidades

## Problema, usuarios y valor

El diseño aprobado distingue una oferta de operación diaria de otra de gestión. Necesita una
resolución autoritativa que preserve Standard y cortesías sin convertir flags temporales, roles o
la selección del navegador en permisos pagados. Usuarios: dueño, gerente, cajero y staff; soporte
interno solo bajo sus controles propios.

Estado: implementación local con pruebas de backend y migración aprobadas. La oferta nueva está
apagada por defecto; esta spec no
acredita publicación, aceptación de Stripe, dispositivos ni rentabilidad. Decisiones:
[ADR-019](../../docs/adr/ADR-019-commercial-plan-design.md) y
[ADR-020](../../docs/adr/ADR-020-commercial-plan-foundation.md).

## Requisitos funcionales

- Cohorte comercial persistida por negocio, con valor predeterminado Standard. Las altas opt-in
  se resuelven al crearse, sin reclasificar negocios por fechas o al cambiar la configuración.
- Standard anterior conserva $299 MXN/mes y el alcance comprometido. La cortesía permanente conserva
  [su contrato](complimentary_access.md), no ofrece Checkout y no oculta deuda de Stripe.
- Esencial y Gestión son $399 y $699 MXN mensuales finales propuestos, respectivamente. Antes de
  activar, el precio de Stripe debe coincidir con moneda, importe, intervalo y tratamiento fiscal.
- El estado autenticado añade `plan_code`, `plan_name`, `features` y `limits`, también para empleados
  que no pueden administrar facturación. Facturación añade catálogo `available_plans` e indicador
  `tiered_pricing_enabled`. No exponer claves ni datos privados del proveedor.
- La configuración de nuevas ofertas no sustituye la resolución de una asignación existente.
  Desactivarla no amplía ni borra permisos comerciales.
- Códigos de plan: `standard`, `esencial`, `gestion`; un estado no reconocido o no verificable se
  comunica como `unknown`, sin capacidades de Gestión. Los nombres e importes no identifican un
  precio: la correspondencia se verifica contra IDs de Stripe configurados.
- `Tenant.billing_cohort` conserva `standard` por defecto; `tiered` identifica altas de la nueva
  oferta. `BILLING_TIERED_PLANS_ENABLED` es falso por defecto. Solo habilita altas/ofertas cuando
  existen dos Price IDs nuevos distintos entre sí y del anterior, y configuración de Checkout.
- La cohorte nueva evalúa Gestión durante la prueba finita ya existente, sin extenderla. El
  snapshot de funciones no sustituye `commercial_access.allowed` ni su fecha de vencimiento.
- `GET /billing/plans` devuelve además `offer_revision`, determinista para el catálogo público y
  la cohorte actuales, tanto con la oferta Standard como con Esencial/Gestión. Incluye los nombres,
  importes, impuestos, funciones y límites presentados; no depende de IDs o secretos de Stripe.
  Registro envía esa revisión en `billing_offer_revision`. Con la oferta nueva activa, ausente u
  obsoleta devuelve 409 antes de crear o recuperar una cuenta o enviar correo. Si se suministra
  una revisión obsoleta durante una desactivación, también devuelve 409. Con la oferta nueva
  apagada, Standard conserva compatibilidad con clientes anteriores que omiten el campo.
  Revisar la oferta y reintentar no migra acuerdos existentes ni confirma pago. El detalle del
  registro está en [Auth & Sessions](../auth/sessions.md).

### Matriz de capacidades

| Capacidad | Esencial | Gestión | Contrato |
|---|---|---|---|
| `pos` | Sí | Sí | Venta inmediata, pagos registrados, turnos, devoluciones, tickets y cola offline |
| `inventory` | Sí | Sí | Catálogo, existencias y ajustes básicos, con sus permisos y sucursal |
| `sales_reports` | Sí | Sí | Resumen de ventas y cifras básicas del negocio |
| `public_catalog` | Sí | Sí | Publicación del catálogo, enlace y QR |
| `purchasing` | No para nuevas operaciones | Sí | Proveedores y compras |
| `advanced_reports` | No | Sí | Análisis profundo, velocidad/cobertura y decisiones de reposición |
| `loyalty` | No para programas o acumulación nueva | Sí | Programa, altas y acumulación; los derechos devengados se conservan |
| `customer_orders` | No para nuevos compromisos | Sí | Pedidos operativos y solicitudes del menú que los originan |
| `quotes` | No para nuevas cotizaciones | Sí | Cotización y seguimiento comercial |

La matriz no altera el significado de pedido, venta o solicitud. `POST /api/v1/orders` es venta
inmediata de Caja y no se restringe por la capacidad `customer_orders`. La separación exacta de
recomendaciones y agregados no debe devolver por otro endpoint datos que el plan excluye.

### Datos y compromisos anteriores

Con acceso comercial vigente, la reducción de plan conserva lectura histórica y exportación de
compras, pedidos, cotizaciones y lealtad. Permite recibir cantidades ya comprometidas o cancelar
compras anteriores, completar/cobrar/cancelar pedidos anteriores y convertir una cotización previa
cuando su estado lo admite. Bloquea la edición que pueda aumentar partidas o compromisos y la
creación de nuevos proveedores, compras, pedidos, cotizaciones, programas o altas públicas.
No eliminar registros, alterar importes históricos, duplicar cobros ni invalidar el seguimiento de
un compromiso existente solo por bajar de plan.

Los puntos devengados pueden canjearse conforme a los controles de saldo, política, permisos e
idempotencia existentes. Cada venta conserva un snapshot privado `Order.loyalty_eligible`, fijado
por el servidor al crearla: falso para Esencial, verdadero para Gestión o Standard. Un trabajo
retrasado puede materializar puntos de ventas elegibles anteriores al downgrade; las ventas de
Esencial no generan puntos nuevos, incluso si después se vuelve a Gestión. No se crean programas
por una cuenta Esencial. Devoluciones y anulaciones conservan sus reversas y restituciones
exactamente una vez.

Si el negocio pierde acceso comercial por vencimiento o deuda, aplica
[la política comercial](access_control.md): no se usa la excepción de historial para eludir 402.
Exportación, privacidad y recuperación de facturación conservan sus rutas permitidas.

### Catálogo público, panel y asistente

- El menú y su QR siguen disponibles para Esencial cuando se cumplen publicación, actividad y
  facturación. No se cambia a 404 solo porque no tiene lealtad o pedidos comerciales.
- Las disponibilidades de nuevas altas de lealtad y nuevas solicitudes operativas se derivan del
  servidor. `requests_available` y `checkout_available` son falsas en Esencial, aunque el menú
  siga visible. Ocultar un botón no sustituye la validación de sus POST públicos.
- Los enlaces históricos conservan su proyección mínima y su expiración; no conceden permisos
  para otras APIs ni exponen contactos, notas o historial de pagos.
- El dashboard básico no devuelve dentro de sus agregados analítica de Gestión. El asistente y
  los trabajos respetan las mismas capacidades en sus fuentes de datos y efectos.

### Límites y prestaciones pendientes

No hay recargo por usuario ni SKU en esta entrega. Ambos planes incluyen una sucursal; el límite
se aplica al servicio compartido de creación, incluido el asistente, después de resolver replays
idempotentes. Las sucursales históricas se conservan. Standard mantiene su contrato anterior.
`limits.branches` expone el límite a la interfaz sin sustituir la validación del servidor.

Los límites implementados de imágenes son 250 MB para Esencial y 1 GiB para Gestión, con medición
y aplicación atómica mediante lock por tenant. Se suman los originales
`ProductImageFile.byte_size` de todo el negocio, sin
contar derivados de caché ni datos de otro tenant. Alcanzar almacenamiento no borra imágenes ni
ventas y no bloquea sincronizar ventas pendientes. Reemplazar una imagen considera su tamaño
anterior: una sustitución igual o menor sigue permitida tras un downgrade por encima de la cuota;
no se permite aumentar ese consumo. Las cargas concurrentes no pueden provocar sobregiro.

Una y tres cajas simultáneas son capacidad comercial propuesta, no una promesa de concurrencia ya
aceptada. No anunciar lease, reserva de dispositivo o capacidad física como implementados sin su
contrato y pruebas. El estado publicado de otros módulos está en
[current-sprint](../../docs/current-sprint.md): Gestión no activa por sí solo Gastos, CFDI,
WhatsApp, inferencia externa ni un modelo de impresora.

## API, permisos y datos

- La ampliación de respuestas es aditiva; recuperar sesión y facturación continúa disponible
  bajo sus permisos. El backend determina tenant, cohorte, plan y capacidades.
- RBAC, acceso comercial, plan y rollout son condiciones independientes; el plan no eleva roles.
- Los writes restringidos fallan antes de crear registros o consumir efectos externos. Reintentos
  de operaciones admitidas conservan idempotencia, versiones, locks y transacciones existentes.
- Los webhooks conservan firma, modo y evaluación temporal. Un Price desconocido o no verificable
  nunca habilita Gestión por defecto. No confiar en `plan_code`, nombre, precio o pago del navegador.
- El Portal conserva configuraciones explícitas por cohorte. Si permite cambiar plan y depende de
  programar reducciones al cierre del período, los dos Prices autorizados deben pertenecer a un
  solo Product: Stripe no admite ese downgrade entre Products distintos. Una configuración con
  cambios de plan habilitados y múltiples Products falla cerrada antes de crear la sesión. El
  catálogo con Products distintos sigue admitiendo Portal con cambios de plan deshabilitados
  para recuperación de pago, historial y cancelación; esto no activa ningún flag.
- Dos pestañas, distintos administradores o claves de reintento no pueden abrir contrataciones
  cobrables independientes para el mismo negocio. El intento y su payload se guardan antes de
  llamar a Stripe, con una clave de idempotencia compartida e inmutable. Un fallo de red conserva
  ese intento; no se resuelve creando otro. Una contratación abierta para otro plan produce una
  guía recuperable, sin segundo cobro. Una sesión completa se concilia antes de considerar otra.
  Solo una expiración verificada permite reemplazar el intento. La antigüedad local, por sí sola,
  no prueba que Stripe no haya cobrado.
- Una migración aditiva conserva cohortes previas, RLS, índices y grants. No baja datos al revertir
  una publicación ni aplica cambios masivos de suscripción.

### Checkout concurrente y recuperación

Cada negocio conserva un intento durable de Checkout, independiente de las claves de reintento de
las pestañas. Antes del HTTP a Stripe se confirma su clave externa y el payload elegido por el
servidor, sin almacenar la clave secreta del proveedor. Otro administrador o un cambio de URLs no
altera esos parámetros mientras el intento siga pendiente. Se revalidan usuario, permisos y sesión
tras los límites de transacción.

- Dos solicitudes de la misma oferta convergen a la misma sesión, aunque cambien de pestaña,
  administrador o clave de idempotencia del navegador. Una oferta distinta con un intento abierto
  devuelve conflicto; no se abre una segunda suscripción ni se cambia silenciosamente el plan.
- Un timeout o una respuesta incompleta conserva el resultado incierto. Un reintento seguro usa
  la misma clave Stripe y los mismos parámetros persistidos. Si no se obtuvo ID de sesión en
  23 horas, falla de forma cerrada y requiere conciliación; un vencimiento local no prueba que
  Stripe no creó un objeto. Ver [idempotencia de Stripe](https://docs.stripe.com/error-low-level#idempotency).
- Una sesión conocida se consulta al proveedor. Solo su expiración verificada permite sustituir
  ese intento. Una sesión completada se concilia contra la suscripción autoritativa antes de
  considerar otra contratación; completar Checkout no equivale a habilitar un plan por el cliente.
- La tabla privada de intentos conserva RLS forzado y una fila por tenant. Un rollback de esquema
  rechaza borrar intentos inciertos, abiertos o completados. No se presentan esos estados internos
  ni referencias del proveedor como instrucciones para el dueño.

## Offline y errores

La caja conserva [la cola vigente](../orders/offline_sync.md), sus UUID y su autorización temporal.
El frontend revalida sesión antes de sincronizar. Un cambio de plan no convierte ventas locales en
descartables ni consume reintentos mientras falta acceso. Las operaciones que ya eran online no
adquieren una segunda cola.

Errores distinguibles: 401 de sesión, 403 de RBAC, 402 de acceso comercial y restricción de capacidad
del plan con explicación segura. Una verificación pendiente no es una cancelación ni un estado
vacío. La UI nunca expone excepciones crudas ni invita a pagar otra suscripción con deuda vigente.

## Auditoría

Conservar las auditorías de facturación y mutaciones de dominio. Cuando se registre una decisión
de plan, guardar solo la referencia interna, capacidad/operación y resultado necesarios; no claves,
cookies, contactos ni payloads íntegros de Stripe. No simular un cambio de plan como un pago.

## Escenarios Gherkin

```gherkin
Scenario: Oferta apagada y negocio anterior
  Given un negocio de cohorte Standard con su acuerdo vigente
  When se prepara la nueva implementación sin activar las ofertas
  Then conserva el plan anterior y sus funciones comprometidas
  And no recibe una migración automática de Stripe

Scenario: Prueba de la nueva cohorte
  Given un negocio nuevo inscrito mediante la oferta habilitada
  When se consulta su sesión durante la prueba vigente
  Then puede evaluar Gestión sin modificar la duración de prueba
  And al vencer sigue la política comercial normal

Scenario: Activación entre ver precios y registrar el negocio
  Given una persona consultó la oferta Standard y conservó su revisión
  And la oferta Esencial y Gestión se activó antes de enviar el registro
  When envía la revisión anterior en billing_offer_revision
  Then recibe 409 con una indicación para revisar los precios actuales
  And no se crea una cuenta ni se envía correo de verificación
  When revisa la oferta actual y vuelve a enviar su registro
  Then el servidor crea la cohorte correspondiente a esa misma oferta

Scenario: Una capacidad no sustituye al permiso del rol
  Given un negocio Gestión con acceso comercial vigente
  And un cajero sin permiso para gestionar proveedores
  When intenta crear un proveedor
  Then la operación se rechaza sin crear registros

Scenario: Venta inmediata en Esencial
  Given un negocio Esencial con acceso comercial vigente
  When un cajero autorizado cobra una venta desde Caja
  Then la venta conserva sus pagos, inventario y ticket
  And no exige una capacidad de pedidos comerciales

Scenario: Nuevas compras requieren Gestión
  Given un negocio Esencial con acceso comercial vigente
  When el dueño intenta crear una compra por la API directa
  Then se rechaza la nueva operación sin efectos parciales

Scenario: Apagar ofertas no amplía permisos
  Given un negocio asignado a Esencial
  When se desactivan las ofertas para nuevas altas
  Then conserva las capacidades de Esencial
  And no hereda el alcance de Standard o Gestión

Scenario: Historial tras reducir un plan
  Given un negocio que conserva acceso comercial y reduce Gestión a Esencial
  And tiene pedidos, compras y cotizaciones anteriores
  When el dueño consulta el historial o exporta su cuenta
  Then conserva sus registros y puede resolver los compromisos admitidos
  And no puede crear nuevas operaciones que requieran Gestión

Scenario: Puntos anteriores conservados
  Given un cliente con puntos devengados antes de reducir el plan
  When un cajero autorizado aplica una recompensa vigente
  Then se conserva el canje atómico y su idempotencia
  And no se acumulan nuevos puntos bajo Esencial

Scenario: Venta offline pendiente al cambiar de plan
  Given una venta de Caja pendiente de sincronización con su UUID
  When cambia el plan y el servidor revalida la sesión
  Then la cola conserva la venta y su UUID
  And un reintento admitido no duplica venta, pago ni inventario
```

## Matriz de aceptación

| Área | Comprobación |
|---|---|
| Backend y PostgreSQL | Cohortes, acceso por rol/plan, RLS, idempotencia y registros conservados |
| Stripe sandbox | Catálogo, precio final, eventos repetidos/fuera de orden y asignación autoritativa |
| Público | Menú/QR básicos, POST sin capacidad y lecturas históricas sin PII |
| Agregados | Sin fuga por dashboard, herramientas del asistente o trabajos |
| Frontend | Navegación, error de plan, 390/1440 px, teclado y ausencia de promesas no aceptadas |
| Offline | Revalidación, cola persistente y ventas sin duplicados |
| Límites | Bytes actuales/nuevos, reemplazo, concurrencia y capacidad de caja no inventada |
| Comercial | Costo/tiempo medidos, sin inventar facturas, tarifas de trabajo ni utilidad |

La ejecución y resultados se registran aparte según
[la guía de aceptación](../../docs/runbooks/commercial-plan-acceptance.md). Los escenarios de este
documento no acreditan por sí solos pruebas ejecutadas ni operación productiva.
