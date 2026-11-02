# Estado actual

Última actualización: 2026-11-02.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

Producción verificada el 2 de noviembre corre `79f73a326b14` (PR #299): frontend `kovasuite.com` y API `api.kovasuite.com`
reportan el mismo SHA. Todo lo fusionado hasta ese PR está publicado. `main` ya exige `CI required`,
también para administradores; [protección comprobada](despliegue.md#protección-de-main). Lo más reciente:

- Corrección de acceso por facturación e imágenes de ejecución endurecidas (#287).
- Caja compacta a 390/768/998/1440 px y tickets de 58/80 mm con altura calculada (#299).
  PDF y navegador aprobados; impresión/corte físico pendientes.
- Acceso permanente de cortesía explícito y auditado, sin simular pago de Stripe (#298).
- Carga progresiva con skeletons y correos con presentación editorial compartida (#296).
  Reset desde API publicado y `delivered` a Gmail el 30 de octubre. Las seis muestras QA actuales
  llegaron a Inbox y se revisaron en Gmail web el 2 de noviembre; otros clientes siguen pendientes.
- Restauración 0099 del respaldo real del 1 de noviembre, con autenticación por cookies,
  exportación por API, RLS/integridad y limpieza en entorno aislado. [Evidencia](audits/KOVA-R2-RESTORE-2026-11-02.json)
  y [run](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41478117936).
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

## Gates abiertos

Ordenados por impacto en la venta. Ninguno se marca cerrado sin evidencia.

1. **Cobro live de Stripe.** La cuenta y el webhook están habilitados; la consulta del 29 de octubre
   confirma renovación pagada y pago fallido recientes, procesados por Kova. Falta la aceptación
   controlada de checkout y cancelación sobre la versión vigente antes del acceso pagado general.
   Preflight repetido el 2 de noviembre: sigue faltando `KOV005_STRIPE_SECRET_KEY` en el environment
   `stripe-sandbox`; la conexión disponible sólo tiene acceso live. Webhook live habilitado hacia
   la API vigente; esta lectura no prueba un checkout nuevo. [Simulacro sandbox](runbooks/stripe-sandbox-drill.md).
2. **Restauración de respaldo.** El respaldo diario a R2 corre. El simulacro lógico del 27 de
   octubre pasó con revisión 0095; el del 2 de noviembre restauró la revisión actual 0099 con RLS
   e integridad aprobadas. También aprobó login, exportación por API y logout sobre datos
   restaurados, con la imagen `79f73a326b14` y una cuenta sintética aislada. Snapshot de 24 h 18 min;
   drill lógico/ASGI de 20.766 s sin construcción de imagen: no equivalen a RTO/RPO regionales.
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
5. **Dispositivos físicos.** El dueño dispone de tablets, laptop Windows y Mac; faltan modelos/OS
   y aceptación real. Impresora, lector y cajón no se han probado físicamente. Seguir la
   [matriz de equipos](runbooks/pos-hardware-acceptance.md) y el
   [checklist offline](claude/manual-qa-checklist.md#offline-funciona-sin-internet).
6. **WhatsApp real.** App de Meta, número de prueba, credenciales en el Secret store, challenge del
   webhook y una entrega aceptada.
7. **CFDI.** Datos del emisor, recorrido Test completo con Facturapi y, sólo después, una operación
   Live controlada.
8. **Piloto multi-giro.** Reclutar y observar la cohorte para medir la activación del análisis
   ([spec](../specs/reports/analysis_activation.md)). Es investigación comercial, no código.

## Reglas de este archivo

- Sólo estado actual y gates abiertos. Cuando un gate se cierra, se borra de aquí y la evidencia
  queda en su PR.
- No repetir criterios de aceptación: enlazar la spec, el runbook o el ADR dueño.
- Lo que no se va a construir va en [`deferred-scope.md`](deferred-scope.md).
- Índice de documentación: [`README.md`](README.md).
