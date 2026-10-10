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
