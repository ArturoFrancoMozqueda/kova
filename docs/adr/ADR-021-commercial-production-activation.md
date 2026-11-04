# ADR-021: Activación productiva de Esencial y Gestión con Portal básico

## Estado

Decisión autorizada por el dueño el 2026-11-03 al solicitar alinear producción con Esencial
$399/Gestión $699. La [aceptación interactiva del Portal básico sandbox](../audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md)
ya aprobó para los tres planes, con fuentes por etapa y limpieza completa. La activación
productiva está autorizada: esta entrega fija flags nativas ON y gate `tiered`, y su publicación
se acredita con release PASS y verificación externa registrada por separado. No se acredita éxito
headless ni se presenta la prueba como aceptación operativa del dueño en un negocio real.

Sustituye la decisión de mantener la oferta productiva apagada de
[ADR-020](ADR-020-commercial-plan-foundation.md), conservando sus contratos de cohortes,
capacidades, pago, datos y seguridad. También sustituye la limitación de autorización de
[ADR-019](ADR-019-commercial-plan-design.md): la aprobación inicial era solo de diseño; la
instrucción posterior autoriza la alineación productiva dentro del alcance descrito aquí.
Los ADR anteriores se conservan como registro histórico.

## Contexto

El catálogo y las capacidades ya distinguen Standard, Esencial y Gestión. Los tres planes tienen
aceptación de Checkout y ciclo de suscripción en sandbox contra Kova/PostgreSQL aislados. Las
referencias públicas del catálogo live se prepararon sin modificar acuerdos existentes; la
baseline de Kova `7032d21f60aa` se verificó OFF antes de esta entrega de activación.

Los Products separados conservan el nombre de cada plan en Checkout y comprobantes. Stripe no
programa el downgrade requerido entre esos Products mediante el Portal. Habilitar cambios de plan
no es necesario para ofrecer contrataciones nuevas con un Portal limitado a administración básica.

## Decisión

1. Publicar para nuevas altas Esencial **$399 MXN/mes** y Gestión **$699 MXN/mes**, con el catálogo
   y las capacidades resueltos por el servidor. El registro debe confirmar la revisión de oferta
   presentada; una revisión ausente u obsoleta falla antes de crear tenant o enviar correo.
2. Mantener un Product separado por plan. Conservar `STRIPE_STANDARD_PRICE_ID` y los acuerdos
   Standard anteriores de $299, sin reclasificarlos ni trasladarlos por configuración, webhook o
   publicidad. La cortesía permanente conserva acceso y alcance, sin simular pago ni ofrecer Checkout.
3. Activar inicialmente **solo Portal básico**: historial de facturas, método de pago y cancelación
   al cierre del período. Cambios de plan/cantidad, pausa y página pública de acceso permanecen
   deshabilitados. Ambas cohortes pueden compartir la configuración mientras no permita cambios
   de suscripción. No anunciar ni ofrecer upgrade, downgrade o migración autónomos entre planes.
4. Separar la aceptación del Portal básico de una futura aceptación de transiciones. Antes del
   release inicial exigir evidencia integrada de Kova con el Portal básico, incluido guardado de
   método de pago y cancelación, sin modificar suscripciones de clientes. La programación/aplicación
   de cambios de plan queda fuera del alcance inicial y requiere otra decisión, contrato y evidencia.
5. Los importes inclusivos describen el precio público final y deben coincidir con la configuración
   verificada de Stripe. `tax_behavior=inclusive` no demuestra registro fiscal, cálculo automático
   de impuestos, CFDI ni aceptación contable. Mantener abierta esa validación sin presentar tales
   prestaciones como disponibles. Publicar el catálogo no equivale a declarar completada la
   aceptación fiscal o un cobro live controlado.
6. Ejecutar la activación por PR y workflow normal, tras aceptar una baseline con los cuatro IDs
   públicos en API y jobs. Cambiar conjuntamente la política de flags y la oferta esperada por el
   gate público, que verifica API/proxy antes de promoción y después de publicación. No eludir
   `CI required`, comprobaciones de despliegue ni recuperación por versiones capturadas.
7. Si falla la activación, recuperar la baseline **OFF posterior al transporte**: conserva los
   cuatro IDs y resuelve acuerdos tiered ya asignados. Apagar nuevas ofertas no migra sus planes,
   invalida pagos ni borra datos. No retirar IDs ni bajar la base como parte del rollback; no usar
   como baseline una versión anterior al transporte de referencias.

## Aceptación y límites

Los criterios y resultados viven en [la guía de aceptación](../runbooks/commercial-plan-acceptance.md)
y el contrato en [planes comerciales](../../specs/billing/commercial_plans.md). La evidencia
interactiva sandbox ya está revisada: Checkout/método de pago en `85284316` y cancelación/acceso
en `7032d21f60aa`, con reanudación Standard y rollback local OFF conservando Gestión. La
publicación de la activación requiere release PASS y verificación externa; el corte previo
`7032d21f60aa` acreditó Standard/OFF.
La recepción/conciliación histórica de riesgos live continúa pendiente, separada de la aceptación
sandbox y de la activación del catálogo autorizado.

El cobro live controlado, aceptación fiscal, hardware físico, recuperación regional y medición de
atención/consumo siguen abiertos. Ninguno se declara aprobado por publicar precios. Las pruebas
sandbox no convierten esos pendientes en aceptación live ni en una promesa de operación al 100%.
