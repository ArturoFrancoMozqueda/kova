# ADR-028: Cerrar explícitamente cada conexión HTTP privada al contenedor

## Evidencia e interpretación

Decisión del 9 de noviembre de 2026. Además del corte de sustitución de imagen, la observación de
producción detectó 503 breves fuera de un release. Cloudflare registra `phase: forwarded`; la
solicitud ya pasó la comprobación de arranque y no debe repetirse automáticamente.

Sobre `4a4f871d4049`, sin otro despliegue y con la misma identidad de proceso, sesenta lecturas
por API/proxy a intervalos de tres segundos no fallaron. Al pasar a cinco segundos reaparecieron
503 de unos trescientos milisegundos; otra ventana de cinco segundos repitió el patrón. El servidor
Uvicorn usa su keep-alive predeterminado de cinco segundos. Esta coincidencia apoya la hipótesis
de reutilización de un socket privado al cerrarse por inactividad; no prueba por sí sola la causa
exclusiva del transporte de Cloudflare ni explica la incidencia histórica de Supabase.

## Decisión

El wrapper que sólo se instala en el entrypoint nativo añade `Connection: close` a las respuestas
HTTP/1.0 y HTTP/1.1. Sustituye valores `Connection` y `Keep-Alive` del proceso para que Uvicorn
anuncie el cierre antes de terminar la respuesta. Así el proxy no debe retener ese socket como
una conexión reutilizable después del período de inactividad. No se cambia el timeout para
desplazar la misma carrera a otro intervalo.

El controlador elimina ambos encabezados antes de responder al gateway: el cierre pertenece
únicamente al salto privado. Los encabezados de identidad, los `Set-Cookie` separados, el cuerpo,
estado y streaming se conservan. WebSocket, lifespan y versiones HTTP diferentes no reciben esta
política de HTTP/1. No se repite ninguna solicitud enviada, ni siquiera una lectura, y no se cambian
sesiones, límites, base, RLS o permisos. El coste esperado es un nuevo establecimiento de conexión
privada por respuesta; la observación posterior debe medir errores y latencia.

## Validación y límites

Dos regresiones con Uvicorn/H11 y TCP reales fallan antes del ajuste y pasan después. Comprueban
GET y POST, EOF de la conexión después de una sola respuesta, cuerpo y cookies conservados y un
solo procesamiento del payload. Otras regresiones verifican protocolos ajenos y que el controlador
no exporte los encabezados privados al cliente público. Los checks nativos existentes permanecen.

La prueba local demuestra el comportamiento de cierre del origen; la hipótesis del proveedor
requiere repetir la misma observación a tres, cinco y siete segundos en el release publicado.
Esto no garantiza que nunca fallen conexiones externas ni resuelve por sí solo el reemplazo de
una única instancia. El orden de controlador/imagen se trata por separado en ADR-027.

Fuentes: [timeouts de Uvicorn](https://github.com/Kludex/uvicorn/blob/main/docs/settings.md)
y [comportamiento de conexiones y respuestas](https://github.com/Kludex/uvicorn/blob/main/docs/server-behavior.md).
