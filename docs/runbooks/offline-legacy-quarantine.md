# Cuarentena de ventas offline antiguas

Las bases IndexedDB v1-v3 podían contener ventas sin `tenant_id`. La migración v4 conserva esas
filas como `quarantined`, no muestra su payload y nunca las sincroniza ni las asigna al siguiente
negocio que inicia sesión. Como el registro no contiene una identidad verificable, Kova no puede
recuperarlo automáticamente sin arriesgar datos cruzados entre tenants.

## Decisión segura

El operador debe contactar soporte desde **Sincronización → Ventas antiguas protegidas** y mantener
el dispositivo sin compartir. Soporte registra fuera de Git cualquier dato personal y verifica:

1. identidad y rol del propietario del negocio actualmente autenticado;
2. que ese dispositivo operó para el negocio durante la fecha aproximada reportada;
3. ventas ya presentes en Kova, recibos entregados, cobros y efectivo del turno;
4. diferencias de inventario y reportes antes de registrar cualquier corrección.

La sola posesión del dispositivo, un correo escrito por el usuario o el contenido de una fila legacy
no prueba ownership. El payload local no debe copiarse por correo, tickets, logs ni herramientas de
analítica.

## Conciliación

- Si la venta ya existe en el servidor, conservar la venta canónica y no volver a capturarla.
- Si no existe y el cobro fue confirmado, el propietario la registra mediante el flujo normal con
  una referencia trazable acordada con soporte; después verifica orden, caja, stock y reportes.
- Si no se puede demostrar cobro o pertenencia, no se crea una venta ni se reasigna la fila.
- Cualquier ajuste de caja o inventario usa las operaciones auditadas del producto; nunca se edita
  IndexedDB o PostgreSQL a mano.

Una vez que el propietario confirma por escrito que la conciliación terminó, puede elegir
**Eliminar después de conciliar**. El diálogo borra exclusivamente filas `quarantined` de ese
dispositivo y nunca toca ventas pendientes, fallidas o sincronizadas con tenant conocido. La acción
es irreversible. Si el borrado falla, el aviso permanece y el dispositivo no debe compartirse.

## Evidencia mínima sin PII

Registrar fecha UTC, versión/commit, navegador y SO, cantidad de filas en cuarentena, resultado de
la conciliación (`ya_existía`, `captura_controlada`, `sin_evidencia`) y resultado del borrado. No
registrar nombres, correos, importes, productos, payloads o tokens.
