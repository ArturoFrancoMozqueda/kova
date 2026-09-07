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

## Latencia observada en el mismo volumen

También se midió el tiempo de cada operación interna, sin incluir la preparación
de usuarios, productos y pedidos. Se hicieron cinco ejecuciones por versión sobre
bases PostgreSQL 17 aisladas en la misma máquina. La versión anterior corresponde
al commit `78d4bfc`; la versión posterior incluye el cambio de consultas del commit
`3805849`. La tabla muestra mediana, rango observado y variación de la mediana.

| Operación | Volumen | Antes (ms) | Después (ms) | Variación |
|---|---:|---:|---:|---:|
| Inventario disponible | 20 productos | 16.775 (16.372–16.836) | 10.548 (8.256–12.765) | -37.1% |
| Lista de pedidos confirmados | 12 pedidos | 31.341 (30.412–33.816) | 21.135 (18.787–32.172) | -32.6% |
| Serializar venta | 8 partidas | 4.574 (4.368–4.643) | 1.933 (1.901–2.487) | -57.7% |
| Serializar pedido | 8 partidas | 6.069 (5.749–6.333) | 3.561 (3.272–4.671) | -41.3% |
| Validar reserva | 8 productos | 17.148 (16.868–19.542) | 8.807 (8.670–10.994) | -48.6% |

Para hacer comparable el código anterior, se ejecutó el archivo actual de pruebas
contra ambos commits y se desactivaron únicamente sus límites de conteo en la copia
temporal anterior. Los datos, operaciones y puntos de cronometraje fueron iguales;
las copias instrumentadas y sus bases se eliminaron después de capturar los
resultados.

La siguiente medición de capacidad debe usar un volumen acordado y capturar p95,
espera del pool y planes `EXPLAIN` en un entorno similar a producción. Este cambio
no justifica cache compartido, materializaciones ni infraestructura adicional.
