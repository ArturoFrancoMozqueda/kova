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
- Configuración no-local fail-closed: exactamente un email + un UUID, o módulo deshabilitado.
- Guard router-wide para impedir que una ruta futura olvide autorización.
- Lecturas cross-tenant solo por `get_privileged_db`; ninguna ruta Ops usa `get_db`.
- Respuestas sensibles con `Cache-Control: private, no-store` y `Pragma: no-cache`.
- Mutaciones con double-submit CSRF y verificación adicional de Origin Kova.
- Links de Sentry reconstruidos en backend y allowlist HTTPS defensiva en React.
- Queries ORM parametrizadas, hosts de conectores fijos y texto renderizado sin HTML crudo.

## Riesgo residual y gate de producción

No es posible garantizar literalmente “solo el dueño” si el correo, dispositivo o
sesión del dueño es comprometido. Kova no cuenta hoy con step-up/MFA propio para
este módulo. Antes de producción se recomienda exigir MFA en la identidad del
fundador o colocar `/internal/ops` detrás de un identity-aware proxy; revocar las
sesiones existentes al activar el módulo y usar una cuenta dedicada.

La ruta y su bundle son descubribles aunque tengan `noindex`; esto no expone datos,
porque el backend es la única frontera de autorización. Los tokens de conectores
permanecen exclusivamente en servidor.
