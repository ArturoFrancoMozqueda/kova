# Current Sprint

Last updated: 2026-10-21

## Revisión real del dueño y carga de fotografías

Se recorrió el tenant de prueba autorizado mediante Computer Use en Edge, con
sesión de propietario y vista de teléfono de 393×852 y DPR3. No se efectuaron
cobros, envíos ni cambios en datos del negocio. Se comprobaron login, Panel,
navegación, Catálogo, publicación existente, catálogo público, selección de un
producto sin enviar la consulta, solicitudes vacías, pendientes y Análisis en
Hoy/30 días. El bloqueo del Mac interrumpió el resto del recorrido; esta muestra
no equivale a probar Safari real, otros roles ni todos los módulos.

Las 12 fotos observadas de 320px devolvieron 200 en 187–215ms. Después de 362
segundos, con la caché del navegador desactivada y sin cambiar versiones/URLs,
nueve descargas observadas tardaron 1.30–2.38s. No se observaron 429/503. Esto
documenta una demora de fotografías; no demuestra un reinicio del backend ni
atribuye todo el tiempo a SQL o decodificación. Las cabeceras anteriores no
separaban esas fases.

Correcciones derivadas de esa evidencia:

- PostgreSQL comprueba SHA-256 del contenido actual y visibilidad antes del HIT
  de miniatura, evitando transferir el original que ya está representado en el
  LRU. Se conserva la clave por contenido, MIME y ancho, los filtros de tenant y
  producto activo, los cuatro slots, un decoder y 4MiB de derivados. El primer
  MISS real todavía descarga y transforma; no se agrega almacenamiento externo.
- Las miniaturas del Catálogo declaran sus 44/48px reales, de modo que 160px
  alcanza para DPR3 en vez del candidato de 320px elegido con el antiguo sizes
  de 64px. Se distinguen carga/fallo/sin fotografía y el reintento explícito
  conserva URL y revisión, sin abrir el editor. Categorías se desplaza en una
  fila en teléfono, conservando filtros y acciones.
- Análisis conserva tickets en bloques con neto cero/negativo, explica que la
  tasa de devolución corresponde a importe y evita comparar una sucursal
  consigo misma. Pocas cancelaciones usan copy neutral; no cambian métricas,
  denominadores, datos ni umbrales.
- Diagnóstico numérico de SQL/caché/resize en imágenes públicas; el gateway
  conserva sólo las métricas autorizadas y añade el tiempo total del hop.

Validación dirigida: 48 pruebas de imágenes con psycopg y otras 48 con pg8000;
20 de gateway/caché/workerd; 163 de Reports/Branch; 16 de miniaturas/Catálogo;
cuatro escenarios de navegador móvil, incluidos DPR3, fallo503 simulado local,
recuperación sin cachebuster y filtro de categoría fuera del primer tramo.
CI completo y comparación posterior al despliegue son los gates de publicación.

Aceptación posterior de #240 (`a468d868df10cbef67f56c43bb0ca99ed4203fd6`):
CI y publicación aprobaron, pero cuatro fotografías reales simultáneas de 320px
todavía tardaron 5.2–8.8s en su primer MISS. Tras 330s sin consultas del
verificador, el mismo proceso devolvió los mismos archivos en 1.8–2.0s; resize
fue cero en esa segunda muestra. Los tiempos alrededor de `db.execute` incluyen
pool/conexión, transporte y ejecución; no son medidas puras del servidor SQL.
Por ello #240 es una mejora parcial y no acredita resuelta la demora reportada.

Seguimiento implementado, pendiente de aceptación productiva: miniaturas persistidas en la fila original,
acotadas a cuatro anchos y validadas contra el SHA real antes de servirlas.
Escritura técnica opcional con sesión propia sujeta a RLS, condición atómica y
sin cambiar la versión de la foto; el reemplazo elimina las variantes anteriores.
Las nuevas subidas preparan los cuatro tamaños fuera del event loop y sin
conexión retenida. Antes de guardar original y variantes en una sola transacción,
se vuelven a comprobar sesión, pertenencia, permiso y producto. Ese trabajo puede
añadir segundos a la subida en el servidor limitado; no se presenta como gratis.
Las fotos antiguas adquieren variantes de forma oportunista al consultarse; su
primera transformación sigue teniendo coste.

Las lecturas públicas frescas usan AUTOCOMMIT exclusivamente en psycopg nativo
y en el pool privilegiado existente: se eliminan BEGIN/ROLLBACK sin alterar auth,
webhooks, transacciones activas ni sesiones con contexto. Una prueba real verifica
que el aislamiento se restaura y una escritura posterior sin commit se revierte.
La proyección residente amplía recycle a 1800s, conservando pre-ping y capacidad.

La aceptación de CI ahora exige persistencia antes de reiniciar realmente el
contenedor y, después, proceso nuevo, mismos bytes y cero resize en las ocho
peticiones, con el presupuesto original de 3000ms y 256MiB/1⁄16CPU. No se amplía
el TTL público de 300s ni se conectan cuentas o recursos externos nuevos.

Hallazgo separado: la consola del SDK reportó un DSN de observabilidad inválido.
No se inspeccionaron valores secretos ni se modificó esa configuración; no se
considera una explicación demostrada de la demora de las imágenes.

### Capacidad mínima y preparación de fotografías anteriores

#241 se publicó correctamente como `ddecf01a3af98d4b9682a8dca3785180761db7c7`
con CI/release `39575574802`. Aun así, cuatro fotos antiguas sin variante de 160px
tardaron 4.46–7.17s; las de 320px, 2.24–6.24s. Tras 330s sin consultas del
verificador, con el mismo proceso y archivos, resize fue cero en las ocho descargas,
pero 160px tuvo mediana 1938ms y máximo 1988ms; 320px, 1158ms y 1425ms. Todas fueron
MISS de caché pública y 200. La persistencia evita recomputar tras reinicios;
estos datos todavía no acreditan resuelta toda la demora interactiva.

Seguimiento: una instancia `basic` (¼ CPU, 1GiB, 4GB, máximo 1) sustituye a `lite`.
Es la siguiente capacidad mínima documentada; la evidencia de latencia motiva
este ajuste, pero no demuestra directamente throttling ni promete 4× rapidez.
RAM/disco residentes agregan aproximadamente USD 5.22 por 720h; CPU activa es variable,
las inclusiones se comparten y el plan Workers USD 5 existente se cuenta aparte.
Referencia: https://developers.cloudflare.com/containers/platform/pricing/.
CI conserva su aceptación más estricta bajo 256MiB y 1⁄16 CPU. La recuperación
valida exactamente ambas tuplas y restaura el tamaño capturado junto con la imagen.

Un workflow manual separado prepara hasta 100 fotos públicas activas anteriores
fuera del servidor productivo. Exige main, intención explícita y CI exitoso del
mismo SHA. Sólo las lecturas de originales usan propietario en transacción de
sólo lectura; cada escritura asume kova_app, fija tenant validado y usa el CAS
existente para actualizar únicamente miniaturas sin cambiar fecha, URL u original.
No crea cuentas, roles o recursos nuevos. La ejecución productiva y la medición
posterior se documentan a continuación.

Aceptación de #242, publicado como `90991995026191737a4af965a150158ac724580b`:
CI y release `39580225817` aprobaron. La configuración productiva confirma basic,
máximo una instancia, una running e imagen coincidente; la API no informa la cuota
física de la VM individual. El mantenimiento SQL `39581662335` se detuvo antes de
procesar fotos porque la identidad de administración no puede asumir `kova_app`.
No se cambiaron permisos. Se completó la preparación de las 12 fotos del tenant
de prueba con 48 GET acotados de la API existente, usando su escritor RLS normal;
SQL de sólo lectura confirmó 12/12 variantes válidas a 160 y 320px. Tras 330s sin
probes del verificador, cuatro fotos simultáneas por ancho devolvieron 200/MISS,
mismos bytes y proceso: 160px mediana 774ms/máximo 806ms; 320px 358/410ms;
400px 330/386ms. No se amplió el TTL de 300s ni se promete ausencia universal de
reinicios o latencia equivalente en todos los dispositivos.

Reanudación de Computer Use, pendiente de publicar sus correcciones: login,
actualización del cliente, Caja (filtros, SKU, cantidad y efectivo exacto sin
cobrar, carrito vaciado), Inventario e historial, Compras existentes, Pedidos y
formulario sin guardar, búsqueda de secciones, Automatizaciones sin activar reglas
y catálogo público con fotografías. Una pestaña de la versión anterior falló al
expirar la sesión: AuthView/AuthLayout 404 y ErrorBoundary; recarga manual recuperó
login. Se implementa recuperación fatal online acotada a una vez por build/tab,
sin alterar cookies o ventas offline y conservando protección de Caja/devoluciones.
Se corrigieron avisos falsos de error/vacío durante la carga de turno, proveedores
y productos, con reproducciones previas en pruebas.

La muestra móvil posterior de Caja (393×852/DPR3, Edge sin throttling) descargó
12 fotos simultáneas aunque sólo tres eran visibles: 1.93–2.42s, todas 200.
Agua mineral: cola 0.63ms, espera servidor 2.13s, descarga 3ms, API 1712ms,
DB 292ms y resize cero. Es distinta de la prueba HTTP con cuatro fotos; no prueba
una regresión del decoder. Se limita la admisión de fotografías a las que
intersectan el viewport, conservando URL, recorte y caché existentes. Quedan por
verificar CI, publicación y esa interacción móvil tras desplegar el cambio.

Validación integrada local: 75 pruebas focales y compilación SSR/prerender
aprobadas; cuatro recorridos E2E de 404 real (dev/preview) comprueban recuperación
acotada y conservación de cookie, almacenamiento ajeno y venta offline con su
clave idempotente. Un navegador local aislado comprobó tres solicitudes iniciales
para tres fotos visibles a 393×852/DPR3, admisión al scroll sin duplicación,
revisión nueva sólo para las visibles y foto cuadrada en escritorio. Revisión
independiente sin regresiones bloqueantes. No se registraron cobros, compras,
pedidos o mensajes durante Computer Use.

## Continuidad de sesión y navegación por tareas — pendiente de publicación

#243 pasó CI `39613792409` y se fusionó como
`7a32729e91db562d223620e86ef4852264b0c6f5`. No apareció una ejecución push de
ese SHA; se inició una sola ejecución manual `39616192422` tras verificar main.
Todos sus gates aprobaron, pero la publicación falló en aceptación: readiness
había observado el frontend nuevo y la verificación final recibió el anterior.
El recovery terminó correctamente y la comprobación pública confirmó frontend y
API `909919950261…`, ambos 200 y backend residente. Por tanto #243 fusionado no
equivale a #243 activo en producción.

La corrección de publicación comparte los headers públicos entre readiness,
aceptación y recuperación, reservando el bypass al candidato protegido. Sólo
reintenta un mismatch tipado del frontend anterior capturado: máximo 10 intentos,
separados por 2s dentro de un único deadline de 20s. Cada intento revalida sitio,
frontend, API, DB y proxy; backend inválido, HTTP, versión desconocida o metadatos
malformados siguen fallando inmediatamente. No se modifican DNS, tokens o cuentas.

Computer Use también observó dos refresh en el mismo intervalo de 22.5min:
200/362ms y 401/420ms, con error `Invalid or expired refresh token`. La prueba
determinista con AuthProvider, TrialChip y refresh real reprodujo la doble
rotación y pérdida de sesión aun con una renovación exitosa. Probe e interceptor
ahora comparten una sola promesa por provider; el resultado tardío no reintenta
solicitudes de una identidad cerrada/cambiada. Se conservan cookies, TTL,
revocación y backend. La coordinación simultánea entre pestañas queda fuera de
esta corrección; no se promete resolver todos los motivos de cierre de sesión.

La instrucción del dueño es completar tareas, no recorrer carpetas. Cambios
acotados: Pendientes como entrada diaria, Clientes conservado en el grupo
comercial, un solo grupo de menú abierto y búsqueda por intención (nuevo pedido,
crear cotización, nuevo cliente). Máximo dos acciones contextuales al final del contenido conectan
secciones; Crear pedido usa la ruta existente y exige su permiso y función.
No se muestran en Caja/Panel/Turnos ni en formularios, edición o detalles;
se preservan permisos, flags, offline, enlaces y todas las capacidades/datos.
Cotizaciones explica precios del catálogo y opciones adicionales en lenguaje del
negocio, sin referencias al servidor. La QA real adicional comprobó el modal de
producto: Tab/ShiftTab permanecen dentro, Escape cierra y restaura el foco.

Validación integrada tras restaurar npm ci desde package-lock: 146 pruebas de
auth/navegación/cotizaciones aprobadas; contratos de release 123 y una omisión
prevista de Windows. TypeScript, build SSR/prerender, lint y escaneo de bundle
aprobaron. Revisión independiente de auth y UX sin bloqueos.

#244 corrigió además una regresión real de espacio móvil detectada por CI: la
franja contextual desplazaba el primer producto debajo de la navegación inferior.
Se reprodujo antes en ambos proyectos y se movió después del contenido, sin
cambiar las aserciones E2E. El build final aprobó 256 escenarios de navegador,
con 11 omisiones existentes de stack real. CI `39622421630` aprobó completamente
y se fusionó como `278d0ad6ed4685555b005b88fdbf330a02fa7ad6`.

La ejecución main `39624669749` pasó todos los gates, pero release falló en fase
`candidate`, antes de promover el frontend. La salud inicial y su identidad nueva
habían aprobado; una de las 24 consultas GET concurrentes agotó 15s antes de
recibir estado HTTP. El verificador anterior no registraba qué ruta fue.
`RELEASE_FAILED_RECOVERED (candidate)` confirma la recuperación: 25 contratos,
mismo proceso, mediana 146ms y máximo 854ms. La comprobación independiente
posterior devolvió frontend/API 909919950261… con 200, API residente en 303ms.
Los cambios de #243/#244 continúan pendientes de publicación.

Los eventos de Containers consultados registran apagado a 15:30:56, startup
a 15:31:40 y listener listo a 15:32:22 UTC, pero son de alcance cuenta y no se
retuvo identidad de aplicación: no se atribuyen a Kova ni prueban su reinicio.
Las tres invocaciones muestreadas sí corresponden a kova-backend y son previas
a 15:31:11; no demuestran la causa del timeout posterior a readiness.
Backend y controlador son idénticos entre 90991995 y 278d0ad6, salvo la identidad
horneada; no hay evidencia para cambiar auth, SDK, RLS o ampliar presupuestos.

El siguiente corte añade diagnóstico exclusivo del verificador: marcador fijo,
rutas/métodos permitidos y etapas enumeradas en el controlador, con presupuesto
de eventos acotado por instancia. El cliente informa endpoint permitido, método,
tiempo y categoría de fallo de transporte sin revelar URL, cuerpo, cookies,
cabeceras arbitrarias o causa original. Se conservan 15s de timeout, 3000ms de
aceptación, las mismas consultas, SHA/PID estrictos y cero reintentos. Esta
instrumentación identifica el atasco del siguiente candidato; no se presenta
como una corrección causal del runtime ni como publicación exitosa.

#245 pasó CI `39628260705`, se fusionó como
`63cad8fe28792ce1263d0009650310a2c8850ff6` y su push creó `39629745330`.
Todos los gates aprobaron; el release falló antes de readiness, tras subir el
Worker y antes de login/push de la imagen. El CLI beta.18 devolvió únicamente
`Generic Error`. La fuente acota esa operación a generar la credencial del
registro gestionado; el mensaje no conserva el estado HTTP ni el código V4.
También puede representar HTTP200 con success:false. No se atribuye a permisos,
capacidad o caída del proveedor sin esa información.

La recuperación pasó 25 contratos, mismo proceso, mediana 195ms y máximo 776ms.
La comprobación independiente de los seis contratos públicos confirmó frontend,
API, DB y proxy sobre90991995. La única verificación local de generación de
credencial funcionó con perfil local, que no es el token de CI; se descartó en
memoria sin login/push. Los eventos de aplicación encontrados son posteriores
al error y pertenecen a recuperación. No hubo coincidencias del nuevo marcador:
el verificador no llegó a ejecutarse, no se considera prueba de ausencia de tráfico.

El siguiente cambio conserva en el CLI fijado el estado y código numérico de
esa operación exacta, procesando sólo la respuesta que ya recibe el cliente.
Se mantienen autenticación, permisos, validaciones, tiempos, cero reintentos y
los demás mensajes. La publicación y la QA del código nuevo siguen pendientes.

## Backend residente en Cloudflare — publicado y verificado

FastAPI nativo se publicó inicialmente en un único Container `lite` (ahora `basic`,
según la aceptación de #242 arriba), con proceso residente tras
inactividad, conservando dominios, frontend, R2, jobs y namespaces existentes. El
gateway dirige este modo directamente a `api-0` para evitar coordinadores intermedios
y su coste. Las credenciales actuales no se extraen ni rotan: un aprovisionamiento
explícito de CI crea un login que hereda sólo `kova_app`, conserva RLS y sella las
conexiones. Rate limiting y avisos de jobs usan bindings privados persistentes.

#232 y #233 quedaron fusionados. CI y publicación `39531362675` aprobaron para
`6bd525e42c22c2b6d8798638ef4de6f3498d47af`, el 20 de octubre a las 20:22 CDMX.
El aprovisionamiento aislado `39529850894` creó el login limitado y selló las
conexiones sin modificar las credenciales anteriores. `KOVA_NATIVE_BACKEND=1`
activa el corte. La captura conserva Workers e imagen para rollback.

Aceptación productiva: API 25 contratos, mediana 311 ms, máximo 828 ms; proxy del
frontend 24 contratos, mediana 323 ms, máximo 484 ms. Se verificaron SHA inmutable,
marcador `native-resident`, proceso estable durante cada muestra, PostgreSQL,
denegación anónima y binding privado del limitador. El listener sólo abre después
de los guards de producción y del HEAD autenticado de R2 sin escrituras. Una prueba
separada tras 330 segundos sin consultas del verificador aprobó 25 contratos con
el mismo proceso: mediana 331 ms y máximo 515 ms. No se fuerza la ausencia de
tráfico de otros usuarios ni se promete ausencia de reinicios por mantenimiento.
Referencia operativa:
`deploy/cloudflare-native/README.md`.

Validación local: suite completa psycopg 1,938 aprobada y pg8000 1,937 aprobada,
sin fallos/errores/omitidas. La imagen Linux amd64 del commit publicado aprobó
en CI con 256 MiB y 1/16 CPU: 24 contratos GET, mediana 197 ms, máximo 298 ms y
pico de 134,922,240 bytes. Esta medición no sustituye los tiempos productivos.
### Revisión funcional, fotos de Caja y navegación

Tres agentes implementaron correcciones concretas de funcionalidad/integraciones,
UX/accesibilidad y rendimiento. Las escrituras de QA se limitan al stack local
aislado con RLS y correo/cobros desactivados.

- Fotos: el `no-store` general anulaba la caché pública del endpoint de producto.
  La excepción se limita a GET versionado de imagen UUID, ancho permitido,
  respuesta raster 200 explícitamente pública, sin cookies ni variación privada.
  Frontend y gateway usan Cache API durante un máximo de 300 segundos sin extender
  la frescura entre capas. Errores y toda API privada conservan `no-store`.
  Las claves y subrequests públicos omiten credenciales; la IP real se conserva
  separada para rate limiting. Los originales permanecen en PostgreSQL.
- Miniaturas: JPEG draft antes de decodificar, orientación EXIF correcta,
  reducción eficiente y caché derivada limitada a 4 MiB. La admisión ocurre antes
  de cargar blobs y sólo se permite un decodificador simultáneo; se mantiene la
  ruta original cuando la imagen excede el presupuesto de píxeles. Versiones de
  carga con microsegundos evitan colisiones de caché al reemplazar una foto.
  PNG se limita antes de consultar EXIF y WebP antes de crear su canvas; los
  códecs comunes se preparan antes de abrir el servicio.
  WebP animada conserva el archivo original sin abrir el decodificador de
  animación, para evitar sus buffers adicionales dentro del proceso `lite`.
  Caja solicita el tamaño real de la tarjeta y conserva candidatos para DPR2.
- Navegación: 5–6 accesos diarios y tres grupos plegables: Productos e inventario,
  Ventas y atención, Gestión y ajustes. Conserva destinos, permisos y flags reales;
  no se inventan preferencias por giro ni se agregan consultas para el menú.
  Etiquetas completas, apertura de sección activa, teclado y foco móvil verificados.
- Sesión: foco/visibilidad/reconexión comparten la comprobación vigente. Requests
  nativos conservan identidad, sucursal, cuerpos, abortos y un único reintento 401;
  nunca se adjuntan esos metadatos a otro origen.
- Formularios: login/registro no comparten contraseñas ni errores; las respuestas
  abandonadas no navegan a otra pantalla. Estados pendientes y contraste accesible
  corregidos, preservando el foco en el primer error y la navegación tras login.
- Jobs: una sucursal fallida revierte su transacción sin bloquear las otras;
  ambos workloads privados se intentan y el scheduler conserva el reintento.

Validación local: 1,961 pruebas completas de backend aprobadas antes del último
guard de admisión de imágenes (61 pruebas dirigidas posteriores aprobadas),
1,147 pruebas frontend, TypeScript, ESLint, build/prerender y 101 contratos de
release aprobados (un caso exclusivo de Windows omitido en macOS). También 47
pruebas edge, incluido Cache API real en workerd, y 11 del verificador de fotos.
Playwright real verificó el recorrido comercial completo, fotos de Caja y
navegación/contraste a 320/390/768/1440 px. CI exige además las fotos JPEG EXIF y
PNG RGBA de 8 MP dentro del contenedor amd64 con límites `lite` y 3,000 ms por GET.
El run de publicación y la aceptación productiva son la fuente del corte final.

## Arranque por módulo solicitado #231, publicado; latencia todavía abierta

#231 publicó `ed2e5a6d7c0ac164d895b5c347de5de47d44bcab` con CI y aceptación
productiva aprobados (39367734205). API/proxy/DB y SHA exacto verificados. Las
primeras peticiones observadas dieron mediana 3,794 ms y máximo 8,303 ms, frente
a mediana 108 ms al repetir. No se forzaron procesos fríos: no prueba ausencia
de arranque ni elimina la necesidad del backend residente solicitado.

#230 publicó `1d0bfc7cab06` con CI completo verde y aceptación productiva
(39364788528, 03:45:14 UTC del 20 de octubre). Sitio/proxy/API/DB y SHA exacto
verificados; 64/64 contratos GET aprobaron. La latencia sigue abierta: primeras
peticiones directas, mediana 6,516.5 ms y máximo 11,244 ms, tres de 16 sobre diez
segundos; repeticiones mediana 212 ms. Desbloquear la compilación no bastó.

El corte #231 conserva las validaciones completas y carga los routers originales
por prefijo, bajo la admisión del coordinador. El snapshot conserva librerías; toda
la metadata ORM se inicializa antes de escribir y los validadores de rutas ajenas
se difieren. El backend nativo conserva aplicación/OpenAPI completos. Se verifican
cobertura de prefijos, mismo contrato y definiciones originales de permisos, orden de
guards y denegación anónima. CI y publicación aprobados; el arranque frío sigue
siendo un límite de esta arquitectura.

## Publicación #227 aceptada; latencia de primera petición aún abierta

`7002418f63389e5220f2136cd4a1489d3201d9e0` quedó aceptado en producción a las
20:16:37 CDMX del 19 de octubre (39356494758, segundo intento). CI completo verde;
sitio/proxy/API/DB verificados con SHA exacto. La corrección conserva strict y compara
rutas idénticas sin depender del orden. El primer intento recibió 504 al cargar Python
y recuperó la versión anterior; el segundo completó publicación y aceptación.

QA pública: 32/32 contratos GET y 52 comprobaciones de navegador a 1440/768/390/320 px,
sin errores JavaScript ni overflow. Sin operaciones de negocio autenticadas en producción.
La latencia sigue abierta: primera cola directa 5,872/229/10,598/199 ms por grupo;
mediana de repeticiones 197.5 ms. Algunas primeras peticiones ya estaban calientes;
no se declara mejora causal ni eliminada la espera de diez segundos.

### Historial previo a la aceptación

Producción conserva `2df276612e66` (#221), verificada tras las recuperaciones. #222 y #224
pasaron CI y se fusionaron; `69109d30d2ed` incluye además los controles de coste #223, preservados.
Su CI completo aprobó, pero el gateway abortó por una propiedad `environment: undefined` que el
comparador cf beta.18 añadía sólo al lado remoto. Ambos descriptores apuntan a la misma clase y
script; el diff visible era `[{}]`. Se corrige sólo la ausencia equivalente de ese campo,
con strict activo y rechazo de diferencias reales. El conflicto de CPU anterior ya fue resuelto
conservando el techo remoto de 100 ms, sin modificar suscripciones.

El siguiente corte conserva las dos validaciones de seguridad sobre el catálogo vivo y elimina
dos ciclos adicionales de protocolo para la lista estática de tablas, escapada por SQLAlchemy.
BEGIN, rol y guards permanecen intactos. Suites completas 1,848 por controlador, cero fallos,
errores u omitidas; Workers 9+4+1 y pausa de presupuesto 4/4 aprobados. Se retira una clave CPU
duplicada por la fusión concurrente sin cambiar su valor.

La última cohorte aceptada sigue mostrando 6.27 s de mediana y 14.50 s máximo en primera cola
directa, frente a 208 ms al repetir. CI/publicación y medición conjunta siguen pendientes;
no se declara eliminada la espera. [Evidencia y límites](audits/KOVA-LATENCY-INTERNAL-AUTOMATION-2026-10-19.md).

#226 está fusionada en `059ceb097cd7` con CI requerido verde. Tras dos fallos de carga
500/10013, el tercer intento publicó los tres Workers backend; el frontend abortó por
el orden de descriptores idénticos de rutas en cf beta.18. Se restauraron las versiones
anteriores y la verificación independiente de sitio/proxy/API/DB aprobó. Workers Paid ya
estaba observado antes de los fallos: no se atribuyen sólo al plan anterior. La corrección
de comparación mantiene strict y los bloqueos de diferencias reales; aceptación pendiente.

## Revisiones de atención, enlaces y arranque frío (2026-10-19, publicadas; diagnóstico de latencia abierto)

`service_case_overdue` incorpora revisiones internas opt-in/defaultoff para vencimientos manuales
posteriores a la autorización, sin retroactividad automática. Reusa motor, worker/cohort/leases,
RLS y billing; `0091` amplía dos CHECK sin tablas nuevas. Identidad por caso/fecha evita duplicados,
la fuente obsoleta se suprime al procesar y FOR SHARE protege la validación hasta commit.

Enlaces de la cola abren el registro exacto de sus cuatro fuentes; tres GET privados nuevos
conservan scope/DTOs y no escriben. Reprogramar refresca también el recordatorio enlazado y retira
sus acciones si deja de estar disponible. PDF/Resend cargan dependencias cuando se utilizan;
Sentry WASM conserva integraciones web explícitas y transporte/sanitización.

Perfil local: 2,171 → 1,213 ms de importación (~44% menos). La comprobación productiva sigue investigando los
aproximadamente 10 s del acceso frío. PR #219 fue aceptada a las 18:00:50 UTC con SHA
`1f12c4baf8a9` y migración 0091. La medición pública dio 32/32 contratos correctos, pero mediana
de primeras peticiones directas 8.45 s frente a 0.35 s en repeticiones; no está resuelto. Se prepara
instrumentación por fases sin cambiar validaciones. PR #220 fue aceptada (SHA `50c6749725b6`)
a las 18:32:33 UTC: suite completa 1,808 aprobada, contratos públicos 32/32 y verificador estricto
aprobados, pero primeras directas siguen con mediana 8.26 s frente a 0.22 s al repetir.
Los tiempos de fases tienen el límite de reloj por I/O de Workers; no acreditan CPU nulo ni
permiten atribuir todo el intervalo a consultas. Sigue una optimización de snapshot puro y viajes
de catálogo RLS, todavía sin aceptación productiva. Validación de la entrega funcional #219:
backend completo final 1,800; automatizaciones 25 por controlador y dos
migraciones; GET 18 por controlador; frontend completo 1,124, focal 79, browser 16 y real uno;
build/121 JS, Workers 9+4+1 y 27 migraciones completas aprobados. Suite backend final sin errores/fallos/omitidas (146 s).
[Entrega, archivos y límites](audits/KOVA-LATENCY-INTERNAL-AUTOMATION-2026-10-19.md).

## Cola operativa interna (2026-10-19, publicada)

La consulta privada `/api/v1/operations/queue` reúne casos activos, oportunidades con próxima acción,
seguimientos pendientes y recordatorios vigentes disponibles de agenda. Dueño/gerente consultan
su sucursal con billing y RLS; cuatro SELECT acotados devuelven hasta 20 filas por sección y
`has_more`, sin total inferido. No agrega escrituras, migraciones, procesamiento ni canales.

Validación focal: ocho pruebas con psycopg y ocho con pg8000; ocho pruebas de runtime workerd
incluyen lectura antes/después de resolver un caso. Frontend: 1,102 pruebas completas, 15 focales,
cuatro recorridos responsivos con axe A/AA y un recorrido real de las cuatro fuentes con
API/Postgres/RLS. TypeScript, ESLint, build SSR/prerender, escaneo de 119 JS y revisión independiente
aprobados. [PR #217](https://github.com/ArturoFrancoMozqueda/kova/pull/217) integrada y publicada
en `734f67fa274f8b44c3883c87ba41c52ba85ecd4b`: el pipeline
[39290153257](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39290153257) registró
`accepted: true` a las 17:09:23 UTC y aplicó `0089 → 0090`. CI final: 1,766 pruebas backend y
1,102 frontend aprobadas. El verificador público confirmó el SHA exacto en sitio/API/proxy y DB
accesible; doce comprobaciones públicas Chromium a 1440/390 px aprobaron, sin errores JavaScript
ni overflow y con APIs privadas 401/no-store. El primer acceso privado observado tardó 10 s;
las siguientes vistas 0.4–1 s, y la API de cola tuvo respuestas de unos 10 s. No se acredita una
sesión autenticada de negocio en producción ni el horizonte E2E completo.
[Contrato](plans/PLAN-COLA-OPERATIVA-INTERNA.md) y
[evidencia local](audits/KOVA-OPERATIONS-QUEUE-2026-10-19.md).

## Atención postventa interna (2026-10-19, publicada)

La continuación autorizada sin conectar cuentas incorpora `/service-cases`: casos por cliente y
sucursal, venta/pedido con identidad verificable, responsables activos, notas append-only con autor,
estados/versiones y vencimiento manual calculado con el reloj del servidor. Dueño/gerente conservan
el historial al resolver o reabrir. Los casos no modifican ventas, devoluciones, caja ni inventario;
las incidencias sencillas de `/crm/followups` permanecen disponibles sin migración automática.

Fuente local final: 1,746 pruebas backend, 25 de migraciones y ocho de workerd aprobadas; frontend
1,087 unitarias, QA Chromium responsiva y recorrido real navegador/API/Postgres con RLS. El artefacto
compila y pasa el escaneo del bundle. Publicada con la cola en `734f67fa` y migración `0090`,
con la aceptación pública y límites descritos en la entrada anterior. Las operaciones de negocio
autenticadas se probaron en entornos locales reales; esta entrada no acredita ese flujo en producción.
[Entrega y límites](audits/KOVA-SERVICE-CASES-2026-10-19.md). La continuación de lectura está
registrada en la entrada de cola operativa anterior.

## Permanent Fly retirement (2026-10-19)

El propietario pidió dejar de usar y generar consumo en Fly. Se eliminó
`pos-project-backend` con sus cinco máquinas detenidas; no tenía volúmenes ni datos
del negocio montados. La organización quedó sin aplicaciones, Managed Postgres,
Redis, Tigris ni Sprites, y no tiene paquete de soporte activo. Se revocaron las dos
credenciales de despliegue/ingesta y se eliminó el secreto de GitHub. Los tres
workflows exclusivos de Fly se desactivaron y su código se conserva como texto
histórico en [el archivo de retirada](archive/fly-retired-2026-10-19/README.md).

Publicación y recuperación requieren Cloudflare y rechazan artefactos antiguos sin
versiones de sus tres Workers. El dispatcher de documentos y conector operativo
retirados no realizan peticiones aunque reciban configuración antigua. Se conservan
los contratos de datos, auth, facturación, RLS y recuperación del proveedor actual.
Los cargos acumulados anteriores a la retirada siguen sujetos a la factura final;
el inventario vacío no cancela consumo ya realizado. La evidencia privada de
inventario y facturación queda fuera del repositorio.

Validación local: 77 contratos de publicación/recuperación (una prueba exclusiva
de Windows omitida), 39 escenarios de backend, 41 contratos de scripts y 14
comprobaciones completas en Workers. La aceptación remota se registra en la PR
y el run de CI/publicación del commit de esta retirada.

## Continuación operativa E2E (2026-10-19)

El propietario autorizó continuar con agentes y verificar el despliegue en producción.
Agenda interna por recurso/sucursal y lealtad opt-in del propietario incorporan UI, API,
migraciones, RLS, permisos mínimos y exportación/purga. Recordatorios y beneficios permanecen
internos/manuales; ningún canal externo se activa.
[Alcance, validación y límites](audits/KOVA-E2E-OPERATIONS-2026-10-19.md).

## Active E2E implementation (2026-10-18)

El propietario autorizó el merge y continuación sin conectar cuentas. Primera entrega integrada en
[PR #207](https://github.com/ArturoFrancoMozqueda/kova/pull/207) con CI completo aprobado.
La continuación conecta captación, oportunidad, cotización, pedido, venta con cliente explícito y
postventa interna; incorpora bandeja/outbox y borradores desde tareas sin activar canales.
[Alcance y evidencia de continuación](audits/KOVA-E2E-COMPLETION-2026-10-18.md).

El propietario solicitó implementar el plan con equipos de agentes. Se autoriza implementación
local incremental de automatizaciones, CRM/consentimientos y captación mediante catálogo público,
preservando los contratos financieros y operativos actuales. Diseño y fases:
[plan E2E](plans/PLAN-AUTOMATIZACION-E2E.md). Las reglas comienzan desactivadas; los canales externos
sin proveedor verificado deben mostrarse desconectados. Ninguna tarea interna representa un envío,
cobro, entrega ni emisión fiscal. La petición no activa proveedores ni publica en producción.

Código local: motor de tareas internas, CRM y consentimientos, cotizaciones a pedido, catálogo
público/QR, reposición aprobada, conciliación CSV manual y preparación de WhatsApp. Cinco
migraciones aditivas, permisos runtime/RLS y exportación/purga acompañan los módulos. La conexión
de canales y los efectos externos permanecen desactivados. El propietario confirmó sólo app de
WhatsApp Business, Meta y dominio; no hay aceptación Cloud API.

[Alcance exacto, evidencia y gates de release](audits/KOVA-E2E-IMPLEMENTATION-2026-10-18.md).
La validación local no habilita producción ni cierra la totalidad del horizonte E2E.

## Cloudflare Free backend migration (2026-10-18, accepted)

El propietario autorizó migrar Fly y eligió mantener Free posponiendo documentos.
La API FastAPI existente se sirve en coordinadores Durable Objects y un gateway
HTTP pequeño, con Postgres en Supabase, Hyperdrive sin caché y un Worker de tareas
sin conexión privilegiada. Frontend y API públicos ya están en Cloudflare;
`KOVA_CLOUDFLARE_BACKEND=1` selecciona el nuevo proveedor de publicación/recuperación.
El primer corte se revirtió al detectar errores intermitentes de sesión/Postgres;
se canceló `39183665551`, se recuperó Fly y se corrigió el ciclo de respuesta ASGI
antes de repetir la aceptación pública.
Las capturas de DNS, versiones exactas y máquinas se conservan fuera del repositorio.

Validación local: 1,516 pruebas completas con pg8000; registro/verificación/login,
cookies seguras, CSRF, aislamiento de tenants, venta offline repetida sin duplicar,
refresh/logout y límites compartidos en workerd. Cuarenta casos CSD, Fernet/AES-GCM,
QR y envío Sentry con datos sensibles eliminados verificados en el runtime.
El PDF contable se renderizó idéntico al actual. Las nuevas opciones de lote del
asistente aprobaron otras 91 pruebas enfocadas con el controlador de Workers.
CI añade la suite completa del nuevo controlador y las pruebas del runtime.

PR #201 y #202 integradas: publicación/recuperación de los tres Workers, R2 nativo,
distribución de lecturas del panel y compresión del edge. El propietario y Browser
validaron login, panel, recarga con renovación de sesión y logout en el candidato.
Se corrigió además HTTPS de Stripe/conectores: una prueba desplegada sin credenciales
reales confirmó el transporte Fetch; 72 pruebas enfocadas y nueve comprobaciones de
Workers aprobaron. No se crearon cobros ni cambios de suscripciones durante la validación.

PR #203 integrada: la corrección retiene la admisión por coordinador hasta terminar ASGI,
conserva JSON de un solo bloque como respuesta completa y descargas como streams.
El gateway rechaza rutas ajenas a la API antes de iniciar Python. Once pruebas
nativas enfocadas y doce comprobaciones de Workers aprobaron, incluyendo tres
ráfagas de seis sesiones entre dos negocios. CI completo de la corrección aprobado en
[`39185158650`](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39185158650).

Browser verificó login nuevo, renovación de una sesión vencida, panel/sucursales,
recargas, logout e informes reales de treinta días en el candidato. En el dominio
principal confirmó login, actualización PWA, recarga completa, logout y redirección
de una ruta privada después de salir. Aprobaron 52 lecturas de base en el candidato
(incluidos todos los coordinadores tras inactividad), 36 públicas y el contrato
frontend/API/proxy/Postgres con DNS normal. No se hicieron ventas ni cobros de prueba.

El arranque de algunos coordinadores todavía puede tardar entre 7 y 13 segundos;
las comprobaciones calientes de base de datos respondieron normalmente en menos de un segundo.
El candidato permanece en `backend-preview.kovasuite.com` / `api-preview.kovasuite.com`.
La primera publicación automática del nuevo proveedor se detuvo antes de mutaciones en
[`39186012958`](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39186012958),
porque comprobaba el alias de respaldo Vercel contra la versión nueva de la API.
La configuración `VERCEL_URL`, usada como origen público por el preflight,
el artefacto de recuperación y los recordatorios, se corrigió a `https://kovasuite.com`.
El segundo intento publicó la API, pero falló durante aceptación y su recuperación
quedó bloqueada porque `GIT_SHA` / `KOVA_RELEASE_SHA` se habían rotado como secretos.
Se activó manualmente la versión de frontend validada para recuperar coherencia
con la API en `1e3e659`; el contrato público completo aprobó de nuevo.

La corrección del publicador usa `KOVA_BUILD_SHA` como binding de texto versionado,
conserva los secretos existentes y sus protecciones de reversión, y espera brevemente
solo si el frontend muestra la versión anterior capturada. Los errores HTTP y versiones
inesperadas siguen bloqueando. Las fallas de aceptación y recuperación conservan ambas
causas para diagnóstico. Validación local: 17 pruebas nativas enfocadas, 49 contratos
de publicación aprobados (una comprobación exclusiva de Windows omitida) y 12 pruebas
de Workers. La prueba remota aislada revirtió exactamente una versión con identidad de texto
sin omitir controles de secretos; el Worker temporal fue eliminado.

Aceptación final: PR #204 integrada y publicación automática aprobada en
[`39188579781`](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39188579781),
fuente `62aafb648cf70abf36336f89706a44cd4fbb25d9`. Una caída de Chromium por SIGSEGV
al crear un contexto requirió repetir únicamente el trabajo de navegador y sus dependencias;
las pruebas y criterios de aceptación se conservaron. El contrato público exacto de
frontend/API/proxy/Postgres aprobó también desde DNS normal tras la publicación.

Fly: las cinco máquinas de `pos-project-backend` quedaron detenidas y las dos máquinas
de API tienen `autostart=false`. No se destruyeron máquinas ni direcciones; las capturas
de imágenes/configuración, DNS y versiones de Cloudflare permanecen disponibles para
recuperación fuera del repositorio. El contrato público volvió a aprobar después del apagado,
y Browser conservó la sesión y el panel completo al actualizar los archivos definitivos.
Con Fly detenido se verificaron también logout y redirección al acceso de una ruta privada.
[Arquitectura, pruebas y límites](../deploy/cloudflare-backend/README.md).

## Cloudflare Free frontend cutover (2026-10-17)

El frontend de `kovasuite.com` ya se sirve mediante Cloudflare Workers Static Assets y un
Worker para conservar el proxy `/api` hacia FastAPI en Fly. `www` redirige al dominio principal
y HTTP a HTTPS. Se activó el proxy únicamente para los registros web de apex/www; los destinos
originales de Vercel permanecen disponibles para revertir DNS. Workers sigue en Free; R2
conserva su suscripción y franquicia de uso existentes. Fly, Supabase, Stripe, Resend y Sentry
conservan sus funciones. Vercel sigue siendo candidato validado/respaldo del pipeline.

PRs #198/#199 integradas. Publicación inicial aceptada en
[`39066334257`](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39066334257), fuente
`089af764b8398944ddb16d84c8387463987c295f`. Captura y reversión incluyen la versión exacta
del Worker, además del artefacto Vercel y la imagen Fly. La corrección de arranque del capturador
dispone de regresión por subproceso. El simulacro desechable debe preparar también ese módulo.

Aceptación: el propietario confirmó login, recarga del panel y logout en el candidato real de
Cloudflare. En el dominio principal se verificaron respuesta del edge Cloudflare, versión,
proxy/API/Postgres, 401 sin sesión, API/version sin caché, recursos versionados con caché
inmutable, archivos faltantes 404 sin caché y redirecciones con parámetros preservados.
Chromium cargó landing/login/privacidad e instaló el service worker sin excepciones JavaScript
ni solicitudes a Vercel Analytics; Web Analytics de Cloudflare se inyecta correctamente.
La aceptación inicial del edge se forzó con resolución de host porque algunos resolvedores
conservaban el destino anterior durante la propagación DNS.

Pruebas locales: build, ESLint, escaneo del bundle, contratos de publicación/recuperación,
nueve pruebas de proxy, 16 unitarias enfocadas, 15 de navegador auth/rutas/PWA/offline y 68 de
contratos de repositorio. CI completo y publicación aprobaron. No se hicieron ventas ni cobros
reales en esta migración. FastAPI/bcrypt/parser Docker siguen sin validar en Workers Free;
Fly no debe retirarse como parte de este corte. [Operación](../deploy/cloudflare/README.md).

## Completed production validation (2026-10-10): operaciones reales en Sweet Home

El propietario autorizó escrituras reales de prueba en su tenant y tres agentes.
Se ejecutaron siete ventas por UI (efectivo, transferencia, tarjeta manual, dividido,
offline, descuento/impuesto y checkout con lotes), siete devoluciones y dos anulaciones.
Los reintentos idempotentes no duplicaron ventas, devoluciones ni recepciones.
El neto final de estas ventas es 0.00; POS vuelve a 30 unidades, lotes a seis sin
reservas. Se conservan los movimientos y registros `QA-20261010`.
Se cerró el turno antiguo y se probaron cortes cuadrado, sobrante y faltante con
importes declarados de prueba; no se certifica conteo físico de efectivo.

Correcciones en `codex/sweet-home-production-validation`: búsqueda fija en tres
triggers de lotes, tabla de devoluciones accesible por teclado, encabezados de panel,
catálogo e inventario, etiquetas de compras/traspasos/pagos y claridad sobre cobros
brutos y eventos de devolución. La revisión de sesiones añade invalidación de
respuestas pendientes tras logout, desmontaje o cambio de identidad; las regresiones
demuestran que no reabren una sesión ni reemplazan el caché del negocio vigente.
Vitest y el parser CSS se actualizan para eliminar los críticos de desarrollo,
conservando las dependencias runtime; CI añade un gate de críticos para el árbol completo.
WebKit también conserva el foco del producto y del botón de menú tras cerrar
sus paneles; nuevas regresiones prueban activación sin foco automático del puntero.
Quedan cinco avisos altos derivados de `braces` sin parche compatible, limitados a
compilación con patrones estáticos: [revisión de dependencias](audits/KOVA-DEPENDENCY-REVIEW-2026-10-10.md).
La restauración real R2 en runner aislado aprobó también para el snapshot actualizado
0079/1,025 órdenes en [38075155881](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38075155881):
checksum, PostgreSQL 17, RLS, pagos/lotes, grants y limpieza verificados.
[Evidencia y límites](audits/KOVA-R2-REAL-RESTORE-2026-10-10.md). PR #187 ya pasó CI y publicación;
frontend/API/proxy/base de datos verificados con fuente `e915e3760e0ff479cdb1d2dbef76449fc8964b43`.
PR #189 publicó las correcciones de contraste, h2 de Análisis, landmark de
sucursal, fechas de la gráfica y explicación de neto cero. Su release
[38075095270](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38075095270)
aprobó CI y comprobación pública de frontend/API/proxy/base de datos con fuente
`6d8fa1467edb5afdecc7277b13e61520232544e6`. La aceptación autenticada de #190 completó las vistas iniciales de 19 rutas en
Chromium/WebKit con cero violaciones WCAG/heading/region, desbordamiento o
excepciones. La respuesta completa del asistente se comprueba por separado. El motor
aprobado se preservó byte por byte y la pregunta libre completó en modo grounded
con netas 0.00, brutas/devoluciones 72.88 y conteos 5/7/2, sin propuestas.
La ampliación corrigió h2 locales en Turnos/configuración, singular de un bloque
y contraste de textos pequeños. PR #191, integrado como
`826b4cc3ce91ff26aa7ee9fe608bc02afea2b57f`, añade los conteos de devolución y
cancelación a la tarjeta completa y h2 en respuestas; CI: 1,483 backend,
993 frontend, 214 navegador compilado y seis con stack real, todos aprobados.
El release final [38079066759](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38079066759)
aprobó a las 19:31:21 UTC; frontend/API/proxy/base de datos verificados en
`826b4cc3ce91ff26aa7ee9fe608bc02afea2b57f`. La misma respuesta completa mostró
sus seis métricas correctas tras recarga e historial en 1440/390, sin fallos de
accesibilidad/desbordamiento/JavaScript detectados y sin nueva inferencia.
Companion vacío/foco probado live; respuesta compacta poblada cubierta por test.
Sesiones propias cerradas; pestaña original abierta en el panel.
La última lectura detectó «Te quedan 1 de Alfajores». PR #193 corrige sólo el
singular del helper y añade tres pruebas 1/2/0, todas correctas; lint/TypeScript
aprobados. CI final: 996 frontend, 1,483 backend, 214 navegador compilado y
seis con stack real. Release [38081235586](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38081235586)
aprobado a las 20:04:33 UTC; frontend/API/proxy/base de datos verificados con
`8f2f2ba9eabc050e54dc43aa4c22e6a85b601e2d`. Aceptación posterior 1440/390:
singular correcto con stock uno/reservas cero; Dashboard y respuesta guardada
sin fallos detectados de WCAG/heading/region, overflow o JavaScript. Seis cifras
intactas y uso 3,126→3,126, sin nueva inferencia ni escrituras de negocio.
La pestaña original aplicó «Actualizar ahora» con caja libre y conservó sesión
y respuesta; volvió al panel. Contextos propios cerrados con logout/me 401.
[Informe único de aceptación y límites](audits/KOVA-SWEET-HOME-PRODUCTION-ACCEPTANCE-2026-10-10.md). Evidencias: [POS y caja](audits/KOVA-PRODUCTION-OPERATIONS-2026-10-10.md),
[negocio](audits/KOVA-PRODUCTION-BUSINESS-2026-10-10.md) y
[acceso](audits/KOVA-PRODUCTION-ACCESS-2026-10-10.md).

El usuario confirmó que no tiene cuenta Facturapi ni requisitos fiscales del emisor
configurados para Sweet Home.
La facturación Live queda sin emisión; Kova requiere una cuenta/llave de plataforma,
y cada emisor debe aportar sus requisitos fiscales. Cargos externos, dispositivos
físicos, Safari/iOS y recuperación regional siguen sin evidencia completa; no se
declara disponibilidad productiva al 100%.

## Published implementation (2026-10-09): Cajón de dinero

El propietario pidió apertura de cajón desde cualquier equipo. Implementación local de un
conector por sucursal, compatible con impresoras ESC/POS de red; Kova puede solicitar aperturas
desde navegador de computadora, Android o iPad. Contrato, limitaciones, seguridad y QA en
[`specs/shifts/cash_drawer.md`](../specs/shifts/cash_drawer.md).

Verificación local: 73 pruebas de backend/RLS, 45 de frontend y 12 de navegador; build, lint,
TypeScript y contrato OpenAPI pasan. La capacidad está publicada y la descarga real del conector verificada;
las pruebas físicas siguen pendientes. No se certifica hardware
USB/Bluetooth ni apertura remota offline. No modifica cobros, cortes ni sesiones por cookies.

## Source Of Truth

The dated section at the top is the active execution board. Older sections below are retained as
historical evidence and are labelled with their period.

- Current execution target and release gates live here.
- Historical sprint notes, completed audit findings, and future roadmap live in
  `docs/sprint-planning.md`.
- Audit deliverables and superseded phase plans live in `docs/audits/`.
- Operational runbooks live in `docs/runbooks/`.
- Risks live in `docs/risk-register.md`.
- Do not duplicate detailed acceptance criteria here; link to the owning spec, runbook, or planning
  section instead.
- Setup, test commands, architecture and operational entry points live in
  [`engineering-operations-index.md`](engineering-operations-index.md).

## Active fiscal onboarding (2026-10-09): facturación administrada por Kova

El propietario solicitó que el negocio active facturación dentro de Kova sin configurar
cuentas ni llaves de Facturapi. Implementación en `codex/managed-fiscal-onboarding`: alta
por tenant, CSD efímeros, autorización embebida, Test/Live separados y journal de recuperación.
Contrato en [CFDI](../specs/integrations/cfdi-contract.md) y operación en
[alta fiscal administrada](runbooks/managed-fiscal-onboarding.md). Las conexiones previas
se conservan. La activación externa exige cuenta/llave de plataforma y requisitos fiscales
reales; no declarar emisión validada sólo por compilar o mostrar el formulario.

## Active branch integration (2026-10-08): correcciones de auditoría

El propietario solicitó implementar correctamente las ramas de mejoras y correcciones.
Las 24 ramas `codex/audit-*` se reúnen desde `codex/audit-verified` en
`codex/integrate-audit-fixes`, con revisión de solapamientos y una corrección adicional
para no afirmar activación tras un rechazo de Checkout sin estado confirmado.
Alcance, validación repetida y límites en
[`audits/KOVA-BRANCH-INTEGRATION-2026-10-08.md`](audits/KOVA-BRANCH-INTEGRATION-2026-10-08.md).
Publicado con autorización explícita mediante PR #182: CI y publicación aprobadas.
Frontend, proxy y base de datos verificados con SHA
`f9d875c103b090c9f08a888db7464b3a2321bbd1`.

## Active production audit (2026-10-08): flujo real y equipos

El propietario autorizó evaluación autenticada integral, tres equipos e implementación de los
hallazgos. Correcciones en `codex/production-comprehensive-fixes`; alcance, QA real, pruebas y
límites en [la evidencia de producción](audits/KOVA-PRODUCTION-AUDIT-2026-10-08.md).
No se registraron operaciones financieras ni ajustes de inventario durante la evaluación.
Publicado mediante PR #183: CI y publicación aprobadas; frontend, API, proxy y base de datos
verificados con SHA `fb47b342489c0a32aad34bee0ad53c5538fcc4f2`.

## Active real-flow evaluation V2 (2026-10-08): segunda pasada con equipos

El propietario solicitó otra evaluación con tres agentes navegando la aplicación real y
resolviendo defectos. Trabajo en `codex/real-flow-evaluation-v2`, con entornos separados para
caja/pedidos, operaciones/reportes y acceso/configuración. La QA productiva conserva los datos
del negocio; las escrituras y los casos adversos se verifican en bases locales desechables.
Hallazgos, archivos, regresiones y límites en
[la evaluación V2](audits/KOVA-REAL-FLOW-EVALUATION-V2-2026-10-08.md).
Los cambios de esta segunda pasada deben aprobar CI y publicación antes de marcarse publicados.

## Active product implementation (2026-10-08): Lotes y fechas

El propietario aprobó una función completa, opcional por producto, en una rama nueva.
Implementación en `codex/inventory-lots`, basada en `main` actualizado; comportamiento
acordado, contratos, seguridad, aceptación y publicación en
[`specs/inventory/lots.md`](../specs/inventory/lots.md).

Incluye reglas de fechas confirmadas, entradas/compras, ventas, reservas, traspasos,
mermas, conteos y recuperación offline. Las fechas vencidas solo advierten; los
reembolsos de ventas con lotes no reponen unidades; la anulación solicita confirmar
que no hubo entrega. La autorización actual cubre implementación y verificación
local; no publicación en producción. La evidencia final se registra en la spec.

## Active assistant implementation (2026-10-08): publicación y activación

El operador autoriza despliegue y gasto recurrente (USD 10/mes de inferencia y hasta USD 35/mes
de ingesta, sin compromiso anual). La selección técnica pasa a **Mistral Small 4**, vía
OpenRouter y exclusivamente `mistral/us`, sin razonamiento extendido ni fallback automático.
El diagnóstico completó 540 consultas: cero errores de contrato, mediana 0.947 s, p95 2.837 s,
máximo 5.816 s. No equivale a aprobación de calidad semántica ni activación. GPT-OSS conserva
su evidencia y fallos de capacidad; las conclusiones/cifras de reportes las controla Kova.

Publicado en PR #169: aprobación ligada al hash del motor, presupuesto y pausas compartidos,
recuperación mensual, capacidad independiente de chat/archivos, citas numéricas literales y
aviso OCR, host de ingesta privado en iad y publicación/rollback sin recursos adicionales.
Validación local: 263 pruebas de asistente/RLS, 31 de operaciones, 21 de publicación.

PR #170 pasó CI y se integró como `489d79b`; su publicación está en curso. La preparación
manual del host usa la identidad de CI existente, sin pedir acceso personal adicional a Fly.
Se corrige además el fallo real: «todo mi histórico» consultaba solo hoy. El histórico de
productos se agrega en PostgreSQL, descontando devoluciones y conservando tenant/sucursal;
la regresión incluye una venta de hace cuatrocientos días y otra sucursal excluida.

Pendientes: CI del motor definitivo, evaluación de ese código y revisión de pertinencia/es-MX;
credencial permanente mensual; host de archivos dentro del total
autorizado y QA autenticada R2/embeddings/ACL/carga/plazo. La sesión de Kova está disponible.
No activar el gate de calidad ni presentar archivos como listos antes de cerrar esas pruebas.
No hay tareas agendadas. [Decisión](research/ASSISTANT-DECISION-2026-10-07.md),
[operación](assistant-operations.md).

## Historical assistant status (2026-10-07): solución de consulta

**Selección técnica cerrada:** GPT-OSS-120B por Cerebras/OpenRouter, con reportes redactados
por Kova y pasajes de documentos seleccionados por identificador. Implementación en PR #169;
no está activada en producción. La integración Groq anterior se entregó mediante PR #167,
pero Groq Free no pasó calidad y la ruta Groq pagada por OpenRouter tuvo un HTTP 429.
La comparación de prosa libre mostró fallos financieros incluso con JSON válido; no se delegan
los cálculos ni sus conclusiones al modelo.

Alcance confirmado: guías, preguntas del negocio, recomendaciones y archivos propios,
sin mutaciones ni correo, máximo diez segundos y escalabilidad desde el inicio. La ruta final
exige nuevo consentimiento para OpenRouter y Cerebras, ZDR, topes compartidos de gasto,
control por negocio y concurrencia configurable. El presupuesto mensual de producción es cero.
La clave local y los USD 10 autorizados siguen siendo solo de evaluación.

La arquitectura final cerró 540 consultas al 2026-10-08: 539 contratos válidos, mediana
2.1345 s / p95 4.179 s, un timeout y una abstención innecesaria. Los campos de revisión humana
siguen pendientes; no acredita activación ni tiempo real de cola/red/UI. Conserva los 220 casos
originales y sus oráculos. Los cuarenta de mutación mantienen su gate independiente antes de
habilitar esa capacidad. No hay programación diaria.

Bloqueos de activación: cierre formal de hallazgos/revisión de pertinencia, QA autenticada de cola/red/UI y
carga; clave y techo mensual aprobados; y, para documentos, host de ingesta aislado y QA real
R2/embeddings/ACL. El worker actual de Fly no tiene el daemon Docker requerido por la ingesta.
Se requiere además separar selección de trabajos de chat/ingesta y comprobar capacidad interactiva
durante procesamiento de archivos.
No habilitar archivos ni declarar producción lista sin completar ese recorrido.
Decisión y evidencia: [selección final](research/ASSISTANT-DECISION-2026-10-07.md);
operación: [asistente](assistant-operations.md).

## Active product integration (2026-10-05): Expansión POS

The owner explicitly authorized implementation, agent branches/worktrees, integration and production
publication. This supersedes the previous discovery gates for the capabilities below. Execution plan:
[`PLAN-POS-EXPANSION-2026-10-05.md`](plans/PLAN-POS-EXPANSION-2026-10-05.md); validation/release matrix:
[`PLAN-POS-RELEASE-2026-10-05.md`](plans/PLAN-POS-RELEASE-2026-10-05.md).

- [x] Integrate sale discounts, added tax defaults, immutable line allocations and offline price snapshots.
- [x] Integrate customer records/history, product barcodes, catalog import and register selection/scanning.
- [x] Integrate suppliers, purchase orders, partial receiving and explicit cost updates.
- [x] Integrate atomic inventory transfers and optional staff assignment to one branch.
- [x] Integrate issuer profiles and internal invoice requests that remain pending external provider.
- [x] Extend tenant RLS/grants, account portability/purge graph, API contracts and mobile scenarios.
- [ ] Complete full integrated verification and CI on the final commit.
- [ ] Merge the verified PR and verify production backend/frontend acceptance.

Each domain spec records delivered behavior and tests. Implemented here means integrated into the
release branch, not yet production acceptance. No PAC or terminal service is contracted by the owner;
real CFDI emission/public autofactura and terminal payment processing remain externally blocked.
These changes do not close restore, live Stripe lifecycle or inbox-delivery research gates.

## Active Sprint (2026-09): Comprehensive audit remediation

The active execution target is the 36 findings in
[`audits/KOVA_IMPROVEMENT_BACKLOG.md`](audits/KOVA_IMPROVEMENT_BACKLOG.md). Each local remediation
lands through a focused `feature/` branch with relevant tests. Provider and production-dependent
gates remain open until their runbook contains dated evidence from the real environment.

Local remediation and independent reauditing are complete as of 2026-09-07. The disposition and
validation for every finding are recorded in
[`audits/KOVA_REMEDIATION_STATUS_2026-09-07.md`](audits/KOVA_REMEDIATION_STATUS_2026-09-07.md).
The effective Supabase grants/Data API gate, the disposable Fly/Vercel recovery drill, and the real
Stripe test-mode lifecycle drill are closed. KOV-031 restore evidence remains the only open audit
gate and was expressly excluded from the authorized remediation scope.

The July premium redesign and CRO sections below are retained as historical execution context. Their
dates and checkboxes must not be interpreted as the current release decision.

## Active product improvement (2026-10): Análisis accionable

The owner requested code improvements that make Kova's subscription value concrete through its own
operating data. The first slice extends the existing inventory recommendations; acceptance and
calculation rules live in [`specs/reports/restock_decisions.md`](../specs/reports/restock_decisions.md).

- [x] Build a replenishment plan from current available stock, reservations and trailing seven-day
      inventory consumption, with owner-selected 3/7/14-day coverage.
- [x] Open the exact inventory product without creating a purchase or changing stock on navigation;
      reread inventory on return after an actual receipt entered through the existing form.
- [x] Distinguish unavailable inventory from untracked products, and avoid suggested quantities
      when stock or consumption evidence is insufficient.
- [x] Preserve categorical telemetry and label estimates without claiming confirmed savings,
      lost sales, or subscription ROI.
- [x] Keep the quantity and next step visible, with calculation details available on demand;
      verify keyboard access, 44 px controls and 320/390 px mobile layouts.
- [x] Update the backend lockfile to patched AnyIO 4.14.2, PyJWT 2.15.1 and urllib3 2.8.0
      after the release dependency audit identified vulnerabilities in the previous versions.
      The existing audit, authentication, integration and migration gates must pass before release.

Commercial value and retention still require real business observation. This local product slice
does not close KOV-031, pilot recruitment, production deliverability or live billing gates.

## Active product improvement (2026-10): Sucursales

The owner explicitly requested multi-location operation and answers to which branch sells most
and which products sell in each branch. This authorization supersedes the Phase 4 demand gate.
Contract and acceptance criteria live in
[`specs/branches/multi_location.md`](../specs/branches/multi_location.md).

- [x] Principal-branch historical backfill, tenant RLS and branch-consistent operational FKs.
- [x] Create/rename branches and select the operating branch on mobile and desktop.
- [x] Separate sales, drawers, stock, customer orders, reservations and expenses per branch.
- [x] Compare net sales, tickets and product quantities for the selected reporting period.
- [x] Preserve the original branch of queued offline sales, including legacy principal sales.
- [x] Verify PostgreSQL migrations/grants, backend/frontend suites, production bundle and mobile
      comparison accessibility; dated local evidence is recorded in the branch spec.
- [ ] Apply migration 0068 and deploy the backend before the new frontend in production.

Catalog, prices, employee roles, subscription and fiscal periods remain business-wide. There is no
new per-location pricing. Natural-language chat, branch-restricted staff and inventory transfers
remain outside this slice. Local checks do not establish commercial traction or close existing
production gates. Once additional branches exist, schema downgrade is intentionally blocked;
retain migration 0068 when rolling back the application.

## Active implementation (2026-10): Asistente por tenant

The owner requested the complete assistant design: guided configuration with explicit confirmation,
catalog imports, private-document RAG, authorized analytics, memory, goals and proactive in-app/opt-in
email follow-up. Architecture, quota estimates, security boundaries and 72 acceptance scenarios live
in [`plans/PLAN-ASISTENTE-TENANT.md`](plans/PLAN-ASISTENTE-TENANT.md), linked from the
[product roadmap](plans/PLAN-KOVA-COPILOT.md).

- [x] Consolidate the complete scope and implementation plan against existing code/contracts.
- [ ] Validate the real provider account, quality, consumption and data-processing conditions.
- [x] Implement the pilot UI/API/worker, confirmation, tenant/private RLS, idempotency, shared budgets,
      document lifecycle, memory/goals and deterministic follow-up on `codex/tenant-assistant`.
      A floating Kova logo companion opens a private chat without leaving the current page;
      checkout, onboarding tours and confirmation dialogs retain visual priority.
- [ ] Close external provider/parser/ingestion/restore gates before enabling a real pilot.
- [ ] Complete full-flow QA, observed pilot capacity and applicable production gates.

The owner authorized implementation on a new branch from main on 2026-10-06. Code and local
verification are tracked in [assistant-operations.md](assistant-operations.md) and the plan. Flags
remain disabled by default. This does not change pricing, authorize paid inference/deployment or
close operational gates. The branch-management slice above remains independently completed.

## Historical Sprint (2026-07): Premium redesign app-wide + remaining hardening

The active backlog was `PLAN-DESIGN.md` (repo root): extend the `feature/reports-redesign` design
system to every tab so the product feels premium end-to-end, and consolidate everything left over
(PLAN-05 backend, PLAN-UX-04/05, B5 resume, quick wins, operational gates).

Merged into `main` as of 2026-07-10 (closed, do not re-open here):

- [x] PLAN-01 (billing lifecycle correctness), PLAN-02 (tenant-isolation RLS — provisioned in prod,
      `kova_app` runtime verified on Fly), PLAN-03 (offline-sync integrity), PLAN-04 (cash & inventory
      correctness).
- [x] PLAN-UX-01 (modal a11y & destructive-action safety), PLAN-UX-02 (one-tap receipt + corte de
      caja printout), PLAN-UX-03 (anonymous funnel instrumentation & landing accuracy).
- [x] Épica 0 of `PLAN-DESIGN.md`: merged `feature/reports-redesign` (design system source) with the
      T0.1–T0.6 correctness fixes (payment keys, `net_amount`, unified thresholds, Docker proxy).

Open (tracked in `PLAN-DESIGN.md`): Épicas 1–4 (shared kit + per-tab redesign + state completeness +
backend hardening PLAN-05/B5) and Épica 6 (operational gates below). PLAN-UX-04/05 detail specs live
in `docs/audits/`.

## Audit remediation execution

The approved execution backlog is
[`docs/plans/PLAN-AUDIT-REMEDIATION-2026-08-13.md`](plans/PLAN-AUDIT-REMEDIATION-2026-08-13.md).
Execute one epic per feature branch, merge only after its required checks and evidence are complete,
and keep provider/production-dependent items open until their external gate is reproducible.

## Historical CRO execution (2026-07)

The active conversion backlog is [`docs/plans/PLAN-CRO-FUNNEL.md`](plans/PLAN-CRO-FUNNEL.md).
Execute one epic per PR, merge only after required checks are green, then continue in order.

The 2026-08-09 production diagnosis supersedes the contaminated CRO baseline for growth decisions.
Requirement-by-requirement execution and proof now live in
[`docs/plans/PLAN-GROWTH-EXECUTION.md`](plans/PLAN-GROWTH-EXECUTION.md); do not treat the scheduled
2026-08-20 analysis as trustworthy unless its window excludes all rows quarantined by migration
`0055`.

- [x] Epic CRO-0 — measurement context, diagnostic events, protected 30-day export and baseline.
- [x] Epic CRO-1 — mobile home and showcase.
- [x] Epic CRO-2 — clear, recoverable signup: backend-aligned password rules, field-specific 422
  recovery with accessible focus, adjacent trial trust copy, and PII-free validation telemetry;
  evidence in [`docs/audits/CRO-2-SIGNUP-2026-07-20.md`](audits/CRO-2-SIGNUP-2026-07-20.md).
- [x] Epic CRO-3 — POS cart without premature anxiety: neutral untouched-cash guidance,
  interaction-gated validation and telemetry, preserved financial guards, and mobile coverage at
  320×844 and 390×844; evidence in
  [`docs/audits/CRO-3-POS-CASH-2026-07-20.md`](audits/CRO-3-POS-CASH-2026-07-20.md).
- [ ] Epic CRO-4 — trustworthy billing and checkout: CRO-4.1–4.5 completed. The provider and
  lifecycle portion of CRO-4.6 passed in a disposable Stripe test-mode drill; return/cancel UX and
  live checkout remain release gates. Evidence in
  [`docs/audits/CRO-4-BILLING-2026-07-20.md`](audits/CRO-4-BILLING-2026-07-20.md).
- [ ] Epic CRO-5 — rollout and learning loop: small-batch rollout and experiment isolation are
  complete; the 3.81-hour preliminary checkpoint was inconclusive as required, and reproducible
  7/30-day analysis remains scheduled for 2026-07-28 and 2026-08-20. Evidence in
  [`docs/audits/CRO-5-ROLLOUT-2026-07-21.md`](audits/CRO-5-ROLLOUT-2026-07-21.md).

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

## Current Focus: Paid Beta Readiness

Kova Audit Sprints 1-6 are product-complete enough for controlled paid beta preparation. The
remaining blocker is not core POS feature work; it is production trust and commercial operations.

Goal: safely charge the first controlled beta tenants without breaking trust in checkout,
subscription state, data recovery, monitoring, or support.

Readiness snapshot:

| Area | Status |
|---|---|
| Core POS flow | Mostly ready for controlled beta. |
| Tenant isolation | Strong foundation; keep tests as a release gate. |
| Offline behavior | Foundation present; production offline drill remains a recurring gate. |
| Billing | Implemented, but live Stripe flow is still commercially gated. |
| Deployment | Vercel/Fly custom domains configured; rewrites now match backend paths. |
| Backups | R2 backup works; restore drill still open. |
| Monitoring | UptimeRobot covers frontend, API, and API + DB. |
| Support/legal | Beta agreement exists; `/seguridad` shipped; official beta support email confirmed. |

## Done

- [x] Standard Plan aligned to $299 MXN/month across product copy, billing defaults, docs, specs,
      tests, and migration.
- [x] Public/auth trust pass landed: narrowed landing claims, privacy/terms pages, signup trust
      cues, and reduced stale PWA prompts on public/auth routes.
- [x] Tenant onboarding path improved for cafe/small food retail: cafe preset, Spanish-first setup
      checklist, direct catalog/inventory actions, and first-value milestone state.
- [x] Core POS usability pass landed: cart-first payment controls, hidden advanced split payment,
      mobile navigation regression coverage, catalog/inventory/order sorting and search.
- [x] Reports storytelling pass landed: compact owner decision brief, deduped actions, restock
      prioritization, local date handling, product trends, restock alerts, and employee contribution.
- [x] Sprint 5 QA blockers substantially closed: stock guard, refund/receipt copy, real 404 and
      Spanish route aliases, session refresh, product validation, billing request dedupe,
      localization, CSP, offline QA checklist, and first-paint polish.
- [x] Sprint 6 Trust Lock product work closed: timezone-safe defaults, localized shifts, production
      data hygiene scripts, sold-out inventory badge, receipt reprint, cash refunds in shift
      reconciliation, trial value recap, dynamic comparison labels, action dedupe, and register
      hotkeys.
- [x] Custom domains validated:
      `https://kovasuite.com` on Vercel and `https://api.kovasuite.com` on Fly.
- [x] Vercel rewrites aligned to backend reality:
      `/api/health -> https://api.kovasuite.com/health`,
      `/api/health/db -> https://api.kovasuite.com/health/db`, and
      `/api/v1/:path* -> https://api.kovasuite.com/api/v1/:path*`.
- [x] GitHub Actions Supabase backup to Cloudflare R2 fixed after PostgreSQL version mismatch:
      workflow now installs PostgreSQL 17 client, puts `/usr/lib/postgresql/17/bin` on `PATH`,
      validates backup secrets/config, dumps with `pg_dump` 17, uploads to R2, verifies the object,
      and prunes after 7 days.
- [x] Uptime monitoring moved to UptimeRobot for frontend, API health, and API + DB health.
- [x] Beta agreement template exists at `docs/beta-agreement-template.md`.
- [x] Beta support email decision confirmed:
      `posprojectsupport@gmail.com` is the official support channel for controlled paid beta.
      A branded mailbox may be revisited after beta signal, but it is not a blocker for charging
      founder-assisted beta tenants.
- [x] CSRF protection hardened (2026-05-25):
      threat model in `docs/security/cookie-csrf-threat-model.md`, double-submit middleware
      in `backend/app/middleware/csrf.py`, frontend wired via `frontend/src/lib/csrf.ts`,
      negative tests in `backend/app/tests/test_csrf.py` and `frontend/src/lib/csrf.test.ts`,
      Stripe webhooks and `X-Internal-Key` paths verified as exempt.
- [x] Rate limiting moved to a pluggable backend (Upstash Redis sliding window in prod,
      in-memory fallback in dev); coverage extended to sync, uploads, and checkout;
      docs at `docs/security/rate-limiting.md`.
- [x] Senior code audit follow-ups landed (2026-05-26):
      - Centralized MXN money formatting: `formatMoney` now accepts `string | number`
        and a new `formatMoneyDelta` handles signed deltas. Removed the ad-hoc
        `formatMXN` in `routes/Home.tsx`, the `${n.toFixed(2)}` patterns in
        `shifts/CloseShiftModal.tsx` and `shifts/ShiftView.tsx`, the `+MX$` deltas
        in `catalog/CatalogView.tsx`, `register/ModifierSelectionModal.tsx`, and
        `orders/OrderDetail.tsx`, and the redundant `.toFixed(2)` wrapping in
        `dashboard/DashboardView.tsx`. `billing/BillingView.formatPlanAmount` is
        left as-is because it is multi-currency (commit `8353aad`).
      - i18n sweep: new `documentTitles` and `notFound` namespaces plus
        `register.online`; migrated the 13 `useDocumentTitle("...")` callsites,
        `routes/NotFound.tsx`, and `offline/OfflineIndicator.tsx` (commit `a765563`).
      - Landing page i18n: the stale `landing` namespace in `i18n/messages.ts` is
        replaced with one that mirrors the current `routes/Home.tsx` sections (nav,
        hero, threeNodes, posShowcase, desktopPreview, tabletPreview, features,
        firstDay, builtFor, faq, pricing, footer). All hardcoded Spanish copy in
        Home.tsx now reads from `copy.landing` (commit `570eace`).
      - Backend domain layout: `reports/` and `business_settings/` now follow the
        `{models, repository, service, router, schemas}` convention. Pure SQL
        queries moved to new `repository.py` modules; `service.py` keeps
        aggregation, timezone handling, and storytelling. No behavior change
        (commit `03b3405`).
      - Trial-reminder window fix (2026-05-26):
        `app/email/trial_reminders.send_due_trial_reminders` used the window
        `[now + (LEAD-1)d, now + LEAD d]` = `[now+2d, now+3d]`, which excluded
        trials ending around 3.5d. The window is now `[now+LEAD, now+(LEAD+1)d]`
        = `[now+3d, now+4d]`, matching the "send ~3 days before expiry" intent
        and the test fixtures in `app/tests/test_trial_reminders.py`.
      - Stripe live-mode go-live fixes (2026-05-26):
        Initial live `POST /api/v1/billing/checkout` failed with Stripe
        `url_invalid` because the deployed `STRIPE_CHECKOUT_SUCCESS_URL` /
        `STRIPE_CHECKOUT_CANCEL_URL` secrets were missing the actual frontend
        paths — fix was to set them to
        `https://kovasuite.com/settings/billing/success` and
        `.../cancel`, which match the `/settings/billing/:returnState` route
        in `App.tsx` that `BillingView` reads from `location.pathname` to
        trigger the success/cancel toasts.
      - Stripe API 2026-04-22.dahlia period field fallback (2026-05-26):
        The new Stripe API moved `current_period_start` / `current_period_end`
        off the subscription root and onto each subscription item. The
        webhook handler in `app/billing/service.py` was reading them from the
        root only, so after a successful checkout `/settings/billing` showed
        "Fin del periodo actual: No disponible". Added `_extract_period()`
        helper that falls back to `items.data[0].current_period_*` when the
        root fields are absent; applied in both
        `_upsert_subscription_from_stripe_object` and `cancel_subscription`.
        Regression test in
        `app/tests/test_billing_api.test_subscription_webhook_reads_period_from_items_when_root_missing`.
      - TrialChip stale day counter fix (2026-05-26):
        `frontend/src/billing/TrialChip.tsx` only fetched the billing status
        once on `authenticated` flip and never re-rendered, so the
        "X días restantes" header chip was frozen across an open tab — only
        a re-login refreshed it. Now ticks every 60s (recomputes
        `daysUntil(trial_ends_at)`) and refetches on `visibilitychange` /
        `focus` to catch trial → active transitions that happened in the
        background.
      - Mega-view splits (ReportsView, CatalogView, RegisterView, >1200 lines
        each) deliberately deferred — they touch business-critical logic and
        violate CLAUDE.md's "do not change component APIs" rule without a
        per-component plan and e2e coverage. To be picked up in a dedicated
        session.

## Active Release Gates

These block broad selling and should be closed before live Stripe or more than founder-assisted
controlled tenants.

- [ ] Stripe live checkout full-flow verified:
      checkout, webhook, active subscription, retry/past_due, grace period, cancel, and resume
      behavior if supported. The equivalent test-mode lifecycle passed in GitHub Actions run
      `34179307328`; this checkbox specifically requires live-mode evidence.
- [ ] Post-checkout, welcome, and trial-ending emails verified against real inbox providers
      (Gmail, Outlook/Hotmail at minimum).
- [ ] Restore drill completed from a real R2 backup into a fresh Supabase project and documented in
      `docs/runbooks/restore-supabase-backup.md`.
- [ ] Beta agreement signed by first paid tenants.
- [x] Domain/support path confirmed:
      `posprojectsupport@gmail.com` is the official support address for controlled paid beta;
      moving to a branded mailbox is deferred until after beta signal.
- [x] `/seguridad` page shipped at `frontend/src/routes/LegalPage.tsx` (security variant);
      covers tenant isolation (app + RLS), HttpOnly cookies + CSRF, backups, uptime monitoring,
      payment separation, beta expectations, and support; linked from the home footer, the legal
      pages, and the signup trust block; excluded from the SW navigation fallback so deploys
      never serve a stale copy.
- [x] Production smoke on custom domain completed after the Vercel rewrite deploy (2026-05-28):
      login, signup, session refresh, billing subscription fetch, catalog load, register sale,
      reports, settings, `/api/health`, and `/api/health/db` all verified on `kovasuite.com`.
- [x] Signup "email already registered" recovery path (regression from 2026-05-28 production
      incident: real prospect hit `POST /api/v1/auth/signup` → 400 twice and only saw the generic
      "No se pudo completar la operación", so she abandoned signup). Shipped 2026-05-28:
      - [x] Backend: `signup` in `backend/app/auth/service.py` now returns a `SignupOutcome` with
            three branches — `account_created`, `verification_resent`, `email_in_use`. Verified
            existing users get `email_in_use` (no token, no tenant_id leaked). Unverified
            existing users have prior `email_verification` tokens invalidated via
            `repo.invalidate_pending_tokens` and a fresh token reissued + resent. Rate limiting
            stays on the existing `auth-signup` bucket; response body shape is identical across
            branches except for `reason` and (for `account_created`) `user_id`/`tenant_id`.
            Audit events `user.signup_blocked_existing` and `user.signup_verification_resent`
            cover the recovery paths. Endpoint returns 201 only for `account_created`, 200 for
            the recovery branches.
      - [x] Frontend: `frontend/src/auth/AuthView.tsx` branches on `response.reason`. New states
            `email_in_use` (muted info panel + "Iniciar sesión" primary CTA that prefills the
            login form via `/login?email=…` + secondary "¿Olvidaste tu contraseña?") and
            `verification_resent` (green success panel: "Ya tenías una cuenta sin verificar. Te
            reenviamos el correo a {email}…"). Copy in `frontend/src/i18n/messages.ts`
            (`signupEmailInUse*`, `signupVerificationResent*`).
      - [x] Audited the rest of the auth surface for blind `operationError` fallbacks.
            `VerifyEmailView` now distinguishes a 400 (expired/invalid token → dedicated panel
            with "Volver a registrarme" CTA) from other errors. `ResetPasswordView` already
            mapped 400/422 to `resetTokenInvalid`. `ForgotPasswordView` intentionally stays
            generic to avoid email enumeration. Login still maps 401/403 to invalid creds and
            429 to rate limit.
      - [x] Tests: backend `test_signup_existing_verified_user_returns_email_in_use` and
            `test_signup_existing_unverified_user_resends_verification` in
            `backend/app/tests/test_auth.py` cover both branches and assert that the previous
            verification token is invalidated. Frontend `frontend/src/auth/AuthView.test.tsx`
            covers the `email_in_use` panel, the `verification_resent` confirmation, and the
            `/login?email=…` prefill. Manual Gmail QA pending before the next live deploy —
            same gate as the rest of the email-deliverability checklist.

## Sellability Audit Follow-Ups

These are detailed follow-ups from the 2026-05-25 sellability review. They should either be closed
before broad self-serve selling or explicitly accepted as controlled-beta risks by the founder.

- [x] Rate limiting hardened with pluggable backend (2026-05-25):
      `backend/app/middleware/rate_limit.py` now selects an Upstash Redis sliding-window backend
      when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set, falling back to in-memory
      otherwise. Coverage extended from auth-only to also include `sync/offline-sales`,
      `billing/checkout`, and image/logo uploads. Frontend handles 429 (auth message in `AuthView`,
      offline sync re-queues to pending). Threat model and operator checklist in
      `docs/security/rate-limiting.md`. Tests in `backend/app/tests/test_rate_limit.py`.
- [x] Fix onboarding billing completion logic:
      `GET /api/v1/onboarding/state` now marks the billing step complete when
      `get_billing_access_status` returns `active`, `trialing`, or `past_due_grace` (the prior
      check used reason strings — `active_subscription`, `subscription_trial` — that the access
      helper never emits, so the step never completed even for paying tenants). Signup-trial and
      expired-trial states keep prompting the user to activate the plan. Regression coverage in
      `backend/app/tests/test_onboarding_billing.py` exercises active subscription, trialing
      subscription, past_due within grace, signup trial, and expired trial.
- [ ] Make email delivery a production gate:
      Partial progress:
      - [x] Startup gate: `_validate_config` in `app/main.py` now fails to boot when
            `APP_ENV=production` and `RESEND_API_KEY` is missing, or when `EMAIL_FROM` is left at the
            default `onboarding@resend.dev` sandbox sender. Lifecycle emails can no longer be
            silently skipped in prod. Covered by `app/tests/test_email_gate.py`.
      - [x] Welcome / post-checkout email: `send_welcome_email` added in `app/email/service.py`
            (Spanish copy, links to dashboard and `/settings/billing`). Wired into the Stripe
            `checkout.session.completed` webhook handler in `app/billing/service.py`; resolves the
            tenant owner via `Membership.role = 'owner'`. Idempotent because the webhook handler
            already short-circuits on duplicate event IDs. Covered by
            `app/tests/test_welcome_email.py`.
      - [x] Billing receipt / billing confirmation email on `invoice.payment_succeeded`:
            `send_payment_receipt_email` in `app/email/service.py` (Spanish copy with amount,
            folio, periodo y link al recibo alojado en Stripe). Wired into the Stripe webhook
            handler in `app/billing/service.py`; resolves the tenant owner via
            `Membership.role = 'owner'`. Idempotent because the webhook handler already
            short-circuits on duplicate event IDs. Covered by
            `app/tests/test_payment_receipt_email.py`.
      - [x] Trial-ending reminder ~3 days before expiry:
            `send_trial_ending_email` in `app/email/service.py` + batch job in
            `app/email/trial_reminders.py`. Cron-friendly script at
            `scripts/send_trial_reminders.py`. Covers both signup-trial (derived from
            `tenant.created_at + billing_trial_days`) and Stripe `trialing` subscriptions.
            Idempotent via new `tenants.trial_reminder_sent_at` column (migration
            `0025_trial_reminder_sent_at.py`). Covered by `app/tests/test_trial_reminders.py`.
            Cron still needs to be wired in the deploy platform — see
            `docs/email-deliverability.md`.
      - [ ] Manual deliverability QA: Gmail + Outlook/Hotmail inboxing, spam placement,
            SPF/DKIM/DMARC for the Kova sending domain, link rendering, sender identity, Spanish
            copy review across all five lifecycle emails. Checklist in
            `docs/email-deliverability.md`.
- [x] Remediate frontend performance warning (2026-05-25):
      route-level lazy loading now splits public/auth/app screens and heavy authenticated surfaces;
      Vite manual chunks separate React, Dexie/offline, UI helpers, icons, and remaining vendor code.
      Production build no longer emits the large-main-chunk warning: the entry chunk is 72.75 kB
      minified / 24.73 kB gzip, with `vendor-react` at 180.74 kB / 54.80 kB gzip and
      `vendor-offline` at 96.37 kB / 32.46 kB gzip. Mobile 4G and returning-PWA behavior should be
      confirmed during the custom-domain production smoke gate.
- [x] Resolve frontend npm audit moderate vulnerabilities (2026-05-25):
      upgraded dev tooling to `vite@^6.4.2` and `vitest@^3.2.4`, then applied `npm audit fix` for
      `ws`; `npm audit --audit-level=moderate` now reports zero vulnerabilities.
- [ ] Improve backend test ergonomics for release gates:
      make the documented Windows backend test command easy to run with a reachable Postgres;
      document the fastest local path to start Postgres, apply migrations, and run `uv run pytest`;
      ensure CI remains the release source of truth and that the exact release commit has green
      backend tests before live Stripe is enabled.

## Known Follow-Ups

These are not blockers for controlled paid beta unless a real tenant hits them.

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [ ] Decide whether employee management should graduate from Settings to first-class navigation
      after beta usage data.
- [ ] Add invitation acceptance-path E2E once that flow is finalized.
- [ ] Decide whether the cafe preset needs modifier groups for milk/size, or keep modifiers as a
      later usability pass.

## Verification Baseline

Recent documented verification:

- Frontend performance/security follow-up passed on 2026-05-25:
  `npm run typecheck`, `npm run lint`, `npm test -- --run` (26 tests), `npm run build`, and
  `npm audit --audit-level=moderate`. Build entry chunk is now 72.75 kB minified / 24.73 kB gzip
  and no Vite large-chunk warning is emitted.
- Frontend typecheck, lint, production build, and diff hygiene passed during Sprint 6.
- Focused unit/E2E coverage exists for date handling, shifts, inventory sold-out state, receipt
  reprint, register hotkeys, routing, out-of-stock sale paths, refunds, and order detail.
- Backend CI passed after Sprint 6 refund cash-movement merge, covering the refund BDD path with
  Postgres.
- Backup workflow now produces a successful Supabase `pg_dump` 17 to Cloudflare R2 per operator
  confirmation on 2026-05-25.

Before moving beyond controlled beta, rerun:

```powershell
cd frontend
npm run typecheck
npm run lint
npm run build
npm test -- --run
npm run test:e2e -- --project=chromium
```

Backend full test gate requires a reachable Postgres:

```powershell
cd backend
$env:UV_PROJECT_ENVIRONMENT=".venv-win"
uv run pytest
```
