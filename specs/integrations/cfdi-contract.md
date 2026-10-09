# CFDI 4.0: contrato de integración (2026-10-06)

Decisión vigente (2026-10-09): Kova administra el alta de organizaciones Facturapi v2
con una cuenta de plataforma, una organización por tenant y llaves Test/Live separadas.
El cliente completa sus datos fiscales, carga sus CSD y firma el manifiesto desde Kova;
no necesita una cuenta del proveedor ni copiar llaves API. Las conexiones manuales previas
se preservan y requieren migración asistida para cambiar de organización.

`KOVA_FACTURAPI_USER_KEY` es una credencial exclusiva del servidor para administrar
organizaciones. Las llaves de organización se obtienen internamente y se cifran con
`KOVA_CFDI_CREDENTIALS_KEY`, con binding autenticado a tenant, ambiente y organización.
Los archivos CSD y su contraseña sólo se procesan en memoria para su envío al proveedor;
no se guardan en archivos temporales, base de datos, logs ni almacenamiento del navegador.
La e.firma para firmar el manifiesto se procesa en el módulo del proveedor, en un iframe
con URL fija; cerrar el iframe no confirma autorización ni activa la emisión.

Primera entrega: facturas individuales de ingreso PUE, ventas MXN completadas sin
devolución, clasificación SAT explícita por concepto, revisión de importes,
timbrado, reconciliación, XML persistido, PDF descargable y cancelación con estado
SAT confirmado. No se presume IVA 16%, no se asigna 01010101 a todo el catálogo.
IEPS, retenciones, PPD/complementos, egresos, global timbrada y portal público
requieren contratos de producto propios y se rechazan o permanecen sin emisión.

## API autenticada bajo /api/v1/integrations/cfdi

- GET /setup: disponibilidad de la plataforma, estado durable, emisor y pasos confirmados.
- POST /setup: `{issuer: FiscalIdentity}`; crea o recupera una organización del tenant,
  configura datos fiscales y obtiene llaves internas. No cambia suscripción ni precio de Kova.
- POST /setup/refresh: recupera intentos y vuelve a comprobar el proveedor; sin cuerpo.
- POST /setup/certificate: multipart `cer`, `key`, `password`; archivos DER <=64 KiB cada uno,
  contraseña <=256 caracteres/1024 bytes UTF-8 y cuerpo <=150 KiB. Preflight de vigencia,
  RFC propio en sujeto, usos de firma, keypair y costo KDF acotado antes del envío. La validación
  SAT definitiva sigue a cargo del proveedor; no se presume válida una cadena autofirmada.
  Todos estos endpoints requieren cookie/CSRF, FISCAL_MANAGE (owner) y acceso comercial.
  Mutaciones limitadas por rate limit. Respuestas jamás incluyen secretos o certificados.
  SetupResponse = `{available, state:not_started|creating|unknown|configured|error|legacy,
  issuer, organization_created, test_connected, live_connected, production_ready,
  certificate_expires_at, last_error_code, manifest_url}`.
  `configured` significa conexión preparada; sólo `production_ready` confirma emisión Live.
- GET /status: `{storage_available, connections: [{environment, organization_id,
  connected, issuer_rfc, production_ready, certificate_expires_at}], provider:"facturapi"}`.
- PUT /connection: `{environment:"test"|"live", api_key}`. Devuelve estado público,
  jamás llave ni ciphertext. FISCAL_MANAGE. Live requiere emisor configurado que
  coincida con organización; certificados vigentes y production_ready en emisión.
- POST /connection/refresh: `{environment}`. Revalida organización y certificados.
- GET /requests/{request_id}/context: cantidades/importes históricos y conceptos
  de la venta para preparar clasificación. FISCAL_MANAGE y sucursal activa.
- POST /preview: cuerpo InvoicePreparation; resultado público de conceptos,
  subtotal, descuento, impuestos, total, ambiente; no efectos externos.
- POST /documents: mismo cuerpo, Idempotency-Key. Crea intento durable, reserva
  venta y llama proveedor sólo tras commit. Devuelve documento y estado actual.
- GET /documents: filtro opcional request_id/environment, límite50. FISCAL_MANAGE.
- POST /documents/{id}/reconcile: GET al proveedor, antes de cualquier reenvío;
  estado pending nunca genera otra factura. Tenant+sucursal activa.
- POST /documents/{id}/cancel: `{motive:"01"|"02"|"03", substitution_uuid?}`;
  motivo01 exige UUID. Motivo04 sólo global y fuera de esta entrega. Idempotency-Key.
- GET /documents/{id}/xml y /pdf: descarga privada, no-store, filename controlado.

InvoicePreparation = `{request_id, environment, recipient?:InvoiceRecipient,
payment_form:"01"|"03"|"04"|"28",
lines:[{order_item_id, product_key, unit_key, tax_kind:"iva16"|"iva8"|"iva0"|
"exempt"|"not_subject", tax_included:boolean}]}`. Los importes/cantidades no los
manda el cliente; proceden de snapshots de venta. Se valida relación con la forma
de pago real (cash=01,transfer=03,card=04/28). Los importes adicionales cobrados
sólo se tratan como IVA cuando el administrador lo declara y se reconcilian; las
ventas sin impuesto añadido permiten declarar IVA incluido sin cambiar el total.
Toda preparación debe conciliar exactamente con la venta y con su descuento.
La vista previa muestra el efecto fiscal y el receptor normalizado antes de emitir.
La corrección del receptor se conserva en el documento nuevo, sin reescribir la
solicitud histórica. Editar preparación invalida la vista previa y su confirmación.

DocumentResponse = `{id, request_id, order_id, environment, state, provider_id?,
uuid?, total_amount, created_at, updated_at, last_error_code?, cancellation_status?,
xml_available, recipient_snapshot}`. Estados: prepared, submitting, unknown, pending, issued,
cancel_pending, canceled, rejected, integrity_error. TEST muestra siempre etiqueta
sin validez fiscal; sólo LIVE confirmado aporta evento confirmed al ledger.

## Persistencia y controles

- Nuevas tablas cfdi_connections y cfdi_documents; migración0074 después0073;
  metadatosRLS/grants, modelosfixtures, exportación sin secretos y purge coordinados.
- LlavesTest/Live se reconocen por prefijo, nunca se infiere ambiente desdeUI sola.
- Journal conserva payload canónico sin credenciales y provider idempotency_key
  derivada del id de documento, external_id único de Kova, ambiente y organización.
  Dos solicitudes concurrentes no crean dos documentos activos para venta/ambiente.
- XML se interpreta con defusedxml y se comprueba UUID, emisor, receptor, moneda,
  total y TimbreFiscalDigital antes de marcar issued. Los errores del proveedor
  se normalizan: nunca se registran llaves, CSD ni payloads fiscales en logs.
- Live submitting/unknown/pending/issued/cancel_pending/integrity_error excluye
  venta de borradores globales; Test no afecta el ledger ni los cierres reales.
- Sólo cancelación confirmada crea reapertura del ledger; nunca un HTTP200 de
  solicitud de cancelación. Endpoint manual no puede reabrir documentos vigentes.
- Void/refund de venta con live activo requiere resolver primero el CFDI; no se
  cancela una factura como efecto oculto de devolver stock o dinero.
- Configuración server: KOVA_CFDI_CREDENTIALS_KEY (SecretStr, Fernet),
  KOVA_CFDI_ENABLED (default true, disponibilidad condicionada a raíz y conexión),
  KOVA_CFDI_TIMEOUT_SECONDS=20. Raíz estable provisionada una vez por pipeline Fly,
  fuera de BD; nunca se regenera por deployment. Rotación documentada separadamente.

## Alta administrada: persistencia

La migración `e9f2d5d835e6` añade `cfdi_enrollments`: tenant PK, organización globalmente
única, snapshot del emisor, operación con lease y rechazo de creación probado por separado
(`creation_rejected`). Un error de consulta nunca convierte una creación incierta en permiso
para otra creación. FORCE RLS, permisos de columnas, inventario de tablas protegidas al inicio,
exportación y purge incluyen la nueva tabla. El lock del tenant excluye cambios de alta/CSD
mientras haya emisión/cancelación Live pendiente; nuevas emisiones no pueden reservarse
durante cambios de configuración. Reconciliación y replays existentes permanecen disponibles.
