# Current Sprint

Last updated: 2026-10-27

## Navegación visible por rol y categorías desplegables — 2026-10-27

El propietario autoriza implementar, validar por navegador y publicar la navegación nueva.
Caja, Pedidos y Ventas quedan directos y fijos, también en el pie móvil; el dueño y gerente
conservan Panel. El resto se presenta en categorías desplegables, con apertura de la ruta
actual y preferencias por negocio/persona/rol. Una sola opción se presenta directamente.
Se distinguen Casos de atención y Seguimientos de postventa, sin cambiar sus rutas.

La [auditoría de navegación](audits/KOVA-ROLE-NAVIGATION-2026-10-27.md) registra cambios,
permisos, teclado, preferencias, móvil y aceptación con API/PostgreSQL reales. Se mantienen
los filtros existentes y el alcance offline. Publicación autorizada, pendiente de CI y
aceptación productiva de este corte.

## Publicación y aceptación productiva de pedidos — 2026-10-26

PR #283 fusionado y release `4ae7c8f7182d` publicado por el flujo coordinado, con reversión
exacta capturada y verificación pública de frontend/API/base/proxy aprobada. El pedido
PED-564580CF por $24.00 abrió automáticamente el seguimiento desde el menú productivo.
Confirmado, preparación, listo y entregado se reflejaron sin pulsar Actualizar; notas,
reserva, cobro vinculado y reapertura anónima se verificaron en navegador.

La [aceptación productiva](audits/KOVA-PRODUCTION-ORDER-FLOW-2026-10-26.md) documenta
la devolución manual identificada de la comprobación: neto $0.00 e inventario restituido,
con venta y devolución conservadas. Esta aceptación no representa movimientos de fondos
externos ni activación de Stripe, WhatsApp, CFDI o hardware físico.

## Revisión para dueños, operadores y cajeros — 2026-10-26

Se amplía la revisión a los recorridos diarios: panel/horas con ventas reales, inventario
disponible frente a reservado, primera configuración de Agenda, proveedor dentro de la compra,
prerrequisitos de reposición y lenguaje comprensible en operación, WhatsApp y suscripción.
La descripción del gerente coincide con el permiso de empleados exclusivo del propietario.
Se mantienen contratos financieros, permisos, cookies, RLS y sincronización.

La [auditoría por rol](audits/KOVA-ROLE-UX-REVIEW-2026-10-26.md) registra pantallas productivas
revisadas, cambios y aceptación con frontend/API/PostgreSQL reales: 20 recorridos y cuatro
recorridos adicionales de propietario, gerente, cajero y colaborador. Backend completo:
2,232 pruebas y seis subpruebas aprobadas. Frontend completo: 1,660 pruebas; navegador sobre
build: 332 escenarios aprobados. Build, lint, contrato API y bundle aprobados. La publicación
y aceptación posteriores están documentadas en la sección productiva anterior.

## Continuidad de pedidos y revisión de operación — 2026-10-26

El dueño pide una revisión real en navegador para reducir fricción de clientes y operadores.
Se revisa la sesión productiva existente y se implementa localmente la entrada directa al
seguimiento al enviar, actualización cada 30 segundos, copia del enlace, alta de cliente
sin salir de la revisión, acceso a solicitudes desde Pedidos, notas originales visibles
al preparar y textos sobre la siguiente acción. Se conserva la restricción de cobrar antes
de entregar, además de privacidad pública, permisos, RLS e idempotencia.

La [auditoría del recorrido](audits/KOVA-ORDER-FLOW-UX-2026-10-26.md) documenta archivos,
contrato opcional del mensaje original, evidencia, referentes y registros de QA detectados
en producción. Validación focal: 173 pruebas frontend, 50 backend, 30 escenarios de navegador
y tres integraciones con API/PostgreSQL reales. Publicación y aceptación posteriores
registradas en la evidencia productiva anterior.

## Presentación terminada y aceptación de producto real

El propietario pide quitar referencias internas de todo Kova, no sólo de la tarjeta.
La revisión con agentes cubre más de 200 TSX: QR como identificación principal, número manual
desplegable, datos de negocio en lugar de UUID/versiones, errores comprensibles, recuperación
sin tokens de desarrollo y roles traducidos. Se conservan folios/SKU/RFC/UUID fiscales útiles,
contratos financieros, reintentos, controles de acceso y los diagnósticos privados de soporte.

La [auditoría del corte](audits/KOVA-PRODUCT-PRESENTATION-2026-10-26.md) registra cambios,
pruebas, revisión con Browser y límites de salida. No se declara GA ni publicación por una
validación local: siguen pendientes el release final y la aceptación de Stripe live, correo,
recuperación completa y operación comercial. Se corrigen runbooks de infraestructura retirada
y se documenta qué comprueba realmente el smoke, sin activar servicios ni hacer cobros.

## Tarjeta desde el menú y continuidad en Caja — alcance autorizado

El propietario descarta Wallet y suscripciones a proveedores de pases. Autoriza una tarjeta web
que el cliente obtenga desde el menú y un trabajo con agentes sobre el recorrido completo.
Implementado y validado localmente; publicación y pruebas con equipos físicos pendientes:

- Alta pública opcional por sucursal, desactivada hasta decisión del dueño. Requiere programa
  de puntos autorizado y menú publicado; no configura tasas ni beneficios automáticamente.
- Tarjeta personal nueva desde el menú, saldo y recompensa reales. No busca ni recupera un
  cliente existente por nombre/teléfono no verificados. Acceso de dispositivo mediante cookie
  HttpOnly separada del comercio, consentimiento explícito, CSRF, caducidad y revocación.
- Código de socio que sirve para identificar al cliente en Caja autenticada, sin conceder
  consulta pública ni servir como contraseña. Cliente asociado visible durante el cobro.
- Navegación descubre tarjetas, recompensas y menú QR dentro de los permisos existentes.
- Pedidos distingue error de inventario de productos agotados y reintenta sin perder el borrador;
  Lealtad descarta resultados anteriores al cambiar una búsqueda de clientes.

Se conservan el enlace privado emitido por el dueño, contratos de venta/offline, RLS y billing.
Wallet, NFC, proveedores nuevos y recuperación automática entre dispositivos quedan fuera.
La comprobación usa datos de prueba locales; no cambia configuración ni datos productivos.

Contrato: [alta pública por dispositivo](../specs/loyalty/public_enrollment.md). El dueño permite
altas desde Lealtad sin activar automáticamente tasas ni beneficios. El cliente elige un alias y
acepta crear su tarjeta; una cookie HttpOnly por programa conserva su acceso durante 180 días.
La tarjeta mantiene el formato compacto, muestra saldo real, avance hasta la meta y beneficio
disponible, y despliega un QR PNG generado localmente con su código de socio. Ese código sólo
identifica al cliente ante personal autenticado; no permite consultar puntos públicamente.

Abrir la tarjeta en otra pestaña conserva cantidades y formulario del menú. Recargar tras una
respuesta incierta recupera la misma alta: sessionStorage sólo guarda la clave de operación,
nunca cookies, grants, nombre ni una credencial de sesión. Sin almacenamiento funcional se bloquea
el envío antes de crear una ficha. Pausar altas conserva el acceso de los miembros vigentes;
revocación de cliente/autorizante, billing, expiración y aislamiento de sucursal siguen vigentes.
La proyección pausa la acumulación si su autorizante pierde acceso, sin editar puntos históricos.

Archivos principales: `backend/app/loyalty/enrollment*.py`, migración 0098, modelos/contratos,
catálogo, grants y lifecycle; `frontend/src/loyaltyCard`, `loyalty/LoyaltyView`, identificación y
resumen de cliente en `register`, menú, búsqueda de navegación y captura de Pedidos.

Validación final: 1,566 unitarias frontend y 2,186 backend (más seis subtests) aprobadas; backend
completo en base nueva y aislada. Setenta focales de API y cinco de migración/RLS verifican
concurrencia real, CSRF comercial/público, origen estricto, cookies, revocación y export/purga.
La pasada completa del build aprobó 331 recorridos de navegador; veinte integraciones se omiten
en preview. Cuatro integraciones reales se ejecutaron aparte: tarjeta emitida por dueño,
alta desde menú y compra/canje, recompensa con devolución y pedido hasta entrega. Las otras
dieciséis integraciones no se repitieron. Tras acotar el texto de avance a su meta se revalidaron
23 recorridos focales sobre el build final a 320/390/768/1440 px, con teclado y axe incluyendo
el diálogo público. El selector de estado del test de recompensa se limita a su propia región
porque la búsqueda de clientes ahora anuncia su carga; conserva la expectativa financiera.

El E2E nuevo sin interceptar APIs conserva un solo cliente, dos ventas ($125.50 y $100.50),
un canje de ocho puntos por $25 y acumulaciones de 10 y 8 puntos. Browser completa otra alta
real local desde el menú, confirma el pedido conservado y revisa código/QR sin desbordamiento.
TypeScript, ESLint, Ruff, build/SSR/prerender, OpenAPI y bundle sin secretos aprobados.
No se acredita lectura de QR con hardware físico, recuperación entre dispositivos ni publicación.

## Continuación autorizada — pedido directo, seguimiento y recompensa en caja

El propietario aprobó la tarjeta pulida y pidió continuar con el resto del recorrido.
Los siguientes cortes están implementados y validados localmente; publicación y aceptación
en dispositivos físicos siguen pendientes:

- Solicitud estructurada del menú, revisión de precios/stock y aceptación idempotente en Pedidos,
  sin recaptura ni paso obligatorio por oportunidad/cotización. Consultas anteriores conservan
  su flujo. Contrato: [aceptación y seguimiento](../specs/storefront/order_acceptance_tracking.md).
- Seguimiento público privado de esa solicitud/pedido, desde recepción hasta entrega o cancelación,
  con capability de lectura propia y sin contactos, historial privado ni cobros inferidos.
- Beneficio de lealtad definido explícitamente por el dueño y cumplido en caja, con puntos y venta
  atómicos, idempotencia, permisos y reversas verificadas. Contrato:
  [recompensas en POS](../specs/loyalty/pos_rewards.md). No se asignan tasas ni beneficios a un negocio
  sin decisión de su dueño. La venta offline anterior conserva su contrato.
- Análisis abre el producto exacto para completar un costo faltante, con el permiso de edición
  existente. No cambia costos históricos ni métricas: [contrato](../specs/reports/missing_cost_review.md).

La comprobación usa PostgreSQL y API locales, además de UI responsive y seguridad. Las migraciones
son aditivas, con RLS, propiedad, exportación y purga. Este alcance no activa un proveedor de pagos,
WhatsApp, timbrado fiscal ni Wallet; sus gates y aceptación externa conservan su vigencia.

Tres E2E nuevos usan API/PostgreSQL reales y rol runtime con RLS: venta y tarjeta de 10 puntos;
venta de $125.50, beneficio explícito de 8 puntos/$25, cobro de $100.50, replay y devolución;
y solicitud de dos productos de $45, revisión con cliente, reserva, cobro y entrega de $90.
El último conserva una sola venta/pedido y stock 5→3, con seguimiento anónimo entregado.
La recuperación incierta conserva cuerpo/clave en un registro separado de la cola offline,
bloquea editar la venta y permite reintentar tras recargar. El aviso queda visible y recibe
foco también en móvil. El recibo conserva el beneficio aplicado y los puntos usados.

Validación de cierre: 1,516 pruebas frontend y 2,167 backend (más seis subtests) aprobadas;
backend completo en una base local nueva. Las migraciones 0065/0096/0097, concurrencia real,
RLS, exportación y purga con dos negocios tienen comprobaciones propias aprobadas.
ESLint, TypeScript, build/SSR/prerender, contrato OpenAPI y bundle sin secretos aprobados.
Browser confirma tarjeta/recompensa y seguimiento con datos reales locales a 390/1440 px.
La pasada completa del build aprueba 325 recorridos de navegador, con 19 integraciones omitidas
por el perfil preview; las tres integraciones nuevas se ejecutaron aparte y aprobaron sobre
API/PostgreSQL reales. Las otras 16 integraciones existentes no se repitieron en este cierre.
El humo de producción se excluye de ese perfil local; no se acredita publicación ni proveedores.

Se actualizaron expectativas de landing y dos fixtures fiscales por el retiro autorizado de
activación/promoción, conservando precio, revisión, confirmación, idempotencia y recuperación
de documentos existentes. El test de enlaces operativos espera que termine el fade-in antes
de medir contraste con axe; mantiene reglas WCAG, IDs exactos, recarga y ausencia de escrituras.

## Alcance disponible, menú y tarjeta digital — ejecución autorizada

El propietario pidió retirar temporalmente la presentación de funciones no disponibles,
optimizar el menú digital y construir con agentes una tarjeta de lealtad de puntos.
Este corte incorpora la [tarjeta digital](../specs/loyalty/digital_card.md) al alcance activo:
el dueño comparte un enlace de consulta por cliente/sucursal, con saldo y regla reales.
El corte inicial no incorporó inscripción pública, sellos, Wallet ni canjes con descuentos POS;
estos últimos se añaden en la continuación descrita arriba.

La presentación conserva los módulos internos existentes. Se retiran el acceso general a
Canales, la promoción de terminal bancaria y la activación fiscal sin conexión o historial.
Las solicitudes fiscales y la recuperación de conexiones/documentos existentes se conservan.
Bandeja describe conversaciones y borradores internos cuando no hay canal conectado;
el centro de control reutiliza esos destinos y deja de destacar el canal ausente.
La landing explica ventas/inventario/análisis sin prometer toda la operación automatizada.

El menú conserva contratos y tres columnas móviles; agrega búsqueda por varias palabras,
orden por precio/nombre, limpieza con foco y primera fotografía prioritaria. La tarjeta
consulta por capability en fragmento y cuerpo POST, sin cookies, caché, contactos ni ledger
privado. Su lectura no acumula puntos; devoluciones pendientes y saldos negativos son visibles.
Se conservan RLS, billing, permisos y separación de sesiones, sin nuevas migraciones.

Validación final integrada: 1,468 unitarias frontend, 51 pruebas backend con PostgreSQL real
y dependencias del lockfile, Ruff, ESLint, TypeScript, build/SSR/prerender, OpenAPI y revisión
del bundle aprobados. Treinta recorridos del build cubren menú, tarjeta, panel y SEO;
teclado y axe en 320/390/768/1440 px, y panel hasta 1920 px. La revisión visual confirma
filtros legibles durante su cambio, tarjeta compacta y menú visible en la primera pantalla.
Los avisos de actualización del comercio no se muestran en menú o tarjeta públicos.
Los cambios de expectativas de landing/SSR
corresponden al copy solicitado, sin modificar resultados financieros ni controles de seguridad.

Un E2E nuevo sin APIs interceptadas completa publicación del menú, venta UI de $125.50,
acumulación única de 10 puntos, emisión del enlace, consulta anónima y regreso al menú.
Usa tenant desechable, API/PostgreSQL locales y rol runtime `kova_app`; ya forma parte de
`test:integration`. Verifica también ausencia de cookies, referrer y datos privados.
No es una operación en producción. La revisión productiva con Browser fue de lectura y
selección en memoria en Panel, Caja, publicación/menú, Lealtad y Análisis, sin enviar
solicitudes, crear ventas ni cambiar políticas. La lectura confirmó que lealtad está
desactivada y el menú público conserva un título genérico.

La tarjeta prioriza identidad comercial, saldo y regreso al menú. Reglas y vigencia están
en un desplegable; ajustes pendientes y saldos negativos permanecen visibles. La versión
final vuelve a aprobar los 30 recorridos con API interceptada y el ciclo real de 10 puntos.
Browser confirma la tarjeta con datos del tenant local y sin desbordamiento a 390 px.
La publicación y aceptación de dispositivos físicos
siguen pendientes. El [siguiente alcance de producto](sprint-planning.md#recorrido-conectado-del-cliente--2026-10-26)
distingue lo implementado de las dependencias externas aún pendientes.

## Preparación de publicación — cierre de AbortSignal/Request

Los dos errores de identidad quedan resueltos al reinstalar las dependencias exactas del
lockfile: el entorno local conservaba Vitest 3.2.7 y el repositorio ya fija 4.1.11. No se
cambian autenticación, setup, lockfile ni expectativas de identidad. Tres nuevas pruebas
protegen Request/clones, motivo de cancelación y limpieza de listeners DOM con los globals reales.
Validación completa: 1,428 unitarias frontend, 2,105 backend y 311 recorridos de navegador
aprobados; 16 casos de integración se omiten deliberadamente en el perfil preview y se ejecutan
contra API/PostgreSQL reales por separado. También se corrigen la espera del guardado final de
postventa y una ruta de capturas exclusiva de macOS, conservando resultados y controles originales.

Los cambios se integran con `main`, incluyendo el enlace/QR fijo del menú y el centro de control.
El [PR #277](https://github.com/ArturoFrancoMozqueda/kova/pull/277) concentra la entrega; su gate
`CI required` sobre el último commit es la autoridad para publicar. No se ha fusionado ni
desplegado esta rama. [Evidencia y límites](audits/KOVA-RELEASE-READINESS-2026-10-25.md).
WhatsApp permanece deshabilitado por defecto y requiere aceptación independiente del proveedor.

## Experiencia compartida y ciclo de negocio — validación local

Agent Teams unifica controles, encabezados/acciones, estados vacíos y foco en Agenda,
Atención postventa, Seguimiento y Bandeja. Compras prioriza registros/recepción y conserva
borradores en paneles secundarios; Pedidos comparte filtros con teclado y el término Tarjeta
manual con Caja. La continuación comercial y reposición/compra conservan el registro exacto.
Se corrige la contradicción entre prioridad y severidad de una devolución única del 100%.
El [contrato UI/UX](claude/ui-experience-contract.md) guía los módulos sin cambiar sus contratos.

El build pasó cuatro recorridos con API/PostgreSQL/RLS locales reales, incluido el nuevo ciclo
por UI: menú anónimo → solicitud → cliente → oportunidad → cotización → pedido → cobro → entrega
→ postventa → reposición → recepción parcial/total. Conservó una venta de $90 y existencias
5→3→4→7. Se añade a CI de integración. Pasaron 47 regresiones de navegador con APIs interceptadas,
TypeScript, ESLint, build/SSR/prerender y contratos. El corte inicial tuvo 1,407 unitarias aprobadas
y dos fallos de AbortSignal/Request, resueltos en la preparación de publicación descrita arriba.
[Alcance, archivos, evidencia y límites](audits/KOVA-EXPERIENCE-CONTINUITY-2026-10-25.md).
Sin publicación ni activación/certificación de proveedores externos por esta entrega.

## WhatsApp → cliente → catálogo → pedido — piloto asistido local

Se implementa ingreso HTTPS con firma raw, routing por registro privado de plataforma y
sesiones runtime/RLS por negocio/sucursal. La bandeja permite identificar el contacto exacto,
vincular cliente, consultar historial y preparar pedido; genera borradores del catálogo publicado
y admite respuesta humana con confirmación, autor/responsable vigente, consentimiento y ventana.
Conexión/configuración y entrega se muestran por separado. Hay interruptor global y por conexión,
límite diario conservador y estados inciertos sin reenvío ciego. No se agregan migraciones ni
permisos de escritura de bindings al runtime; el alta asistida verifica la cuenta ante Meta con
un script de operador. [Contrato](../specs/integrations/messaging-inbox.md) y
[guía de alta/aceptación y pendientes](runbooks/whatsapp-assisted-pilot.md).

El propietario sólo tiene WhatsApp Business en el celular. La app de Meta, número de prueba,
credenciales en Secret store, publicación y entrega real siguen pendientes. Este corte no completa
Embedded Signup ni avisos automáticos con plantillas/postventa externa; las tareas internas y
los contratos de venta/pago conservan su significado. Validación local: 117 pruebas backend
focales y 75 con pg8000; 19 frontend focales, siete recorridos Chromium y 21 del controlador
nativo aprobados. El corte inicial tuvo 1,391 unitarias aprobadas y dos fallos de AbortSignal/Request,
resueltos en la preparación de publicación descrita arriba. TypeScript, ESLint,
Ruff, build/SSR/prerender y contratos aprobados. [Evidencia y límites](audits/KOVA-WHATSAPP-PILOT-2026-10-23.md).

## Menú digital público — implementación local

El catálogo se presenta como menú para armar solicitudes de pedido, a distancia o en el negocio:
búsqueda, disponibilidad, cantidades, subtotal estimado y resumen adaptable a móvil/escritorio.
El detalle llega a la bandeja existente de Kova con el contrato público actual, sin migraciones.
Las consultas generales y el enlace secundario a WhatsApp se conservan. No crea automáticamente
órdenes operativas, reservas ni pagos; el equipo revisa la solicitud antes de continuar.
[Contrato y límites](../specs/storefront/public_catalog.md). Publicación y aceptación con un
negocio real pendientes; las pruebas locales no acreditan pedidos productivos ni WhatsApp real.
El ajuste móvil conserva el encabezado compacto y separa exploración de revisión sin duplicar formulario.
El menú usa tarjetas en tres columnas en móvil/tablet con fotografías 4:3 a todo el ancho, nombres,
precios y controles bajo la imagen. «N en pedido» abre el detalle para ajustar cantidades sin
comprimir los botones; escritorio conserva sus controles directos. Un toque abre foto grande y descripción completa en el diálogo
compartido. Sólo se muestran las fotos públicas reales del negocio; las capturas de demostración
usan recursos existentes del proyecto desde una respuesta interceptada del test.
Al volver conserva datos, selección, posición de desplazamiento y foco. Escritorio conserva la
disposición con resumen lateral. La bandeja y los contratos no cambian.
Validación: 32 pruebas focales, TypeScript, ESLint de archivos afectados y build/SSR/prerender
aprobados. Ocho recorridos del catálogo sobre el build final, con APIs interceptadas, cubren
320/390/768/1440 px, pedidos a distancia/presenciales, consultas, teclado, reintento y axe.
Móvil verifica tres tarjetas por fila en 320/390/768 px, carga de fotografías, primer producto
antes de 400 px, revisión separada y conservación de contacto/notas al regresar al menú.
Las pruebas con fotografías verifican carga de píxeles reales, amplitud de imagen y navegación
por teclado del detalle (foco, Tab/Shift+Tab y Escape), conservando la cobertura sin fotografías.
Revisión visual de capturas móvil/escritorio completada; QR físico y WhatsApp real sin verificar.

Ajuste del 2026-10-24: el guardado del menú conserva siempre el enlace y QR vigentes. Se retira
la casilla de reemplazo del formulario para evitar invalidar direcciones al actualizar contenido.
La interfaz aclara que los cambios guardados se ven al abrir o recargar el mismo enlace. La API
rechaza `rotate_link: true` con 422 y elimina la lógica de reemplazo; el campo deprecado sólo
admite `false` para clientes existentes. Las rutas retiradas históricamente siguen inválidas.
Retirar y volver a publicar conserva la dirección y el QR, sin nuevas publicaciones ni alias.
Validación frontend:
cuatro pruebas del formulario, TypeScript y ESLint aprobados. El recorrido de navegador con
API, Postgres y rol runtime sin bypass de RLS confirma que editar, guardar y abrir la misma
URL muestra el título actualizado; también completa la consulta y su conversión existentes.
Validación completa del ajuste: 30 pruebas backend de catálogo/captación, 33 de storefront,
TypeScript, ESLint, Ruff y contrato OpenAPI aprobados. El recorrido real de publicación,
actualización por la misma URL y consulta también aprobó con la nueva restricción de API.
Backend prueba rechazo sin crear alias, retiro/republicación con el mismo PNG de QR y
compatibilidad de enlaces históricos, incluyendo la invalidez de los ya retirados.
Implementado localmente, pendiente de publicación.

Integración con el panel de #275: se incorpora su DTO puro al inventario de Workers y se
ajustan los checks de navegación/login a «Centro de control». El menú cerrado se verifica
directamente por `aria-hidden`, `inert` y enlaces fuera del árbol accesible; los accesos de
Catálogo del panel permanecen permitidos. Cuatro pruebas de snapshot, 13 recorridos de
login/navegación sobre el build final, TypeScript, ESLint, Ruff y build/SSR/prerender aprobados.

## Flujos conectados de comercio y servicios — implementación local

Agent Teams implementó navegación del dueño con siete entradas y herramientas contextuales,
ficha de cliente con registros reales y pasos directos a Caja/Pedidos/Agenda. Pedidos conserva
cliente explícito hasta la venta; Agenda vincula una venta existente con idempotencia/historial,
sin confundir atención y cobro. Se mantienen rutas, roles, gates y operación anónima de mostrador.
Migraciones 0094/0095 aditivas; preservan RLS, propiedad, exportación y purga. Los arreglos útiles
de #267 se conservan íntegros en esta entrega antes de coordinar su cierre por sustitución.
[Alcance, archivos, validación y límites](audits/KOVA-CONNECTED-OWNER-2026-10-22.md).
Validación: 1,373 pruebas frontend, 93 backend por cada driver psycopg/pg8000, cinco escenarios
de migración y 42 de navegador sobre el build final (tres con API/Postgres/RLS locales reales).
Exportación del grafo conectado y ciclo de cuenta: 11 pruebas adicionales aprobadas.
Publicación y aceptación productiva pendientes; no se activan canales ni proveedores externos.

## Estado productivo registrado durante la PR #267

La base productiva es `07b03a9912ba32fd9ad165e3818e32d403626ff6` (#266):
[CI y release 39865204921](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39865204921)
aprobados y `/health` con el SHA exacto. #262/#263 corrigieron la publicación
estricta tras cambios de configuración del dashboard; #265 normalizó la
jurisdicción R2 sin configurar y tuvo
[release 39850544534 aprobado](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39850544534).
#261 también está integrado (`cb90e026`); corrige una aserción sobre ciphertext,
sin modificar el almacenamiento de credenciales.

La comprobación posterior `verify-deployment` confirmó web, proxy, backend y
base de datos con ese SHA. El verificador residente aprobó 25 contratos sobre
el mismo proceso, mediana 291 ms y máximo 551 ms. Fueron lecturas sin mutaciones;
no equivalen a una nueva venta, emisión fiscal, mensaje entregado ni aceptación
autenticada completa de la interfaz.

La lectura autenticada actual de `GET /api/v1/integrations/cfdi/setup` devolvió
`available:true`, `state:not_started`, `issuer:null`, `organization_created:false`,
`test_connected:false`, `live_connected:false` y `production_ready:false`.
Kova detecta la configuración fiscal de plataforma; faltan emisor y conexión
Test/Live. Esto no demuestra que Facturapi acepte la llave. La lectura de
`GET /api/v1/assistant/capabilities` devolvió `enabled:true`,
`local_answers_ready:true`, `inference_ready:false`, `configuration:false`,
`documents:false` y `email:false`. Las respuestas locales están disponibles según
capacidades; generación externa, aplicación de configuración, documentos y correo
no están habilitados. No se probó una respuesta hoy ni se invocó inferencia o
generó gasto por ella.

El catálogo con nombre del negocio ya se publicó en #260 y se verificó en
`https://kovasuite.com/catalogo/cafeteria-sweet-home`. Ese pendiente está cerrado;
no implica checkout ni pago en línea. La ronda con equipos de agentes está lista
para PR, sin publicar y con CI remoto pendiente. Incluye claridad de preparación
de canales, especificación fiscal actualizada y cuatro correcciones de Pedidos.
La generación de consulta descarta respuestas tardías tanto de API como del
fallback al limpiar la consulta; las respuestas anteriores tampoco actualizan la
caché. Pruebas con promesas diferidas cubren esa protección. La primera descripción
de arquitectura en `CLAUDE.md` refleja Cloudflare activo, Vercel de respaldo y Fly
retirado, sin cambiar sus reglas.

Validación de la versión final: 192 archivos y 1,334 pruebas de frontend;
TypeScript, ESLint y build/SSR/prerender aprobados. Pasaron 19 pruebas de navegador
del build final (`customer-orders` y `automations-crm`), con 320/390/768/1440 px y
axe. Revisión independiente de Canales y especificación sin bloqueos. Las pruebas
usan APIs interceptadas; las lecturas autenticadas anteriores no equivalen a una
nueva aceptación completa de UI. No se realizó QA productiva financiera ni hubo
emisión fiscal, envío de mensajes o cobro real.

Prioridades pendientes: distinguir guía y conexión real de canales; completar
el emisor fiscal y aceptar Test antes de cualquier Live, con configuración de
plataforma ya detectada; revisar con el
dueño turno, costos y catálogo; completar recorridos externos de WhatsApp/IA y
aceptación de dispositivos/offline según alcance. El
[estado funcional](audits/KOVA-ESTADO-FUNCIONAL-2026-10-22.md) conserva la auditoría
autenticada anterior como snapshot, separado de estos hechos de publicación.

## Escritorio: resultados y valor visible — publicado en #266

Pase autorizado de Panel, Caja, Catálogo e Inventario: resultados y prioridades
antes de configuración, comparación explícita, atajos compactos, enlaces
contextuales, instantánea operativa con alcance real y checkout integrado con
total y cobro accesibles. No agrega consultas ni cambia contratos, cálculos,
sesiones o permisos. [Alcance, archivos y QA](audits/KOVA-DESKTOP-VALUE-2026-10-22.md).
Suite de frontend: 1,326 pruebas aprobadas y revalidaciones focales finales;
build/SSR/prerender, TypeScript, ESLint y 49 recorridos de navegador del build
final aprobados, incluidos 320–1920 px y regresiones de cobro/offline/recibo.
Los recorridos usan datos de pruebas con APIs interceptadas. Publicación
completada con el SHA y release indicados arriba; aceptación autenticada de este
pase en producción pendiente. El documento de alcance enlazado conserva su
estado de implementación local anterior a la publicación.

## Auditoría funcional y enlaces legibles — snapshot y publicación #260

Revisión de lectura autenticada de las secciones del dueño, contrastada con contratos,
implementación y QA previa: [matriz de estado y prioridades](audits/KOVA-ESTADO-FUNCIONAL-2026-10-22.md).
El núcleo POS está respaldado por aceptación previa; los canales externos no quedan
certificados por CI. No se realizaron nuevas ventas ni conexiones durante esta auditoría.
El propietario eligió enlaces del catálogo con nombre del negocio sin código aleatorio.
La implementación publicada incorpora rutas legibles con colisiones numéricas, compatibilidad de QR anteriores
y revocación por versión; migración aditiva y metadatos de routing con RLS por slug exacto.
#260 se publicó como `e20b62a92413c78398dd8c1c039efe1704842ef6`, con
[CI y release 39823273561 aprobados](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39823273561).
La aceptación posterior verificó la URL real indicada arriba; no se repitió
durante esta actualización documental ni acredita las integraciones externas.

## Kova como copiloto — Phase 0 foundation

The 12-month product strategy starts with validation rather than feature parity. The first shipped
slice measures whether real analysis produces a useful owner action; contract and privacy rules live
in [`specs/reports/analysis_activation.md`](../specs/reports/analysis_activation.md).

- [x] Keep **Análisis** as the authenticated surface without changing `/reports` or report API
      contracts.
- [x] Track tenant-scoped analysis views, evidence opens, action starts, completions and reopens with
      categorical metadata only.
- [x] Add the missing successful `close_shift` activation event.
- [x] Validate analysis payload categories server-side and reject financial or unsupported metadata.
- [x] Expose a protected, identity-free 7/30-day adoption report for weekly pilot review.
- [x] Measure explicit recommendation usefulness, prior-window return, active-business adoption and
      the observable sale → close → analysis journey.
- [ ] Recruit and observe the planned multi-vertical pilot cohort; this is commercial research, not
      a code-complete gate.
- [ ] Close the existing live Stripe, inbox-delivery and backup-restore production gates before broad
      rollout.

## Source Of Truth

Este archivo contiene sólo el plan vigente. Las secciones históricas (julio–21 de octubre) se
retiraron del árbol el 2026-10-22 y se conservan en el historial de git.

- El objetivo de ejecución actual y los gates de publicación viven aquí.
- La hoja de ruta futura vive en `docs/sprint-planning.md`.
- Los runbooks operativos viven en `docs/runbooks/` y los riesgos en `docs/risk-register.md`.
- No duplicar criterios de aceptación detallados aquí; enlazar la spec, runbook o plan dueño.
- Setup, comandos de prueba, arquitectura y puntos de entrada operativos viven en
  [`engineering-operations-index.md`](engineering-operations-index.md).
