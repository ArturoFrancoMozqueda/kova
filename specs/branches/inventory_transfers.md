# Traspasos y acceso por sucursal

Los propietarios y administradores con acceso a todas las sucursales pueden trasladar un producto activo con control de inventario entre dos sucursales del mismo negocio. El traspaso requiere conexión, un motivo, unidades enteras positivas y `Idempotency-Key`; el mismo intento devuelve la misma operación aunque cambie la sucursal activa.

Una transacción bloquea el producto, valida las unidades libres de reservas, registra salida y entrada y deja evidencia de auditoría. No altera las existencias totales, las unidades reservadas ni la atribución de operaciones anteriores. El historial guarda el nombre del producto al trasladarlo.

Un propietario puede asignar a un empleado una sucursal o acceso a todas desde Configuración → Sucursales. La restricción se aplica en servidor a cada solicitud y al origen de cada venta offline durante sincronización. Las ventas que ya no pueden sincronizarse permanecen fallidas con explicación para solicitar ayuda al propietario. Un administrador asignado no puede ejecutar traspasos, consultar comparaciones globales ni consultar documentos fiscales del negocio completo. Los propietarios mantienen acceso global y una promoción a propietario elimina la asignación anterior.

## Validación

- Transferir cuatro de diez unidades: quedan seis en origen y cuatro en destino.
- Repetir la clave: misma respuesta y ningún movimiento adicional.
- Usar otra sucursal activa al reintentar: misma respuesta.
- Intentar mover unidades reservadas: rechazo sin cambios; mover únicamente unidades libres sí funciona.
- Sucursal inexistente o de otro negocio: rechazo sin movimientos.
- Administrador asignado: puede operar su sucursal; otra sucursal, traspasos y reportes globales devuelven rechazo.
- Venta offline de origen bloqueado tras una reasignación: resultado fallido, sin relocalizarla.

Pendiente QA visual manual en móvil y lector de pantalla; controles nativos etiquetados, estados de carga/error y confirmación implementados.
