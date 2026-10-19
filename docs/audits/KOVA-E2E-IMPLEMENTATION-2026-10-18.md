# Implementación local de automatización comercial E2E

Fecha: 2026-10-18, America/Mexico_City. Rama: `feature/business-automation-e2e`.
Origen: solicitud del propietario de implementar con equipos el
[plan E2E](../plans/PLAN-AUTOMATIZACION-E2E.md). Esta evidencia corresponde a código y entornos
locales aislados; no publica ni certifica proveedores o producción.

## Resultado implementado

| Área | Comportamiento y archivos principales |
|---|---|
| Automatizaciones | `backend/app/automations/`, `frontend/src/automations/`: reglas opt-in por sucursal para pedido listo, postventa y reposición; eventos transaccionales, tareas durables, versiones, deduplicación, pausa, resolución y revalidación de permisos/billing/datos. |
| Pedidos | `backend/app/customer_orders/service.py`: ready/fulfilled/cancelled registra eventos en la misma transacción. Un fallo al procesar tareas conserva el pedido y el evento pendiente mediante savepoint. |
| Programación | Worker privado existente en `deploy/cloudflare-backend/jobs.py`, cohorte explícita `AUTOMATION_TENANT_IDS` independiente del asistente. `backend/scripts/run_automation_worker.py` permite ejecución nativa. No agrega inferencia ni permisos privilegiados. |
| CRM | `backend/app/crm/`, `frontend/src/crm/`: oportunidades, etapas, responsable, importe estimado, próxima acción, vencimiento y notas internas. Ganada no significa cobrada. |
| Consentimiento | Canal y finalidad independientes; bajas explícitas. Cambiar teléfono/correo invalida el permiso anterior. No se infiere autorización por tener un teléfono guardado. |
| Cotizaciones | `backend/app/quotes/`, `frontend/src/quotes/`: precio del servidor, snapshots, vigencia, registro humano de compartir/aceptar y conversión atómica a pedido. Sin ingreso, reserva ni envío implícitos. |
| Catálogo público | `backend/app/storefront/`, `frontend/src/storefront/`: publicación explícita de productos, enlace firmado revocable y QR PNG. Precio/disponibilidad reales; costos, cantidades exactas y productos no elegidos permanecen privados. |
| Reposición | `backend/app/replenishment/`, `frontend/src/replenishment/`: evidencia de stock/reservas/compras pendientes, costo ausente explícito, revisión y aprobación de compra pendiente. Conserva recepción física y pagos separados. |
| Conciliación | `backend/app/reconciliation/`, `frontend/src/reconciliation/`: CSV canónico manual, preview, selección, importación idempotente, sugerencias y confirmación/rechazo/reversa. No modifica pagos ni caja; no declara compatibilidad con formatos bancarios no probados. |
| WhatsApp | `backend/app/messaging/`, `frontend/src/messaging/`: preparación del canal y adaptador desacoplado con host fijo, versión explícita, timeout incierto, HMAC y parser acotado. No hay dispatcher ni webhook público activo. |

Rutas nuevas: `/automations`, `/crm`, `/quotes`, `/replenishment`, `/reconciliation`,
`/settings/public-catalog`, `/settings/channels` y consulta anónima `/catalogo/:token`.
Vistas privadas owner/manager, online, con identidad/sucursal y solicitudes cancelables.

Specs: [motor](../../specs/automations/automation_engine.md),
[reposición](../../specs/automations/replenishment.md),
[catálogo público](../../specs/storefront/public_catalog.md),
[conciliación](../../specs/reconciliation/bank_reconciliation.md) y
[preparación WhatsApp](../../specs/integrations/whatsapp-cloud-preparation.md).

## Alcance frente al plan completo

El motor ejecuta tareas internas y operaciones de dominio expresamente confirmadas. Se ha integrado
el circuito interno cotización → pedido y los de reposición/conciliación. El catálogo abre el contacto
directo con el negocio; una consulta por WhatsApp no se convierte automáticamente en cliente,
oportunidad, pedido o consentimiento dentro de Kova.

Quedan pendientes de implementación/activación según su fase: bandeja comercial conectada,
captura/calificación de prospectos desde canales externos, dispatcher y comprobantes de entrega,
campañas/reseñas/recompra automáticas, PSP del comercio y conciliación del proveedor. CFDI mantiene
su adaptador existente y sus gates Live; crédito requiere su spec de dominio. Citas, lealtad,
recetas/KDS, voz, firma, cursos y franquicia continúan como extensiones por giro del horizonte,
sin presentarlas como disponibles en esta entrega.

## WhatsApp y cuentas reales

El propietario confirmó WhatsApp Business en la app, Meta y dominio; no confirmó Cloud API.
Ese dato de conversación no se convierte en configuración global de todos los tenants. La API
de preparación devuelve `not_connected` y `account_mode=not_verified` sin leer credenciales.

Antes de habilitar comunicación: verificar alta oficial y elegibilidad para mantener app/número,
WABA/Phone Number ID, permisos, vinculación exclusiva por tenant, custodia de credenciales, webhook
HTTPS, idempotencia/outbox, consentimiento, plantillas, límites y costos. Después verificar entrega
real y derivación humana. La documentación de coexistencia respondió 429 durante esta revisión;
no se promete elegibilidad ni se cambia el número. Fuentes y protocolo en la spec del canal.

No se enviaron mensajes, contrataron servicios, procesaron tarjetas, emitieron CFDI Live ni
modificaron cuentas externas durante este trabajo.

## Migración, permisos y compatibilidad

- Migraciones aditivas `0080_business_automations` a `0084_customer_quotes`: 12 tablas privadas con
  RLS ENABLE/FORCE y relaciones por tenant/sucursal. Los downgrades rechazan borrar historial.
- Runtime conserva NOSUPERUSER/NOBYPASSRLS; no grants a PUBLIC/anon/authenticated/service_role.
  Identidad de eventos, snapshots de cotización, pagos y liquidaciones no reciben UPDATE general.
- `backend/app/db.py`, provisioning y grafo de exportación/purga incluyen las tablas nuevas.
  Los hijos se purgan antes que sus padres; no se omite propiedad de datos.
- La matriz de grants de pruebas de migración y el fixture runtime se amplían exclusivamente por
  las tablas nuevas y sus verbos/columnas autorizados. Se mantienen las aserciones de denegación
  y se añaden nodos válidos de dos tenants; no se relajan permisos para obtener pruebas verdes.
- Los paths y schemas OpenAPI existentes se comparan estructuralmente contra HEAD y permanecen
  idénticos. Se añaden rutas nuevas y se versiona `specs/openapi.json`.
- Las respuestas de importación/consulta de conciliación normalizan sus fechas a UTC para conservar
  replay idéntico incluso cuando PostgreSQL usa CDMX. Una regresión fuerza explícitamente ese huso.
- Las alertas de reposición desempatan por nombre/ID cuando tienen igual severidad y horizonte.
  Se corrige una muestra no determinista del asistente sin modificar métricas ni expectativas.
- Pedidos ya tiene default `true` en el código previo; se corrigió la documentación que aún decía
  apagado, conservando overrides y pruebas del gate por negocio. No se cambió el flag.
- No se modifican precios/planes, Stripe Billing, cookies, cola offline ni definiciones históricas
  de ventas. Compras compone transacciones sin commit intermedio para aprobación de reposición;
  cotizaciones usa el mismo patrón en pedidos. Sus endpoints existentes conservan el commit usual.

## Validación

La pasada final completa de backend aprobó **1,654 pruebas**, con tres advertencias, en 138.22 s.
Se separaron la base del smoke de navegador y la base de suites para evitar que las operaciones
persistidas del recorrido contaminaran verificaciones globales de auditoría e importación.
Las suites usan bases locales desechables en UTC como CI; la regresión de conciliación verifica
además CDMX explícitamente.

- Frontend final: 1,029 pruebas en 169 archivos; TypeScript, ESLint, build, SSR, prerender,
  escaneo de 109 chunks e import guard aprobados.
- Chromium con respuestas controladas: automatizaciones, CRM, cotizaciones, canales y conciliación
  a 1440/768/390/320 px, con movimiento reducido en 390. Sin overflow, excepciones o violaciones
  axe A/AA detectadas en esos recorridos.
- `frontend/e2e/business-automation-real.spec.ts`: recorrido sin mocks, navegador → API →
  PostgreSQL con rol runtime/RLS, aprobado. Signup UI, tareas, oportunidad/consentimiento,
  cotización/pedido, publicación anónima, compra pendiente y conciliación. Verifica venta/pago
  intactos y stock/reservas esperados; cierra sesión. Registrado en `test:integration` para CI.
- Migraciones: 17 pruebas aprobadas, incluyendo upgrade poblado, rollback vacío, protección contra
  pérdida de historial y matriz de grants/aislamiento de todas las tablas nuevas.
- Contratos del repositorio: comprobador de OPS y 72 unitarias de scripts aprobados con Python 3.12.
- WhatsApp: 36 pruebas de protocolo simulado y API de preparación; no prueban servicio ni entrega real.
- Controlador Workers PostgreSQL: 116 pruebas de los módulos nuevos aprobadas con pg8000, además
  de diez contratos del proveedor de despliegue. Esto no equivale a ejecutar el runtime workerd.
- La vista de aprobación reutiliza el total de Compras calculado en centavos con BigInt. Tras ese
  ajuste aprobaron TypeScript, lint y cinco pruebas focales de reposición/formateo.

## Release y límites de QA

Antes de producción: CI completo, revisión del diff, respaldo y migraciones con conexión de
propietario; reprovisionar rol runtime y validar postura RLS. Desplegar backend antes de frontend,
mantener reglas apagadas y cohorte de scheduler vacía hasta aceptación controlada. El código anterior
puede recuperarse conservando las migraciones aditivas; no hacer downgrade destructivo.

Faltan aceptación del runtime workerd para estas funciones nuevas, prueba de carga/costo del
scheduler y aceptación productiva autorizada. El smoke real fue local, no sobre `kovasuite.com`.
No se validaron QR impreso, hardware físico, WhatsApp real ni proveedores de cobro/fiscal. La QA
de navegador registrada es Chromium; no acredita Safari/iOS o WebKit para estos módulos nuevos.
