# Restauración lógica y ASGI de la revisión 0101 — 3 de noviembre de 2026

El respaldo nuevo se restauró y validó en PostgreSQL 17 desechable, sin restaurar ni escribir en
la base de producción. La revisión recuperada fue `0101_checkout_attempts`, que incluye
`0100_commercial_plans`. La API aprobó el smoke ASGI con una cuenta sintética creada únicamente
en la copia aislada.

| Evidencia | Resultado |
| --- | --- |
| Fuente de la aplicación | `88bb94056a0fc9845753d93078931a38f74e774e` (PR #308) |
| Respaldo | [Run 41706779313](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41706779313) |
| Restauración y limpieza | [Run 41707510744](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41707510744) |
| Snapshot | 2026-11-03 19:49:20 UTC; antigüedad al iniciar de 307.659 s (5 min 7.659 s) |
| Restauración del archivo | 0.630 s |
| Drill lógico y ASGI, incluida limpieza | 20.962 s; excluye construcción de imagen |
| Motor restaurado | PostgreSQL 17.11 |
| Revisión del esquema | `0101_checkout_attempts` |
| Aislamiento de tenants con el rol de runtime | Aprobado |
| Integridad de pagos y lotes | Aprobada |
| Grants de tablas a roles de Data API | 0 |
| Limpieza de ambos contenedores y archivos privados | Verificada |

El workflow verificó el tamaño, formato custom y checksum SHA-256 antes de restaurar los esquemas
`public` y `assistant_control`. Reaplicó los grants de runtime y comprobó RLS, FORCE RLS en las
tablas de tenant aplicables y un rol `kova_app` sin privilegios de superusuario ni BYPASSRLS.
Las comprobaciones de integridad existentes aprobaron; el agregado conserva una clave foránea
histórica sin validar y no acredita una validación exhaustiva de todas las relaciones.

Los seis indicadores de servicio aprobaron: salud de API, conexión a la base, login con cookies
seguras, exportación del tenant restaurado, logout y RLS con el rol de runtime. El probe también
rechazó identidad de tenant ajena y logout sin CSRF. La exportación de datos existentes coincidió
con conteos SQL independientes; ni el archivo exportado ni sus registros se publican.

La imagen se **reconstruyó desde la misma fuente** `88bb94056a0f` publicada, usando
`backend/Dockerfile.api`. El helper comprobó que sus dos identidades de imagen correspondieran al
SHA del workflow. Esto no demuestra igualdad de digest con la imagen que corre en Cloudflare.
La base no tuvo red externa; la API compartió únicamente su namespace de loopback, sin listener
HTTP público. Los contenedores tuvieron filesystem de solo lectura y datos temporales en RAM.

El artifact original `kova-r2-restore-88bb94056a0fc9845753d93078931a38f74e774e` contiene el JSON
agregado de aceptación y tiene retención de siete días. Este documento conserva su resultado
público reducido: omite la ubicación del objeto de respaldo, checksum, identidades y datos de
clientes. Los tiempos y comprobaciones describen este drill, no métricas de adopción comercial.

El resultado acredita recuperación lógica y lectura por la aplicación con un snapshot que ya
estaba en 0101. No prueba migrar un respaldo 0099 a 0101, resolver intentos de Checkout recuperados,
recuperar esquemas administrados de Supabase, bindings de producción, facturación/correo externos,
reposición de fotos, cambio de tráfico ni recuperación regional. La antigüedad del snapshot y la
duración aislada no equivalen a RPO/RTO regionales.
