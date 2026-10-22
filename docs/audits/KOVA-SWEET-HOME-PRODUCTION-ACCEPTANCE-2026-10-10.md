# Aceptación productiva de Sweet Home · 10 de octubre de 2026

## Resultado y versión

Última versión funcional publicada: `8f2f2ba9eabc050e54dc43aa4c22e6a85b601e2d`
(PR #193, singular de stock). Las evidencias de #190/#191 se conservan abajo;
la aceptación posterior del último ajuste se completó correctamente y se detalla abajo.

El propietario autorizó operaciones reales de prueba en **Cafetería Sweet Home**,
revisión con agentes, correcciones e integración/publicación. Se conservó su sesión
existente en la pestaña de Codex; los equipos usaron contextos independientes.
Las pruebas registran datos reales en Kova dentro del tenant de evaluación.
No se presentan registros manuales como cargos bancarios ni importes declarados
como conteos físicos.

PRs [187](https://github.com/ArturoFrancoMozqueda/kova/pull/187),
[188](https://github.com/ArturoFrancoMozqueda/kova/pull/188) y
[189](https://github.com/ArturoFrancoMozqueda/kova/pull/189) publicados y verificados.
[PR 190](https://github.com/ArturoFrancoMozqueda/kova/pull/190) integrado en
`29dd9c4b1c4cc1c27384ea2655484d883a5750bf`; CI del head final aprobado.
Su release [38077638478](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38077638478)
terminó correctamente a las 19:09:56 UTC. El verificador posterior confirmó
frontend `29dd9c4b1c4c`, API/proxy `29dd9c4b1c4cc1c27384ea2655484d883a5750bf`
y base de datos accesible. La aceptación autenticada de 19 rutas × dos navegadores
completó 38 comprobaciones de las vistas iniciales sin violaciones
WCAG/heading/region, desbordamiento ni excepciones JavaScript. En `/assistant`
ese barrido cubrió la bienvenida vacía; la respuesta completa se comprobó por
separado. La pregunta libre posterior a #190 se completó en modo grounded
con las cifras reales correctas y consentimiento OpenRouter/Mistral vigente.
[PR 191](https://github.com/ArturoFrancoMozqueda/kova/pull/191) añade la presentación
de conteos de devolución/cancelación y encabezados de respuestas completas;
integrado como `826b4cc3ce91ff26aa7ee9fe608bc02afea2b57f`, con CI del PR aprobado:
1,483 backend, 993 frontend, 214 navegador compilado y seis con stack real.
La publicación final [38079066759](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38079066759)
aprobó a las 19:31:21 UTC; el verificador posterior confirmó frontend
`826b4cc3ce91`, API/proxy `826b4cc3ce91ff26aa7ee9fe608bc02afea2b57f` y
HTML/sitio/base de datos accesibles. El proceso verificó diez checks reales
del parser/antivirus y actualizó el host de archivos existente. La aceptación
autenticada final a las 19:34:41 UTC reabrió la misma respuesta
completa en Chromium 1440 y WebKit 390: seis tarjetas correctas, conservadas tras
recarga e historial; BODY WCAG/heading-order/region, desbordamiento y errores de
página sin fallos detectados. No se envió otra pregunta.
No existe una certificación al 100% para los frentes sin ejecución descritos abajo.

## Matriz de evidencias

| Frente | Evidencia ejecutada | Límite que se conserva |
| --- | --- | --- |
| Caja / ventas | Siete ventas por UI: efectivo, transferencia, tarjeta manual, dividido, offline, descuento/impuesto y pedido con lote. Recibo, persistencia y recarga comprobados. | Transferencia/tarjeta manual son registros del cobro; no acreditan movimiento en un procesador. |
| Devoluciones / anulaciones | Siete eventos de devolución y dos anulaciones. Parciales, máximo restante y reintento idempotente comprobados. | No se simula un reintegro bancario externo. |
| Conciliación | Hoy: brutas 72.88, devuelto 72.88, netas 0.00; cinco órdenes completadas, siete devoluciones, dos anulaciones. Siete días: brutas 200.88, devuelto 72.88, netas 128.00; seis órdenes completadas. | Fechas de ventas originales y eventos siguen el contrato de reportes; no se cambian definiciones para hacer coincidir cifras. |
| Inventario / compras | Stock final POS 30, inventario 15 y lotes 6, reservas cero. Recepción parcial/cancelación y recepción con replay sin duplicar entradas. | Historial y productos QA se conservan. |
| Pedidos / lotes | Reservar, editar, cancelar, checkout, devolver y ajuste explícito auditable. Bloqueo de merma con stock reservado. | Devolver una venta con lotes no repone automáticamente stock; la restitución fue una operación explícita conforme a contrato. |
| Offline / PWA | Corte de red real, cobro local, recibo, recarga sin red, reconexión/recarga y sincronización de una única orden. Cola final sincronizada. Actualización segura sin perder la sesión original. | No acredita toda combinación de dispositivos concurrentes, revocación/expiración y red. Los casos adversos tienen pruebas automáticas independientes. |
| Turnos / efectivo | Cierre antiguo cuadrado y nuevos cortes con sobrante +1 y faltante −1. Turno nuevo abierto en cero. | Cantidades declaradas de prueba; no hubo conteo físico de billetes. |
| Sesión / seguridad | Cookies Secure/HttpOnly/SameSite=Lax; ausencia de tokens en storage; logout de sesiones propias y me 401. CSRF 403, sucursal ajena 404 y endpoints protegidos anónimos 401. Regresiones de respuestas obsoletas tras logout/desmontaje/cambio de identidad. | La QA real autenticada fue owner. No se proporcionaron cuentas manager/cashier ni dos tenants reales para una matriz live completa. |
| RLS / base de datos | Runtime sin superusuario/BYPASSRLS, tablas públicas con RLS, grants Data API 0. Migración 0079 fija búsqueda de tres triggers sin elevar permisos. Regresiones adversariales y roundtrip. | Una FK legacy NOT VALID conserva historia de un tenant eliminado; enforcement activo, cero violaciones de tenants existentes. No se borra historia para cambiar el indicador. |
| Suscripción | Standard, MXN 299/mes, estado activo y acceso permitido en Sweet Home; gates y Stripe Live/Test cubiertos automáticamente. Existe evidencia histórica de Checkout/renovación/fallo/recuperación/cancelación en Stripe Test (7 de septiembre). | El drill histórico pertenece a otro commit y no acredita el runtime actual. No se acreditó un ciclo nuevo Stripe Live de compra, cobro, fallo, cancelación y webhook. |
| Fiscal / CFDI | UI/API de alta administrada, estados y gates; setup sin emisor/conexión, Live bloqueado por requisitos. | El propietario confirmó que no tiene cuenta Facturapi ni requisitos del emisor configurados. Kova necesita su cuenta/llave de plataforma; cada emisor aporta datos fiscales/CSD/autorización. No hubo timbrado real. |
| Cajón / impresora | UI, descarga real del conector, sintaxis y correspondencia de código. Conector por sucursal implementado. | Sin impresora/cajón vinculados, no hubo apertura ni impresión física. Terminal bancaria sin conectar, con cargo deshabilitado. |
| Asistente | Consulta local y pregunta libre grounded reales, conciliadas con netas/brutas/devoluciones y conteos 5/7/2. Perfil aprobado y consentimiento OpenRouter/Mistral vigentes. Seis tarjetas completas conservadas tras recarga e historial en Chromium/WebKit. Companion vacío y Escape/foco probados live. | Respuesta compacta poblada de dos métricas con evidencia automatizada únicamente. Documentos/correo/configuración desactivados; una pregunta no acredita todas las consultas o carga sostenida. |
| Host de archivos / parser | Diez checks reales del parser/antivirus y verificación de imagen e identidad aislada durante el release final. | Documentos del usuario desactivados: no acredita una ingesta autenticada de documentos reales ni carga sostenida. |
| Accesibilidad / dispositivos | Barrido real de las vistas iniciales de 19 rutas en Chromium 1440/WebKit 390; WCAG 2.1 AA y BODY heading-order/region. La respuesta completa del asistente se comprobó por separado en #191. Menú, foco, tabla desplazable y jerarquía con regresiones. | Safari 27 instalado no ejecutado por automatización remota deshabilitada; iOS físico, lectores/impresoras/cajón y lector de pantalla real no certificados. |
| Dependencias | Cero vulnerabilidades runtime y cero críticos en árbol completo tras actualizar herramientas. | Cinco avisos altos sin parche compatible en cadena de compilación; alcance estático y revisión documentados. No se reporta cero hallazgos completos. |
| Respaldo / restore | Respaldo real actualizado a las 18:15:30 UTC y restore en PostgreSQL 17 aislado: 0079, 1,025 órdenes, 36 productos, 72 tablas public / cinco assistant y 72 políticas, RLS/pagos/lotes/grants/limpieza correctos. | Ejercicio lógico de runner; no prueba recuperación regional, cambio de tráfico ni RTO completo del servicio. |

## Correcciones publicadas

- Búsqueda segura de tablas en tres triggers de lotes, con permisos y RLS conservados.
- Protección contra respuestas de sesión obsoletas; contrato cookie-only intacto.
- Foco al cerrar paneles/menú en WebKit, tabla de devolución desplazable por teclado,
  encabezados locales y landmarks.
- Etiquetas en español, cobros brutos explicados, frecuencia de eventos de devolución
  por cada cien órdenes, fechas de contexto y neto cero sin inventar una sucursal ganadora.
- Contraste de texto pequeño positivo y prioridad completada; se preservan colores
  decorativos, cálculos y estados. Singular correcto para una orden en un bloque.
- Restauración real corregida tras detectar el socket de bootstrap incompatible.
- Motor del asistente byte por byte idéntico al evaluado, sin cambiar aprobación,
  procesador, consentimiento, presupuesto o secretos; español aplicado en la API.
- Conteos de devolución/cancelación en evidencia completa y encabezados h2 en
  respuestas; contrato compacto de dos métricas y controles de contenido intactos.
  66 pruebas unitarias focalizadas y ocho browser adicionales en cuatro anchos.

CI final de PR #191 y main: **1,483 backend, 993 frontend, 214 navegador compilado y seis
navegador con FastAPI/Postgres/RLS reales**, todos aprobados. Se mantienen seis
skips de integración en la suite compilada; esos casos se ejecutan en el job
con stack real. Regresiones focalizadas de #190: 14 backend, 141 frontend y 11 browser;
ESLint, TypeScript, build y revisión de diff correctos. Estos conteos no sustituyen
una prueba de carga/SLA. La revisión autenticada de las vistas iniciales de #190
está completada; la respuesta completa publicada de #191 y su persistencia
aprobaron por separado.

## Pregunta libre real tras recuperar el perfil aprobado

Consulta: «Hoy, ¿cuáles son mis ventas netas, cuántas órdenes completadas tengo y
cuántas devoluciones y cancelaciones registré?» Conversación
`7719cfb9-0ad2-49e2-acac-d5f8fc414bc9`, run
`5683e891-d1c6-4d34-a89f-366406720a18`, completed / grounded, sin propuesta de cambios.
Métricas del backend: netas 0.00, brutas 72.88, devoluciones 72.88, órdenes 5,
eventos de devolución 7 y cancelaciones 2, para el 10 de octubre.
Consentimiento externo OpenRouter/Mistral vigente e inferencia disponible.
Uso agregado del usuario/tenant: 1,566→3,126 tokens (Δ1,560), límite diario 50,000,
`limit_kind=available`. Es uso de tokens; no se presenta como importe mensual facturado.
La respuesta completa de #191 se reabrió desde historial y tras recarga en ambos
navegadores con seis tarjetas: venta neta $0.00, tickets 5, venta bruta $72.88,
reembolsos $72.88, devoluciones 7 y cancelaciones 2. Uso posterior 3,126→3,126:
la aceptación final no realizó otra inferencia. URL persistida:
[respuesta real](https://kovasuite.com/assistant?conversation=7719cfb9-0ad2-49e2-acac-d5f8fc414bc9).
El backend y el perfil aprobado son idénticos entre ambos releases.

El companion vacío abrió y cerró con Escape devolviendo el foco al botón en
ambos navegadores. Su respuesta poblada de dos métricas queda acreditada por
regresión automatizada, sin afirmar ejecución live de ese estado. Los contextos
propios del agente hicieron logout, comprobaron me 401 y se cerraron. El root
comprobó las mismas seis cifras en la pestaña original y la devolvió al panel.

## Último ajuste de presentación: stock singular

La lectura final de la pestaña original detectó «Te quedan 1 de Alfajores».
[PR #193](https://github.com/ArturoFrancoMozqueda/kova/pull/193) corrige únicamente
el helper del panel a «Te queda 1…» y conserva plural y stock agotado. Tres
regresiones (1/2/0) aprobaron, incluido singular rojo→verde; ESLint y TypeScript
correctos. Backend, métricas, inventario y perfil aprobado permanecen intactos.
El release [38081235586](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38081235586)
aprobó a las 20:04:33 UTC; verificador posterior correcto para frontend
`8f2f2ba9eabc`, API/proxy `8f2f2ba9eabc050e54dc43aa4c22e6a85b601e2d`,
HTML/sitio/base de datos accesibles. CI final: 1,483 backend, 996 frontend,
214 browser compilado y seis con stack real, todos aprobados. A las 20:07:05 UTC
el agente comprobó el singular real en Chromium 1440/WebKit 390 con stock uno y
reservas cero, iguales al baseline. Dashboard y respuesta completa persistida:
BODY WCAG/heading-order/region, desbordamiento y errores JavaScript sin fallos
detectados. Seis tarjetas 0.00 / 5 / 72.88 / 72.88 / 7 / 2, uso 3,126→3,126,
sin nuevas consultas ni escrituras de negocio. Sesiones propias cerradas con
logout/me 401. La captura nueva conserva la evidencia de #191 por separado.

La pestaña original recibió el aviso de actualización. El root pulsó
«Actualizar ahora» con la caja libre, comprobó que mantuvo login y respuesta
persistida, y volvió al panel con el singular correcto. Esto acredita ese
recorrido manual y no garantiza actualización automática en todos los dispositivos.

La evidencia de Stripe Test del
[7 de septiembre](evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-09-07.md)
queda como histórica: Checkout, renovación, fallo/gracia, recuperación,
cancelación, llegada en distinto orden, duplicados y limpieza correctos.
No se presenta como una ejecución nueva en el commit actual ni como Stripe Live.

## Estado de los registros del tenant

Se conservaron los IDs de órdenes, devoluciones, compras, pedidos, movimientos y
cortes en las evidencias especializadas. No se borraron ventas ni se modificó SQL
financiero directamente para ocultar las pruebas. La caja queda con turno
`fdd27022-504f-4578-a4a9-8222867d4215` abierto en 0.00, sin ventas locales pendientes.
No se cerró la pestaña ni la sesión original del propietario.

## Evidencias especializadas

- [POS, ventas, offline y caja](KOVA-PRODUCTION-OPERATIONS-2026-10-10.md).
- [Compras, pedidos, lotes e inventario](KOVA-PRODUCTION-BUSINESS-2026-10-10.md).
- [Acceso, configuración, asistente y accesibilidad](KOVA-PRODUCTION-ACCESS-2026-10-10.md).
- [Respaldo real actualizado e integridad restaurada](KOVA-R2-REAL-RESTORE-2026-10-10.md).
- [Dependencias y avisos pendientes](KOVA-DEPENDENCY-REVIEW-2026-10-10.md).
- [Contrato y alta fiscal administrada](../runbooks/managed-fiscal-onboarding.md).

La aceptación de los recorridos ejecutados se distingue de la certificación
externa: los frentes pendientes requieren integración/cuenta/identidad fiscal,
periféricos concretos o un entorno de recuperación adicional. La autorización
existente permite continuar las pruebas en Sweet Home cuando esos medios estén
configurados; no se inventan datos fiscales ni una ejecución física.
