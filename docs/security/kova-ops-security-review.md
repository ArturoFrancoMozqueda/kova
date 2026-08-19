# Kova Ops — revisión de seguridad

Fecha: 2026-08-19
Alcance: `/api/v1/internal/ops/*`, `/internal/ops/*`, conectores y acceso a datos cross-tenant.

## Resultado ejecutivo

La revisión encontró un bloqueador de producción que las fixtures ocultaban: Ops
intentaba autenticar y agregar datos con la conexión `kova_app`, sometida a RLS.
La solución usa ahora exclusivamente la conexión privilegiada sancionada y mantiene
la autorización founder-only como dependencia global del router.

El acceso queda ligado a dos atributos de base de datos: un único email verificado
y el UUID inmutable del usuario. Los roles tenant nunca conceden acceso. Esto evita
que una cuenta recreada con el mismo email herede privilegios.

## Controles implementados

- Autenticación cookie firmada, sesión existente, vigente y no revocada.
- Integridad entre claims `sub`/`tid` y la sesión persistida.
- Usuario activo, email verificado, email exacto y UUID exacto.
- TOTP obligatorio con step-up por sesión, ventana configurable y rechazo de replay.
- Enrolamiento protegido por contraseña actual y diez códigos de recuperación de un solo uso.
- Bootstrap protegido por una clave de enrolamiento separada y entregada fuera de banda.
- Semilla TOTP derivada de una raíz exclusiva de servidor; no se almacena en Postgres.
- Configuración no-local fail-closed: exactamente un email + un UUID, o módulo deshabilitado.
- Guard router-wide para impedir que una ruta futura olvide autorización.
- Lecturas cross-tenant solo por `get_privileged_db`; ninguna ruta Ops usa `get_db`.
- Respuestas sensibles con `Cache-Control: private, no-store` y `Pragma: no-cache`.
- Mutaciones con double-submit CSRF y verificación adicional de Origin Kova.
- Links de Sentry reconstruidos en backend y allowlist HTTPS defensiva en React.
- Queries ORM parametrizadas, hosts de conectores fijos y texto renderizado sin HTML crudo.

## Riesgo residual y gate de producción

MFA TOTP reduce el riesgo de contraseña o sesión antigua comprometida, pero no
protege un dispositivo donde el atacante controle simultáneamente la sesión y la
app autenticadora. Antes de producción se recomienda usar una cuenta dedicada,
guardar los códigos de recuperación fuera de Kova y considerar un proxy de
identidad con factor hardware como defensa adicional.

`INTERNAL_OPS_MFA_ROOT_KEY` debe generarse aleatoriamente, guardarse como secreto
de Fly y respaldarse. Su rotación cambia la semilla TOTP derivada y exige un
procedimiento explícito de recuperación y nuevo enrolamiento.
La raíz, la clave de enrolamiento y `SECRET_KEY` deben ser valores distintos;
el arranque falla si se reutiliza alguno.

La ruta y su bundle son descubribles aunque tengan `noindex`; esto no expone datos,
porque el backend es la única frontera de autorización. Los tokens de conectores
permanecen exclusivamente en servidor.
