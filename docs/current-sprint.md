# Estado actual

Última actualización: 2026-11-03.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

La última verificación registrada del 3 de noviembre corresponde a `31b0693f5a74` (PR #307):
frontend `kovasuite.com`, API `api.kovasuite.com` y proxy reportaron el mismo SHA, con la base disponible.
Los cambios de código hasta ese PR están publicados.
Los merges posteriores solo de documentación no cambian el SHA desplegado. `main` ya exige `CI required`,
también para administradores; [protección comprobada](despliegue.md#protección-de-main). Lo más reciente:

- Corrección de acceso por facturación e imágenes de ejecución endurecidas (#287).
- Fundación de planes comerciales y Checkout durable (#302), validación de Portal con productos
  expandidos y sin cantidades ajustables (#303), y simulacro aislado seleccionable por plan (#304).
  Esencial/Gestión y Portal siguen apagados en producción; Standard conserva $299 MXN mensuales.
- Transporte de referencias públicas de Stripe a API/jobs, protección de registro con oferta
  obsoleta y actualización de precios al volver a la app (#307). El release verifica el catálogo
  aprobado antes y después de promoción, sin reenviar bypass a redirecciones. Portal básico
  preparado; falta repetir su aceptación después de alinear la validación de enlaces opacos.
- Recordatorios que excluyen cortesía permanente, recuperan envíos pendientes antes de vencer y
  reportan fallas al scheduler; importes de correo en Decimal (#300).
- Dependencias PDF corregidas, motor OCR con fix oficial de propiedad de palabras y sus dos
  regresiones, y SQLite retirado de la imagen nativa PostgreSQL (#300). CI exige los 20 avisos
  OCR revisados, 18 suites/70 regresiones ejecutadas y los escaneos sin excepciones nuevas.
- Caja compacta a 390/768/998/1440 px y tickets de 58/80 mm con altura calculada (#299).
  PDF y navegador aprobados; impresión/corte físico pendientes.
- Acceso permanente de cortesía explícito y auditado, sin simular pago de Stripe (#298).
- Carga progresiva con skeletons y correos con presentación editorial compartida (#296).
  Reset desde API publicado y `delivered` a Gmail el 30 de octubre. Las seis muestras QA actuales
  llegaron a Inbox y se revisaron en Gmail web el 2 de noviembre; otros clientes siguen pendientes.
- Restauración 0099 con la imagen `4e3a58060f81` y el respaldo nuevo del 2 de noviembre: login,
  exportación por API, RLS/integridad y limpieza aprobados. [Run actual](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41483756223)
  y [alcance y tiempos](runbooks/restore-supabase-backup.md#drill-log).
- Navegación por rol con Caja, Pedidos y Ventas fijos y categorías desplegables (#285). Aceptada en
  producción.
- Pedidos con seguimiento público y operación diaria simplificada (#283). Aceptado en producción
  con un pedido real de prueba y su devolución.
- Menú digital, tarjeta de lealtad web con alta desde el menú y recompensa en Caja (#282), detrás
  del puente de compatibilidad 0096–0098 (#281). Contratos:
  [alta pública](../specs/loyalty/public_enrollment.md),
  [recompensas en Caja](../specs/loyalty/pos_rewards.md),
  [solicitud → pedido → seguimiento](../specs/storefront/order_acceptance_tracking.md),
  [costo faltante desde Análisis](../specs/reports/missing_cost_review.md).
- Sentry del navegador con DSN público ([runbook](runbooks/monitoreo.md#sentry-del-navegador)) (#278).
- Menú con enlace y QR fijos (#276) y centro de control (#275).

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

## Planes comerciales preparados, oferta apagada

El dueño aprobó avanzar con Esencial $399/Gestión $699 MXN mensuales, conservar acuerdos actuales y
medir atención/consumo antes de cerrar la rentabilidad. [ADR-019](adr/ADR-019-commercial-plan-design.md)
registra el diseño; [ADR-020](adr/ADR-020-commercial-plan-foundation.md) documenta la fundación
de cohortes/capacidades, ya publicada detrás de banderas apagadas. El contrato está en
[planes comerciales](../specs/billing/commercial_plans.md) y la
[aceptación/medición](runbooks/commercial-plan-acceptance.md) distingue los recorridos aprobados y
los gates abiertos. El sandbox aprobó Checkout y ciclo de suscripción con Kova/PostgreSQL efímeros
para Esencial $399, Gestión $699 y la regresión Standard $299 sobre `1a181853162b`.
Faltan las transiciones mediante el Portal de Kova, la aplicación efectiva al vencer y la
validación fiscal antes de autorizar la oferta productiva.
Standard $299 sigue vigente en la app productiva. El dueño autorizó después alinear producción:
se crearon en Stripe live productos separados de Esencial $399 y Gestión $699 MXN mensuales,
con precios inclusivos, sin modificar suscripciones ni los precios de $299 anteriores. Un precio
preliminar no utilizado quedó archivado, sin suscripciones. Se preparó un Portal privado para
historial, método de pago y cancelación al cierre del período, sin acceso público ni cambios de
plan. Las cuatro referencias no secretas ya llegaron a API/jobs mediante el release aceptado de
#307. Falta aceptar el recorrido del Portal antes de activar la oferta de Kova.

La revisión detectó que Stripe sólo programa reducciones entre Prices del mismo Product; agrupar
ambos planes eliminaría su identidad en Checkout/comprobantes. Se conserva un Product por plan y
no se habilitan cambios autónomos entre planes. El resultado anterior de UI alojada no basta para
aceptar esa transición en el catálogo definitivo. Los cambios de plan y su aplicación al vencer
siguen pendientes, separados del Portal básico. Identidad pública, enlaces legales, recuperación
automática y aceptación fiscal se revisan sin inventar datos del titular.
La revisión detallada de recuperación confirmó Smart Retries ya habilitado, con hasta ocho
intentos en dos semanas; no se cambió esa política. Los avisos de tarjeta por vencer, pago
fallido y autenticación requerida están apagados. Los enlaces legales y el nombre comercial
público requieren guardar la corrección preparada; no se consideran resueltos por crear el Portal.

## Gates abiertos

Ordenados por impacto en la venta. Ninguno se marca cerrado sin evidencia.

1. **Cobro live de Stripe.** La cuenta y el webhook están habilitados; la consulta del 29 de octubre
   confirma renovación pagada y pago fallido recientes, procesados por Kova. Falta la aceptación
   controlada de checkout y cancelación sobre la versión vigente antes del acceso pagado general.
   El simulacro sandbox del 3 de noviembre aprobó los tres planes contra Kova/PostgreSQL efímeros:
   Checkout, renovación simulada, falla/gracia/recuperación, cancelación y eventos duplicados o fuera
   de orden. No prueba un cobro live ni adelanta el reloj de Kova. La clave de prueba se instaló
   temporalmente en el Secret store para ejecutar esos recorridos y ya fue retirada tras conservar
   la evidencia. Webhook live habilitado hacia la API vigente.
   [Simulacro y evidencia por plan](runbooks/stripe-sandbox-drill.md).
2. **Restauración de respaldo.** El respaldo diario a R2 corre. El simulacro lógico del 27 de
   octubre pasó con revisión 0095; el del 2 de noviembre restauró la revisión actual 0099 con RLS
   e integridad aprobadas. La repetición sobre `4e3a58060f81` aprobó login, exportación por API
   y logout con una cuenta sintética aislada. Snapshot de 23 min 37 s; drill lógico/ASGI de
   22.447 s sin construcción de imagen: no equivalen a RTO/RPO regionales.
   Falta la recuperación regional con bindings de producción, tráfico y RTO/RPO completos.
   [Alcance comprobado](runbooks/restore-supabase-backup.md).
3. **Correo transaccional.** Dominio habilitado y seis plantillas QA `delivered` a Gmail el 27 de
   octubre, incluido invitación; logo HTTP 200. El reset solicitado desde el proxy del backend
   publicado llegó a `delivered` el 29 de octubre CDMX y se repitió con el diseño nuevo sobre
   `4b14f2ca6659` el 30 de octubre (diseño editorial actual). Resend lo mantiene como `delivered`
   en la consulta del 2 de noviembre y el dominio sigue verificado. Seis muestras QA del diseño
   editorial enviadas ese día con el conector Resend también llegaron a Inbox, con revisión
   visual en Gmail web y SPF/DKIM/DMARC PASS observados en la muestra de reset. No prueban
   los disparadores del backend. Faltan enlaces reales, clientes móviles/oscuro, Outlook/Hotmail y
   disparadores actuales de las otras plantillas. [Evidencia y límites](email-deliverability.md).
4. **Revisión con el dueño** de turno, costos y catálogo en su negocio real.
   La revisión de navegador del 2 de noviembre confirmó cortesía permanente en Suscripción y Caja
   sin desbordamiento a 390/998/1440 px, sin crear ventas ni alterar inventario. No sustituye el
   conteo físico, conciliación ni aceptación operativa de los pilotos.
5. **Dispositivos físicos.** El dueño dispone de tablets, laptop Windows y Mac; faltan modelos/OS
   y aceptación real. Impresora, lector y cajón no se han probado físicamente. Seguir la
   [matriz de equipos](runbooks/pos-hardware-acceptance.md) y el
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
