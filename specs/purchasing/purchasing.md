# Compras y proveedores

Proveedores compartidos por negocio; compras e inventario ligados a la sucursal activa. Sólo usuarios con `inventory.adjust` y acceso comercial pueden leer o mutar este dominio. No se aceptan recepciones offline.

- `GET/POST /api/v1/purchasing/suppliers`: nombre y contacto opcional.
- `GET /api/v1/purchasing/orders?limit=100&offset=0`: compras de la sucursal.
- `POST /api/v1/purchasing/orders`: proveedor, notas opcionales, partidas de productos activos con inventario, unidades y costo unitario MXN. No altera stock.
- `POST /api/v1/purchasing/orders/{id}/receive`: partidas, cantidad recibida y `update_catalog_cost` (false por defecto). Se permiten recepciones parciales, nunca superiores a la cantidad pendiente.
- `POST /api/v1/purchasing/orders/{id}/cancel`: cancela únicamente lo pendiente; conserva recepciones y movimientos anteriores.

Toda mutación exige `Idempotency-Key`. La reserva, los movimientos, el cambio opcional de costo, la auditoría y la respuesta se guardan en una transacción. Se bloquea primero la compra y después los productos ordenados por ID; las ventas usan esos mismos locks de producto. Las cantidades se validan contra INTEGER y stock máximo. Cada movimiento `purchase` indica compra y partida; la auditoría conserva movement_id, unidades, costo de compra y costo anterior. Los snapshots de costo de ventas anteriores no se modifican. La compra no representa un pago ni crea automáticamente un gasto: registra mercancía/costo; conciliación de cuentas por pagar queda fuera de este contrato.

RLS forzada por tenant en las tres tablas. FKs compuestas evitan proveedor/producto/sucursal de otro negocio. Compras usan BranchScoped para SELECT/INSERT/UPDATE. Roles anon/authenticated/PUBLIC sin permisos directos; kova_app sólo SELECT/INSERT y UPDATE(status) o UPDATE(received_quantity) donde corresponde.

QA: crear proveedor y compra multi-producto; recibir parcialmente y consultar stock; repetir misma clave sin duplicar unidades; intentar cantidad excesiva y partida ajena; cambiar sucursal y verificar invisibilidad; cancelar saldo pendiente conservando stock; actualizar costo explícitamente y verificar snapshots históricos; desconectar y comprobar bloqueo de recepción.
