# Facturación y terminal: alcance y requisitos de activación

## Solicitudes internas de factura

- Perfil fiscal del emisor persistido por negocio.
- Captura interna autenticada de solicitudes para ventas completadas de la sucursal activa.
- Instantáneas inmutables de emisor, receptor e importe; aislamiento tenant/RLS y branch.
- Reintento idempotente; una solicitud por venta. Estado único `pending_provider`, estatus fiscal `not_issued`.
- Vista de conexiones y solicitudes. Permisos FISCAL_VIEW/FISCAL_MANAGE y acceso comercial.

La validación de este flujo es **solo de formato**; no valida RFC, régimen, uso o código postal
contra SAT. La solicitud por sí sola no timbra, genera XML/UUID fiscal, envía correo ni cobra.
Una solicitud pendiente no excluye la venta de borradores globales. La captura interna no recibe
credenciales del proveedor ni certificados.

## CFDI administrado implementado; aceptación externa pendiente

El flujo separado bajo `/api/v1/integrations/cfdi` implementa alta administrada de Facturapi,
una organización por tenant, conexiones Test/Live, validación previa de CSD, vista previa,
emisión individual, reconciliación, descarga privada de XML/PDF y cancelación confirmada.
El alcance fiscal y sus restricciones están en [el contrato CFDI](cfdi-contract.md).

La llave de administración es un Secret exclusivo del servidor. Las llaves de organización
se almacenan cifradas con binding a tenant, ambiente y organización. CSD y contraseña pasan
sólo por memoria; la e.firma del manifiesto se procesa en el módulo del proveedor. El journal
conserva los intentos inciertos para recuperarlos sin duplicar la organización o la emisión.
La reserva de documentos protege la exclusión entre factura individual y borrador global;
una solicitud interna no reemplaza ese control.

`GET /setup` con `available:true` acredita presencia/formato de la credencial y disponibilidad
del cifrado. No prueba que Facturapi acepte la llave, una suscripción del proveedor ni permiso
de emisión Live. `configured` indica conexión preparada; `production_ready` exige la
confirmación del proveedor, emisor coincidente y certificado vigente. Test conserva etiqueta
sin validez fiscal y no afecta el ledger fiscal real.

Antes de declarar la integración operativa:

1. Configurar la cuenta de plataforma y su Secret mediante el [runbook de alta fiscal](../../docs/runbooks/managed-fiscal-onboarding.md), conservando la raíz de cifrado existente. Tras rotar un Secret, verificar que el proceso nativo nuevo cargue la configuración.
2. Completar datos reales del emisor y probar el recorrido Test con el proveedor: alta/reintento, emisión, rechazo, timeout, reconciliación, descarga y cancelación. Las pruebas con transporte simulado no acreditan aceptación externa.
3. Para Live, verificar costos/acuerdo del proveedor, CSD, manifiesto y confirmación fiscal; obtener autorización para una operación real controlada y comprobar su resultado antes de expandir. Publicar código o guardar una llave no activa una suscripción ni demuestra timbrado.

La autofacturación pública, envío automático de facturas y casos fuera del contrato fiscal
actual requieren alcance propio; no se presentan como disponibles por existir el adaptador.

## Terminal: integración pendiente

`terminal_status=not_connected` y `can_charge_terminal=false` describen el estado implementado.
Registrar tarjeta en caja no procesa un cargo; la conciliación CSV tampoco conecta un adquirente.
Se requiere elegir proveedor/hardware y verificar contrato, costos, sandbox y cobertura por negocio.
Después hay que implementar adaptador, webhook autenticado/replay-safe, idempotencia, estados
inciertos, pagos parciales si se incluyen, devoluciones, desconexión y conciliación. El navegador
no confirma que un pago esté liquidado. La aceptación exige cobro y devolución controlados con
el proveedor elegido; ninguna credencial por sí sola completa esta integración.
