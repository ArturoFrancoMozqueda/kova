# ADR-026: Espera acotada para fallos transitorios de la sonda de arranque

## Evidencia y alcance

Decisión del 9 de noviembre de 2026. Complementa [ADR-025](ADR-025-native-pre-forward-startup-wait.md).
El release de `96111e5d3298` terminó aceptado, pero la observación externa registró cuatro
respuestas 503 entre 21:15:43 y 21:15:49 UTC, seguidas de tres vencimientos del cliente de ocho
segundos. Cloudflare conserva quince eventos `native_backend_unavailable` en esa ventana,
sin motivo `code_update_reset`. La telemetría anterior no distingue si ocurrieron antes o después
del envío: estos datos no demuestran por sí solos una causa exclusiva.

La revisión del controlador y del SDK 0.3.7 reproduce un hueco concreto: `containerFetch()` puede
fallar, o devolver una respuesta transitoria, después de comprobar el estado del proceso. La sonda
`/health` de arranque todavía convertía ese caso inmediatamente en 503, sin usar la espera previa
al envío. Las cinco regresiones nuevas fallan con la implementación anterior.

## Decisión

Sólo dentro de la concesión original de despliegue, una excepción de transporte de la sonda de
arranque, un 502/503/504 o un 500 reconocido del SDK se consideran arranque pendiente. Usan el
mismo presupuesto compartido de treinta segundos, limitado por la concesión; no lo renuevan.
Un reset de código conserva su recuperación separada. Fuera de la concesión no hay espera nueva.

No se ha enviado el payload de negocio en esta fase. Cada escritura se envía una vez después de
verificar imagen y marcador de arranque. Un error después del envío conserva su fallo privado y
**no se repite**. Un 200 malformado, una imagen ajena, un 401 o un 500 de aplicación sin la firma
acotada del SDK no se convierten en readiness ni se reintentan por esta regla.

El evento fijo `native_backend_unavailable` incorpora `phase: readiness|forwarded` para distinguir
ambas fases sin registrar payloads, URLs, cookies, excepciones ni credenciales. Se actualizan las
tres expectativas exactas de forma de log por este contrato nuevo; los resultados de seguridad,
acceso, identidad, HTTP e idempotencia siguen iguales.

## Validación y límites

Pasaron las 71 pruebas locales de controlador, empaquetado, configuración y contratos compartidos,
incluyendo concurrencia, plazo vencido, fallos transitorios, identidad inválida y ausencia de replay.
La aceptación productiva debe medirse en su propio release. Una sola instancia y las solicitudes ya
enviadas pueden interrumpirse durante una sustitución; esta decisión no acredita despliegue sin
cortes ni disponibilidad absoluta.
