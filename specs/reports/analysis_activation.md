# Kova — medición de activación del análisis accionable

## Objetivo

Medir si el análisis lleva al dueño desde un hallazgo real hasta una acción, sin almacenar en
telemetría importes, nombres de productos, clientes, consultas ni texto libre.

Kova conserva las órdenes y los reportes tenant-scoped como fuentes de verdad. La telemetría solo
registra categorías necesarias para calcular adopción.

## Taxonomía de decisiones

- `caja`: pagos, devoluciones, cancelaciones y limpieza operativa.
- `inventario`: agotados, reabasto, productos sin seguimiento, caídas y sobrestock.
- `margen`: costos y utilidad; reservado para reglas posteriores.
- `gasto`: gasto operativo; reservado para reglas posteriores.
- `cliente`: recurrencia y cartera; reservado para fases posteriores.
- `empleado`: cobertura y contribución del equipo.
- `crecimiento`: ventas, ticket, horarios tranquilos y productos nuevos.

## Eventos autenticados

| Evento | Cuándo ocurre | Propiedades permitidas |
|---|---|---|
| `close_shift` | El backend confirma el cierre de turno | Contexto común únicamente |
| `analysis_viewed` | Un reporte con ventas reales termina de cargar | `range_days`, `preset`, `has_previous_period`, `recommendation_count` |
| `analysis_recommendation_opened` | El dueño abre “Ver por qué” | `template_id`, `decision_area`, `priority`, `surface` |
| `analysis_action_started` | El dueño abre el flujo donde puede actuar | Mismas categorías de recomendación |
| `analysis_action_completed` | Marca una acción como hecha | Mismas categorías de recomendación |
| `analysis_action_reopened` | Revierte una acción hecha | Mismas categorías de recomendación |
| `analysis_action_feedback` | Confirma si una acción completada fue útil | Mismas categorías más `helpfulness`: `helpful` o `not_yet` |

El backend deriva `tenant_id` y `user_id` de la sesión. No acepta estos identificadores desde el
cliente. Los eventos son idempotentes por `tenant_id + client_event_id`.

## Reglas de privacidad y exactitud

- No enviar ventas, importes, márgenes, nombres, correos, teléfonos, IDs de órdenes, productos,
  clientes, empleados o proveedores, ni texto de la recomendación.
- `template_id` solo admite las reglas deterministas `R1`–`R13`. Las acciones iniciadas,
  completadas, reabiertas o evaluadas solo admiten `R1`–`R12`; `R13` es una señal informativa.
- El periodo admite 1–366 días y un máximo de 20 recomendaciones reportadas.
- Los eventos no sustituyen el estado operativo ni demuestran causalidad; solo prueban interacción.
- Un fallo de telemetría nunca bloquea caja, cierre, reportes ni navegación.

## Criterios de aceptación

1. Una visita repetida a Análisis produce una nueva observación para medir retorno, pero una misma
   respuesta no se duplica por re-render de React.
2. Abrir evidencia, iniciar una acción, completarla, evaluarla y reabrirla producen eventos distintos.
3. Los payloads con importes, plantillas o categorías desconocidas reciben validación negativa.
4. La telemetría autenticada conserva cookie-only session y CSRF.
5. El nombre visible de la superficie autenticada permanece como “Análisis” y la ruta `/reports`
   permanece estable.

## Métrica principal

`negocios con feedback helpful en 7 días / negocios con analysis_viewed en 7 días`

La finalización se conserva como proxy secundaria; la métrica principal exige confirmación explícita
de utilidad. También se reportan apertura de evidencia, inicio, reaperturas, adopción entre negocios
con ventas, retorno contra la ventana anterior y la secuencia observable venta → cierre → Análisis.
Las reaperturas se muestran aparte y no se interpretan automáticamente como fracaso.

El reporte usa órdenes completadas y turnos cerrados como fuente de verdad para actividad y recorrido.
La secuencia no demuestra que el usuario actuó sin asistencia ni que Kova causó el resultado.
Un negocio activo es aquel con al menos una orden completada dentro de la ventana. El retorno compara
los negocios que consultaron Análisis en la ventana actual contra quienes lo hicieron en la ventana
inmediatamente anterior de la misma duración.
