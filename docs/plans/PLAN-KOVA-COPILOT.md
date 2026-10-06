# Plan de producto — Kova como copiloto del dueño

Estado: aprobado por producto; ejecución secuencial y condicionada por gates.

Actualización 2026-10-05: el dueño solicitó el diseño completo del asistente por tenant, incluyendo
configuración confirmada, archivos, RAG, memoria y seguimiento. Su evaluación, arquitectura,
escenarios y etapas viven en el [plan técnico del asistente](PLAN-ASISTENTE-TENANT.md).
Actualización 2026-10-06: piloto implementado en `codex/tenant-assistant`; activación y gates externos
pendientes. [Operación y evidencia](../assistant-operations.md). La autorización no incluye cargos/despliegues ni
cierra gates operativos.

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
los gates anteriores, salvo ampliaciones expresamente solicitadas por el dueño y documentadas con
sus propios gates. El asistente tiene etapas AS-0–AS-6 en su plan técnico; las ventanas de esta tabla
no constituyen fechas comprometidas para esa implementación ni habilitan capacidades de dominio
que todavía no existen.

## Contratos no negociables

- Órdenes y snapshots de la venta son la fuente de verdad histórica.
- Toda tabla futura incluye `tenant_id`, RLS, RBAC, auditoría e idempotencia.
- CFDI es asíncrono: una caída del proveedor no bloquea el cobro ni produce un estado “emitido” falso.
- Certificados y credenciales fiscales permanecen cifrados, fuera del frontend y de logs.
- Mutaciones fiscales, de inventario y de crédito requieren conexión; la venta offline conserva los
  snapshots necesarios y se procesa después de sincronizar.
- “Pregúntale a Kova” mantendrá las consultas de datos y métricas aprobadas en modo de lectura,
  sin generar SQL contra producción y sin inventar respuestas cuando falte evidencia. La ampliación
  solicitada permite configuración mediante propuestas concretas y confirmación explícita, ejecutadas
  por servicios autorizados con validación, auditoría e idempotencia, fuera del bucle del modelo.
- El asistente no tiene acceso a infraestructura, código de Kova, secretos, Ops ni herramientas
  arbitrarias de código/red. El aislamiento abarca tenant, sucursal, ACL privada, jobs, cachés,
  memoria, fuentes y entregas; los permisos se imponen en backend y base de datos.
- Importar catálogo y consultar conocimiento son flujos distintos: una importación validada y
  confirmada puede cambiar datos; cargar un documento RAG no configura el negocio automáticamente.
- La cuota gratuita de inferencia se comparte y reserva con límites por cuenta, tenant y usuario;
  no hay fallback de pago automático. Capacidad comercial requiere observación real.
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
