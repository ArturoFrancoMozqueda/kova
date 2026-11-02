# ADR-020: Base comercial multiplan con activación separada

## Estado

Implementación con pruebas locales de backend y migración aprobadas. La activación comercial y
la aceptación con Stripe sandbox siguen pendientes. Esta entrega no cambia precios ni
suscripciones en producción. La evidencia local y sus límites están en la guía de aceptación.

## Contexto

El dueño autorizó implementar en equipo el diseño de [ADR-019](ADR-019-commercial-plan-design.md):
Esencial $399 y Gestión $699 MXN mensuales finales, preservando acuerdos existentes y midiendo
trabajo/consumo. El contrato operativo anterior es [ADR-003](ADR-003-single-standard-plan.md).
Mantener un importe único en el backend, confiar en la selección del navegador o reutilizar
flags de rollout como planes no permite aplicar esa decisión de forma segura.

## Decisión

1. Persistir la cohorte comercial del negocio. El valor predeterminado y la migración conservan
   Standard para negocios anteriores, incluso sin una suscripción de Stripe. No inferir cohortes
   desde fechas editables, importes enviados por el cliente ni cambios de configuración posteriores.
2. Separar la habilitación de ofertas/altas nuevas de la resolución de planes ya asignados. La
   oferta multiplan permanece apagada por defecto. Apagarla después no convierte Esencial en
   Standard ni concede funciones adicionales a una suscripción existente.
   La prueba finita de una cohorte nueva permite evaluar Gestión, sin modificar su duración ni
   convertir la prueba en pago o en acceso permanente.
3. Resolver en el servidor el plan y sus capacidades; RBAC y acceso comercial conservan controles
   independientes. El tenant procede de la sesión. Un plan no concede permisos de gerente o dueño,
   ni sustituye validación de pago, sesiones, CSRF o RLS.
4. Añadir al estado comercial autenticado `plan_code`, `plan_name`, `features` y `limits`. El
   catálogo de facturación expone `available_plans` y `tiered_pricing_enabled`. Estos datos guían la
   presentación del frontend; no convierten sus decisiones en autorización del servidor.
5. Admitir solo los precios de Stripe configurados y verificados por entorno, moneda e intervalo.
   Los importes finales nuevos son 39900 y 69900 unidades menores MXN al mes. Verificar su
   tratamiento fiscal antes de activarlos. La selección y la vuelta de Checkout no conceden
   funciones: mandan el estado validado y la sincronización autoritativa de Stripe.
6. Mantener firma, modo, idempotencia, bloqueos y orden temporal de eventos. Precios desconocidos
   o datos no verificables no habilitan Gestión. La cortesía conserva su contrato y no simula una
   suscripción pagada; los clientes anteriores no migran de plan por recibir un webhook repetido.
   Una reserva durable anterior al HTTP externo comparte la clave de Checkout entre pestañas y
   administradores. Un resultado incierto no libera otro intento cobrable. La eliminación de
   cuenta conserva esa referencia hasta verificar su resolución; su payload interno no se exporta.
7. Aplicar capacidades también en rutas directas, agregados del panel, herramientas del asistente,
   solicitudes públicas y trabajos. No basta ocultar menús. Catálogo público/QR y ventas de Caja son
   funciones básicas; no se despublican porque falte una capacidad comercial adicional.
8. Conservar datos y continuidad al reducir plan, con acceso comercial vigente: lectura histórica,
   exportación y resolución expresamente admitida de compromisos anteriores. No crear nuevos
   pedidos, compras, cotizaciones, programas o acumulaciones que requieran Gestión. Una pérdida de
   acceso por falta de pago sigue su política de bloqueo, sin una excepción genérica de historial.
   El servidor guarda en cada venta su elegibilidad de lealtad; los trabajos diferidos respetan
   derechos devengados previos sin convertir ventas Esencial en puntos al subir de plan después.
9. Mantener separado el rollout de Gastos/margen. [ADR-015](ADR-015-expenses-standard-plan-rollout.md)
   conserva lo prometido a Standard; tener Gestión no habilita un módulo todavía apagado ni
   transforma resultados aproximados en utilidad neta o fiscal.
10. No añadir cobro por usuario o SKU, proveedor nuevo de monitoreo ni presupuestos de trabajo
    inventados. Los límites de imágenes necesitan contabilidad de bytes y concurrencia segura;
    las cajas simultáneas no se anuncian como garantizadas sin su mecanismo y aceptación reales.

## Contrato y validación

El detalle por capacidad y las transiciones viven en
[la especificación comercial](../../specs/billing/commercial_plans.md). Las pruebas deben cubrir
Standard, cortesía, altas opt-in, ambos planes, cambios y fallas de verificación, precios ajenos,
webhooks repetidos o fuera de orden, acceso por URL y conservación de ventas offline.

[La guía de aceptación y medición](../runbooks/commercial-plan-acceptance.md) separa resultados
locales, sandbox y producción. No atribuir al backend un consumo por negocio que el proveedor solo
reporta de forma compartida. Los importes cobrados y las horas registradas no prueban por sí solos
una rentabilidad definitiva.

## Consecuencias y relación con el contrato anterior

- El servidor dispone de una base para la evolución aprobada sin obligar a una migración comercial.
- La implementación amplía el contrato de ADR-003 para cohortes nuevas cuando se active la oferta;
  Standard y sus condiciones anteriores permanecen vigentes para los negocios correspondientes.
- Los flags de producto, los permisos del rol, el pago y el plan deben probarse en combinación.
  Una de esas condiciones favorable no compensa otra condición denegada.
- Las políticas de transición añaden casos de operación que requieren evidencia; no se presentan
  como terminados solo por existir esta decisión o el catálogo de precios.
