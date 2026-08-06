# Plan de producto — Kova como copiloto del dueño

Estado: aprobado por producto; ejecución secuencial y condicionada por gates.

## Promesa

**Kova te dice qué cambió en tu negocio, por qué importa y qué conviene hacer hoy.**

El ciclo objetivo es `detectar → explicar → recomendar → ejecutar → medir`. Kova debe usar
datos reales, mostrar evidencia y distinguir claramente entre observación, correlación y causalidad.
Nunca debe inventar costos, pronósticos, razones ni datos faltantes.

## Secuencia aprobada

| Fase | Ventana | Resultado | Gate de salida |
|---|---:|---|---|
| 0 | Semanas 1–6 | Confiabilidad, telemetría, taxonomía y piloto | Métricas entendibles, gates operativos cerrados y 10 negocios con 4 semanas activas |
| 1 | Meses 2–4 | Paridad comercial mexicana | Descuentos, impuestos, códigos de barras, clientes ligeros y CFDI probados |
| 2 | Meses 5–7 | Ciclo de inventario y dinero | Compras, recepción, crédito y recomendaciones deterministas |
| 3 | Meses 8–10 | Crecimiento y recurrencia | Clientes, objetivos, plan semanal, resultados y consultas controladas |
| 4 | Meses 11–12 | Supervisión remota | Centro del dueño; multiubicación solo si cumple demanda/pilotos |

La Fase 0 tiene una primera entrega técnica activa en
[`specs/reports/analysis_activation.md`](../../specs/reports/analysis_activation.md). Las capacidades de
las fases siguientes están aprobadas como dirección, pero no deben desarrollarse antes de superar
los gates anteriores.

## Contratos no negociables

- Órdenes y snapshots de la venta son la fuente de verdad histórica.
- Toda tabla futura incluye `tenant_id`, RLS, RBAC, auditoría e idempotencia.
- CFDI es asíncrono: una caída del proveedor no bloquea el cobro ni produce un estado “emitido” falso.
- Certificados y credenciales fiscales permanecen cifrados, fuera del frontend y de logs.
- Mutaciones fiscales, de inventario y de crédito requieren conexión; la venta offline conserva los
  snapshots necesarios y se procesa después de sincronizar.
- “Pregúntale a Kova” será tenant-scoped, read-only y limitado a métricas aprobadas. No generará SQL
  directo contra producción y rechazará respuestas con datos insuficientes.
- El piloto conserva el precio vigente; cualquier tarifa fiscal depende de costos contractuales y
  consumo real verificados.

## Métrica y gates de producto

Métrica principal: negocios que completan al menos una acción recomendada útil por semana entre
los negocios que consultaron Análisis esa semana.

Después del cuarto mes deben cumplirse:

- 50% o más de los negocios activos consulta Análisis semanalmente.
- 30% o más completa una recomendación semanal.
- 70% o más completa venta, cierre y consulta de resultado sin asistencia.
- Cero incidentes de mezcla de tenants, pérdida de ventas o CFDI marcado incorrectamente como emitido.

Se revisan mensualmente retención, tiempo ahorrado, decisiones ejecutadas y valor declarado. La
cantidad de funcionalidades no es una métrica de éxito.

## Alcance excluido

No compiten por prioridad tienda en línea, fabricación, KDS, nómina, contabilidad completa,
marketplace, hardware propio, jerarquías de franquicia ni automatización masiva de marketing. Consulta
[`docs/deferred-scope.md`](../deferred-scope.md) para el alcance diferido completo.
