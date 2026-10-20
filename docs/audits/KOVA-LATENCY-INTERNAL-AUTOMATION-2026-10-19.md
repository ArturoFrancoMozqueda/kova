# Arranque frío, revisiones de atención y enlaces a pendientes

Fecha: 2026-10-19. Estado: PR #219 publicada y aceptada en producción; latencia fría pendiente de resolver.
Aceptación 18:00:50 UTC, SHA `1f12c4baf8a974ce6fd49d3cc2356009640a4b65`, migración 0091 aplicada. Este corte continúa la cola/casos ya publicados por PR #217. No acredita todavía una
reducción de los aproximadamente 10 s observados en producción ni completa el horizonte E2E.

## Alcance implementado

La regla `service_case_overdue` amplía el motor existente y comienza desactivada. Tras autorización
por sucursal, genera revisiones internas para casos activos cuyo vencimiento manual sea anterior
al reloj servidor y posterior o igual a `enabled_since`. Excluye casos vencidos antes de habilitarla.
No envía avisos, escala personas automáticamente, define SLA ni modifica el caso o sus finanzas.

La identidad por caso/fecha UTC en microsegundos evita duplicados por notas o asignaciones. El
scanner excluye identidades existentes antes de LIMIT. Resolver/cancelar, reprogramar, pausar o
perder autorización suprime revisiones pendientes en el siguiente procesamiento acotado; no se
promete supresión inmediata. Las fuentes obsoletas tienen prioridad en ese barrido para evitar
que un lote válido lleno las bloquee. Completar exige fuente vigente con FOR SHARE hasta commit:
un cierre/reprogramación concurrente no puede confirmar entre validar y completar la revisión.

Reusa bloqueo por sucursal, permisos del autorizante, billing, rol runtime/RLS y worker/cohort/lease
existentes. `0091_case_deadline_automation` sólo amplía dos CHECK del catálogo de plantillas/eventos;
no crea tablas, grants ni cambios de exportación/purga. Su downgrade rechaza retirar historial nuevo,
incluso si la regla quedó desactivada. Los eventos/auditorías no incorporan notas ni nombres privados.
[Contrato y validación](../../specs/automations/automation_engine.md).

La cola ahora abre el registro individual de sus cuatro fuentes con rutas/IDs permitidos:
`case_id`, `opportunity_id`, `task_id` y `reminder_id`. Los tres GET nuevos de oportunidad, seguimiento
y recordatorio conservan DTOs existentes, `require_crm`, tenant/sucursal y respuesta privada no-store.
Atención reusa su GET individual. No buscan el registro dentro de una muestra paginada ni escriben
al navegar. UUID inválido/duplicado, falta de acceso, 404 y offline tienen estados explícitos; los
resultados tardíos o de otra identidad/sucursal se descartan. Reprogramar la cita refresca también
el recordatorio enlazado: si el GET exacto devuelve 404, se retiran sus acciones obsoletas.
[Spec de cola](../../specs/operations_queue/internal_queue.md) y
[BDD de enlaces](../../specs/operations_queue/linked_records.feature).

## Arranque frío y límites de medición

El PDF de Workers carga `pypdf` al construir el documento, preservando el render existente. En
WASM, Sentry conserva transporte/sanitización y las integraciones web/database utilizadas
(FastAPI, Starlette, SQLAlchemy, HTTPX), con integraciones automáticas opcionales desactivadas;
sus defaults principales se conservan. Resend carga su SDK al enviar con configuración habilitada.
No se cambian contratos de auth, cookies, CSRF, sesiones, RLS, billing, cohort ni conexiones.

El perfil local de importación pasó de 2,171 ms a 1,213 ms, aproximadamente 44% menos. Mide ese
perfil local, no latencia de login/sesión en producción, tiempo de red ni base de datos. La medición pública posterior a publicar confirmó 32/32 contratos privados correctos y el mismo
SHA antes/después. En ocho primeras peticiones directas, la mediana fue 8,453.5 ms (411–17,574 ms);
cinco superaron 8 s. En ocho repeticiones directas, 347.5 ms (219–1,120 ms). Las muestras proxy,
posteriores a las directas, tuvieron medianas de 790 y 474 ms. Son primeras observaciones por
contexto sintético y pueden estar calientes por tráfico previo; no prueban un SLA. La latencia fría
no está resuelta. Sitio, proxy, API y conexión de base de datos aprobaron el verificador estricto.

## Evidencia local

| Comprobación | Resultado y límite |
|---|---|
| Backend completo | 1,800 pruebas finales, cero errores/fallos/omitidas, 146 s. |
| Automatizaciones | 25/25 con psycopg y 25/25 con pg8000; dos pruebas de migración 0091 aprobadas. |
| GET individuales | 18/18 con cada controlador, incluidas tres regresiones directas con rol `kova_app` y dos negocios reales. |
| Frontend completo final | 1,124 pruebas aprobadas. |
| Frontend focal/integrado | 79 focales, 16 recorridos browser y uno real con API/Postgres/RLS aprobados. |
| Artefacto frontend | Build aprobado y escaneo de 121 JS aprobado. |
| Workers fuente final | Nueve pruebas de runtime, cuatro de compatibilidad y una de jobs aprobadas. |
| Migraciones completas | 27 pruebas, cero errores/fallos/omitidas, 35 s; aprobadas. |

Las pruebas de automatización incluyen creación/resolución con dos conexiones runtime simultáneas,
identidad por fecha, no retroactividad, notas sin duplicar, reprogramación/resolución/pausa/revocación,
roles/billing, dos tenants/sucursales, fechas futuras/null y lotes de una fila sin starvation. La
carrera de cierre fue reproducida antes de FOR SHARE y su regresión pasa con ambos controladores.
La revisión independiente de enlaces detectó el recordatorio obsoleto tras reprogramar; frontend
lo corrigió y añadió regresión focal y recorrido real. No quedaron otros hallazgos reproducibles.

No se realizaron envíos ni transacciones financieras reales durante esta validación. Las pruebas
locales no acreditan conexión de cuentas, entrega externa ni funcionamiento autenticado productivo.
CI del commit final, migración/publicación y medición productiva conservan gates separados.

## Archivos principales

- Motor y contrato: `backend/app/automations/{models,schemas,service}.py`, migración
  `backend/alembic/versions/0091_case_deadline_automation.py`, pruebas API/migración y
  `specs/automations/automation_engine.{md,feature}`.
- Lecturas: routers/servicios de `backend/app/crm/` y `backend/app/appointments/`,
  `backend/app/tests/test_linked_operations_reads.py` y `specs/openapi.json`.
- UI: `frontend/src/operationsQueue/{useLinkedRecord,LinkedRecordNotice,OperationsQueueView}.tsx`
  (hook `.ts`), vistas de casos/CRM/seguimiento/agenda, y enlaces de automatizaciones.
- Arranque/compatibilidad: `backend/app/workers/pdf.py`, `backend/app/observability/sentry.py`,
  `backend/app/email/service.py`, sus guards de startup y pruebas de runtime/compatibilidad Workers.

WhatsApp/Meta, correo comercial, PSP y PAC mantienen sus dependencias de configuración/aceptación.
Este corte no conecta proveedores ni habilita efectos externos.

## Diagnóstico siguiente

Se añaden mediciones monotónicas con etiquetas estáticas y duración para configuración, importación,
Sentry/configuración, RLS, ACL privada y construcción de la aplicación. No cambian validaciones,
orden, lock/cache, cookies, RLS ni contratos HTTP. No registran configuración, SQL o datos de
clientes. La fase Workers temprana se emite después de instalar logging. Ocho regresiones nuevas
comprueban orden, fallo cerrado, cache y ausencia de payload privado; 14 focales aprobadas.
La instrumentación fue aceptada en producción por PR #220 a las 18:32:33 UTC, SHA
`50c6749725b66ee9c908ade48cdf32cd6552fc51`, versión API
`3368dde6-04dc-455d-8540-891d085e8c34`. Verificador estricto: sitio/proxy/API/base de datos
alcanzables y SHA coherente. La suite backend completa final pasó 1,808 pruebas sin
fallos/errores/omitidas. La prueba de comparación de rutas se aisló de las rutas temporales que
las pruebas RBAC añaden a `main.app`; once regresiones combinadas y suite completa aprobaron.

Nueva cohorte de 32 GET: todos los contratos aprobaron. Primeras directas: mediana 8,260 ms,
rango 245–17,575 ms, seis de ocho >=8 s; repeticiones directas: mediana 218 ms (191–234 ms).
Proxy posterior: medianas 262/221 ms. Telemetría por fases de esa versión: `workers.total`
mediana 5,686.5 ms, `app.rls_posture` 5,410 ms y ACL privada 271 ms, con muestras distintas.
Los relojes de Workers sólo avanzan tras I/O: los ceros no prueban CPU cero y el intervalo RLS
puede incorporar CPU anterior al siguiente I/O. No se atribuye todo el tiempo a consultas.
[Semántica del reloj](https://developers.cloudflare.com/workers/runtime-apis/performance/).

## Siguiente optimización, aún sin aceptación productiva

Se implementó una frontera explícita de metadata declarativa sin configuración ni conexiones:
`app.db.Base` conserva su identidad por reexportación. Los modelos y schemas se pueden importar
antes de la invocación sin `app.config`, `app.db`, engines o sockets. El experimento temporal
mantuvo el inventario puro de 96 tablas/201 índices/DDL y OpenAPI idénticos, con nueve pruebas runtime por corrida.
Dos mediciones equivalentes dieron ~28.7% menos trabajo local de inicialización; no se promete
ese porcentaje remoto. El modelo `InventoryTransfer`, declarado fuera de los archivos `*models.py`,
conserva su carga diferida y comparte la misma registry cuando se importa; el inventario puro no
pretende abarcar todo módulo con una clase ORM. Tres preloads adicionales no dieron una mejora incremental estable y
se descartaron. El segundo cambio reúne las lecturas del catálogo de arranque en un viaje,
conservando el comprobador completo de RLS y ACL separada. Veintiséis pruebas diferenciales
(psycopg/pg8000) comparan los mismos inputs con las cuatro lecturas originales, incluidos estados
inseguros, propiedad, tablas ausentes y políticas de relaciones particionadas. Focal ampliado:
78 aprobadas; frontera/listeners: 11 aprobadas; Workers: 9 API + 4 compatibilidad + 1 tareas;
27 migraciones aprobadas sin cambios de schema. Metadata nativa completa: 97 tablas y 202
índices idénticos, incluyendo el modelo de transferencias diferido. Las suites completas finales
con ambos controladores están en ejecución. CI/publicación y medición remota pendientes;
no se declara resuelta la demora fría.

## Aceptación de PR #221 y latencia todavía abierta

PR #221 fue aceptada el 19 de octubre a las 14:32 CDMX (20:32 UTC), SHA
`2df276612e661b2b6652f65ee9edaaec4b869a8c`, versión API
`c96a1fb3-6aaa-4860-973b-9fa653656306`. CI y publicación completos aprobaron. El arnés
RLS final utiliza el controlador real de cada perfil: once escenarios de catálogo y cuatro de
fallo cerrado por perfil, sin exigir el proveedor opcional del otro job ni omitir escenarios.
El perfil nativo también aprobó bloqueando explícitamente la importación de pg8000.

Verificador estricto: frontend/proxy/API/base de datos alcanzables con ese mismo SHA.
QA pública: 32 navegaciones en cuatro tamaños, 12 GET protegidos con 401/no-store, cero errores
JavaScript/desbordamientos. No se usaron sesiones de clientes ni escrituras del negocio. El
intento de refresh sin credencial se permitió únicamente para exigir 401 sin cookies de auth.

La cohorte posterior (17:49 CDMX) aprobó 32/32 contratos y verificó identidad antes/después, pero
no resolvió la demora. Primeras consultas directas de cola: 6,828/14,499/5,707/238 ms; mediana
6,267.5 ms. Repeticiones directas: mediana 208 ms (184–240). Las sesiones iniciales ya estaban
calientes: mezclar sus tiempos con cola daría una mediana engañosa de 232 ms. Estos son primeros
accesos observados, no arranques fríos forzados ni un SLA.

## Siguiente corte: descubrimiento del dialecto, sin saltar guards

La primera conexión SQLAlchemy ejecuta cuatro sondeos de versión, schema, aislamiento y strings.
Se agrupan en una consulta de valores vivos de la misma conexión para el dialecto Workers;
`super.initialize` conserva el parser y las capacidades originales. Las lecturas GUC se califican
con `pg_catalog` para conservar la semántica de SHOW sin depender de search_path. Los proxies
sólo viven en el stack de inicialización y las consultas desconocidas se delegan a la conexión.
Lecturas de aislamiento posteriores vuelven al comportamiento upstream.

El alias se aplica únicamente a los motores Workers runtime y privilegiado. El creador/binding,
NullPool, sesiones, transacciones, normalización de errores y comprobadores RLS/ACL permanecen
intactos. Se descartó el adaptador de catálogo directo: habría trasladado los sondeos a la primera
petición autenticada. También se descartó precargar SDK ASGI: sólo ahorró 3 ms en el experimento.

Validación del nuevo corte: 30 focales por controlador, OpenAPI sin cambios, Ruff/diff-check y
Workers 9 API + 4 compatibilidad + 1 tareas aprobados. Suites completas finales en ejecución;
publicación y medición productiva pendientes. No se declara eliminada la espera de diez segundos.

## PR #222: CI aprobado, publicación recuperada por conflicto de gateway

PR #222 fusionó `289cc4656148a153100987e28ff9caf38b73a70f` a las 18:12 CDMX.
CI completo y 1,833 pruebas por controlador aprobaron. La primera petición autenticada local
fue 1,129 ms baseline frente a 1,099 ms nueva; caliente 15 ms ambas. Es orientación local,
no prueba de mejora remota.

El pipeline 39346232676 detuvo la fase candidate: el gateway remoto tenía
`limits.cpu_ms=100`, creado a las 18:06 CDMX, mientras la configuración local omitía limits.
Se conservó strict y la recuperación restauró API `c96a1fb3-6aaa-4860-973b-9fa653656306`
y jobs `f4da2eb1-32d7-4cd1-a112-ad13db3c6c8c`. No hubo accepted:true para #222 ni se
midió su latencia como versión aceptada. El gateway previo capturado conservó su límite remoto.

Se declara explícitamente ese mismo techo en la configuración tipada (`cpuMs: 100`), sin
normalizar diferencias arbitrarias ni omitir strict. Una lectura acotada de suscripciones
confirmó Workers Paid ya existente; no se activó, canceló ni cambió ningún plan. La referencia
histórica a Free es intención previa, no evidencia del estado actual de la cuenta. El valor
de configuración no es una medición de CPU ni de latencia, y no permite inferir nuevos costes.
[Campo tipado](https://developers.cloudflare.com/cf/projects/cloudflare-config/),
[límites oficiales](https://developers.cloudflare.com/workers/platform/limits/).

## Catálogo de arranque compartido, ambas validaciones completas

RLS devuelve su catálogo vivo sólo después de validar toda la postura. La guarda ACL recibe
opcionalmente esa misma lectura local y evalúa las políticas restrictivas originales; al
llamarse por separado conserva su SELECT. Un catálogo vacío falla cerrado, no activa fallback.
create_app y jobs terminan ambas evaluaciones antes de construir app o marcar listo. No se
retiene catálogo, conexión ni estado de verificación global.

La proyección coincide con la lectura independiente. Nueve catálogos prueban el válido y ocho
alteraciones de tabla, política, rol, expresión, permisividad o comando; ambas entradas producen
los mismos rechazos. La nueva prueba de create_app confirma una conexión física y un SELECT
de guardas en vez de dos. Doce regresiones nuevas; focal 36 por controlador. Suites completas
1,845/1,845 psycopg y 1,845/1,845 pg8000, sin fallos/errores/omitidas; Workers 9 API + 4
compatibilidad + 1 tareas y build 33.24 MiB aprobados. El ajuste de arnés de observabilidad
acepta el nuevo argumento del catálogo sin cambiar orden, excepciones ni expectativas.

El próximo corte medirá conjuntamente #222 y reutilización ACL, sin atribuir causalidad a una
entrega aislada. El perfil local identifica el registro de rutas como coste relevante, pero no
hay preload puro adicional grande y seguro. Se descartó responder sesión anónima en gateway:
trasladaría la espera a refresh y no resolvería la primera interacción autenticada. Publicación
y medición productiva siguen pendientes; no se declara eliminada la espera de diez segundos.

## PR #224 y último main: segundo intento recuperado por falso conflicto del CLI

#224 fusionó `4638322832500e46718460b28e37c47bacc8f1d3` tras todos sus checks verdes.
Dos segundos después, #223 agregó controles de coste sobre ese mismo árbol: último main
`69109d30d2ed5c8f74cdc2f39476c02207ee8467`. La ejecución intermedia quedó con jobs cancelados;
se canceló antes de publicar para validar el último main. CI completo de `69109d30` aprobó en
39348627738; su publicación falló y recuperó candidate a las 18:52 CDMX. Ninguno de esos dos
SHAs recibió accepted:true. El verificador estricto volvió a confirmar sitio/proxy/API/DB en
`2df276612e66` después de recuperar.

La diferencia CPU ya estaba resuelta. El nuevo diff era `durable_objects.bindings: [{}]`:
cf beta.18 construye el descriptor remoto con una propiedad propia `environment: undefined`,
aunque la respuesta API no incluya environment; el conversor local omite la propiedad. El
comparador distingue ambas formas y luego el formato JSON oculta undefined, creando el falso
conflicto. La reproducción offline usa el comparador real del CLI y el descriptor DO filtrado
(nombre/clase/script; ningún binding sellado). La corrección omite únicamente environment
cuando es undefined en esa conversión; null, cadenas y diferencias reales siguen presentes.
Strict y sus bloqueos permanecen activos. Se añade a la corrección beta.18 existente de nombres
de módulos Python, con pin, verificación de coincidencia e idempotencia.

## Catálogo estático mediante protocolo simple

pg8000 usa tres ciclos para una consulta parametrizada: parsear, describir y ejecutar. La lista
RLS es inventario del código, sin entradas de solicitudes. `bindparam(literal_execute=True,
type_=ARRAY(String()))` hace que SQLAlchemy escape esa lista y envíe cero parámetros DBAPI,
activando el protocolo simple. Se conservan BEGIN, la misma consulta y todos los validadores.
La primera petición autenticada local confirmó 4→2 ciclos incluyendo BEGIN; no es evidencia de
latencia remota. Comparaciones locales dieron variación de ruido, sin ahorro de wall demostrado.

Suites completas: 1,848 por controlador, sin fallos/errores/omitidas; Workers 9+4+1; pruebas de
pausa de presupuesto 4/4. Las nuevas regresiones comprueban parámetros vacíos y escapado de
comillas, barras y Unicode con standard_conforming_strings vivo ON/OFF antes de inicializar el
dialecto. Las matrices existentes mantienen equivalencia y rechazo de deriva. Se conserva CPU y
pausa de tareas de #223; sólo se elimina la clave idéntica duplicada del gateway.

El experimento JSON del catálogo se descartó: tres pares autenticados no dieron un ahorro claro
(fase RLS 26 ms ambas; TCP 8 lecturas ambas). Reutilizar rutas FastAPI mediante copias también se
descartó por alterar dependencia/overrides entre apps. No se incorporan esos experimentos.
Aceptación y medición pública del siguiente corte siguen pendientes.

## #226: carga superada; conflicto de orden en las rutas del frontend

#226 fusionó `059ceb097cd7c285346130214308e64e9ede1199` con CI requerido verde.
Los dos primeros intentos fallaron con HTTP 500/10013 al cargar Python. La cuenta ya
mostraba Workers Paid a las 00:26 UTC del 20 de octubre, antes de esos errores;
no hay evidencia para atribuirlos únicamente al plan gratuito anterior.

El tercer intento de 39351546553 sí publicó API, tareas y gateway a las 01:43 UTC,
pero el frontend se detuvo con strict activo: el diff movía el descriptor idéntico
de `preview.kovasuite.com` entre los extremos de la lista de rutas. No se eliminó
la protección para forzar la publicación. La recuperación restauró las versiones
anteriores; el verificador estricto independiente confirmó sitio, proxy, API y DB
en `2df276612e661b2b6652f65ee9edaaec4b869a8c`. La espera de propagación del propio
job agotó su plazo durante esa recuperación; la comprobación posterior sí aprobó.

Una carga local sin activar también fue aceptada, pero contenía 49 módulos OTel
adicionales fuera del lock. No se promueve ese artefacto ni se usa como prueba de
paridad con CI. La pareja offline posterior conserva los 2,919 módulos del código
activo y cambia únicamente los cuatro archivos de aplicación de #226. Aceptación
y nueva cohorte de latencia productiva continúan pendientes.

La corrección del frontend normaliza sólo el orden de rutas dentro de las copias
del comparador real, usando descriptores completos y orden lexicográfico exacto.
No modifica los archivos enviados ni elimina duplicados o campos. Diferencias
de patrón, dominio, zona, flags, límites y variables siguen siendo visibles;
se conserva la política upstream sobre adiciones no destructivas. El parche
exige beta.18 y un único marcador conocido, y falla cerrado ante deriva.
Instalación limpia y once pruebas frontend/CLI aprobaron, incluyendo Unicode
compuesto/descompuesto, idempotencia y rechazo de versiones o marcadores distintos.
Contratos de publicación/recuperación: 40 aprobados y una prueba exclusiva de
Windows omitida en macOS. La aceptación productiva de esta corrección está pendiente.

## #227 aceptada; medición productiva posterior

#227 fusionó `7002418f63389e5220f2136cd4a1489d3201d9e0` tras CI completo verde.
El primer intento de 39356494758 recibió 504 Gateway Timeout en el PUT de Python;
recuperación y verificador independiente aprobaron. El segundo intento del mismo
job terminó con `accepted:true` a las 02:16:37 UTC del 20 de octubre (20:16:37 CDMX
del 19). API `c01bff06-5f7c-4b07-a781-1c0bc4e24d67`, gateway
`009dea74-1ee5-4f41-9b6e-ffa600625d04`, tareas
`73afbffa-f9e7-4561-bd51-b93c8e09e60b` y frontend
`4c51850d-8790-47a3-b450-cde87a19b77e`. Sitio/proxy/API/DB y SHA exacto aprobados
en una verificación independiente. No se desactivó strict ni se promovió el bundle local.

Cohorte posterior: 32 GET con cookies sintéticas no autenticadas, cuatro grupos,
directo/proxy y primera/repetición. Identidad exacta antes y después; 32/32 contratos.
Primeras sesiones directas: 6,051/250/4,364/192 ms; primera cola directa:
5,872/229/10,598/199 ms. Medianas de repetición directa: sesión 218 ms y cola
197.5 ms. El proxy, observado después del directo, tuvo todas sus muestras por debajo
de 400 ms; no es un contraste frío independiente. Los contextos ya calientes impiden
atribuir la mediana menor a la entrega. El máximo de 10.6 s mantiene abierto el problema.

Telemetría de la versión API: seis arranques, fase total instrumentada 2,183–6,442 ms,
mediana 3,409 ms. Reloj condicionado por I/O y sin CPU/wall en estos logs: no permite
atribuir todo el intervalo a PostgreSQL ni interpretar ceros como CPU nula.

QA de navegador: 40 navegaciones y doce GET privados a 1440/768/390/320 px, sin errores
JavaScript ni overflow. Login/redirecciones y 401/no-store aprobados. Refresh sin token
devolvió 401 sin cookies de autenticación; las demás escrituras y telemetría se bloquearon.
No se ejerció una sesión autenticada de negocio en producción.

El prototipo de pg8000 de un ciclo se descartó por bloqueo reproducido con NOTICE y
Bind grandes. Dos ciclos pasó 1,852 pruebas y Workers 9+4+1, pero no mejoró wall local
(mediana primera sesión 1,040→1,100 ms) y la revisión encontró adaptación anticipada
de tzinfo personalizado. Permanece aislado fuera del repositorio y no se publicó.
