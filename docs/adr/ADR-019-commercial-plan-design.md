# ADR-019: Diseño comercial de Esencial y Gestión

## Estado

Diseño comercial aprobado por el dueño el 2026-11-02. Implementación y publicación pendientes.
La aprobación conserva expresamente los acuerdos actuales y exige medir atención y consumo antes
de cerrar la rentabilidad. No autoriza cambiar precios en producción, suscripciones, planes de
proveedores ni publicar la nueva oferta.

## Contexto

El producto implementa un solo Standard de $299 MXN/mes, conforme a
[ADR-003](ADR-003-single-standard-plan.md). El contrato vigente se comprueba en
[`backend/app/billing/service.py`](../../backend/app/billing/service.py) y
[`frontend/src/billing/standardPlan.ts`](../../frontend/src/billing/standardPlan.ts).

La propuesta anterior incluía horas y tarifas de trabajo sin medir y reservas de herramientas
sin facturas. No son gastos comprobados. Tampoco prueban un margen final ni un número de clientes
necesario para alcanzar equilibrio. Los precios nuevos se evalúan por valor, mercado y costos
observables, sin presentar trabajo propio no medido como gratuito.

## Decisión

1. Avanzar con el diseño de dos planes mensuales para nuevas contrataciones, con precios finales
   propuestos de **$399 MXN para Esencial** y **$699 MXN para Gestión**, IVA incluido. Antes de
   publicarlos, confirmar el tratamiento fiscal y su representación coherente en Stripe y Kova.
2. Conservar las condiciones comprometidas con los clientes Standard actuales. No migrar ni
   restringir sus funciones automáticamente; las cortesías permanentes siguen su contrato propio.
3. Medir horas de atención y consumo antes de afirmar rentabilidad. Los datos faltantes permanecen
   sin medir; no se convierten en cero ni se sustituyen por reservas arbitrarias.
4. Reutilizar health, comprobación de base, Kova Ops, logs de Cloudflare y Sentry. Verificar la
   detección y entrega de las alertas externas existentes. No presupuestar una nueva herramienta de
   monitoreo sin una necesidad y un costo identificados. Ver
   [monitoreo](../runbooks/monitoreo.md) y [Kova Ops](../runbooks/ops-dashboard.md).

### Distribución a concretar antes de implementar

| Aspecto | Esencial | Gestión |
|---|---|---|
| Operación diaria | Caja, inventario básico, turnos, cortes, tickets y resumen de ventas | Todo Esencial |
| Gestión adicional | — | Compras, proveedores, análisis, lealtad y seguimiento comercial |
| Continuidad y datos | Offline, permisos, exportación y respaldo operativo | Las mismas garantías |
| Sucursal propuesta | Una | Una |
| Cajas simultáneas propuestas | Una | Tres, sujeto a aceptación de concurrencia |

Esta distribución es un diseño, no una matriz de permisos ya implementada. La división exacta de
recorridos como pedidos, cotizaciones y análisis necesita especificación y QA. No ofrecer módulos
apagados o pendientes de aceptación como beneficios disponibles. En particular:

- Gastos y su análisis conservan [ADR-015](ADR-015-expenses-standard-plan-rollout.md) para el
  Standard vigente. Cualquier diferenciación futura para nuevas altas debe especificar su alcance
  sin quitar lo prometido a clientes anteriores ni convertir el flag de rollout en un plan.
- No fijar topes de usuarios o SKU a partir de costos no medidos. Conservar cuentas individuales y
  permisos seguros; no inducir a compartir credenciales.
- Los topes de imágenes de 250 MB y 1 GB son candidatos provisionales, sujetos a medición. Validar
  su aplicación antes de venderlos. Ningún tope borra historial ni pierde ventas pendientes.
- Hardware, IA externa, documentos, WhatsApp y CFDI necesitan aceptación y, cuando corresponda,
  costos del proveedor y consumo incluido definidos. No prometer consumo ilimitado.
- Configuración, migración y capacitación personalizadas pueden cotizarse por alcance como
  servicios opcionales. No confundir sus precios comerciales con nuestro costo de trabajo.

## Medición necesaria

Responsable operativo: el dueño, o la persona que designe. Empezar con registro operativo y
facturación disponibles; esta decisión no crea telemetría ni contratos nuevos en producción.

| Medición | Qué registrar | Cómo interpretarla |
|---|---|---|
| Alta y migración | Fecha, categoría y minutos por negocio | Trabajo inicial, separado de la atención recurrente |
| Atención recurrente | Categoría, minutos y si fue falla o capacitación | Costo y frecuencia de la ayuda, sin cobrar correcciones de Kova como extras |
| Mantenimiento | Horas y actividad compartida | Separado de implementar funciones nuevas |
| Proveedores | Periodo, moneda, importe, impuestos y unidad consumida | Separar factura pagada, consumo acumulado y proyección |
| Consumo por negocio | Unidad y origen de la medición, si existe atribución fiable | Si solo hay dato compartido, declararlo compartido |
| Validación comercial | Oferta presentada, pago, renovación y motivo de elección cuando se conozca | Diferenciar intención, pago confirmado y renovación |

El registro de atención no necesita correos, contraseñas, cookies, contenido de mensajes ni
detalles de pagos. Usar referencias internas en el registro operativo protegido. La remuneración
del dueño debe ser una decisión explícita; conservar horas medidas aunque no se les haya asignado
una tarifa. No inferir capacidad o costo por cliente a partir del volumen de QA.

## Antes de publicar

- Especificar la matriz definitiva, altas por cohorte, cambios de plan y conservación del historial.
- Separar permisos comerciales, RBAC y rollout; el servidor conserva la autoridad. Mantener RLS,
  autenticación, verificación de webhooks e idempotencia.
- Validar Stripe en sandbox: precio final, impuestos, checkout, renovación, pago fallido,
  actualización y reducción de plan. No habilitar permisos pagados por el éxito declarado por el
  navegador.
- Probar cambio de plan con operaciones y sincronizaciones pendientes, reimpresión e historial.
- Hacer QA a 390 y 1440 px, teclado, límites de imágenes y concurrencia de cajas propuesta.
- Confirmar las ampliaciones de proveedores por cuota y necesidad real; su aprobación de gasto
  no se deduce de aprobar los precios comerciales.
- Publicar únicamente después de completar la implementación, sus pruebas y la autorización de
  publicación. La rentabilidad y los tiempos de respuesta no se presentan como validados sin datos.

## Relación con decisiones anteriores

ADR-003 y ADR-015 siguen describiendo la operación vigente y los acuerdos anteriores. Este ADR
registra el diseño aprobado para una evolución posterior. El cambio de comportamiento para nuevas
altas requiere una entrega explícita con specs y evidencia; no se modifica retroactivamente el
historial de decisiones.
