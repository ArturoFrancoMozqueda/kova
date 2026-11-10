# ADR-029 — Publicar frontend conservando un backend sin cambios

Estado: implementado bajo revisión; aceptación productiva pendiente.

## Problema y evidencia

El release publicaba jobs, controlador, imagen y gateway para cualquier cambio de aplicación,
incluidos cambios exclusivos del frontend. La API nativa tiene una instancia `basic`. El
[reemplazo de Containers](https://developers.cloudflare.com/containers/configuration/rollouts/)
detiene la instancia elegida antes de arrancar la nueva. La publicación de `4aeaa973044d` terminó
sana, pero produjo 503 y esperas superiores a treinta segundos. Una espera mayor no prueba
continuidad ni evita reinicios innecesarios.

## Decisión

Antes de crear un candidato, comparar el SHA propuesto con el SHA del backend que está realmente
publicado. No usar el último commit ni sólo el diff del PR: puede haber cambios de backend previos
que todavía no llegaron a producción. Se desactiva la detección de renames para conservar también
las rutas borradas. El árbol revisado debe coincidir con HEAD y no tener cambios tracked locales.

Sólo un push automático cuyo diff completo pertenezca al frontend, su Worker de assets,
Markdown documental o los archivos de CI explícitamente admitidos conserva el backend. Cambios
en `backend/`, otros `deploy/`, rutas desconocidas, historia incompleta o diff vacío mantienen
la publicación completa. Un dispatch manual también es completo. Los cambios de configuración
que deban llegar al proceso siguen requiriendo un SHA nuevo revisado según ADR-022; volver a
publicar el mismo SHA no prueba que el proceso haya recibido una configuración nueva.

Cuando se conserva el backend:

- No se ejecutan migraciones, build/rollout de Container, publicación de jobs/controlador/gateway
  ni preparación de paquetes Python/WASM de publicación. Se mantienen captura y verificación
  del backend real, sus identidades de arranque y sus bindings privados.
- El nuevo frontend se valida contra el SHA exacto del backend retenido, por acceso directo y
  proxy, con la base accesible y la misma oferta comercial revisada. No se admite cualquier SHA.
- El artefacto de rollback añade `frontendSha`. `releaseSha` sigue identificando el backend.
  Los artefactos históricos sin `frontendSha` conservan el significado anterior de SHA compartido.
  La identidad corta del frontend se resuelve sin ambigüedad en el historial completo de Git y
  se comprueba de nuevo contra el sitio antes de cualquier publicación.
- La recuperación automática sólo restaura los componentes que el intento pudo modificar.
  Un fallo del frontend recupera sus versiones exactas sin reiniciar la API retenida. La ruta
  completa sigue registrando la posible mutación del backend antes de llamar al proveedor,
  incluso si éste falla parcialmente. La recuperación manual histórica sigue siendo conservadora.

La web y el backend pueden mostrar SHAs diferentes: identifican artefactos distintos, ambos
verificados. El contrato público de `/health` conserva el SHA de la API que responde. No se
cambia auth, cookies/CSRF, RLS, gates de facturación, idempotencia offline ni secretos.

## Verificación y límites

La regresión usa historial Git y un servidor HTTP locales: publica dos revisiones de frontend
sobre un backend anterior, comprueba los seis contratos HTTP y envía una escritura una vez sin
llamar a publicación/restauración del backend. Falla contra el ejecutable anterior. También se
prueban recuperación tras fallos de frontend, identidades independientes, rutas desconocidas,
renames, fuente sucia, historia ausente y preservación de la publicación manual completa.

Esto elimina una clase de cortes evitables; **no resuelve el corte cuando cambia realmente el
backend**. La solución completa requiere arrancar y verificar un reemplazo independiente antes
de mover tráfico, conservar una recuperación exacta y drenar la versión anterior. La nueva
[política de scheduling por Durable Object](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)
permite elegir imágenes por instancia, pero es inmutable y exige una aplicación de reemplazo:
no se cambia en la aplicación productiva existente ni se presume una migración por editar un flag.

Antes de aceptar producción: CI completo aprobado; publicación de frontend con SHA nuevo y API
con SHA previo; observación de salud continua y proceso nativo sin reinicio; recuperación de
frontend ensayada con la misma API; siguiente publicación completa y recuperación desde un
artefacto con identidades separadas. La [ejecución 42748649604](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42748649604)
de la evidencia de bienvenida no arrancó por facturación/límite de gasto de GitHub. No se
sustituye el gate de CI ni se publica manualmente cuando los runners están bloqueados.
