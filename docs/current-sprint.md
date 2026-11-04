# Estado actual

Última actualización: 2026-11-04.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

El PR #317 se fusionó con [CI aprobado](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41858776382)
y su [release 41860220621](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41860220621)
aprobó para `d4d81d6a4fe67c9e12b3dc0cbb272698c50bb770`, con
Standard $299 MXN/mes, Esencial/Gestión y Portal OFF. La verificación externa aprobó seis rutas de
frontend/API/proxy/base, catálogo Standard/OFF, marcador de arranque del controlador por API y
proxy y la misma identidad de proceso. Esta es la baseline operativa verificada para la activación.

El intento previo del PR #316 pasó CI, pero su
[release 41772733388](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41772733388)
falló por discrepancia del catálogo y recuperó `7032d21f60aa`; esa activación no se publicó.
Esta entrega contiene la activación separada de Esencial/Gestión y Portal básico, con ambas flags
ON y gate `tiered`, conservando el protocolo de [ADR-022](adr/ADR-022-native-controller-boot-policy.md)
y la baseline OFF de #317. Su publicación necesita su propio release y verificación externa;
este cambio de política no declara que la oferta ON ya esté publicada.
Los merges posteriores solo de documentación no cambian el SHA desplegado. `main` ya exige `CI required`,
también para administradores; [protección comprobada](despliegue.md#protección-de-main). Lo más reciente:

- Corrección de acceso por facturación e imágenes de ejecución endurecidas (#287).
- Fundación de planes comerciales y Checkout durable (#302), validación de Portal con productos
  expandidos y sin cantidades ajustables (#303), y simulacro aislado seleccionable por plan (#304).
  Standard conserva sus acuerdos de $299 MXN mensuales; la nueva oferta no migra esa cohorte.
- Transporte de referencias públicas de Stripe a API/jobs, protección de registro con oferta
  obsoleta y actualización de precios al volver a la app (#307). El release verifica el catálogo
  aprobado antes y después de promoción, sin reenviar bypass a redirecciones. El Portal básico
  sandbox de los tres planes aprobó mediante navegador interactivo: guardado efectivo del método
  de pago, historial y cancelación programada, con acceso conservado y limpieza completa.
  [Evidencia y fuentes por etapa](audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md).
  La activación del PR #316 no aprobó publicación. El release y la comprobación externa
  de #317 aprobaron la baseline OFF `d4d81d6a4fe6` con el protocolo de arranque.
  Esta entrega contiene la activación separada,
  que necesita su propio release y verificación externa.
  La aceptación interactiva no acredita éxito headless.
- Riesgos de Stripe con firma, modo e idempotencia, mapeo autoritativo y revisión visible en Ops
  (#311), sin alterar suscripción, deuda ni acceso. El webhook se procesa fuera del event loop.
  La aceptación real de los tres riesgos en sandbox aprobó sobre `5fd7b35f75a3`:
  [evidencia](audits/evidence/KOV-005-STRIPE-RISK-DRILL-2026-11-03-standard.md).
  Los tres tipos ya están habilitados en el destino live, verificados por API con los seis
  anteriores, sin cambiar destino ni versión. Faltan permisos de lectura live confirmados,
  recepción/conciliación histórica live y revisión de Ops con MFA;
  [procedimiento](runbooks/stripe-risk-review.md).
  El intento Standard con Portal
  [41754550717](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41754550717) se detuvo en
  Add deshabilitado aun con el email de Link vacío; no demuestra la causa ni acepta el Portal.
  Ambas limpiezas aprobaron y se retiró la copia temporal de la clave de ese intento. El
  [drill independiente de riesgos 41756012658](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41756012658)
  aprobó con `include_portal=false`, tres relojes y tres Customers QA eliminados. Esa corrida
  no acepta Portal; su aceptación interactiva posterior está enlazada arriba. El ajuste de
  entrada y harness de #314 está incluido en #315.
  El primer [release de #314](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41760340561)
  falló durante la fase candidata y recuperó la baseline; no aprobó publicación. #315 añade
  reintentos acotados de GET de readiness, conservando presupuesto, identidad y fallos cerrados,
  sin demostrar por ello la causa del fallo anterior.
- Cancelación programada de Stripe normalizada (#315): reconoce el booleano legado o un
  `cancel_at` entero futuro que coincide con el fin del período del mismo objeto autoritativo.
  Conserva estado, deuda, período pagado y acceso. La cancelación y el acceso de los tres planes
  se aceptaron interactivamente sobre #315; Checkout y guardado del método de pago se comprobaron
  sobre #314, sin atribuir todas las etapas a un único SHA ni al helper headless.
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
- Restauración 0101 con respaldo nuevo del 3 de noviembre y una imagen reconstruida desde la
  fuente publicada `88bb94056a0f`: login, exportación por API, RLS/integridad y limpieza aprobados.
  [Evidencia redactada](audits/KOVA-R2-RESTORE-2026-11-03.md) y
  [alcance y tiempos](runbooks/restore-supabase-backup.md#drill-log). No acredita el mismo digest
  desplegado ni recuperación regional.
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

## Planes comerciales: aceptación y política de activación

El dueño aprobó avanzar con Esencial $399/Gestión $699 MXN mensuales, conservar acuerdos actuales y
medir atención/consumo antes de cerrar la rentabilidad. [ADR-019](adr/ADR-019-commercial-plan-design.md)
registra el diseño; [ADR-020](adr/ADR-020-commercial-plan-foundation.md) documenta la fundación
de cohortes/capacidades, publicada con activación separada. El contrato está en
[planes comerciales](../specs/billing/commercial_plans.md) y la
[aceptación/medición](runbooks/commercial-plan-acceptance.md) distingue los recorridos aprobados y
los gates abiertos. El sandbox aprobó Checkout y ciclo de suscripción con Kova/PostgreSQL efímeros
para Esencial $399, Gestión $699 y la regresión Standard $299 sobre `1a181853162b`.
La activación productiva está autorizada en
[ADR-021](adr/ADR-021-commercial-production-activation.md). El Portal básico sandbox ya aprobó
la aceptación interactiva. El intento de activación #316 se recuperó; el release de #317
y la verificación externa aprobaron `d4d81d6a4fe6` como baseline OFF del protocolo de arranque
según ADR-022. Esta entrega fija la política ON y el gate `tiered`; no declara esa oferta ya publicada.
La activación se acredita
con release PASS y verificación externa. Las transiciones autónomas permanecen fuera del alcance inicial;
la validación fiscal conserva su pendiente separado.
Los acuerdos Standard de $299 conservan su vigencia. El dueño autorizó después alinear producción:
se crearon en Stripe live productos separados de Esencial $399 y Gestión $699 MXN mensuales,
con precios inclusivos, sin modificar suscripciones ni los precios de $299 anteriores. Un precio
preliminar no utilizado quedó archivado, sin suscripciones. Se preparó un Portal privado para
historial, método de pago y cancelación al cierre del período, sin acceso público ni cambios de
plan. Las cuatro referencias no secretas ya llegaron a API/jobs mediante el release aceptado de
#307. La [evidencia interactiva de los tres planes](audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md)
ya está revisada y su limpieza concluyó. La baseline OFF con identidad de arranque verificada es
`d4d81d6a4fe67c9e12b3dc0cbb272698c50bb770` (#317; release `41860220621` aprobado).
El workflow capturará sus versiones exactas y conservará los cuatro IDs para el rollback.
La publicación de la oferta ON requiere el cierre del release y su verificación externa.

La revisión detectó que Stripe sólo programa reducciones entre Prices del mismo Product; agrupar
ambos planes eliminaría su identidad en Checkout/comprobantes. Se conserva un Product por plan y
no se habilitan cambios autónomos entre planes. El resultado anterior de UI alojada no basta para
aceptar esa transición en el catálogo definitivo. Los cambios de plan y su aplicación al vencer
siguen pendientes, separados del Portal básico. En live se guardaron y verificaron el nombre
público Kova, el sitio [kovasuite.com](https://kovasuite.com), el correo de soporte
[posprojectsupport@gmail.com](mailto:posprojectsupport@gmail.com) y los enlaces de
[privacidad](https://kovasuite.com/privacy) y [términos](https://kovasuite.com/terms). Nombre,
correo y sitio se confirmaron por API; privacidad y términos al reabrir la UI.
La revisión detallada de recuperación confirmó Smart Retries ya habilitado, con hasta ocho
intentos en dos semanas; no se cambió esa política. Se guardaron y verificaron tras recargar los
avisos live de pago fallido, tarjeta por vencer y autenticación requerida mediante enlace de Stripe.
Los avisos de fin de prueba, próxima renovación y débito bancario siguen apagados. Estos ajustes
no cierran la aceptación fiscal ni la aceptación controlada de cobro.

## Gates abiertos

Ordenados por impacto en la venta. Ninguno se marca cerrado sin evidencia.

1. **Cobro live de Stripe.** La cuenta y el webhook de ciclo de suscripción están habilitados.
   La aceptación controlada de cobro y cancelación live sobre la versión vigente sigue pendiente.
   La activación del catálogo y Checkout está autorizada conforme a ADR-021, con la preparación
   y secuencia de ADR-022. Se acredita con release PASS y verificación externa; no equivale a aceptación live completada
   ni operación al 100%.
   Los handlers de disputa, reembolso y alerta temprana de fraude ya están
   publicados (#311) y su aceptación sandbox real aprobó sobre `5fd7b35f75a3`. Los tres tipos live
   ya están habilitados y verificados por API. Faltan confirmar permisos de lectura live, ejecutar
   recepción/conciliación histórica controlada y revisar Ops con MFA.
   Un riesgo procesado conserva el acceso y requiere revisión en Ops.
   El simulacro sandbox del 3 de noviembre aprobó los tres planes contra Kova/PostgreSQL efímeros:
   Checkout, renovación simulada, falla/gracia/recuperación, cancelación y eventos duplicados o fuera
   de orden. No prueba un cobro live ni adelanta el reloj de Kova. La clave de prueba se instaló
   temporalmente en el Secret store para ejecutar esos recorridos y ya fue retirada tras conservar
   la evidencia. Webhook live habilitado hacia la API vigente.
   [Simulacro y evidencia por plan](runbooks/stripe-sandbox-drill.md).
2. **Restauración de respaldo.** El respaldo diario a R2 corre. El 3 de noviembre se restauró
   la revisión `0101_checkout_attempts` y se aprobó RLS, integridad, login, exportación por API,
   logout y limpieza con una cuenta sintética aislada. La imagen se reconstruyó desde la fuente
   publicada `88bb94056a0f`; no se acredita igualdad de digest con Cloudflare. Snapshot de
   5 min 7.659 s; drill lógico/ASGI de 20.962 s sin construcción de imagen: no equivalen a
   RTO/RPO regionales. La evidencia previa de 0099 conserva su alcance histórico.
   Falta la recuperación regional con bindings de producción, tráfico y RTO/RPO completos.
   [Evidencia redactada](audits/KOVA-R2-RESTORE-2026-11-03.md) y
   [alcance comprobado](runbooks/restore-supabase-backup.md).
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
