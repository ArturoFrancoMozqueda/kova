# Decisión de proveedor CFDI para Kova

Fecha de consulta: 6 de octubre de 2026 UTC (5 de octubre en el contexto del cliente).
Estado: recomendación técnica investigada; no constituye contratación, homologación ni evidencia de timbrado real. Alcance de esta entrega: documentación solamente.

## Decisión recomendada

Integrar **Facturapi primero**, con credencial por organización emisora y una interfaz de proveedor pequeña que permita cambiar posteriormente. La recomendación favorece claridad del contrato, aislamiento operativo por organización y recuperación documentada de emisiones inciertas. **Facturama resulta económicamente competitivo**; SW merece evaluación comercial para alto volumen. No afirmar que Facturapi es el proveedor más barato.

La API de un proveedor y la entidad PAC que certifica son conceptos diferentes. Antes de contratar, confirmar razón social, PAC efectivo, responsabilidades, soporte y tratamiento de datos; cotejar el certificador en la [lista oficial del SAT](https://www.sat.gob.mx/portal/public/tramites/lista-de-proveedores-autorizados-de-certificacion-de-cfdi). La documentación de intermitencias de Facturapi identifica a PADE como participante del timbrado; eso no demuestra por sí mismo la situación vigente de autorización de una razón social.

## Comparación verificable

| Proveedor | Multiemisor y pruebas | Precio público consultado | Adecuación a Kova |
|---|---|---|---|
| Facturapi | Organizaciones emisoras con llave Test/Live; API multi-RFC sin cargo adicional por emisor | API: **$299 MXN/mes + $0.60/timbre**, IVA incluido. Autofactura hospedada E-Receipts: **$599/organización/mes + $0.40/recibo + $0.60/timbre** | Contrato de organizaciones, recibos y recuperación explícito; preferido para primer adaptador. [Precios oficiales](https://www.facturapi.io/pricing). |
| Facturama | API Multiemisor administra varios RFC y CSD; tiene sandbox. Los documentos Multiemisor no aparecen en su plataforma web | **$1,650 MXN/año**, incluye 100 folios; prepago adicional **$0.50** (1–10,000), **$0.45** (10,001–50,000), **$0.40** (>50,000), IVA incluido | Alternativa con menor cargo base anual; verificar condiciones comerciales de volúmenes y recuperación. [Costos oficiales](https://api.facturama.mx/costos), [planes actuales](https://facturama.mx/index.php/planes-facturacion). |
| SW Sapien | Multi-RFC por defecto; emisión JSON/XML con CSD en su cuenta; usuario de pruebas | No se verificó tarifa general aplicable a Kova. Los precios de paquetes para Odoo son específicos y no deben extrapolarse | Interesante para volumen y relación PAC directa; requiere cotización y validar contrato de consulta/duplicados. [Multi-RFC](https://developers.sw.com.mx/knowledge-base/errores-comunes/), [emisión JSON](https://developers.sw.com.mx/knowledge-base/emision-timbrado-json-cfdi/), [pruebas](https://developers.sw.com.mx/knowledge-base/usuario-de-prueba/), [términos comerciales](https://tienda.sw.com.mx/terms). |

Los productos de Facturapi se contratan por separado: API multi-RFC no significa portal de autofactura incluido para todos los RFC. Su cobro de consumibles se agrega a la siguiente mensualidad. [Política comercial](https://help.facturapi.io/es/articles/9247074-informacion-general-sobre-precios).

Ejemplo aritmético del precio API público: 1,000 timbres en un mes serían $899 MXN (299 + 1,000 × 0.60), antes de descuentos contractuales; no es una oferta comercial. Debe modelarse consumo agregado de Kova y presupuesto por tenant. No modificar precios de suscripción de Kova con esta estimación.

## Contrato Facturapi: puntos que no se deben inventar

La [referencia API oficial](https://docs.facturapi.io/api/) documenta:

- `GET /v2/organizations/me`: llave de organización Test/Live. `GET /v2/organizations/{id}`: también admite User Key. El ejemplo cURL con User Key no restringe las autorizaciones enumeradas.
- Emisión `POST /v2/invoices`: `idempotency_key` **en JSON**, no asumir un header. `external_id` ayuda a buscar, pero **no es único**.
- Factura: `status` puede ser `pending`, `valid`, `canceled`, `draft`, `failed`; `livemode` distingue ambientes.
- `product_key`, `unit_key`, `taxability`, `taxes`, `tax_included` son datos fiscales explícitos; `items[].discount` existe, pero la extracción consultada no aclaró su base/unidad. No asumir porcentaje ni descuento unitario.

Las organizaciones, usuarios y llaves se crean/administra con User Key. La configuración operativa puede hacerse con User Key o Live Key de la organización. [Onboarding oficial](https://docs.facturapi.io/docs/getting-started/organization-onboarding/).

**Recomendación de Kova:** vincular mediante `/organizations/me`, comparar RFC/identidad devuelta con emisor local y guardar ID comprobado. No pedir User Key global en el flujo normal de un negocio. No aceptar un ID de organización del navegador como prueba de propiedad. User Key, si se usa para onboarding SaaS centralizado futuro, debe quedar en infraestructura administrativa separada.

## Reintentos y reconciliación de emisión

La guía de [intermitencias HTTP 202](https://docs.facturapi.io/docs/guides/invoices/intermitencias/) describe una factura `pending` sin UUID; consulta al certificador cada diez minutos, hasta cinco intentos, y termina en `valid` o `failed`. Mientras esté pendiente, no crear otra factura ni reutilizar su folio. La recuperación automática de esta guía corresponde a errores intermitentes elegibles, **no a cualquier timeout de red de Kova**.

La [facturación asíncrona](https://docs.facturapi.io/docs/guides/invoices/async-invoices/) también devuelve un ID antes del timbrado; `stamp` y `uuid` quedan vacíos hasta completarse. La aceptación de una solicitud HTTP no demuestra emisión válida.

**Diseño recomendado de Kova, derivado del riesgo de doble efecto externo:**

1. Antes de llamar al proveedor, persistir intento, payload inmutable y hash, tenant/organización/ambiente y clave estable de documento. Confirmar ese registro local; no mantener una transacción DB abierta durante una espera de red.
2. Usar siempre la misma clave externa y el mismo payload para el mismo intento incierto. Nunca generar una nueva clave porque el usuario recargó o hubo timeout.
3. Guardar ID externo inmediatamente si existe. Consultar ese ID para resolver pendientes; opcionalmente verificar `invoice.status_updated` antes de hacer GET autenticado.
4. Si no llegó ID por timeout, buscar por referencia externa y contrastar organización, ambiente, importe, receptor y hash disponible. Cero coincidencias no prueba que nunca se timbró; varias coincidencias requieren revisión.
5. El [contrato de errores](https://docs.facturapi.io/docs/getting-started/errors/) reconoce `idempotency_key_in_use`; tratarlo como operación concurrente/pendiente y respetar `Retry-After` cuando exista. No transformarlo automáticamente en fracaso definitivo.
6. No se confirmó en documentación pública la duración de retención de claves, replay exacto, comportamiento ante payload cambiado o consulta por clave idempotente. Obtener confirmación del proveedor y probar sandbox. Hasta entonces, una emisión incierta debe bloquear una emisión nueva y permitir reconciliación conservadora, no reintentos ilimitados.
7. Solo marcar emitida una respuesta comprobada: ambiente esperado, estado válido, ID/UUID reales y consistencia de emisor/importe. Persistir y reconciliar la misma evidencia después de un reinicio.

## Impuestos, descuentos y catálogo

La [guía de productos](https://docs.facturapi.io/docs/guides/products/) considera por defecto precio con IVA 16% incluido. Para precio antes de impuestos ofrece `tax_included: false`. La documentación contiene ejemplos antiguos `/v1` y una muestra Java que difiere de sus ejemplos vecinos; usar el contrato vigente `/v2` y pruebas reales, no copiar muestras ciegamente.

**Diseño de Kova:** los impuestos de POS recientemente incorporados son configuración operativa, no clasificación SAT suficiente. Requerir mapeo fiscal aprobado por producto y snapshot de venta: clave producto/servicio, unidad, objeto de impuesto, tasa/factor y descuentos distribuidos. No asignar IVA 16%, H87 o una clave genérica a todos los productos por comodidad.

Ejemplo de aceptación a probar: precio antes de impuesto $100, descuento total $10, IVA 16% debe mantener base $90 y total $104.40 cuando esa clasificación sea aplicable. Probar también cantidad 2, descuentos por renglón y orden, IVA cero frente a exento, sin objeto, redondeos y productos mixtos. Es un caso de ingeniería esperado, no una confirmación del significado de `discount` del proveedor. Si el XML o total difiere de la venta, no esconder la diferencia ni alterar el ticket cobrado.

## Custodia de certificados y habilitación productiva

Facturapi exige CSD `.cer`, `.key` y contraseña para live; datos del emisor, suscripción y Carta Manifiesto integran su checklist. La firma de esa carta usa e.firma. Su [ayuda oficial sobre manifiesto](https://help.facturapi.io/es/articles/13540282-carta-manifiesto-que-es-y-por-que-es-necesaria) señala firma individual por RFC, portal externo/embebido y que los archivos de e.firma no se almacenan en ese proceso. Es una declaración del proveedor, no una auditoría independiente de custodia CSD.

El [SAT explica el CSD](https://sat.gob.mx/portal/public/tramites/certificado-de-sello-digital) como certificado para sellar facturas y [recomienda no compartir e.firma](https://wwwmat.sat.gob.mx/consulta/73637/contribuyentes-interesados-en-utilizar-los-servicios-de-un-proveedor-autorizado-de-certificacion-de-facturas-electronicas). Facturama también recibe [CSD, llave y contraseña](https://facturama.mx/docs/api-reference/endpoint/mi-cuenta/sube-los-csd-al-servidor-de-facturama); SW requiere cargar CSD para su servicio de emisión JSON.

**Recomendación de Kova:** onboarding y manifiesto en el portal del proveedor para que Kova no recolecte e.firma/CSD. Custodiar únicamente credencial por organización en backend cifrada, con llave maestra fuera de DB, sin respuesta de secretos, telemetría ni exportación de credenciales. Revocar/reemplazar claves sin perder evidencia del emisor previo. Confirmar contrato de custodia, eliminación, subprocesadores, portabilidad y acceso antes de activar live.

## Cancelación y autofactura

Una devolución de POS y una solicitud de cancelación no equivalen a cancelación fiscal. El [SAT](https://wwwmat.sat.gob.mx/consultas/91447/nuevo-esquema-de-cancelacion) solicita motivos y, en casos aplicables, aceptación del receptor; la sustitución motivo 01 requiere UUID relacionado. La página consultada referencia reglas de 2024: cotejar RMF vigente antes de establecer plazos/requisitos legales en producto.

La [guía de cancelación Facturapi](https://docs.facturapi.io/docs/guides/invoices/cancelaciones/) admite cancelación solicitada mientras invoice sigue `valid`; diferencia `pending`, `verifying`, `accepted`, `rejected`, `expired`. La guía incluye `verifying` que no aparece en el enum del modelo general consultado: el adaptador debe tolerar estados nuevos sin declarar cancelación exitosa. Consultar estado y conservar acuse.

El [portal de autofactura Facturapi](https://docs.facturapi.io/docs/guides/self-invoice/) convierte recibos abiertos mediante `self_invoice_url`; la expiración restringe el portal, no necesariamente la API. **Recomendación:** primero emisión individual autenticada; luego decidir entre portal Kova con tokens opacos/rate limits y costo API base, o producto E-Receipts contratado. Evitar dos fuentes de cierre global: no incluir en factura global una venta ya emitida individualmente o con emisión incierta, y reconciliar cancelación antes de liberar la venta.

## Criterios para autorizar activación live

- Credencial real de organización correcta y suscripción vigente; CSD y manifiesto completados por emisor.
- Sandbox end-to-end comprobado, incluyendo documentos descargables, validación fiscal, idempotencia concurrente, timeout/reinicio, HTTP202, pendientes y cancelaciones. Las facturas Test no tienen validez SAT.
- Pruebas de tenant isolation, permisos, cifrado, rotación, acuse/evidencia y exclusión individual/global.
- Un caso productivo controlado verificable contra SAT con autorización del negocio. No sustituirlo con mocks o una respuesta de ejemplo.
- Confirmación escrita de límites idempotentes y costos para la operación comercial real.

No se contactó ni contrató a proveedores, no se crearon cuentas, no se enviaron certificados y no se timbraron documentos durante esta investigación.
