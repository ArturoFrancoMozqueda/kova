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
de usuarios, productos y pedidos. Se hicieron 30 ejecuciones por versión sobre
bases PostgreSQL 17 aisladas en la misma máquina. La versión anterior corresponde
al commit `78d4bfc`; la versión posterior incluye el cambio de consultas del commit
`3805849`. p50 es la mediana y p95 usa nearest-rank: valor 29 de 30 tras ordenar
las muestras.

| Operación | Volumen | Antes p50 / p95 (ms) | Después p50 / p95 (ms) | Variación p50 / p95 |
|---|---:|---:|---:|---:|
| Inventario disponible | 20 productos | 18.810 / 23.156 | 9.366 / 11.894 | -50.2% / -48.6% |
| Lista de pedidos confirmados | 12 pedidos | 35.319 / 43.954 | 20.593 / 24.290 | -41.7% / -44.7% |
| Serializar venta | 8 partidas | 5.033 / 6.091 | 2.178 / 2.655 | -56.7% / -56.4% |
| Serializar pedido | 8 partidas | 7.314 / 8.704 | 4.049 / 4.871 | -44.6% / -44.0% |
| Validar reserva | 8 productos | 20.543 / 28.043 | 9.402 / 12.083 | -54.2% / -56.9% |

Para hacer comparable el código anterior, se ejecutó el archivo actual de pruebas
contra ambos commits y se desactivaron únicamente sus límites de conteo en la copia
temporal anterior. Los datos, operaciones y puntos de cronometraje fueron iguales.
Las aserciones comparan nombres, IDs, cantidades, importes, stock, reservas,
conflictos y modificadores contra los mismos valores esperados en ambas versiones.
Las regresiones de refunds, venta offline, zona horaria y costo congelado siguen
cubiertas por sus suites de dominio; no se cambió su implementación en este corte.

La siguiente medición de capacidad debe usar un volumen acordado y capturar espera
del pool y planes `EXPLAIN` en un entorno similar a producción. Este cambio
no justifica cache compartido, materializaciones ni infraestructura adicional.
