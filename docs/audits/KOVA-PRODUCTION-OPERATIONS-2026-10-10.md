# Operaciones reales de POS y caja en Sweet Home

Fecha: 10 de octubre de 2026. El usuario autorizó operaciones reales en su tenant de
evaluación. Producción inicial verificada: `960f17fbff6a85743125012a804b523abe881e1c`.
Pruebas mediante Chromium, UI y API reales de `https://kovasuite.com`, inicio de
sesión normal, sin interceptar escrituras, SQL directo ni autenticación persistida.
Los productos `QA-20261010` identifican operaciones de aceptación: son registros
reales en Kova y no acreditan entrega física ni movimiento bancario.

## Ventas y reversos

Producto POS `cd8d95e7-a0b2-450f-bead-0389cbfc82e6`: precio 10.00, costo 3.00,
stock inicial de prueba 30. Se comprobaron recibos y persistencia después de recargar.

| Flujo | Orden | Total MXN | Resultado final |
| --- | --- | --- | --- |
| Efectivo, dos unidades, recibido 50/cambio 30 | `e3bc7a72-aded-45c1-91ce-2c7ed0329c97` | 20.00 | Dos devoluciones de 10.00; la UI mostró máximo restante uno tras la primera. |
| Transferencia registrada | `f904f29e-ca54-4b1c-8470-d375e4adce92` | 10.00 | Devolución total por transferencia. |
| Tarjeta manual registrada | `92b70010-368f-4831-93f2-7337e38be869` | 10.00 | Devolución total por tarjeta manual. No hubo cargo en un procesador. |
| Dividido: efectivo 8, recibido 10/cambio 2; transferencia 12 | `ba9d7afb-62e8-405e-8506-204c974620f1` | 20.00 | Anulada; inventario y efectivo revertidos. |
| Offline, efectivo exacto | `23fb6e19-a681-43c2-b1f5-5d646b3aadfa` | 10.00 | Sincronizada y después anulada. |
| Dos unidades, descuento 2, impuesto adicional 16% | `f7e57043-f0b7-43b5-bb20-3a2e762e4547` | 20.88 | Impuesto 2.88 y cambio 9.12 sobre recibido 30. Dos devoluciones de 10.44 conciliaron el total. |
| Pedido con lote, transferencia | `80de2cf8-6850-43d2-b021-32ac612aa909` | 12.00 | Devolución total. Stock no repuesto por devolución, conforme a contrato de lotes. |

El pedido `81fc060d-56bf-4444-a84f-c44d4dbd63dc` quedó vinculado a su venta:
`ready/unpaid` versión 5 → `ready/paid` versión 6 → `cancelled/refunded` versión 7.
La reserva se consumió una vez. Su restitución de inventario se hizo mediante ajuste
explícito auditable, documentado en la [auditoría de negocio](KOVA-PRODUCTION-BUSINESS-2026-10-10.md).

## Offline e idempotencia

Se cortó la red del contexto Chromium antes de cobrar. El recibo mostró folio local
`CB09512D`, pendiente de sincronizar. Recargar sin red preservó la cola y el catálogo
guardado; Kova mantuvo el modo local seguro y bloqueó efectivo sin comprobar el turno.
Reconectar y recargar con sesión verificada permitió sincronizar el UUID
`cb09512d-ce46-42a3-a28f-8ed21c50880d` a una sola orden.
Se inspeccionó IndexedDB sólo en memoria: todas las entradas del contexto acabaron
`synced`; no se exportaron estados de sesión ni trazas.

Repetir la petición original del pago dividido (UUID
`70abb380-c8b5-4e50-b5ff-09d7af62858a`) devolvió la misma orden. Antes/después:
cinco órdenes completadas, neto 50.00 y efectivo esperado 56.00, sin cambios.
La devolución de tarjeta se repitió con su clave original: HTTP 201, mismo ID de
devolución y stock 30 antes/después, sin otra devolución.

Los timeouts de localizadores del harness no se trataron como fallos de producto ni
provocaron nuevos cobros: se consultó el recibo/orden existente antes de continuar.
Se aisló el proceso de navegador para evitar reinicios de kernel compartido entre agentes.

## Conciliación del día y turnos

Después de siete devoluciones y dos anulaciones, API real del 10 de octubre:

- Bruto de órdenes no anuladas: 72.88; devuelto: 72.88; neto: 0.00.
- Cinco órdenes completadas, siete devoluciones y dos anulaciones.
- Desglose: transferencia 22.00/22.00 devuelto; efectivo 40.88/40.88;
  tarjeta manual 10.00/10.00. Neto cero en los tres métodos.
- Stock POS nuevamente 30, reservas cero.

El turno antiguo `12eb0b62-fc93-42bd-baa0-5393ed4db7a0` estaba abierto desde
13 de septiembre y esperaba 38.00. Entrada 5.00 y salida 5.00 guardadas por UI
con motivo de QA compensado conservaron ese saldo. Ventas, devoluciones y anulaciones
lo regresaron también a 38.00. Se cerró con declaración de prueba 38.00:
`balanced`, diferencia 0.00.

Turnos nuevos de aceptación, con importes declarados de prueba:

- `74b8b2c2-ff58-467c-9f31-3342ab723f76`: apertura 5.00, declaración 6.00,
  `overage`, diferencia +1.00.
- `ffee886b-e219-4aad-8975-d37e561c2861`: apertura 5.00, declaración 4.00,
  `shortage`, diferencia -1.00.
- `fdd27022-504f-4578-a4a9-8222867d4215`: nuevo turno abierto con 0.00.

Los cortes guardados prueban cálculo y persistencia; **no son un conteo físico de
billetes**. Historial y productos de prueba se conservan, sin borrar ventas para
ocultar actividad. La caja queda con turno nuevo, sin ventas locales pendientes.

## Correcciones y límites

La búsqueda de tablas en tres triggers de lotes permitía shadowing mediante tablas
temporales. Una nueva migración fija `pg_catalog, public, pg_temp` sin cambiar permisos
ni RLS; tres regresiones adversariales fallaban antes y pasan después.
También se corrigieron accesibilidad de análisis/catálogo/inventario y etiquetas de
movimientos, con pruebas descritas en las auditorías de cada equipo.

La pestaña integrada del usuario permitió comprobar su sesión existente y encontrar
dos defectos adicionales del panel: métodos de pago en inglés y una frecuencia de
140% presentada incorrectamente como porcentaje de órdenes. Se corrigieron las
etiquetas y se describen ahora eventos por cada 100 órdenes: múltiples devoluciones
parciales pueden pertenecer a una venta. No cambian los campos, el score ni los
datos. Panel y análisis aclaran que el desglose de pagos es bruto; análisis presenta
también bruto, devoluciones y neto cuando hay reembolsos.

La pasada ampliada de WebKit reprodujo pérdida de foco al cerrar el resumen de
venta: Safari no enfoca automáticamente el botón activado con el puntero. El
producto y el control de apertura recuerdan ahora su foco antes de abrir el panel;
el foco inicial diferido tampoco desplaza una interacción que ya alcanzó un campo.
La nueva regresión falló antes y pasa después. Pasaron 38 pruebas relacionadas y
los cuatro recorridos WebKit de resumen a 1272 px y recibo a 390/1100/1440 px.
Los dos botones de apertura del menú guardan de la misma manera su foco antes
de abrir el drawer. Dos regresiones nuevas fallaron antes y pasan después al
cerrar con Escape. La prueba de onboarding espera el encabezado de Análisis y
su milestone antes de volver al panel, conservando la verificación final.

El primer harness WebKit con mocks permitía que el service worker eludiera
`page.route()` y enviara solicitudes al proxy local. Aislar ese worker hizo pasar
los seis casos de inventario, margen y merma con las mismas aserciones. Se conserva
por separado la prueba offline real descrita arriba. El cuerpo multipart vacío en
la captura WebKit es una limitación documentada del runner, también marcada en
las [pruebas oficiales de Playwright](https://github.com/microsoft/playwright/blob/main/tests/page/page-request-intercept.spec.ts);
no se cambió la carga de archivos del producto ni se eliminaron las aserciones
de contenido que pasan en Chromium.
El Tab inicial de WebKit en macOS sigue la preferencia nativa de Safari: con la
configuración predeterminada, Option+Tab permite alcanzar enlaces. Se reprodujo
en HTML mínimo sin Kova y no se debilitaron las expectativas de teclado del repo;
la diferencia está descrita en la [guía oficial de Safari](https://support.apple.com/en-gb/guide/safari/cpsh003/27.0/mac/27).

CI detectó una carrera en la observación del efecto inicial de una prueba de identidad.
La prueba espera ahora ese efecto antes de medir el nuevo montaje; mantiene las
expectativas de descartar exactamente una vez los snapshots al cambiar de identidad.
La investigación reprodujo además tres defectos de implementación: una respuesta
de sesión anterior podía sobrescribir el caché offline y borrar consultas del nuevo
negocio, reabrir la sesión tras logout o guardar identidad después del desmontaje.
Se invalidan esas respuestas mediante la época de la consulta y el ciclo de vida
del proveedor. Las tres nuevas regresiones fallaron antes del cambio y pasan después;
cookies, autorización del servidor y separación entre tenants se conservan.

Verificación: CI del PR #187 aprobó 1,480 pruebas backend y 970 frontend;
localmente aprobaron 209 pruebas de navegador compilado (seis skips de integración que
requieren stack efímero), TypeScript, ESLint, build/SSR/prerender, contrato OpenAPI y
100 archivos JS del bundle sin patrones de secretos. Scripts operativos: 60 pruebas;
publicación: 24 aprobadas y un skip específico de Windows. Las tres regresiones finales de copy y las de foco quedaron incluidas en CI,
que también aprobó seis pruebas de navegador con FastAPI/Postgres/RLS reales. Las pruebas de navegador actualizan
selectores de título a nivel uno y del listado de productos para reflejar los nuevos
encabezados accesibles, conservando la comprobación de ordenación y los flujos.
Logout normal de la sesión de prueba: HTTP 204, cookies eliminadas y `auth/me` 401;
la sesión del usuario en el navegador integrado se conservó.

La [revisión de dependencias](KOVA-DEPENDENCY-REVIEW-2026-10-10.md) elimina los
dos críticos de desarrollo sin cambiar versiones runtime. Los gates actuales
dan cero hallazgos runtime y cero críticos completos; permanecen cinco avisos
altos de una misma cadena de compilación sin parche compatible, con alcance y
validación documentados. El parser actualizado recupera once variantes CSS ya
declaradas, conservando todas las reglas anteriores.

Los backups reales recientes tienen dump, subida, checksum, retención y limpieza
aprobados. El drill real [38073545892](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38073545892)
restauró el snapshot del 10 de octubre en PostgreSQL 17 aislado: checksum, RLS,
pagos/lotes, grants y limpieza verificados. El primer intento descubrió y permitió
corregir el socket de bootstrap mediante PR #188. [Evidencia y alcance](KOVA-R2-REAL-RESTORE-2026-10-10.md).
No sustituye recuperación regional de Supabase ni prueba de RTO/RPO completa.

El usuario confirmó ausencia de cuenta Facturapi e identidad/CSD del tenant. No se
inventaron datos fiscales ni se emitieron CFDI reales. La cuenta de plataforma y
los requisitos del emisor siguen necesarios. Terminales/cargos externos, Safari/iOS
y periféricos físicos no se declaran certificados. La publicación de los fixes
requiere CI y comprobación posterior de la versión realmente servida.


## Publicación y revisión real posterior

PR #187 se integró y su release [38072711403](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38072711403)
aprobó CI y publicación. `verify-deployment.mjs` verificó frontend, API directa,
proxy y base de datos con fuente `e915e3760e0ff479cdb1d2dbef76449fc8964b43`.
La migración 0079 está aplicada; los tres triggers tienen búsqueda fija, siguen
SECURITY INVOKER y desaparecen las advertencias correspondientes. RLS público y
rol runtime sin superusuario/BYPASSRLS siguen intactos.

La sesión original del propietario en el navegador de Codex siguió autenticada.
Al navegar de nuevo al panel se cargó inicialmente el shell PWA anterior y luego
la actualización segura cargó los cambios sin perder la sesión. Se comprobaron
etiquetas de pagos en español, base de cobros brutos, frecuencia de eventos de
devolución y encabezados h2; el menú entra al diálogo y Escape devuelve el foco.
Lecturas independientes posteriores concilian nuevamente importes, stock y reservas.

Esa última pasada descubrió contraste 2.37:1 del texto verde «44% no efectivo»
en escritorio, salto h1→h3 en Análisis y selector de sucursal fuera de landmarks.
Correcciones adicionales en `codex/published-accessibility-followups`: texto
verde oscuro en salud y comparación positiva, h2 locales con estilos conservados
en reportes y región nombrada de selección de sucursal. La gráfica de siete días
que acompaña el KPI de un día añade sus fechas reales; el neto cero en todas las
sucursales se explica sin nombrar una ganadora. Las comprobaciones originales de
cambio de sucursal y conservación de ventas offline se mantienen; no cambian los
contratos ni cálculos. PR #189 publicó estas correcciones; el release
[38075095270](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38075095270)
aprobó y el verificador público confirmó frontend/API/proxy/DB en
`6d8fa1467edb5afdecc7277b13e61520232544e6`. CI: 974 pruebas frontend,
1,480 backend, 211 de navegador compilado y seis de navegador con stack real.
La comprobación autenticada final detectó además la regresión del perfil de IA
descrita en la auditoría de acceso; su cierre sigue pendiente de corrección y QA.

Validación adicional: 30 pruebas unitarias focalizadas, 10 pruebas de navegador
compilado Chromium/WebKit (390/1440, contraste saludable y con devoluciones),
TypeScript, ESLint y build. Dos regresiones de claridad y la de landmark fallaron
antes de la corrección y aprobaron después. Las pruebas de jerarquía y landmarks
amplían axe sobre el documento y conservan la comprobación WCAG del contenido.
