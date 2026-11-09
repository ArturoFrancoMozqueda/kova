# Aceptación y medición de los planes comerciales

Guía de aceptación de Esencial/Gestión y su activación productiva autorizada en
[ADR-021](../adr/ADR-021-commercial-production-activation.md), conservando Standard y cortesías.
El diseño original está en [ADR-019](../adr/ADR-019-commercial-plan-design.md). Una lista revisada
no acredita publicación, aceptación del Portal, cobro live, validación fiscal ni rentabilidad.
La aceptación interactiva sandbox de los tres planes ya está
[registrada](../audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md), con fuentes por
etapa y limpieza completa. El release de activación #316 se recuperó por discrepancia del catálogo.
[ADR-022](../adr/ADR-022-native-controller-boot-policy.md) exige ahora una baseline preparatoria OFF
con verificación del controlador al arrancar, seguida por una activación ON separada. La baseline
OFF del PR #317 es `d4d81d6a4fe67c9e12b3dc0cbb272698c50bb770`, con
[release 41860220621 aprobado](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41860220621)
y verificación externa de las seis rutas, catálogo Standard/OFF, marcadores de API/proxy e identidad
de proceso. Esta entrega contiene la activación ON con gate `tiered` y conserva el protocolo;
su publicación necesita su propio release y verificación externa registrada.

## Evidencia y entorno

- Registrar el commit, entorno, fecha y resultado de cada prueba. Separar validación local,
  integración con sandbox y aceptación productiva.
- Usar PostgreSQL desechable, cuentas sintéticas y el sandbox dedicado. No reutilizar una cuenta
  live para completar una prueba pendiente. El [drill de Stripe](stripe-sandbox-drill.md) selecciona
  Standard, Esencial o Gestión; cada ejecución acredita solo el alcance y plan de su evidencia.
- Mantener fuera de git claves, cookies, direcciones de clientes, IDs de tenant y capturas con
  datos reales. Conservar evidencia operativa privada y publicar solo resultados agregados.
- La autorización posterior del dueño permite alinear producción según ADR-021; no contrata
  ampliaciones de proveedores, migra acuerdos existentes ni aprueba transiciones autónomas.

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
| Portal básico inicial | Abre desde Kova; historial, guardado de método de pago y cancelación al cierre aceptados; sin cambios de plan/cantidad |
| Transiciones entre planes | Fuera del alcance inicial: no anunciar upgrade/downgrade autónomos; aceptar el Portal básico no los acredita |
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

La baseline preparatoria `7032d21f60aa`, verificada antes de esta entrega, fijaba
`BILLING_TIERED_PLANS_ENABLED=false` y `BILLING_PORTAL_ENABLED=false`, incluso ante valores
externos diferentes. La preparación del protocolo de arranque del PR #317 conserva ambas flags
en `false` y gate `standard`; su release aprobado y la verificación externa confirmaron el SHA
`d4d81d6a4fe67c9e12b3dc0cbb272698c50bb770` (run `41860220621`).
Esta entrega cambia ambas a `true` y el gate a `tiered`, conservando esa baseline para capturar sus
versiones exactas. El marcador y la
verificación del arranque se conservan tanto al activar como al recuperar la baseline OFF.
Cambiar solo variables externas no sustituye esa política.
No modificar el Price de Standard ni migrar acuerdos.

Antes de ejecutar el release de activación, registrar:

1. Baseline productiva aceptada con los cuatro IDs públicos en API y jobs; capturar sus versiones
   exactas para recuperar a OFF. No usar la baseline anterior al transporte ni retirar IDs al
   apagar ofertas: siguen resolviendo acuerdos tiered existentes.
2. Catálogo live verificado: dos Products, Prices activos distintos de Standard, 39900/69900 MXN,
   mensuales con intervalo 1 e inclusivos. Checkout mantiene su validación de modo y precios.
3. Evidencia integrada del Portal básico desde Kova en sandbox: método de pago guardado,
   cancelación al cierre, estado autoritativo e idempotencia; configuración sin cambios de plan
   ni cantidad. Registrar plan, fuente y limpieza. Un enlace que abre no acredita el guardado.
   La evidencia de Checkout de los tres planes conserva su alcance separado.
4. CI y release normal: catálogo/revisión de oferta por API y proxy, rechazo de registro obsoleto,
   Standard/cortesía conservados y recuperación por versiones capturadas. Solo declarar activa
   la oferta después de aprobar la publicación y su verificación pública.

Las transiciones entre planes no son un requisito del Portal básico inicial: permanecen
inhabilitadas y no se venden como prestaciones disponibles. El cobro live controlado, validación
fiscal, hardware físico y medición de costos/atención siguen abiertos; esta aceptación no los
cierra ni declara a Kova listo al 100%.

Esta revisión documental no activa la oferta ni cambia Stripe. En un entorno controlado:

- Con la oferta apagada, landing, registro y facturación presentan el catálogo público vigente;
  títulos, descripciones, datos estructurados y HTML prerenderizado no anuncian precios futuros.
- Al probar la activación con configuración completa, el catálogo público presenta los mismos
  nombres, moneda, periodicidad e importes finales que las ofertas validadas por el backend.
- Revisar HTML inicial, metadatos SEO y contenido tras hidratar o recargar. Verificar también una
  sesión anterior y un negocio Standard: la publicidad nueva no modifica su acuerdo.
- Si falla la consulta del catálogo, mostrar carga o un error recuperable; no inventar un precio
  de respaldo ni presentar una oferta de otro entorno. Comprobar la invalidación de caché para que
  una activación o desactivación no mantenga copy y precios contradictorios.

La aprobación de QA local no sustituye la aceptación integrada del Portal básico ni el release.
Los precios inclusivos no prueban registro fiscal, CFDI o aceptación contable. Mantener dichos
pendientes explícitos conforme a ADR-021, sin presentarlos como pruebas aprobadas.

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

Este corte local no acreditó los pasos externos. La autorización posterior y el alcance inicial
se rigen por ADR-021 y los criterios de activación anteriores; no exigen aceptar transiciones
que permanecen deshabilitadas. Validación fiscal, consumo/atención y hardware siguen pendientes
y no se consideran aprobados por esos criterios.

## Preparación de Stripe del 3 de noviembre de 2026

### Revisión posterior para alinear producción

Tras la nueva autorización del dueño se preparó el catálogo **live** con un Product por plan:
Esencial MXN 399.00 y Gestión MXN 699.00, activos, mensuales, intervalo 1 y `tax_behavior=inclusive`.
Los acuerdos anteriores de MXN 299.00 y las suscripciones existentes no se modificaron. Un Price
preliminar sin suscripciones quedó archivado y no debe instalarse como referencia de Gestión.
Los IDs finales viven en configuración operativa privada y en las cuatro variables no secretas
del entorno `production` de GitHub; crearlos no activa la oferta de Kova.

Se guardó un Portal básico live, inicialmente compartido por ambas cohortes: historial y cambio
de método de pago habilitados; cancelación `at_period_end`; cambios de plan/cantidad, pausa,
edición de información de cliente y página pública de acceso deshabilitados. El retorno es la
pantalla de Suscripción de Kova. Compartir esta configuración es seguro mientras no admita
cambios de plan; Standard nunca debe recibir una configuración que los habilite.

La [restricción documentada del Portal](https://docs.stripe.com/customer-management/configure-portal)
sólo permite reducciones al cierre entre precios del mismo Product. Se conserva la identidad
de cada plan en Checkout y comprobantes con Products separados, por lo que las transiciones
autónomas entre planes quedan deshabilitadas. La evidencia alojada descrita abajo corresponde
a la preparación anterior; **no acepta esa transición para el catálogo definitivo**. El backend
rechaza una configuración que pretenda habilitarla con varios Products. La aceptación del
Portal básico y la de cambios de plan deben registrarse por separado.

El código preparatorio añade revisión pública de oferta y rechazo 409 de un registro obsoleto
antes de crear tenant/enviar correo. La UI refresca y confirma la oferta sin perder el formulario;
volver al foco durante conciliación de Checkout no la interrumpe. El release compara la oferta
por API y proxy antes de promoción y después de publicación. Las banderas permanecieron apagadas
en la baseline `7032d21f60aa`. El intento #316 no aprobó publicación; la secuencia de ADR-022
prepara primero el protocolo OFF y exige configuración completa y release aprobado antes de
acreditar una activación posterior.

### Evidencia anterior del sandbox

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

En el corte previo a esta entrega, la oferta verificada era Standard MXN 299.00 y las flags
estaban OFF. El release de PR #315
([41768085471](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41768085471)) aprobó sobre
`7032d21f60aafd21b65832f847b380d10e384b3c`, con sus verificaciones de publicación. La verificación
independiente posterior con `verifyDeployment` y `verifyPublicBillingOffer` aprobó seis rutas de
frontend/API/proxy/base y catálogo Standard/OFF sobre esa fuente.
El primer [release de #314](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41760340561)
falló en la fase candidata y recuperó la baseline. #315 conserva el código de #314 y añade
reintentos GET acotados de readiness: no reintenta errores de auth, redirecciones, certificados o
identidad desconocida ni acepta un éxito fuera del presupuesto. Eso no acredita la causa del
fallo previo ni un recorrido headless del Portal.
El runner ya admite seleccionar
Standard, Esencial o Gestión y comprueba los importes, funciones y acceso de Kova, según el
[runbook del simulacro](stripe-sandbox-drill.md). Sus 64 pruebas aisladas pasaron. Las referencias a
ambos precios nuevos están configuradas en `stripe-sandbox`; la preparación live posterior
instaló además las cuatro referencias públicas en `production`, sin activar la oferta.

La aceptación integrada del 3 de noviembre sobre `1a181853162b92f5d9a0c4d6432416c3dd157ed6` aprobó
Esencial y Gestión, con Kova y PostgreSQL efímeros en el runner. Stripe confirmó `complete/paid` y
Kova devolvió el plan, importe, funciones y acceso correctos. Se aprobaron renovación con Test Clock,
falla de pago con gracia, recuperación, cancelación, ambos órdenes de eventos y duplicados, con
limpieza de tres relojes y un cliente de Checkout por ejecución. Evidencia revisada:

- [Esencial: MXN 399.00 y cuatro funciones](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-esencial.md)
  ([ejecución](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41683047004)).
- [Gestión: MXN 699.00 y nueve funciones](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-gestion.md)
  ([ejecución](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41683860187)).
- [Regresión Standard: MXN 299.00 y nueve funciones](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-standard.md)
  ([ejecución](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41684612699)).

La clave se transfirió directamente desde el sandbox al Secret store, sin publicarla ni guardarla
en archivos. La clave restringida existente no permitía consultar la cuenta; se usó temporalmente
la clave estándar de prueba ya existente, validando el identificador del sandbox antes de instalarla.
No se crearon claves ni se ampliaron permisos. La copia del Secret store debe retirarse al terminar
las ejecuciones y conservar su evidencia, según el runbook. Esa copia ya fue retirada después de
comitear las tres evidencias; la clave original de Stripe y sus permisos permanecieron intactos.

Se eliminaron los dos clientes sintéticos de los recorridos alojados, cancelando sus suscripciones
de prueba; se conservaron el catálogo y las configuraciones del Portal para la aceptación posterior.
El perfil heredado del sandbox todavía reporta requisitos de dirección vencidos y capacidades
inactivas, aunque permitió completar pagos simulados. Esto no acredita habilitación de cobros ni
depósitos en ese sandbox; la revisión de habilitación live descrita arriba corresponde a otra cuenta.

La aceptación interactiva del Portal básico de los tres planes ya aprobó con limpieza completa;
[su evidencia](../audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md) distingue fuentes
por etapa. Los intentos headless anteriores sin guardado del método de pago conservan su resultado
fallido. La autorización de publicación está en ADR-021; el cierre se acredita con release PASS
y verificación externa, por separado de las pruebas interactivas. Las transiciones autónomas
y su aplicación efectiva quedan fuera del alcance inicial. Cobro live controlado, validación fiscal,
hardware y recuperación regional conservan sus pendientes. Test Clocks no adelanta el reloj de Kova.

### Intento integrado posterior a PR #311

El recorrido Standard con riesgo y Portal básico
([41737681325](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41737681325)) se detuvo
antes del Portal: Stripe rechazó el reembolso de QA con `amount_too_small`. Ese intento
no acredita aceptación de riesgos ni guardado/cancelación en el Portal. Los dos pasos de limpieza
aprobaron y se retiró la copia temporal de la clave del Secret store.
PR #312 corrigió el fixture de reembolso a $1 MXN. No se cambió por ello un pago, deuda o
condición comercial de producción.

### Intento de Portal posterior a PR #313 y riesgos por separado

El recorrido Standard [41754550717](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41754550717)
falló con Add deshabilitado aun con el email de Link vacío. No identifica la causa ni acredita
guardado del método de pago o cancelación. Los dos pasos de limpieza aprobaron y se retiró la
copia temporal de la clave usada en ese intento.

La validación manual con datos oficiales sintéticos habilitó Add tanto con MX como con US y
postal de QA, sin pulsar Guardar. Solo comprueba validación del formulario; no creó un método de
pago, cobro o suscripción y no sustituye la aceptación del Portal.

El [drill independiente de riesgos 41756012658](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41756012658)
aprobó sobre `5fd7b35f75a33a76172afb58524a4cab89e277fd`, con `include_portal=false`:
[evidencia revisada](../audits/evidence/KOV-005-STRIPE-RISK-DRILL-2026-11-03-standard.md).
El listener firmado recibió los tres tipos reales del sandbox. El reembolso se correlacionó con
su suscripción probada; disputa y alerta temprana, generadas con Customers QA separados sin
facturas, quedaron globales como `no_subscription`. Cada caso conservó un intento y una auditoría,
replay idempotente, estado comercial intacto y triage persistido y visible por consultas de Ops.

También aprobaron Checkout Standard y su ciclo con relojes: renovación, falla/gracia/recuperación,
cancelación y eventos repetidos/fuera de orden. Se eliminaron tres relojes y tres Customers QA;
los dos pasos de limpieza aprobaron y se retiró la copia temporal de la clave de GitHub. El
historial de PaymentIntents/Charges de prueba permanece en Stripe, como corresponde.
La evidencia usa servicios/repositorios aislados: no acredita UI del fundador con MFA, recepción
live, validación fiscal ni aceptación del Portal. El código de riesgo probado conserva la
implementación publicada en #311; los cambios posteriores del runner no reescriben esa aceptación.

### Aceptación interactiva del Portal básico aprobada

La [evidencia pública revisada](../audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md)
registra Standard, Esencial y Gestión con Kova local/PostgreSQL desechable, navegador interactivo
y consultas de lectura al sandbox dedicado. Checkout y guardado efectivo del método de pago se
comprobaron sobre `8528431675423d2deefaf521fdb19b70121fb169`; cancelación y acceso sobre
`7032d21f60aafd21b65832f847b380d10e384b3c`. #315 no cambia Checkout ni guardado del método de pago.

Se comprobaron el catálogo y acceso exactos, historial y ausencia de cambios de plan, precio y
período conservados. En los tres planes Stripe devolvió el booleano crudo falso y `cancel_at`
igual al límite pagado; Kova expuso correctamente su marca normalizada verdadera sin retirar
acceso anticipadamente. Standard además se reanudó desde el Portal. El rollback local de nuevas
ofertas a OFF conservó acceso y capacidades de Gestión. La [matriz de estados](../billing-state-copy-matrix.md)
describe la normalización, sin inferir fechas desde caché o `canceled_at`.

La limpieza terminó: tres Customers sintéticos propios eliminados y tres suscripciones propias
canceladas; cero Customers ajenos modificados. Frontend/backend y listeners CLI quedaron
detenidos, PostgreSQL temporal eliminado y puertos cerrados; la copia temporal de clave de prueba
está ausente del Secret store. El historial inmutable de PaymentIntents/Charges de prueba permanece
en Stripe. La validación no constituye aceptación operativa del dueño en
su negocio, éxito del helper headless ni una corrida Actions de Portal aprobada.

La aceptación interactiva sandbox cierra este gate del Portal básico. Antes de activar, el workflow
debe capturar la baseline OFF `d4d81d6a4fe6`, verificada tras el release aprobado del run
`41860220621`, con el protocolo de arranque y los cuatro IDs en API/jobs, conforme a ADR-022.
La política ON y gate `tiered` solo se presentan como
publicados después de release PASS y verificación externa. Cobro live, fiscal, hardware, recuperación
regional y recepción de avisos conservan sus límites separados.

## Revisión de cuenta Stripe live del 3 de noviembre

La consulta del proveedor confirmó `charges_enabled`, `payouts_enabled` y `details_submitted`
verdaderos, sin requisitos `currently_due` ni `past_due`. El webhook vigente está habilitado
hacia la API de Kova para Checkout, ciclo de suscripción y facturas pagadas/fallidas. No se
modificaron identidad legal, domicilio, banco, descriptor, calendario de depósitos ni política
de reintentos. La revisión detallada confirmó Smart Retries ya habilitado: hasta ocho intentos
en dos semanas.

El nombre comercial público live se guardó y verificó como Kova. Con aprobación del dueño se
guardaron el sitio [https://kovasuite.com](https://kovasuite.com), el correo de soporte
[posprojectsupport@gmail.com](mailto:posprojectsupport@gmail.com),
[privacidad](https://kovasuite.com/privacy) y [términos](https://kovasuite.com/terms). Nombre,
correo y sitio se confirmaron por API; los enlaces legales persistieron al reabrir una UI nueva.
Estos cambios conservaron identidad legal, banco y descriptor. Los avisos live de pago fallido, tarjeta por
vencer y autenticación requerida mediante enlace de Stripe se guardaron y verificaron tras recargar.
Fin de prueba, próxima renovación y débito bancario siguen apagados; no se forzó 3DS ni se habilitó
el enlace de gestión de suscripción. Los avisos propios de Kova y los del proveedor deben evitar
duplicados. Guardar estos ajustes no acredita todavía un envío/recepción real de cada aviso.

PR #311 publicó el tratamiento de `charge.dispute.created`, `charge.refunded` y
`radar.early_fraud_warning.created`: firma y modo verificados, asignación por la cadena autoritativa
de recursos, registro idempotente y revisión visible en Ops. El procesamiento síncrono se ejecuta
fuera del event loop; los casos sin correlación probada quedan globales y un riesgo procesado no se cuenta
como fallo de entrega. El [runbook de riesgos](stripe-risk-review.md) describe triage y límites.
La aceptación real sandbox de los tres tipos aprobó en el recorrido independiente anterior.
Los tres tipos ya se habilitaron en el destino live mediante el formulario oficial y se
verificaron por API: nueve tipos exactos, conservando los seis anteriores, destino y versión de
API. El dueño autorizó el reenvío histórico, que sigue sin completarse. La Shell oficial también
es de solo lectura para el usuario en live: no sirve para ejecutar el comando retirado. Una
recepción/conciliación histórica autorizada requiere CLI nativa autenticada para live u otra vía
permitida, sin extraer claves live. Faltan confirmar permisos de lectura, recepción controlada y
UI de Ops con MFA; este pendiente no bloquea la aceptación Portal sandbox ni la activación del
catálogo autorizado. Ni la configuración guardada ni la evidencia sandbox acreditan esas
comprobaciones. El [runbook de riesgos](stripe-risk-review.md) distingue configuración y entrega.
Una disputa, devolución parcial o alerta de
fraude no autoriza inventar deuda, cancelar la suscripción ni retirar acceso automáticamente.
Este pendiente afecta todos los planes y no se cierra por activar precios.

No hay registros activos en Stripe Tax y no se habilitó `automatic_tax`. El precio inclusivo no
acredita cálculo fiscal, registro de obligaciones, CFDI ni aceptación del contador. Mantener esa
validación separada del cobro y no completar información fiscal con datos supuestos.

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

### Método efectivo de pago del Portal (9 de noviembre de 2026)

El Portal básico permite guardar tarjetas y elegir la predeterminada del Customer. Checkout
puede dejar `Subscription.default_payment_method` asignado: esa asignación tiene prioridad y
el cambio visual del Portal por sí solo no demuestra qué tarjeta usará el siguiente cobro.

El webhook firmado `customer.updated`, únicamente cuando cambió
`invoice_settings.default_payment_method`, resuelve la suscripción vigente por el Customer
único ya vinculado en Kova. Bajo el bloqueo del negocio consulta Customer, método expandido
y suscripción actuales en Stripe, valida propietario/modo y quita solamente la asignación de
método de esa suscripción para que herede la elección actual del cliente. No modifica planes,
precios, cancelación, acceso, correos de inicio de sesión ni otras suscripciones. Eventos viejos
usan el método autoritativo actual; fallos del proveedor permiten redelivery idempotente.

Tras publicar este handler, habilitar `customer.updated` en el destino productivo existente
conservando URL, secreto de firma, versión y todos los eventos anteriores. El listener aislado
lo incluye también. La aceptación mantiene el oráculo de **método efectivo** (primero el de la
suscripción, después el del Customer); no repara datos mediante API para pasar la prueba.
Referencia: [integración del Portal](https://docs.stripe.com/customer-management/integrate-customer-portal).
