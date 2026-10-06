# Facturación y terminal: preparación sin proveedor

## Disponible

- Perfil fiscal del emisor persistido por negocio.
- Captura interna autenticada de solicitudes para ventas completadas de la sucursal activa.
- Instantáneas inmutables de emisor, receptor e importe; aislamiento tenant/RLS y branch.
- Reintento idempotente; una solicitud por venta. Estado único `pending_provider`, estatus fiscal `not_issued`.
- Vista de conexiones y solicitudes. Permisos FISCAL_VIEW/FISCAL_MANAGE y acceso comercial.

La validación es **solo de formato**; no valida RFC, régimen, uso o código postal contra SAT. No hay autofacturación pública, timbrado, XML, UUID fiscal, envío de correo, terminal, cancelación o certificación simulados. Una solicitud pendiente no excluye la venta de borradores globales. No se almacenan credenciales de PAC, CSD, claves privadas o terminal en este flujo.

## Activación futura (requiere proveedor contratado)

1. Elegir PAC autorizado con contrato/API y terminal con API compatible. Verificar costos, soporte, sandbox y cobertura por negocio.
2. Obtener CSD del emisor y autorización para custodia; almacenar secretos fuera de tablas y frontend, cifrados y con rotación.
3. Implementar adaptador del contrato real. Validar catálogos SAT vigentes, combinaciones fiscales, impuestos, forma/método de pago y receptor. Mantener feature flag apagada hasta homologación.
4. Diseñar exclusión transaccional entre factura individual y global; no timbrar ventas ya facturadas ni devolver/cancelar a través de solicitudes internas.
5. Probar sandbox end-to-end: rechazos, timeout y reconciliación, firma, XML/UUID verificables, descarga, entrega, cancelación y auditoría. PAC webhook autenticado/replay-safe.
6. Para terminal: reconciliar idempotencia con proveedor, webhook firmado, timeouts, pagos parciales, devoluciones, desconexión y conciliación; no marcar pagado por respuesta del navegador.
7. Habilitar autofacturación pública solo con token opaco de un solo ticket, rate limits, expiración, mínima exposición y consentimiento para datos personales.
8. Activar con credenciales productivas del proveedor y realizar una operación real controlada; monitorear antes de expansión.
