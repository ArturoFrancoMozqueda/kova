# Reposición revisada y aprobada

Estado: implementación local; no envío al proveedor ni pago automático.

`GET /api/v1/replenishment` presenta productos debajo del mínimo con disponible, reservado,
mercancía pendiente de compras abiertas, costo conocido o ausente y fingerprint de evidencia.
La cantidad sugerida busca superar el umbral configurado descontando compras pendientes; no
representa pronóstico, optimización de caducidad ni garantía de demanda.

`POST /api/v1/replenishment/approve-purchase` exige sesión con `inventory.adjust`, billing,
proveedor del negocio, selección y cantidades/costos revisados, `Idempotency-Key` y fingerprint
vigente por producto. Bajo locks de productos ordenados valida stock, reservas, compras pendientes
y costos; si cambian devuelve 409 sin compra. La creación normal de compra usa los mismos locks.

La aprobación crea una compra `pending` mediante el servicio existente. Los registros de respuesta
idempotente y compra comparten transacción. Repetir una solicitud completa devuelve la misma compra
aunque su creación ya haya cambiado la evidencia de mercancía pendiente. No recibe mercancía,
modifica costos del catálogo, envía comunicaciones ni crea gastos o pagos.

`/replenishment` muestra la evidencia, permite ajustar cantidades/costos y elegir proveedor,
presenta resumen para confirmar y enlaza a Compras para recepción posterior. Si falta costo,
no selecciona el producto automáticamente ni inventa su importe.

Pruebas: aprobación y replay, stock sin recibir, mercancía entrante, evidencia obsoleta por
ajuste o compra, costo faltante, roles y aislamiento. QA UI cubre confirmación en dos pasos y 409.
