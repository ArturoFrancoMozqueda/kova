# ADR-024: Convivencia acotada de la imagen anterior durante el despliegue

## Estado y motivo

Decisión del 9 de noviembre de 2026. Sustituye la expectativa de continuidad de
[ADR-023](ADR-023-resident-controller-update-strategy.md); conserva la actualización inmediata,
la verificación de arranque de [ADR-022](ADR-022-native-controller-boot-policy.md) y la recuperación.

El [release 42677244109](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42677244109)
publicó `4a24cf988dc8bf122801aa8cfd435821e40c77c2` y aprobó la aceptación final. La observación
externa detectó, sin embargo, 503 en API y proxy desde 19:03:25 UTC, con primera recuperación
200 a las 19:06:57 UTC. El controlador nuevo rechazaba la imagen anterior mientras el rollout
independiente de Cloudflare aún no la reemplazaba. Actualizar el controlador inmediatamente no
elimina esa ventana. No se presenta este release como prueba de continuidad.

## Decisión

El release genera una concesión pública e inmutable de treinta minutos como máximo, con el SHA
anterior capturado y un vencimiento absoluto. La transporta como binding de texto versionado
`KOVA_NATIVE_HANDOFF`, sin añadir secretos, endpoints públicos ni flags comerciales.

El controlador admite temporalmente tráfico hacia el proceso anterior únicamente si:

- Ya estaba en ejecución y saludable antes de comprobarlo; no requiere nuevas pruebas de puerto.
- `/health` declara exactamente el SHA anterior capturado y su marcador de arranque coincide
  con **esa misma imagen**. Marcadores ausentes, ajenos o malformados siguen bloqueados.
- El proceso no se detuvo ni cambió de generación durante la comprobación.
- La concesión sigue vigente y nunca excede el límite original. No se renueva por solicitud.

Ese proceso conserva su configuración de arranque anterior; no se le inyecta la nueva política.
La excepción no se almacena en el caché de readiness: cada lote concurrente vuelve a comprobarla.
No se cambia su SHA, marcador o respuesta de salud, ni se reproduce una escritura fallida.

El proceso nuevo mantiene la obligación de arrancar con su propio controlador. Un proceso frío,
no saludable o con imagen desconocida sigue fallando cerrado. `ready()` y la aceptación del release
exigen siempre la imagen nueva, su marcador nuevo y la base accesible. La baseline anterior nunca
cuenta como publicación aceptada. La recuperación conserva sus versiones e imagen exactas.

El comparador del CLI permite exclusivamente esta transición capturada y validada; conserva la
comparación estricta de credenciales, recursos, flags, otros bindings y nombre del Worker. Una
colisión con un binding sellado bloquea antes de migraciones o publicación. Las migraciones siguen
teniendo que ser compatibles con la versión anterior.

## Validación y límites

Pruebas de convivencia con escritura única, respuesta de salud fiel, política anterior intacta,
transición a imagen nueva, vencimiento, parada concurrente, arranque frío, identidad inválida,
binding sellado y comparador real del CLI instalado. El fixture de recuperación independiente
debe seguir importando sin dependencias de publicación.

La aceptación externa de este cambio sigue pendiente hasta observar su propio despliegue. Una
sola instancia puede aún esperar durante el arranque o sufrir fallas del proveedor. No se garantiza
cero fallas en todas las publicaciones ni continuidad de una recuperación de emergencia; para
esa garantía se necesitarían instancias de reemplazo preparadas antes del cambio de tráfico.

## Fuentes

- [Orden y límites de rollouts de Containers](https://developers.cloudflare.com/containers/configuration/rollouts/).
- [Estrategia de actualización de Durable Objects](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/).
