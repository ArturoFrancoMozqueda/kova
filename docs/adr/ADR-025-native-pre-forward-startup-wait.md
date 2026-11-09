# ADR-025: Esperar el reinicio antes de enviar una solicitud al backend

## Estado y evidencia

Decisión del 9 de noviembre de 2026. Complementa [ADR-024](ADR-024-bounded-native-image-handoff.md).
El [release 42686091608](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42686091608)
publicó `856cd4461d3e0b71f4bc7278a3a9f778bfdc5fdf` con aceptación final aprobada. La baseline
anterior continuó respondiendo durante la preparación de imagen. Quedaron cuatro muestras 503
por API/proxy entre 19:58:44 y 19:58:50 UTC, seguidas por dos vencimientos del cliente de ocho
segundos. La primera solicitud 200 empezó a las 19:59:08 y tardó 7,4 segundos. Esa observación
demuestra una interrupción residual; no se declara continuidad solo porque aprobó el release.

## Decisión

Durante la concesión de despliegue ya validada, las solicitudes comparten una espera previa al
envío cuando el controlador reconoce un proceso anterior drenando, una reconfiguración pendiente,
un cambio de arranque o un fallo de inicio del SDK. El presupuesto de reintentos es de hasta
treinta segundos, limitado también por el vencimiento original de la concesión. Las llamadas
concurrentes comparten el mismo presupuesto: una solicitud nueva no lo renueva. Los límites
existentes de provisión y puertos del SDK permanecen iguales.

Esta espera ocurre **antes** de `super.fetch()`: ningún payload de negocio fue enviado todavía.
Después de comprobar imagen y marcador de arranque se envía cada solicitud exactamente una vez.
No se reintenta una escritura enviada ni una respuesta de error de la aplicación. Un fallo de
transporte posterior al envío conserva su 503 privado y las reglas de idempotencia del producto.

El proceso anterior no saludable no recibe tráfico por disponer de una concesión. Tiene que
terminar su reemplazo y superar los mismos controles. Imágenes desconocidas y estados de salud
malformados conservan el fallo cerrado; no se convierten en readiness. Fuera de la concesión no
se activa esta espera. `ready()` y la aceptación del release mantienen su contrato estricto.

## Pruebas y límites

- Parada e inicio controlados, con solicitudes concurrentes y un único envío por escritura.
- Imagen anterior drenando sin tráfico hasta su reemplazo verificado.
- Inicio del SDK pendiente que se recupera antes de enviar el primer payload.
- Concesión/presupuesto vencidos sin prolongación, reinicios repetidos ni tráfico.
- Imagen ajena rechazada y transporte fallido después del envío sin repetición, aun con concesión.

Los fixtures de denegación usan presupuesto agotado para verificar su respuesta 503 sin esperar
tiempo real; las nuevas pruebas usan reloj y espera controlables para verificar los límites.
Los resultados esperados de seguridad e idempotencia no se suavizan.

La validación productiva de esta espera sigue pendiente de su propio despliegue. Una sola
instancia puede tardar en arrancar o fallar; una solicitud en curso todavía puede interrumpirse.
No se promete disponibilidad absoluta ni recuperación sin interrupción.
