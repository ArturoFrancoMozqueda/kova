# ADR-027: Comprobar el controlador antes de sustituir la imagen

## Evidencia

Decisión del 9 de noviembre de 2026. Complementa ADR-024–ADR-026. El
[release 42717745942](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42717745942)
terminó aceptado, pero sondas externas de treinta segundos recibieron seis respuestas 503 por
API/proxy entre 23:19:28 y 23:20:01 UTC, con latencias de hasta veinticinco segundos, y después
vencimientos. Los eventos `native_backend_unavailable` de esa ventana pertenecen a la versión
anterior del controlador, sin el nuevo campo `phase`. No se atribuye esta evidencia a Supabase ni
se considera que la aceptación final del release demuestre continuidad durante su publicación.

La configuración inmediata llega al metadato del CLI instalado, pero no había una comprobación
externa de que el objeto residente hubiera adoptado el nuevo controlador **antes** del rollout de
imagen. Esto deja sin demostrar una precondición de las esperas implementadas en ADR-025/026.

## Decisión

Publicar primero el mismo artefacto nativo con `--containers-rollout none`. El proceso anterior
conserva imagen, entorno y marcador de arranque. La concesión capturada permite que el nuevo
controlador atienda con ese proceso sano; no permite arrancar imágenes ajenas ni aceptar la
baseline como nueva versión.

Sólo `/health` añade `x-kova-controller-sha`, derivado del entorno del controlador. Es independiente
de `release_sha` y `x-kova-boot-controller-sha`, que siguen describiendo el proceso real. No confiere
permisos ni modifica la identidad de la aplicación. El controlador elimina valores entrantes y
valores del proceso para ese encabezado antes de escribir su propio valor.

Antes de cambiar la imagen, el publicador debe observar por HTTPS: estado sano, SHA y marcador
de arranque de la baseline capturada, y SHA del controlador nuevo. La espera usa sólo GET, dura
hasta cinco minutos y nunca sobrepasa la concesión original. Un encabezado ausente o del
controlador anterior permite esperar; una identidad ajena, respuesta malformada o HTTP fallido
bloquea el cambio de imagen y la publicación del gateway. La recuperación conserva el flujo y
artefacto exactos existentes.

Después de esa comprobación, se publica el mismo artefacto con rollout normal. El comparador
acepta esta repetición sólo con los mismos SHA, concesión vigente e identificadores públicos
verificados. Las diferencias de secretos, recursos, permisos y demás bindings siguen estrictas.
El release aún debe comprobar imagen nueva, su marcador nuevo, base, API y frontend.

Los fallos reconocidos del SDK posteriores al envío distinguen únicamente `sdk_start`,
`sdk_disconnected` y `sdk_proxy` en telemetría. No se conservan mensajes crudos ni se repite la
solicitud enviada. Esta distinción también permite investigar errores fuera del rollout.

## Validación y límites

Regresiones de orden de publicación, falta de adopción, vencimiento original, éxito tardío,
identidad ajena, errores HTTP y repetición exacta del comparador real. La concesión saludable
mantiene las pruebas de envío único y no relabela el proceso anterior.

Esta decisión debe medirse en su propio despliegue. No elimina la sustitución de una sola
instancia ni permite repetir escrituras enviadas. Un arranque mayor al presupuesto del cliente o
una solicitud ya en curso todavía puede interrumpirse. Si la observación vuelve a mostrar cortes,
la continuidad requerirá preparar una instancia de reemplazo antes de mover el tráfico; esta
decisión no declara esa capacidad implementada.

Fuentes: [rollouts de Containers](https://developers.cloudflare.com/containers/configuration/rollouts/)
y [actualizaciones de Durable Objects](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/).
