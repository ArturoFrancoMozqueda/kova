# ADR-035: consultas locales en la API nativa

Estado: aceptada para lecturas deterministas; aceptación autenticada pendiente del release.
Fecha: 2026-11-13.

## Contexto

La API nativa guarda trabajos de consulta y despierta un Durable Object de Python. Las pruebas
autenticadas de ventas y guías públicas vencieron sin inferencia. Los logs muestran que el puente
privado supera sus dos segundos y que la verificación RLS del worker termina después. Adelantar
alarmas y retirar la inicialización del método de despertar no resolvió el vencimiento en la cuenta.
La aceptación local con procesos calientes no certificaba este arranque de Python en Cloudflare.

## Decisión

Las preguntas completas reconocidas por `direct.match` intentan ejecutar el trabajo ya confirmado
en la misma petición de la API nativa. Reutilizan `worker.process_job`, sus locks, cupos, sesión,
consentimiento, autorización comercial y guardas de finalización. No se invoca inferencia ni se
reserva presupuesto de modelo. Si no se consigue el cupo, se conserva la cola y su despertar normal.

No se crean trabajos alternativos. Un replay idempotente recupera el trabajo original antes de
intentar procesarlo otra vez. La respuesta conserva el contrato de recurso existente y HTTP 202;
su estado puede ser terminal desde esa primera respuesta.

Las preguntas abiertas, documentos y mantenimientos conservan el worker privado. Su pausa operativa
sigue deteniendo las ejecuciones programadas y alarmas; las lecturas locales pasan a ser trabajo
de la API y mantienen los límites de turnos y concurrencia del asistente. No se cambia proveedor,
consentimiento ni verificación de inferencia mediante este cambio.

## Consecuencias y verificación

Una lectura local ocupa la petición durante su ejecución, dentro del plazo interactivo existente.
Se elimina la dependencia del arranque del worker para responder esas preguntas. No se declara
resuelto el rendimiento de las consultas abiertas ni se habilita el proveedor externo por ello.

Las pruebas verifican una venta real, respuesta e historial, replay sin duplicados, rechazo de una
clave reutilizada para otra pregunta, cupo lleno y permanencia de la inferencia en el worker.
La aceptación en la cuenta debe contrastar la respuesta con Análisis después del release y registrar
sus fallos sin reenviar consultas automáticamente ni liberar reservas inciertas.
