# ADR-023: Actualizar el controlador residente antes del rollout de imagen

## Estado

Decisión del 9 de noviembre de 2026. Complementa ADR-022: conserva sus controles de imagen,
marcador de arranque, catálogo y recuperación. La aceptación productiva se registra por separado;
las pruebas locales no acreditan por sí solas continuidad de tráfico.

## Problema y decisión

Cloudflare cambió el comportamiento predeterminado el 30 de octubre: un Durable Object activo
puede conservar su código anterior hasta 300 segundos. Nuestro controlador residente evita
hibernar, pero el rollout de su imagen avanza de manera independiente. La imagen nueva puede
recibir por tanto el marcador y la configuración del controlador anterior y rechazar el arranque.
Es compatible con los errores de identidad y el incidente reportado el 8 de noviembre.

Se fija `code_update_strategy: { mode: "immediate" }` en el metadata del Worker nativo. La
configuración tipada instalada lo transporta mediante `unsafe.metadata`; una prueba comprueba
el campo en el formulario multipart que construye el CLI instalado, no sólo en el archivo fuente.
No se modifican credenciales, namespace, número de instancias ni validaciones del backend.

La recuperación envía también esta estrategia al crear el deployment del controlador capturado,
antes de restaurar su imagen. El campo es de escritura y pertenece a cada deployment: recuperar
un Version ID por sí solo no recupera esa política. Jobs y gateway conservan su publicación actual.

## Pruebas y límites

- Configuración, metadata real del CLI y orden de recuperación antes de tocar imágenes.
- Controles existentes de arranque, identidad, cabeceras, concurrencia y ausencia de reenvío de escrituras.
- En el release se observarán estado HTTP e identidad desde fuera, incluyendo la fase de publicación.

La actualización inmediata puede reiniciar una invocación en curso. Se conserva la recuperación
acotada de lecturas y nunca se repiten escrituras desde el gateway. Esta decisión elimina la
espera diferida de cinco minutos; no promete por sí sola cero latencia o cero errores durante
todo reinicio. La misma instancia aún debe detener su proceso y arrancar la imagen nueva.

## Fuentes

- [Actualizaciones de código de Durable Objects](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/).
- [Cambio del 30 de octubre](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/).
- [Rollouts de Containers](https://developers.cloudflare.com/containers/configuration/rollouts/).
