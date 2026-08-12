# Runbook: rollout piloto de Pedidos

Pedidos se despliega con `customer_orders=false` por defecto. La migración crea el dominio y sus
permisos, pero no lo muestra ni permite llamar la API hasta habilitar explícitamente cada tenant.

## Requisitos previos

- El PR de Pedidos está aprobado y desplegado en frontend y backend.
- La migración `0056_customer_orders` aparece como `head` en el backend desplegado.
- El runtime usa la conexión sin bypass de RLS y el proceso de rollout dispone de
  `MIGRATION_DATABASE_URL` únicamente para ejecutar el comando administrativo.
- El piloto confirmó horario, responsable y mecanismo de rollback.

Nunca copie URLs de base de datos, tokens, teléfonos, direcciones o notas a tickets o logs.

## Selección del piloto

Empezar con 3–5 negocios de rubros distintos. Registrar internamente solo `tenant_id`, rubro,
responsable y ventana de activación. Antes de activar, confirmar que cada negocio:

- tiene catálogo e inventario reales;
- entiende la separación Pedidos / Caja / Ventas;
- sabe que no hay anticipos, pagos parciales, KDS, reparto ni CFDI en el pedido;
- dispone de un producto “Envío local” si necesita cobrar envío.

## Activar un tenant

Ejecutar desde `backend/` con las variables del entorno objetivo. Primero inspeccionar:

```powershell
python scripts/set_customer_orders_feature.py `
  --tenant-id <TENANT_UUID> --enable --dry-run
```

El comando muestra el nombre actual y no modifica nada. Copiar ese nombre exactamente en la
confirmación:

```powershell
python scripts/set_customer_orders_feature.py `
  --tenant-id <TENANT_UUID> --enable `
  --confirm-tenant-name "<NOMBRE EXACTO MOSTRADO>"
```

No ejecutar actualizaciones masivas ni cambiar el valor por defecto del feature flag.

## Verificación inmediata

1. Cerrar y volver a iniciar sesión en el tenant piloto.
2. Confirmar que `GET /api/v1/auth/session` expone `customer_orders: true`.
3. Verificar que aparece **Pedidos** junto a Caja y Ventas.
4. Crear un pedido pequeño, confirmar y comprobar `reserved_quantity` / `available_quantity`.
5. Confirmar que Caja normal no puede vender unidades reservadas.
6. Cobrar por transferencia o tarjeta manual y verificar una sola venta vinculada.
7. Abrir turno, cobrar un segundo pedido en efectivo y validar recibo y corte.
8. Entregar el pedido; imprimir el documento de pedido y confirmar que no se presenta como recibo.
9. Simular modo offline del navegador y validar consulta de solo lectura, sin mutaciones.

## Monitoreo del piloto

Revisar logs categóricos `customer_order event=...` y errores HTTP, sin PII:

- `created`, `confirmed`, `status_changed`, `cancelled`, `checked_out`;
- `stock_conflict` y `checkout_stock_conflict`;
- `seconds_to_fulfillment` al entregar;
- errores 409 de versión/transición y errores de checkout;
- diferencias entre reservas activas, movimientos de inventario, ventas y turnos.

Detener la expansión ante duplicados, reservas huérfanas, diferencias de turno o incidentes P0/P1.

## Rollback por tenant

Deshabilitar el acceso sin borrar datos:

```powershell
python scripts/set_customer_orders_feature.py `
  --tenant-id <TENANT_UUID> --disable --dry-run

python scripts/set_customer_orders_feature.py `
  --tenant-id <TENANT_UUID> --disable `
  --confirm-tenant-name "<NOMBRE EXACTO MOSTRADO>"
```

Deshabilitar oculta frontend y bloquea la API. No elimina pedidos, reservas ni ventas vinculadas.
Si existen reservas activas, resolver o cancelar los pedidos antes del rollback siempre que sea
posible; de lo contrario escalar para liberar reservas de forma auditada antes de reabrir Caja.

## Apertura gradual

Habilitar el siguiente grupo únicamente después de una ventana estable sin duplicados, fugas de
reserva, diferencias de turno ni fallas P0/P1. Mantener activación por tenant hasta contar con
evidencia suficiente para una decisión separada sobre disponibilidad general.
