# Estado actual

Última actualización: 2026-11-10.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

La baseline publicada y verificada es `4aeaa973044d8e377706b2df449842d949e8dd7e`,
[release 42729913216](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42729913216).
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
- Esencial, Gestión y Standard aprobaron el simulacro completo de Checkout, Portal básico, riesgo,
  renovación/fallo/recuperación, cancelación, orden, duplicados y limpieza sobre esta fuente.
  [Ejecuciones y alcance](runbooks/commercial-plan-acceptance.md#evidencia-vigente).
- Se comprueba el controlador antes del rollout de imagen (ADR-027) y se cierra cada conexión HTTP
  privada al terminar la respuesta (ADR-028). La comparación a 3/5/7 segundos pasó de 10 errores
  en 158 lecturas a cero en otras 158, con el mismo protocolo de observación y sin otro despliegue
  en esas ventanas. La consulta de Cloudflare tampoco devolvió errores del controlador en la
  ventana posterior. Es una mitigación del patrón observado, no una causa histórica exclusiva.
- La continuidad del despliegue **no está aceptada**: la publicación final terminó saludable pero
  hubo 503 y vencimientos de treinta segundos durante la sustitución. La primera respuesta con
  el SHA nuevo se completó a las 01:01:49 UTC del 10 de noviembre. Se necesita preparar un reemplazo
  antes de mover tráfico; ordenar el controlador no elimina el corte de una sola instancia.
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
| WhatsApp | `KOVA_WHATSAPP_ENABLED` falso. Piloto asistido listo en código ([runbook](runbooks/whatsapp-assisted-pilot.md), [contrato](../specs/integrations/messaging-inbox.md)). |
| CFDI | Configuración de plataforma detectada (`available:true`); faltan emisor y conexión Test/Live ([runbook](runbooks/managed-fiscal-onboarding.md)). |
| Cierres para contador | Disponibles; falta la validación escrita de un contador ([runbook](runbooks/fiscal-global-drafts.md)). |
| Asistente | Respuestas locales sí; inferencia externa no aprobada ([ADR-017](adr/ADR-017-asistente-respuestas-ancladas.md)). |
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

1. **Continuidad durante el despliegue.** El release final aprobó sus 25 contratos y los tres
   simulacros de Stripe están aceptados. Sin embargo, la sustitución productiva todavía causó 503
   y esperas que superaron treinta segundos. Criterio pendiente: mantener la versión anterior
   atendiendo mientras se prepara una instancia separada, verificar imagen/controlador/base antes
   de cambiar tráfico y conservar recuperación exacta sin repetir escrituras.
   [Evidencia y límite operativo](despliegue.md#continuidad-observada-y-pendiente).
   La mitigación de [ADR-029](adr/ADR-029-frontend-release-without-backend-rollout.md) ya está publicada
   con CI aprobado: conserva la API en publicaciones exclusivas de frontend admitido y evita
   reiniciarla al recuperar un frontend fallido. Esos casos automatizados aprobaron; su ensayo
   productivo aún está pendiente. La instalación inicial exigió publicación completa y volvió a
   registrar cuatro rondas de sondas con timeout antes de terminar saludable. Los cambios reales
   de backend siguen necesitando un reemplazo preparado antes de cambiar tráfico.
   [ADR-030](adr/ADR-030-independent-native-api-slots.md) implementa dos controladores independientes,
   verificación antes de mover tráfico y recuperación hacia la instancia anterior. Está bajo revisión;
   este gate exige todavía CI y aceptación productiva de ambos slots y recuperación caliente.
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
   Faltan recibo corregido, enlaces de las otras plantillas, clientes móviles/oscuro, Outlook/Hotmail y
   otros disparadores actuales. [Evidencia y límites](email-deliverability.md).
4. **Revisión con el dueño** de turno, costos y catálogo en su negocio real.
   La revisión autenticada del 9 de noviembre comprobó Caja y catálogo con datos reales a
   390/820/1440 px, sin desbordamiento horizontal, con menú y resumen móvil operables. No creó
   ventas ni modificó inventario o turno. No sustituye conteo físico, conciliación o aceptación de
   los pilotos. Los flujos transaccionales/offline se verificaron en CI sobre API/PostgreSQL/RLS.
5. **Dispositivos físicos.** El alcance indicado por el dueño es PC, móvil y tablet, sin modelos
   ni hardware definidos. La regresión de navegador no sustituye una prueba física. Impresora,
   lector y cajón siguen pendientes. [Matriz de equipos](runbooks/pos-hardware-acceptance.md) y
   [checklist offline](claude/manual-qa-checklist.md#offline-funciona-sin-internet).
6. **WhatsApp real.** App de Meta, número de prueba, credenciales en el Secret store, challenge del
   webhook y una entrega aceptada.
7. **CFDI.** Datos del emisor, recorrido Test completo con Facturapi y, sólo después, una operación
   Live controlada.
8. **Piloto multi-giro.** Reclutar y observar la cohorte para medir la activación del análisis
   ([spec](../specs/reports/analysis_activation.md)). Definir responsables/soporte y cerrar los
   acuerdos y revisión profesional del [gate operativo](runbooks/ops-beta-gate.md#ops-6--legal-y-comercial).
   Es aceptación comercial y operativa, no código.

## Reglas de este archivo

- Sólo estado actual y gates abiertos. Cuando un gate se cierra, se borra de aquí y la evidencia
  queda en su PR.
- No repetir criterios de aceptación: enlazar la spec, el runbook o el ADR dueño.
- Lo que no se va a construir va en [`deferred-scope.md`](deferred-scope.md).
- Índice de documentación: [`README.md`](README.md).
