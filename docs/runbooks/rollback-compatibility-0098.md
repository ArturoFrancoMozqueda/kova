# Puente de reversión para las migraciones 0096–0098

El puente es la rama `feature/kova-rollback-compatibility` / PR #281 y se publica **antes** de
activar las funciones nuevas. Su árbol Alembic termina en `0095_customer_order_customer`: no
incorpora migraciones, altas públicas ni canjes de recompensa. Esta entrega completa / PR #282
integra ese puente, termina en 0098 y conserva las funciones nuevas y la restitución de puntos.
Preparación local no equivale a publicación o aceptación productiva.

1. Publicar el puente con aprobación explícita, `CI required` del SHA exacto y captura habitual
   de versiones Cloudflare/Container/Vercel. Verificar frontend, backend, proxy y DB del mismo SHA;
   la revisión productiva de esquema sigue siendo 0095. Registrar esta versión como base compatible.
2. Integrar después la entrega completa. Su release aplica 0096–0098 y debe capturar el puente
   aceptado como estado anterior. No habilitar las escrituras nuevas antes de tener ese punto de
   recuperación comprobado. Las reglas, recompensas y altas siguen requiriendo decisión del dueño.
3. Si falla la entrega completa, usar únicamente la recuperación del artefacto capturado. Restaura
   las versiones de aplicación, **sin downgrade de la base**. El puente no puede ejecutar
   `alembic upgrade head` sobre una revisión 0098 que no figura en su árbol; no se debe volver a
   publicar la rama vieja mediante el release ordinario para simular un rollback.

Durante esa recuperación el puente lee solicitudes `accepted` y movimientos `reward_return`,
exporta los campos públicos nuevos y purga su grafo conocido sin divulgar hashes de credenciales.
Desconocer cualquier otra tabla de tenant sigue bloqueando la purga. La reprovisión conserva
SELECT/INSERT de las cuatro tablas append-only futuras cuando existen; no concede UPDATE/DELETE.
Las consultas mantienen tenant/sucursal y RLS.

Durante la recuperación al puente, las devoluciones/anulaciones de ventas con recompensa
devuelven **409 antes de efectos nuevos**: ese backend no puede restituir sus puntos. El replay
financiero ya registrado sigue devolviendo su resultado original. Las ventas ordinarias conservan su operación. Para procesar una reversa de
recompensa debe restablecerse la versión completa compatible; no se deben corregir puntos a mano.
Las APIs públicas nuevas de tarjeta/seguimiento no existen en el puente y devuelven 404. Es una
indisponibilidad temporal explícita, no borrado de miembros, saldos o solicitudes.

En la entrega completa, las devoluciones/anulaciones conservan `lock_reward_reversal` y
`return_reward`: restituyen los puntos realmente gastados una sola vez, con replay idempotente.
El helper 409 del puente queda cubierto como contrato de recuperación y no se invoca desde las
rutas financieras completas. El exportador completo ya incluye las cuatro tablas y tres columnas
CRM: no duplicarlas al combinar su allowlist con la proyección condicional del puente.

Evidencia requerida: regresión sobre 0095; lecturas accepted/reward_return, reversas sin efectos,
replay, exportación y purga sobre las migraciones 0096–0098 reales en una base local aislada; scope
SQL/RLS, permisos append-only y carrera del bloqueo de venta. En la rama puente las fixtures de
proyección de `backend/app/tests/test_rollback_compatibility.py` prueban el contrato futuro en CI
sin publicar esas migraciones. En la entrega completa estas pruebas reutilizan el esquema 0098
real y verifican por separado el helper legacy 409 y las APIs financieras completas 201 con canje
real, devolución del importe
pagado y restitución única de puntos. También comprueban que el ZIP y sus columnas no se dupliquen.
La evidencia de la rama puente sobre Alembic real se registra por separado con su alcance y resultado.

La aceptación de Stripe live, entrega de correo, recuperación completa del servicio y dispositivos
sigue su [gate operativo](ops-beta-gate.md); este puente no cierra esas comprobaciones externas.
