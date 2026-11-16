# Estado actual

Última actualización: 2026-11-16.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

Confirmaciones y recordatorios de reservas integrados con plantillas y el programador privado,
con bloqueo de plataforma apagado y activación adicional del dueño por sucursal. Incluye citas,
reservas públicas y mesas confirmadas. No libera previews anteriores ni envía al aprobar Meta;
la aceptación real sigue pendiente. [Contrato](../specs/integrations/reservation-notices.md) y
[activación operativa](runbooks/whatsapp-reservation-notices.md).
La solicitud de permisos de WhatsApp ya fue enviada con los dos videos y las declaraciones
autorizadas; Meta confirmó **Revisión en curso**. Esto actualiza las referencias anteriores a un
borrador pendiente, sin acreditar aprobación ni conexión del número real.

La baseline publicada y verificada antes de este corte es `d9e973bf2334e54757026b697f6690e27dfc9ace`,
[release 43934149277](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/43934149277).
API, frontend, proxy y controlador sirven ese mismo SHA; sitio y base accesibles, comprobados
independientemente tras la aceptación del workflow. La coexistencia de WhatsApp está publicada
con alta limitada a dos negocios admitidos, pendiente de permisos de WhatsApp y aceptación real. Se conserva la
[evidencia de Clientes, lealtad y Agenda](testing-clients-booking.md#ci-y-publicación).
La corrección del drenado y del monitor de recuperación permitió publicar el alta de WhatsApp
con su gate comercial apagado. [Evidencia e incidente anterior](despliegue.md#recuperación-verificada-el-12-de-noviembre-de-2026).
Esencial $399/Gestión $699 MXN mensuales y el Portal básico están ON; los acuerdos Standard de
$299 se conservan. API/frontend se alojan en Cloudflare y la base PostgreSQL está en Supabase.
Fly está retirado. [Arquitectura](claude/architecture-context.md).

- El dueño completó un cobro live de Esencial por $399 MXN en «Kova QA live». Stripe confirmó
  factura pagada y Kova otorgó acceso sin cortesía. La renovación se canceló desde el Portal y
  Kova conservó el acceso hasta el 9 de diciembre de 2026 a las 13:40, hora de Ciudad de México.
- El webhook live está activo con los nueve eventos anteriores más `customer.updated`;
  conserva destino y versión `2026-04-22.dahlia`. La nueva elección de método predeterminado del
  Customer se verifica y aplica solamente a la suscripción vinculada del negocio.
- Los avisos de bienvenida/recibo ya no se suprimen por la reconciliación autoritativa inicial;
  usan idempotencia en Resend. La bienvenida se verificó el 9 de noviembre a las 21:13 CDMX mediante
  recuperación del Checkout ya pagado: un correo entregado en Gmail Inbox tras dos confirmaciones,
  con SPF/DKIM/DMARC PASS y sin otro cargo ni cambio de cancelación. El recibo corregido y una compra
  nueva posterior a la corrección siguen sin aceptación live. [Alcance del correo](email-deliverability.md).
- El registro de pagos conserva sus marcas de eventos antes de la lectura de bienvenida, incluso
  con `autoflush=False` como en producción, dentro de la misma transacción. También se corrigió la
  carrera de propiedad del mapeo entre consultas; no se relajan firma, modo ni aislamiento.
- Esencial, Gestión y Standard aprobaron los simulacros previos de Checkout, Portal básico, riesgo,
  renovación/fallo/recuperación, cancelación, orden, duplicados y limpieza sobre las fuentes allí
  registradas. Este cambio de infraestructura no repitió cobros ni simulacros de Stripe.
  [Ejecuciones y alcance](runbooks/commercial-plan-acceptance.md#evidencia-vigente).
- Se comprueba el controlador antes del rollout de imagen (ADR-027) y se cierra cada conexión HTTP
  privada al terminar la respuesta (ADR-028). La comparación a 3/5/7 segundos pasó de 10 errores
  en 158 lecturas a cero en otras 158, con el mismo protocolo de observación y sin otro despliegue
  en esas ventanas. La consulta de Cloudflare tampoco devolvió errores del controlador en la
  ventana posterior. Es una mitigación del patrón observado, no una causa histórica exclusiva.
- El reemplazo independiente de ADR-030 está publicado: legacy → green, green → blue y recuperación
  exacta a green. Desde la primera respuesta nueva hubo 147 sondas sin errores, con el proceso
  anterior conservado durante la preparación y recuperación. En el bootstrap inicial hubo dos
  timeouts de transporte sin HTTP, todavía sin atribuir. No se declara continuidad absoluta de
  esa migración ni una garantía global. [Evidencia](despliegue.md#continuidad-observada-y-pendiente).
- El error de Sentry que envolvía repetidamente excepciones se corrigió con la actualización del
  SDK; la causa histórica de conexión externa con Supabase no está demostrada. La consulta de
  Sentry del 9 de noviembre no mostró incidencias del backend en su ventana de 24 horas.
- El respaldo del 9 de noviembre posterior al pago/cancelación se restauró en un runner aislado;
  RLS, integridad, login, exportación y limpieza aprobaron. Su alcance se detalla abajo.

Los merges sólo de Markdown no cambian el SHA desplegado. El job de publicación exige
`CI required`; el plan privado actual no permite asumir protección del merge. Antes de fusionar,
esperar al CI completo del SHA revisado sin confiar en auto-merge.
[Publicación y recuperación](despliegue.md#protección-de-main).

Publicado no significa activado. Siguen apagados o sin aceptación externa:

| Función | Estado |
| --- | --- |
| Alta pública de tarjeta | Apagada por sucursal hasta que el dueño la active en Lealtad. |
| Reservas públicas | Publicadas sin anticipo; desactivadas inicialmente por sucursal. Requieren personas/espacios, servicios y disponibilidad reales antes de habilitarse. |
| WhatsApp | Alta v4 y coexistencia publicadas; `WHATSAPP_SIGNUP_ENABLED=true` sólo tiene efecto en Sweet Home y el negocio aislado del revisor, con admisión auditada. Negocio **Verificado**, app **Activa**, renovación **Completada**, `public_profile` avanzado y cinco campos de webhook suscritos en v25.0. Release aceptado y verificado; el dueño abre el SDK real desde Sweet Home / Sucursal principal. Tras aceptar las condiciones autorizadas e ingresar el 3710, Meta bloquea la app para coexistencia con **3441107**. La solicitud de acceso avanzado a los dos permisos de WhatsApp fue enviada con los videos reales de mensajería y creación de plantilla; Meta confirmó **Revisión en curso**. La aprobación sigue pendiente, al igual que la aceptación real de coexistencia. La sucursal sigue sin conectar; no está abierta el alta general ([expediente](runbooks/whatsapp-meta-app-review.md), [alta](runbooks/whatsapp-embedded-signup.md), [contrato](../specs/integrations/whatsapp-embedded-signup.md)). |
| CFDI | Configuración de plataforma detectada (`available:true`); faltan emisor y conexión Test/Live ([runbook](runbooks/managed-fiscal-onboarding.md)). |
| Cierres para contador | Disponibles; falta la validación escrita de un contador ([runbook](runbooks/fiscal-global-drafts.md)). |
| Asistente | Respuestas locales sí; inferencia externa no aprobada ([ADR-034](adr/ADR-034-asistente-cloudflare-consumo-verificado.md)). Qwen/Cloudflare ya tiene ruta anclada, reportes con una llamada, límites 256/128 y conciliación verificable sin liberar incertidumbre. Selector real validado dentro de cuota gratuita; faltan corpus/revisión humana y recorrido/carga alojados con proveedor. Evidencia en el [runbook](runbooks/assistant-acceptance.md); cambios locales no acreditan publicación ni activación. |
| Gastos y margen | Detrás de `margin_reports` ([ADR-015](adr/ADR-015-expenses-standard-plan-rollout.md)). |
| Cajón de dinero | Código publicado; sin evidencia física de un modelo real ([contrato](../specs/shifts/cash_drawer.md)). |
| Terminal bancaria | No contratada; Caja registra tarjeta manual. |

## Reconexión offline publicada

La recarga sin conexión conserva las ventas y la sincronización espera a la sesión
revalidada por el servidor. La corrección evita consumir reintentos mientras el navegador
está offline, reactiva la cola al reconectar y vuelve a cargar catálogo, existencias y turno para
continuar cobrando. La regresión de navegador usa API/PostgreSQL/RLS reales, a 390 y 1440 px, y
pierde una respuesta exitosa para comprobar una sola venta, pago y salida de inventario.
Contrato: [sincronización offline](../specs/orders/offline_sync.md).

El [CI completo del PR](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40987680895) y el
[release coordinado](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40988258073) aprobaron.
La verificación pública posterior confirmó sitio HTTP 200, frontend/API/proxy con el mismo SHA y
base accesible por API directa y proxy. No se hicieron escrituras de negocio en producción.

La revisión local del 14 de noviembre repitió el circuito de Caja sobre el build y una API con
PostgreSQL/RLS desechables a 390/1440 px: apertura de turno, entradas/salidas, pago dividido,
devolución, anulación y cierre con $155 esperados/contados y diferencia de $0; el inventario terminó
en ocho unidades desde diez iniciales. La recarga offline y la pérdida de una respuesta exitosa
conservaron una sola venta, un pago y una salida de inventario al reintentar.
También se corrigió el texto del carrito que se encimaba con los controles de cantidad; nombres y
modificadores envuelven, el subtotal conserva su cifra completa y los botones mantienen 44 px.
La aceptación enfocada comprende 87 pruebas backend, 237 unitarias frontend y 17 de navegador,
incluidos nombres largos a 320/390/1440 px y PDFs de 58/80 mm. No acredita equipos físicos,
conteo real del negocio ni compatibilidad con una impresora específica.

## Planes comerciales: aceptación y política de activación

La oferta ON conserva Esencial $399 y Gestión $699 MXN mensuales, con precios inclusivos y un
Product por plan. Los acuerdos Standard de $299 no se migran. El Portal básico incluye historial,
método de pago y cancelación al terminar el período. Los cambios autónomos entre planes siguen
fuera del alcance inicial: Stripe sólo programa reducciones entre Prices del mismo Product.

El contrato está en [planes comerciales](../specs/billing/commercial_plans.md); la
[aceptación por etapa](runbooks/commercial-plan-acceptance.md) distingue código, sandbox y live.
Las decisiones se conservan en ADR-019–ADR-022. La evidencia interactiva del 3 de noviembre es
histórica y no reemplaza la repetición del código actual.

El cobro live de Esencial y la cancelación de renovación ya aprobaron. Las nuevas pruebas
integradas de Esencial/Gestión/Standard aprobaron tras corregir el mapeo concurrente, la pérdida de
marcas de eventos y la navegación final del helper de cancelación. Un fallo de prueba no se convierte en aceptación por omitir una etapa.
Smart Retries y los avisos live de pago fallido, tarjeta por vencer y autenticación requerida
siguen configurados. Próxima renovación, fin de prueba y débito bancario conservan su política.

## Gates abiertos

Ordenados por impacto en la venta. Ninguno se marca cerrado sin evidencia.

1. **Continuidad durante el despliegue: mecanismo independiente verificado.**
   [ADR-030](adr/ADR-030-independent-native-api-slots.md) ya pasó CI completo, publicación de ambos
   slots y recuperación caliente de la API usando la versión exacta del gateway capturado.
   Se verificaron base, oferta, proceso y los 25 contratos nativos sin repetir escrituras.
   El corte conocido por sustituir la única instancia ya tiene un reemplazo independiente
   validado. Permanecen sin atribuir dos timeouts de transporte durante el bootstrap legado;
   no se certifica disponibilidad global, apagado automático en producción ni una recuperación
   de un proceso ya frío. La retención/recuperación de frontend de ADR-029 conserva pruebas
   automatizadas; este ensayo cambió backend. [Alcance y límites](despliegue.md#continuidad-observada-y-pendiente).
2. **Recuperación regional del respaldo.** El respaldo diario corre. La
   [restauración 42725832764](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42725832764)
   aprobó sobre fuente `1b41646cae8d`: revisión 0101, integridad, RLS, login, exportación, logout y
   limpieza. Respaldo `2026-11-09T21:46:43Z`, posterior al cobro y cancelación, con antigüedad medida
   de 8.467,908 s; restauración 0,657 s y drill lógico/ASGI 26,524 s. La imagen se reconstruye desde
   fuente: no prueba el mismo digest desplegado, bindings productivos ni RTO/RPO regionales.
   [Alcance y procedimiento](runbooks/restore-supabase-backup.md).
3. **Correo transaccional.** Dominio habilitado y seis plantillas QA `delivered` a Gmail el 27 de
   octubre, incluido invitación; logo HTTP 200. El reset solicitado desde el proxy del backend
   publicado llegó a `delivered` el 29 de octubre CDMX y se repitió con el diseño nuevo sobre
   `4b14f2ca6659` el 30 de octubre (diseño editorial actual). Resend lo mantiene como `delivered`
   en la consulta del 2 de noviembre y el dominio sigue verificado. Seis muestras QA del diseño
   editorial enviadas ese día con el conector Resend también llegaron a Inbox, con revisión
   visual en Gmail web y SPF/DKIM/DMARC PASS observados en la muestra de reset. No prueban
   los disparadores del backend. La bienvenida actual sí llegó a Inbox desde la recuperación de
   Checkout del backend publicado el 9 de noviembre; se revisaron contenido, destinos y autenticación.
   La revisión del 14 de noviembre confirmó dominio/envíos y corrigió la etiqueta de periodo del
   recibo y la recuperación de enlaces de verificación. Pasaron 117 casos backend, 40 frontend y
   revisión local de las seis plantillas a 390/1440 px. Faltan el recibo corregido disparado por un
   pago real, enlaces reales restantes, clientes móviles/oscuro, Outlook/Hotmail y otros disparadores
   actuales. [Evidencia y límites](email-deliverability.md).
4. **Revisión con el dueño** de turno, costos y catálogo en su negocio real.
   La revisión autenticada del 9 de noviembre comprobó Caja y catálogo con datos reales a
   390/820/1440 px, sin desbordamiento horizontal, con menú y resumen móvil operables. No creó
   ventas ni modificó inventario o turno. No sustituye conteo físico, conciliación o aceptación de
   los pilotos. Los flujos transaccionales/offline se verificaron en CI sobre API/PostgreSQL/RLS.
   La revisión del 16 de noviembre confirmó carga de inventario, recibos y agenda de mesas, y cola
   offline vacía en el dispositivo revisado. El piloto mezcla datos reales y de ensayo: sus cifras
   no acreditan todavía conciliación física ni rendimiento comercial. Un turno acumulado se cerró
   por instrucción del dueño igualando el esperado; fue una regularización sin conteo físico,
   no evidencia de caja conciliada. El [conteo de inventario](../specs/inventory/physical-counts.md)
   exige cantidades explícitas ordinarias y por lote; su aceptación local no sustituye el conteo del negocio.
5. **Dispositivos físicos.** El alcance indicado por el dueño es PC, móvil y tablet, sin modelos
   ni hardware definidos. La regresión de navegador no sustituye una prueba física. Impresora,
   lector y cajón siguen pendientes. [Matriz de equipos](runbooks/pos-hardware-acceptance.md) y
   [checklist offline](claude/manual-qa-checklist.md#offline-funciona-sin-internet).
6. **WhatsApp real.** El dueño confirmó recepción del saludo de prueba de Meta y se guardaron los
   secretos del piloto. La configuración ya está publicada en un proceso nuevo y el SDK abre
   desde la sucursal elegida. Falta completar la autorización de coexistencia con el dueño,
   resolver la habilitación de Meta que devuelve 3441107 y obtener respuesta a la revisión de permisos enviada,
   validar ingreso firmado en Kova y aceptar entrega desde la bandeja; ver [runbook](runbooks/whatsapp-embedded-signup.md).
7. **CFDI.** Datos del emisor, recorrido Test completo con Facturapi y, sólo después, una operación
   Live controlada.
8. **Piloto multi-giro.** Reclutar y observar la cohorte para medir la activación del análisis
   ([spec](../specs/reports/analysis_activation.md)). Definir responsables/soporte y cerrar los
   acuerdos y revisión profesional del [gate operativo](runbooks/ops-beta-gate.md#ops-6--legal-y-comercial).
   Es aceptación comercial y operativa, no código.

## Clientes y reservas: publicado, activación por negocio

La reorganización de Clientes y atención, el diseñador de lealtad y la reserva pública sin anticipo
se publicaron en el [PR #349](https://github.com/ArturoFrancoMozqueda/kova/pull/349).
Se verificaron ficha/búsqueda, borrador con logo y regla en vivo, calendario semanal/diario,
ausencia de errores visibles y reservas apagadas, a 390 y 1440 px. No se guardaron configuraciones
ni se crearon operaciones productivas durante QA. Las reservas requieren servicios y disponibilidad
configurados antes de activarse. Contratos:
[reservas](../specs/appointments/public-booking.md), [lealtad](../specs/loyalty/program-designer.md),
[ADR-032](adr/ADR-032-public-booking-and-loyalty-program.md). Validación y límites del cambio en
[validación local](testing-clients-booking.md).

## Reglas de este archivo

- Sólo estado actual y gates abiertos. Cuando un gate se cierra, se borra de aquí y la evidencia
  queda en su PR.
- No repetir criterios de aceptación: enlazar la spec, el runbook o el ADR dueño.
- Lo que no se va a construir va en [`deferred-scope.md`](deferred-scope.md).
- Índice de documentación: [`README.md`](README.md).
