# ADR-030 — Preparar una API independiente antes de mover tráfico

Estado: implementación bajo revisión; aceptación productiva pendiente.

## Problema

ADR-029 evita reemplazar una API que no cambió, pero no evita el corte cuando sí se publica el
backend. El rollout de una aplicación de Containers detiene su instancia antes de arrancar el
reemplazo. Actualizar el código del Durable Object que atiende también puede reiniciar conexiones.
Una espera más larga o dos nombres de objeto dentro de la misma aplicación no aíslan esos cambios.

## Decisión

Usar dos Workers privados, `kova-api-blue` y `kova-api-green`, cada uno con su propia aplicación,
namespace `KovaApi` y un proceso `api-0` basic. Sólo se publica el Worker que está fuera de servicio.
El gateway conserva una referencia explícita a la API que atiende; cambia esa referencia después
de preparar y verificar el reemplazo. Worker, imagen y configuración del proceso que atiende
permanecen intactos durante esa preparación. No hay balanceo aleatorio ni selección por tenant,
cookie, header o parámetro del cliente.

Se conserva la política de Containers y el SDK bloqueado que ya utiliza el proyecto. La alternativa
`durable_object` requiere otra aplicación, namespace, tamaño y reconstruir helpers del SDK; no es
necesario introducir esa migración adicional para aislar dos aplicaciones y sus controladores.

### Configuración y estado compartido

- `kova-backend` conserva sus secretos sellados, su namespace de límites, R2 y referencia a jobs.
  Un WorkerEntrypoint **privado**, `NativeSettings`, proyecta exclusivamente el allowlist existente
  al arranque del proceso nuevo. Valida SHA completo y los cuatro identificadores públicos de la
  oferta. No acepta inyección de otras variables. Los valores viajan por un service binding dentro
  de Cloudflare; no pasan por HTTP público, frontend, CLI, artefactos ni logs. Su handler HTTP es 404.
- Ambos procesos usan los mismos secretos de sesión, base y límites durables. Se mantienen rol
  runtime `kova_app`, rol privilegiado separado, guards de RLS/propiedad, cookies/CSRF y firma/modo
  de Stripe. Los namespaces de slots sólo guardan metadatos de drenado; no tablas del negocio.
- La primera preparación añade dos entrypoints privados, sin añadir, borrar o renombrar clases DO
  en los Workers existentes. Conserva imagen, SHA, identificadores públicos e Hyperdrives originales
  y publica el holder con `--containers-rollout none`. La actualización DO diferida permite que el
  proceso legado continúe durante la transición. Se exige que conserve su identidad de proceso.
- `KOVA_NATIVE_CORE_SOURCE_SHA` identifica por separado el código revisado del holder. Cambios
  posteriores en sus fuentes de configuración/límites bloquean la preparación: necesitan una
  migración de control plane explícita. No se ignoran ni se aplican al proceso activo a escondidas.

### Publicación

1. Capturar y subir el rollback original **antes** de la preparación. Después de instalar/verificar
   el holder, capturar sus versiones exactas y los slots; persistir el artefacto final antes del candidato.
2. Aplicar migraciones compatibles con la versión anterior y publicar jobs según su contrato vigente.
3. Elegir el slot opuesto (`legacy → green`, luego alternar green/blue). Para reutilizarlo, habilitar
   sólo su sonda fija y exigir cinco minutos desde su última solicitud y cero respuestas abiertas.
   El lease se persiste antes de despachar y una respuesta streaming se cuenta hasta cierre/cancelación.
   La inspección funciona aunque una imagen de un intento previo no haya arrancado. No mata solicitudes
   para avanzar: si no puede demostrar el drenado dentro del presupuesto, conserva la API que atiende.
4. Construir/publicar exclusivamente la imagen y Worker del slot elegido. Una ausencia de aplicación
   sólo es válida en un slot inactivo; namespace, cuenta, repositorio de imagen y recursos se verifican.
5. `/health/candidate` comprueba SHA, identidad de arranque, proceso, base accesible y oferta comercial
   completa contra la revisión aprobada. `/health/candidate/drain` sólo inspecciona el lease. Son GET
   fijos sin query; no transmiten cookies, autorización, body ni un path/slot elegido por el caller.
   Los fallos son 503 privados y no se vuelven salud exitosa. No hay endpoint genérico de proxy/admin.
6. Comprobar que la API anterior conserva su SHA y el **mismo proceso**. Promover únicamente el gateway.
   La aceptación directa y por proxy exige el proceso exacto que se preparó, además del SHA/boot:
   una repetición del mismo commit en el otro slot no puede aprobar conservando el proceso anterior.
7. Mantener las verificaciones completas de sitio, base, oferta y los 25 contratos nativos. ADR-029
   sigue conservando la API para los cambios exclusivos de frontend que su allowlist admita.

### Recuperación

El artefacto añade `cloudflareNativeSlots`: slot activo, SHA/proceso, versión de cada Worker,
namespace/aplicación/imagen y fuente del holder. Se valida su coherencia con `releaseSha` antes
de cualquier mutación. La recuperación comprueba que el slot anterior sigue siendo exactamente
el capturado y lo prepara mediante la sonda privada antes de restaurar el gateway a su versión
original. Si el proceso estaba apagado, comprueba su nueva identidad antes de enviarle tráfico.
No republica el controlador ni cambia
la imagen de esa API. El intento fallido queda aislado y puede terminar las respuestas enviadas
antes del cambio de ruta. Jobs y frontend conservan la recuperación correspondiente a su fase.

Artefactos históricos siguen usando su ruta de recuperación. Si la configuración de la aplicación
ya coincide con su captura, la recuperación no inicia otro rollout innecesario. No se baja la base,
no se repiten escrituras ni se borran namespaces o datos para recuperar una publicación.

### Recursos y legado

Cada slot permite un basic: 1/4 vCPU, 1 GiB y 4 GB. El proceso activo permanece residente. El
inactivo conserva una ventana de treinta minutos para recuperación y después se apaga si no
tiene respuestas pendientes y el gateway confirma que está fuera de servicio. Las sondas de
preparación renuevan esa ventana; una solicitud real cancela el apagado. La recuperación lo
prepara antes de cambiar la ruta. Se usa el scheduler del SDK sin sustituir su alarm.

Si una copia adicional estuviera encendida durante 720 horas, su memoria/disco incrementarían
aproximadamente USD 7.20576 antes de CPU, Workers/DO, egreso e impuestos; el gasto real depende de
las horas de transición y las franquicias compartidas. No es un techo de gasto.
Se mantienen los pools por proceso: runtime 3 sin overflow; privilegiado 2 + 2 de overflow. El máximo
declarado es 14 conexiones para ambos slots, además de jobs y la transición legada; no se aumenta
ningún pool ni se omiten los controles de conexión/RLS.

La instancia legada se conserva para la primera recuperación. Tras adoptar el código nuevo
(la deferral inicial permite hasta 24 horas), su hook comprueba el slot activo mediante RPC privado
del gateway y concede treinta minutos adicionales antes de pararla. Si la ruta sigue siendo legada,
es desconocida o no se puede comprobar, permanece disponible. Una solicitud real de retorno cancela
la retirada. El namespace de límites y el entrypoint de configuración siguen funcionando sin Linux.

## Validación requerida

- Contratos existentes y pruebas nuevas de HTTP real: escritura durante arranque, candidato fallido,
  recuperación sin reinicio, streaming/drenado persistente y rechazo de identidades ajenas.
- RPC real en workerd: configuración accesible por binding privado; todos los paths HTTP devuelven 404.
- Comparador real del CLI: sólo se admite la transición capturada, manteniendo flags, roles, recursos,
  límites y bindings ajenos bajo sus comprobaciones estrictas. No se usa bypass de despliegue.
- CI completo antes de merge. Aceptación productiva de la primera migración, del siguiente cambio
  al otro slot y de una recuperación caliente, con observación de API/proxy/base e identidades.
  Una muestra sin errores no constituye una garantía global de disponibilidad ni valida futuras DDL.

Fuentes oficiales: [rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/),
[actualizaciones DO](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/),
[service bindings RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/),
[precios](https://developers.cloudflare.com/containers/platform/pricing/) y
[recursos](https://developers.cloudflare.com/containers/platform/limits/).
