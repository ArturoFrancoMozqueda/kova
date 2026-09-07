# Baseline de consultas de rutas con crecimiento por fila

Medición local del 7 de septiembre de 2026 con PostgreSQL y datos sintéticos. El
objetivo de este bloque es limitar consultas repetidas; no representa capacidad,
latencia productiva ni un SLO.

| Ruta interna | Volumen | Antes | Después | Resultado conservado |
|---|---:|---:|---:|---|
| Inventario disponible | 20 productos | 22 consultas de stock/reserva/producto | 3 | Existencia, reservado, disponible y umbral por producto |
| Lista de pedidos confirmados | 12 pedidos, una reserva cada uno | 39 consultas base/stock/reserva | 6 | Estado de pago, conteos y conflicto de stock por pedido |
| Serializar venta | 8 partidas | 10 consultas de partidas/pagos/modificadores | 3 | Snapshots y modificadores por partida |
| Serializar pedido | 8 partidas | 9 consultas de partidas/modificadores | 2 | IDs y snapshots de modificadores por partida |
| Validar reserva | 8 productos | 17 consultas de stock/reserva | 2 | Disponibilidad bajo los mismos locks de producto |

Las pruebas `test_query_performance.py` instrumentan SQLAlchemy y fijan el número
de consultas a movimientos, reservas y modificadores independientemente del
número de filas. Los filtros de tenant permanecen en cada consulta agrupada.

La siguiente medición de capacidad debe usar un volumen acordado y capturar p95,
espera del pool y planes `EXPLAIN` en un entorno similar a producción. Este cambio
no justifica cache compartido, materializaciones ni infraestructura adicional.
