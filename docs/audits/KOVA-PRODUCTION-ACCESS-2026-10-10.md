# Auditoría de acceso, configuración y dispositivos · 10 de octubre de 2026

Producción: `https://kovasuite.com`, tenant **Cafetería Sweet Home**, cuenta owner
autorizada por el usuario. Esta revisión complementa las operaciones reales de
ventas, caja e inventario ejecutadas por los otros agentes. No afirma readiness
total ni sustituye una prueba física o una transacción fiscal certificada.

## Navegación y accesibilidad en producción

- Login normal correcto en Chromium 147.0.7727.15 y WebKit 26.4.
- Chromium de escritorio, 1440 × 1000: panel, configuración, suscripción,
  facturación y asistente sin violaciones axe WCAG 2.1 AA ni desbordamiento.
- WebKit móvil emulado, 390 × 844, es-MX / America/Mexico_City: 18 rutas
  revisadas esperando red inactiva entre páginas:
  `/dashboard`, `/settings/integrations`, `/settings/billing`, `/assistant`,
  `/settings/receipt`, `/settings/employees`, `/settings/branches`,
  `/settings/fiscal`, `/settings/advanced`, `/register`, `/orders`,
  `/inventory`, `/customers`, `/pedidos`, `/catalog`, `/purchasing`,
  `/reports`, `/shifts`.
- En esas rutas no hubo alertas de error, desbordamiento horizontal de la
  página ni excepciones JavaScript en estado estable.
- Se encontró una violación seria `scrollable-region-focusable` en la tabla
  de motivos de devolución de `/reports`. Las otras 17 rutas no presentaron
  violaciones axe.
- Navegar inmediatamente antes de terminar las peticiones produjo mensajes
  WebKit de cancelación/acceso al documento anterior. No se reprodujeron al
  esperar red inactiva; no se atribuyen a una respuesta HTTP defectuosa.

## Corrección demostrada

`frontend/src/reports/components/RefundsAndCancellations.tsx`: la tabla de
devoluciones ahora está dentro de una región con nombre accesible, foco por
teclado y contorno visible. Conserva los cálculos y datos del backend.

Validación local:

- `RefundsAndCancellations.test.tsx`: 4 pruebas aprobadas, incluida la nueva
  regresión que enfoca la región y comprueba que contiene la tabla.
- `frontend/e2e/reports.spec.ts`: nueva prueba con sus mocks existentes,
  devoluciones y viewport 390 px. Comprueba desbordamiento real dentro de la
  región, foco, desplazamiento con flecha derecha y axe sin violaciones.
- Bundle Vite compilado en directorio temporal independiente: correcto.
- Regresión contra ese bundle: **2 aprobadas**, Chromium y WebKit con
  emulación móvil. Se mantiene la tecla 100 ms para permitir el desplazamiento
  nativo de WebKit; no se debilita la comprobación de `scrollLeft > 0`.
- ESLint de los tres archivos: aprobado. La excepción de
  `no-noninteractive-tabindex` se limita al contenedor desplazable y explica
  por qué necesita recibir foco; no se cambia la configuración global.

La corrección debe volver a revisarse en producción después de publicar.

### Aclaración del bruto de pagos tras las operaciones reales

La revisión posterior del equipo encontró que, tras siete ventas y siete
devoluciones, el backend tenía brutas/devoluciones **72.88** y netas **0.00**,
pero la tarjeta «Cómo te pagaron» seguía mostrando la composición bruta
(efectivo 40.88/56 %, transferencia 22.00/30 %, tarjeta manual 10.00/14 %)
sin explicar esa base. El contrato `_payment_drivers` mantiene precisamente
`amount` y `sales_share_pct` como cobros brutos; no es un error de cálculo.

`AnalysisOverview.PaymentMixCard` añade la explicación visible que ya existía
en el componente anterior y, cuando hay devoluciones, presenta brutas,
devoluciones y netas desde `story.summary`. La tarjeta no convierte su
composición bruta en una afirmación de efectivo disponible ni cambia los
porcentajes, las definiciones o los contratos.

Regresión específica con devolución total: conserva los 40.88/56 % y muestra
«Ventas brutas: $72.88 · Devoluciones: $72.88 · Ventas netas: $0.00.» sin abrir
ningún desplegable. Las 20 pruebas de AnalysisOverview, ReportsView y
PaymentAnalysis aprobaron. La prueba browser de devoluciones también verifica
la aclaración y la reconciliación parcial, sobre el bundle compilado en
Chromium y WebKit móvil; ambas aprobaron. ESLint aprobado. La revisión de
React no incorpora hooks, nuevas consultas, dependencias ni agregaciones de
dinero; sólo formatea los campos existentes. Pendiente verificación publicada.

## Configuración y seguridad reales

| Verificación | Resultado observado |
| --- | --- |
| `/api/v1/integrations/cfdi/setup` | 200; `available=false`, `state=not_started`, `production_ready=false`, emisor ausente |
| `/api/v1/integrations/cfdi/status` | 200; cifrado disponible, cero conexiones |
| `/api/v1/integrations/readiness` | 200; CFDI y terminal sin conectar; emisión/cargo deshabilitados |
| Selector fiscal Live | Muestra efectos fiscales y «Emisión Live pendiente de requisitos fiscales»; activación deshabilitada |
| `/api/v1/hardware/drawer` | 200; `configured=false`, `online=false`, `auto_open=false` |
| `/api/v1/billing/subscription` | 200; Standard, MXN 299/mes, suscripción activa, acceso permitido |
| `/api/v1/assistant/capabilities` | 200; consultas/modelo/respuestas locales disponibles; configuración, documentos y correo deshabilitados |
| Cookies de acceso/refresh | Secure, HttpOnly y SameSite=Lax; no tokens de autenticación en claves de localStorage/sessionStorage |
| PUT de emisor sin cabecera CSRF | 403, sin modificar datos |
| Lectura de catálogo con sucursal UUID ajena | 404 |
| Acceso anónimo a me, setup fiscal, cajón y catálogo | 401 en los cuatro casos |
| Logout normal de la sesión de auditoría | Regresa a `/login`; me devuelve 401 |

Con cifrado disponible y `available=false`, el código de `cfdi/setup.py`
indica que falta una llave de cuenta administradora con formato válido. No se
leyó ningún valor secreto ni se infiere que la cuenta externa ya exista. Debe
configurarse una vez para Kova según el runbook de alta administrada; Sweet
Home también requiere identidad real, CSD vigente y autorización del emisor.
No se inventó un RFC, no se cargó un certificado ficticio y no se emitió un CFDI.

El contrato actual conserva `can_charge_terminal: Literal[False]` y terminal
sin conectar. Registrar tarjeta no constituye un cargo al procesador. El
conector nuevo del **cajón** es una capacidad distinta y sí está implementado.

## Consulta real del asistente

Se envió y persistió una consulta de ventas del **3 al 4 de octubre de 2026**
con el consentimiento de consultas ya vigente en la cuenta. La respuesta y
`/api/v1/reports/sales-summary` coincidieron exactamente:

- Venta neta/bruta: **$166.00**.
- Tickets: **2**.
- Reembolsos: **$0.00**.
- Sin alertas; axe sin violaciones tras completar la respuesta.

Conversación: `7741e7a3-461d-4e01-961c-db3819968f57`.
Run: `19f040ff-2cc2-491f-85ec-862b1646f0ee`.
No se confirmaron propuestas de configuración ni se enviaron correos.

## Dispositivos y límites de evidencia

- **Safari real instalado**: Safari 27.0.1. SafariDriver devolvió
  `session not created`: necesita «Allow remote automation». Intentar
  `safaridriver --enable` requirió contraseña administrativa; se detuvo sin
  completar la habilitación. Safari real continúa sin ejecución, aunque
  WebKit fue probado. No se cambió esa preferencia global.
- **iOS físico**: no probado. Xcode/`simctl` no están disponibles. La
  emulación WebKit móvil no equivale a un iPhone o iPad real.
- **Impresión/cajón/lector físicos**: CUPS no tiene impresoras configuradas y
  no se enumeraron dispositivos USB. Esto no descarta una impresora LAN; no
  hay un host/modelo físico conocido para enviar una orden ESC/POS.
- **Descarga real del conector**: HTTP 200, `text/x-python`, archivo adjunto
  `kova-drawer-connector.py`, 6257 bytes, sintaxis Python válida y contenido
  idéntico al código actual. No se vinculó un dispositivo inexistente ni se
  confirmó una apertura ficticia.
- **Roles manager/cashier en producción**: no se proporcionaron cuentas
  adicionales; esta ejecución autenticada fue owner. Las comprobaciones
  anónimas/CSRF/sucursal no sustituyen una matriz live completa de roles y
  dos tenants reales.
- **Pagos/CFDI efectivos**: pendientes de integración de pago y configuración
  fiscal real; ningún registro manual demuestra un cargo bancario o timbrado.

No se exportó estado de autenticación ni se guardaron traces de producción.
Los artefactos del navegador local usan solamente los mocks de pruebas.


## Asistente después de las operaciones y regresión de perfil

La consulta local «Revisa mis ventas hoy» se completó y persistió en UI con
run `0161645d-e7b3-4130-999d-141e2de0af5f`, conversación
`3ae15cdf-3645-4927-8cb8-3b53c6324a43`. Para el 10 de octubre devolvió
netas 0.00, brutas/devoluciones 72.88, cinco órdenes completadas, siete eventos
de devolución y dos cancelaciones, conciliados con los reportes reales.
El modo fue `direct`: no acredita inferencia pagada.

La pregunta libre con los mismos datos fue rechazada con 503. La cuenta mantiene
consentimiento vigente `chat_provider=openrouter` y `chat_recipients=mistral`,
con documentos y correo desactivados; no se cambiaron esas preferencias.
`capabilities` pasó de inferencia disponible antes de PR #187 a deshabilitada.
El código incluye `reports/service.py` dentro del SHA-256 del motor aprobado;
los dos ajustes de texto de PR #187 cambiaron ese archivo e invalidaron el perfil.
El gate rechaza correctamente un motor distinto al evaluado; no corresponde
relajarlo ni afirmar que el consentimiento es la causa.

La corrección en curso preserva el motor evaluado y aplica las dos correcciones
de español exclusivamente a la presentación de la API de reportes. El perfil
anterior es `a3b9af8f46ead1e815339ba777dc112f389ff296200865a6dfc47fa10755f0cb`;
el posterior a PR #187 es
`cca3157c9cd234f383d10e26a30520175ac52d8a37c9643cd626e62860f6e274`.
Esos hashes se calcularon del código, sin leer el secreto ni la configuración
de aprobación de Fly. No se marca una nueva evaluación o revisión humana.
Publicación y comprobación de la pregunta libre siguen pendientes en este punto.

Regresiones locales de la corrección: seis pruebas de presentación conservan
las tres expectativas originales de español en el handler que entrega el reporte,
comprueban no mutar datos del motor y preservan singular/periodo vacío. Primero
fallaron las expectativas de español al restaurar el motor sin el formatter y
aprobaron al aplicar presentación en el borde HTTP. Las ocho pruebas existentes
de disponibilidad mantienen todos los gates, incluido el rechazo de hash distinto.
En conjunto: 14 aprobadas sin red ni base productiva; Ruff y diff-check aprobados.

## Ampliación final de accesibilidad sobre la versión publicada #189

Se revisaron 19 rutas reales en Chromium 1440 y WebKit 390, con WCAG 2.1 AA
y las mismas reglas `heading-order`/`region` sobre BODY usadas por las regresiones
del repo: panel, análisis, inventario, catálogo, caja, turnos, asistente, ventas,
clientes, pedidos, compras y ocho pantallas de configuración (integraciones,
suscripción, ticket, empleados, sucursales, avanzado, perfil y fiscal).
No hubo desbordamiento de página ni excepciones JavaScript. La pasada descubrió
saltos h1→h3 en Turnos y varias pantallas de configuración; se corrigen con h2
locales manteniendo las clases de CardTitle, sin cambiar el componente compartido.
Las regresiones recorren cinco tabs de configuración en dos tamaños y comprueban
la jerarquía completa de Turnos; el cajón y panel fiscal incluyen aserción h2.
Los falsos positivos `p-as-heading` de valores KPI procedían de activar reglas
experimentales deshabilitadas en un harness inicial; se retiró esa activación,
no los valores ni su semántica.

La sesión original en Codex conservó el login y recibió la actualización segura
de la PWA. En Hoy concilió netas 0.00/brutas 72.88/devoluciones 72.88 y conteos
5/7/2; en siete días concilió netas 128.00/brutas 200.88/devoluciones 72.88,
seis órdenes completadas y los mismos eventos 7/2. La jerarquía de Análisis
y las fechas 4–10 de octubre fueron correctas, sin declarar una sucursal ganadora
cuando todas las netas son cero. Ese recorrido detectó «1 órdenes» en un bloque;
la presentación reutiliza el pluralizador existente y dos pruebas verifican
singular y plural, con regresión roja→verde.

Se revisaron también textos pequeños positivos: el verde de marca sobre blanco
produce aproximadamente 2.37:1. Sólo los textos informativos usan emerald-700
(aproximadamente 5.48:1), conservando barras e iconos decorativos. Se retira
la opacidad del contenedor de una prioridad completada, porque habría vuelto
a reducir el contraste de su texto; se mantienen las tachaduras y estado Hecha.
Alcance: comparaciones de bloques/productos, feedback/estado de prioridades,
DeltaChip, producto, cobro dividido/completado, caja, cierre y pedido.
Los importes, umbrales, clasificación y cálculos no cambian.

Validación focalizada adicional: 108 pruebas unitarias del agente de acceso,
28 de configuración/hardware/sucursales y cinco de bloques del día; ESLint,
TypeScript y build correctos. Seis comprobaciones browser Chromium/WebKit
del bundle nuevo y tres de encabezados/configuración pasaron. WebKit verificó
el contraste con CSS compilado: el texto anterior falla y el nuevo pasa.
La comprobación del perfil sigue encontrando los 14 archivos idénticos a la
fuente evaluada. La publicación conjunta de estas correcciones y la consulta
libre del asistente se acreditarán después de verificar la versión servida.

La nueva regresión browser ejercita una comparación positiva con base real
sobre el umbral de 500, una orden en el bloque y una prioridad marcada Hecha
con feedback «Sí, fue útil»; conserva el fixture original y usa un escenario
propio conciliado. Axe comprueba contraste WCAG y jerarquía/landmarks completos.
Aprobó en Chromium y WebKit (dos casos), sobre el bundle compilado.
