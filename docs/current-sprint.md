# Estado actual

Última actualización: 2026-10-28.

Este archivo dice qué está en producción y qué falta. Las bitácoras de cada corte (pruebas, cifras,
archivos) viven en sus PRs y en el historial de git; la versión anterior de este archivo también.

## En producción

Producción corre `fb67e755` (PR #288): frontend `kovasuite.com` y API `api.kovasuite.com`
reportan el mismo SHA. Todo lo fusionado hasta ese PR está publicado. Lo más reciente:

- Corrección de acceso por facturación e imágenes de ejecución endurecidas (#287).
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

## Gates abiertos

Ordenados por impacto en la venta. Ninguno se marca cerrado sin evidencia.

1. **Cobro live de Stripe.** Aceptar checkout, renovación y cancelación reales con la cuenta live
   antes de abrir acceso pagado general. El simulacro en sandbox está en
   [stripe-sandbox-drill](runbooks/stripe-sandbox-drill.md).
2. **Restauración de respaldo.** Ensayar la restauración completa con
   [restore-supabase-backup](runbooks/restore-supabase-backup.md). El respaldo diario a R2 corre.
3. **Correo transaccional.** Dominio y DNS de Resend están verificados, pero la entrega de los
   cinco correos se comprobó en agosto con Fly. Repetirla desde el backend en Cloudflare
   ([email-deliverability](email-deliverability.md)).
4. **Protección de rama.** Exigir `CI required` en `main` desde GitHub ([despliegue](despliegue.md)).
5. **Revisión con el dueño** de turno, costos y catálogo en su negocio real.
6. **Dispositivos físicos.** Lectura del QR de la tarjeta, cajón de dinero y operación offline en
   los equipos del negocio ([checklist](claude/manual-qa-checklist.md#offline-funciona-sin-internet)).
7. **WhatsApp real.** App de Meta, número de prueba, credenciales en el Secret store, challenge del
   webhook y una entrega aceptada.
8. **CFDI.** Datos del emisor, recorrido Test completo con Facturapi y, sólo después, una operación
   Live controlada.
9. **Piloto multi-giro.** Reclutar y observar la cohorte para medir la activación del análisis
   ([spec](../specs/reports/analysis_activation.md)). Es investigación comercial, no código.

## Reglas de este archivo

- Sólo estado actual y gates abiertos. Cuando un gate se cierra, se borra de aquí y la evidencia
  queda en su PR.
- No repetir criterios de aceptación: enlazar la spec, el runbook o el ADR dueño.
- Lo que no se va a construir va en [`deferred-scope.md`](deferred-scope.md).
- Índice de documentación: [`README.md`](README.md).
