# Solicitud del menú → pedido revisado → seguimiento público

Estado: autorizado por el propietario el 2026-10-26; implementación y validación locales completas.
Publicación y aceptación productiva pendientes; evidencia en `docs/current-sprint.md`.

## Valor y límites

El visitante elige productos y cantidades; el equipo vincula un cliente explícito, revisa precios
y disponibilidad actuales y crea un pedido sin pasar por oportunidad/cotización. Crear el pedido
lo deja `new`: la reserva se realiza al confirmarlo mediante Pedidos. No crea venta, pago,
consentimiento, mensaje externo ni promesa de entrega automática.

## Contrato aditivo

- El POST público de solicitudes conserva `submission_id`, `name`, `contact`, `message` y
  `product_ids`. Opcionalmente recibe `order_lines: [{product_id,quantity}]` y `origin: remote|in_store`.
  Estructurado exige 1–20 productos distintos, cantidades enteras 1–99, origen explícito e IDs
  coincidentes con `product_ids`. No acepta precios del navegador y no interpreta el mensaje.
- Al capturar se conserva un snapshot inmutable de cantidades, nombres y precios reales del
  catálogo. La disponibilidad al consultar no representa una reserva. Las consultas antiguas,
  sin estructura, conservan su fingerprint y recibo exacto `{receipt_id,status:received}`.
- Recibo estructurado añade `tracking_path: /seguimiento#CAPABILITY` y `tracking_expires_at`.
  Si Pedidos está deshabilitado para el negocio conserva la solicitud estructurada para
  revisión manual, pero omite el enlace de seguimiento; no elude el gate ni emite un enlace roto.
  El replay conserva esos datos aunque el equipo ya haya revisado la solicitud; no expone PII.
- La lista privada añade `order_lines` (snapshot con producto/nombre/cantidad/precio/total),
  `origin`, `customer_order_id` y estado `accepted`. Los registros históricos usan null.
- `GET /api/v1/crm/requests/{id}/order-preview` devuelve `request_id`, `version`, `items`
  (producto/nombre/cantidad/precio/total/disponibilidad actual), `total_amount`, `can_accept`,
  `issues`, `preview_fingerprint`, `customer_order_id`. Sólo owner/manager con acceso a Pedidos.
- `POST /api/v1/crm/requests/{id}/accept-order` recibe `expected_version`, `customer_id`,
  `preview_fingerprint`, `confirmed:true`; exige Idempotency-Key, CSRF y permisos de creación.
  Respuesta 201 `{request,customer_order}`. Bloquea solicitud/productos, vuelve a comprobar
  la revisión y crea/vincula el pedido en la misma transacción. Reintentos no crean duplicados.
  Otra versión, precio/disponibilidad distinta, producto inactivo o cliente ajeno/inactivo
  obliga a revisar. El pedido conserva identidad y precios backend; sus contratos no cambian.

## Seguimiento

`POST /api/v1/public/order-tracking` recibe `{token}` sin cookies ni referrer. La capability
queda en fragmento al abrir la página; no aparece en URLs de API, logs de acceso ni navegación.
Audiencia exclusiva `kova-order-tracking`, firma HS256 existente, expiración obligatoria de 30 días
desde captura, tenant/sucursal/solicitud/submission exactos y validación de claims antes de DB.
No autoriza otras APIs. Se verifica negocio activo, billing, Pedidos habilitado, cliente activo
cuando existe vínculo y pedido de ese tenant/sucursal/cliente. RLS runtime permanece vigente.

Respuesta pública: `business_name`, `branch_name`, `status`, `folio`, `total_amount`,
`items:[{product_name,quantity}]`, `catalog_path`, `updated_at`, `expires_at`.
No incluye nombres/contactos del visitante, cliente, notas, dirección, ID de pedido, empleado,
historial financiero o pagos. El total es null hasta crear un pedido; después es el total
operativo congelado del pedido, nunca una confirmación de cobro.

Estados: sin pedido `pending_review` (incluso si hay oportunidad); descartado `dismissed`;
pedido `new` → `accepted` (pendiente de confirmar/reservar), después los estados reales
`confirmed`, `in_progress`, `ready`, `fulfilled`, `cancelled`. No se infieren fechas ni entregas.
Lectura sólo consulta; no reserva ni sincroniza. Respuesta no-store/no-referrer/noindex y
límite por IP. El retiro del menú no borra compromisos ya registrados; sólo retira `catalog_path`.

## Persistencia y aceptación

Migración 0096 aditiva sobre `crm_catalog_requests`: estructura/origen inmutables y vínculo
compuesto al pedido de la misma sucursal. Mantiene FORCE RLS, grants mínimos y legado null.
Exportación incluye los tres nuevos campos; purga borra solicitudes antes de pedidos como hoy.
Downgrade rechaza perder estructura o vínculos existentes. No cambia los importes financieros.

Pruebas: captura sin parsing ni precios cliente, legacy replay intacto, precios cambiados entre
revisión/confirmación, stock insuficiente, required modifiers, cliente explícito, gates/CSRF,
reintentos/concurrencia, rollback atómico, RLS/FK cross-tenant/branch, grants inmutables,
capability alterada/expirada/de otro propósito, proyección sin PII y estados reales hasta entrega.
