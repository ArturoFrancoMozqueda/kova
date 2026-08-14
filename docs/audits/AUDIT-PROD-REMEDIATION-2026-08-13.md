# Remediación de auditoría — Épica PROD

Fecha: 2026-08-13

Rama: `feature/audit-product-remediation`

Alcance: decisiones de producto y preparación de investigación; sin implementación de CRM,
proveedores, compras o cambios de entitlement.

## Resultado

| ID | Estado después de esta remediación | Evidencia | Qué falta |
|---|---|---|---|
| PROD-1 | **Cerrado como decisión** | [`ADR-015`](../adr/ADR-015-expenses-standard-plan-rollout.md) fija entitlement y navegación | La salida del rollout y UX-2 son trabajo posterior; falta el conteo operativo anonimizado de overrides |
| PROD-2 | **Diferido por señal; protocolo listo** | Protocolo y plantilla de síntesis de este documento | Ejecutar entrevistas consentidas y reunir 5–10 datos consistentes por segmento antes de decidir alcance |

La épica PROD completa no debe marcarse cerrada: PROD-2 depende de evidencia externa que no existe
en el repositorio. Preparar el instrumento no equivale a completar entrevistas.

## PROD-1 — trazabilidad de la decisión

La evidencia interna sí alcanza para decidir:

- ADR-003 y la especificación del Plan Standard prohíben tiers o add-ons en v1 y permiten flags
  sólo para módulos incompletos o internos.
- ADR-012 acepta Gastos y su resultado operativo aproximado, y los mantiene bajo `margin_reports`
  durante rollout.
- Navegación, vista de Gastos y secciones de margen/gastos en Análisis consultan el mismo flag.
- La landing promete reportes de ventas/productos/horarios/pagos; no promete Gastos, utilidad neta
  ni contabilidad.

Decisión resumida: Gastos está incluido en el Plan Standard cuando se habilita; `margin_reports` es
rollout, no monetización. Sólo owner/manager con permiso ve la navegación. La ruta directa conserva
su guard y no se amplían claims mientras la disponibilidad no sea general.

### Límite de evidencia

El repositorio demuestra el default (`false`) y el mecanismo de override, pero no el estado de
tenants desplegados. No se consultó producción. Antes de retirar el flag, Operaciones debe registrar
un corte agregado con fecha y ambiente:

| Ambiente | `enabled` | `disabled` | `unknown/no boolean` | Fuente/commit |
|---|---:|---:|---:|---|
| producción | pendiente | pendiente | pendiente | pendiente |

No adjuntar tenant IDs, nombres, correos ni JSON completo de overrides.

## PROD-2 — lo que la evidencia actual permite afirmar

- **Pedidos no es CRM.** Captura snapshots operativos de nombre/dirección/teléfono para cumplir un
  pedido, y su especificación excluye explícitamente CRM.
- No hay módulo independiente de clientes, proveedores, órdenes de compra o recepción.
- `docs/deferred-scope.md` y `PLAN-KOVA-COPILOT.md` aprueban la dirección futura, pero mantienen
  clientes ligeros, compras y proveedores detrás de gates de fase y señal.
- `PLAN-GROWTH-EXECUTION.md` exige 10 pilotos activos antes de reabrir clientes/fiado. El playbook
  define activo como al menos una venta completada en cada una de cuatro semanas consecutivas.
- No hay entrevistas, transcripciones ni respuestas estructuradas suficientes en git. No se crean
  personas, frecuencia, intensidad ni claims a partir de ausencia de datos.

### Drift observado, fuera de esta decisión

`specs/customer_orders/customer_orders.md` dice que `customer_orders` está apagado por defecto,
pero `backend/app/tenants/feature_flags.py` y sus tests esperan `true`. Esto no convierte Pedidos en
CRM ni autoriza Clientes. El owner de Pedidos debe decidir qué fuente refleja el rollout vigente y
corregir el contrato en una tarea separada.

## Protocolo mínimo de validación

### Objetivo y muestra

Decidir por separado el menor alcance útil para:

1. clientes: directorio, historial, fiado/crédito;
2. proveedores/compras: directorio, pedido de compra, recepción y actualización de costo.

Entrevistar dueños o responsables operativos de cafeterías y panaderías. Analizar cada vertical por
separado. Un área sólo puede avanzar cuando reúna **5–10 datos independientes y consistentes por
segmento**, además de los gates de fase ya aprobados. Cuentas internas, demos y opiniones del equipo
no cuentan como evidencia de cliente.

### Reclutamiento y privacidad

- Priorizar pilotos activos según la definición del playbook; incluir abandonos consentidos cuando
  ayuden a entender un bloqueo real.
- Contacto, agenda, consentimiento, audio y notas identificables viven únicamente en el CRM o
  archivo privado autorizado, nunca en git.
- Usar `pilot_code` (`P-01`…`P-10`) en artefactos versionados. No unir el código con `client_id`,
  `tenant_id`, correo, teléfono o nombre comercial.
- Pedir consentimiento para notas. Audio requiere consentimiento separado. Una negativa se respeta
  y sólo se registra como `declined` en el sistema privado.

### Guion conductual (20 minutos)

Preguntar por el último caso real, no por deseos hipotéticos:

1. Cuéntame la última vez que necesitaste reconocer a un cliente que volvió. ¿Qué hiciste y dónde
   quedó esa información?
2. En la última venta a crédito o fiada, si ocurrió, ¿cómo registraste saldo, abonos y vencimiento?
   ¿Quién lo revisó después?
3. ¿Qué información de un cliente necesitas durante la venta y cuál nunca capturarías?
4. Cuéntame la última compra de insumos o mercancía: desde que notaste la necesidad hasta que llegó.
5. ¿Cómo elegiste proveedor y cómo registraste precio, cantidad pedida y cantidad recibida?
6. Cuando el costo recibido cambió, ¿cómo actualizaste inventario o precio? ¿Qué error ocurrió la
   última vez que ese proceso falló?
7. ¿Qué herramienta usaste en cada paso y qué seguiste haciendo fuera de ella?
8. ¿Con qué frecuencia ocurrió en las últimas cuatro semanas? Solicitar ejemplos contables, no una
   estimación complaciente.
9. Si sólo pudiéramos resolver un paso, ¿cuál evitaría más trabajo o riesgo? ¿Qué parte debe seguir
   fuera de Kova?

No enseñar un mockup de CRM o Compras antes de las preguntas: sugerir la solución contamina la
respuesta. No prometer función, proveedor ni fecha al cerrar.

### Registro privado por entrevista

La nota fuente puede conservar detalle dentro del sistema privado autorizado. La síntesis que sí
puede llegar al repositorio usa exclusivamente categorías:

| Campo | Valores permitidos |
|---|---|
| `research_id` | código aleatorio sin significado externo |
| `pilot_code` | `P-01`…`P-10` |
| `segment` | `cafeteria`, `panaderia`, `otro` |
| `evidence_type` | `interview`, `observed_workflow`, `support_case` |
| `job` | `customer_directory`, `purchase_history`, `credit`, `supplier_directory`, `purchase_order`, `receiving`, `cost_update` |
| `frequency_4w` | `0`, `1`, `2_3`, `4_7`, `8_plus`, `unknown` |
| `intensity` | `low`, `medium`, `high` |
| `current_tool` | `paper`, `spreadsheet`, `whatsapp`, `other_software`, `memory`, `none`, `mixed` |
| `outcome` | `must_have`, `useful`, `not_needed`, `anti_fit`, `unknown` |
| `consent` | `notes_only`, `notes_and_quote`, `declined` |

No incluir texto libre, nombres, contactos, importes, productos, proveedores ni IDs operativos. Una
cita sólo puede publicarse por separado si fue consentida y anonimizada manualmente.

### Síntesis y decisión

Calcular frecuencia por `job` y segmento; no promediar cafeterías y panaderías. Clasificar la
confianza:

- **alta:** 3 o más fuentes independientes del segmento mencionan el problema sin ser dirigidas;
- **media:** 2 fuentes o la necesidad apareció sólo después de una pregunta;
- **baja:** una fuente o respuesta hipotética.

La decisión debe escoger una de estas salidas por área: `no abrir`, `seguir investigando`,
`especificar alcance mínimo`, o `rechazar por anti-fit`. “Especificar” exige 5–10 datos consistentes
del segmento y una Feature Spec posterior con RLS, RBAC, auditoría, idempotencia, BDD y efecto
offline. No se agrupa automáticamente directorio + historial + crédito, ni proveedor + compra +
recepción + costo.

## Uso correcto de la telemetría existente

No se añadió instrumentación nueva.

- `growth-snapshot` aporta conteos agregados de activación y pago; ayuda a saber si existe una base
  suficiente de pilotos, pero no selecciona entrevistados ni prueba demanda.
- `analysis-adoption` mide uso de Análisis y acciones recomendadas. Las áreas `cliente` y `gasto`
  son categorías acotadas; no prueban necesidad de CRM o Compras. No existe área `proveedor`.
- Las ventas completadas son fuente de verdad para actividad, pero el contacto con un piloto debe
  resolverse en el sistema privado autorizado, sin intentar reidentificar exports anónimos.
- Añadir clics sobre una función inexistente, un botón “próximamente” o texto libre produciría señal
  dirigida y riesgo de PII. La instrumentación de adopción se diseña después de aprobar una Feature
  Spec, no para sustituir entrevistas.

## Claims y alcance mientras PROD-2 siga diferido

- No presentar Pedidos como CRM.
- No afirmar que Kova administra clientes, cartera, proveedores, compras o recepción.
- No usar “próximamente” ni comprometer fecha.
- Puede comunicarse que el alcance está en investigación sólo en conversaciones directas y sin
  convertirlo en promesa comercial.

## Validación realizada

Cambio exclusivamente documental. Se revisaron ADRs, plan y especificación de billing, flags y
tests, navegación/rutas, Gastos, Análisis, landing, alcance diferido, roadmap, growth y contratos de
telemetría. No se ejecutaron tests de código porque no cambió comportamiento.
