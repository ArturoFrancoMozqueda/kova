# Segunda evaluación real: acceso y configuración — 2026-10-08

Equipo de acceso, configuración y permisos. Base publicada: `fb47b342489c0a32aad34bee0ad53c5538fcc4f2`.
Se revisó la auditoría anterior para evitar repetir arreglos de PR #183.
Estos cambios requieren integración y publicación del equipo coordinador.

## Navegación en la aplicación real

- Un login válido en `https://kovasuite.com`, seguido de perfil, recibo, empleados,
  sucursales, ajustes avanzados, suscripción e integraciones. Sesión de este navegador
  cerrada mediante el botón normal de logout al terminar; no logout global.
- Revisión a 1440, 720 y 390 px. 720 px reproduce el reflujo de un escritorio de
  1440 px al 200%; no se afirma haber accionado zoom nativo de un dispositivo.
  No se observó desbordamiento horizontal en las páginas examinadas.
- Diálogo real de soporte: foco entra, Tab y Shift+Tab permanecen dentro, Escape
  devuelve el foco al botón inicial y el contenido bloquea el scroll del fondo.
  Se usó `prefers-reduced-motion: reduce`.
- Ajustes avanzados y signup móvil: axe WCAG A/AA sin infracciones.
  Login público muestra título correcto y no desborda. Signup se abrió sin enviarlo.
- Sin errores JavaScript observados. No se guardaron perfiles, recibos, sucursales,
  empleados, conexiones, invitaciones, consentimientos ni operaciones comerciales
  en producción. No se inició Checkout, cancelación, borrado, exportación ni correo.
  No se guardaron contraseñas, cookies, auth state, trazas o datos personales.

## Defectos reproducidos y corregidos

| Defecto | Evidencia | Implementación |
| --- | --- | --- |
| GET de perfil o recibo fallido habilitaba guardar valores iniciales | Producción: se abortó únicamente GET perfil en el navegador; apareció contacto vacío, guardar habilitado y ningún aviso. Sin escrituras. Regresiones de ambos recursos fallaban antes. | Se exige carga completa; error anunciado y reintento explícito. No se monta formulario editable con defaults tras una lectura fallida. |
| Configuración del gerente dependía de datos de empleados exclusivos del propietario | Contratos backend: gerente tiene `SETTINGS_MANAGE`, no `USERS_MANAGE`; la carga pedía empleados e invitaciones incondicionalmente. Regresión fallaba al recibir 403. | Sólo propietario pide empleados/invitaciones y ve su pestaña. Gerente conserva perfil, recibo y panel fiscal cuando esté habilitado. No se ampliaron permisos backend. |
| Invitación enviada varias veces mientras la primera seguía pendiente | Dos submits consecutivos invocaban dos POST. Backend revoca enlace pendiente anterior al invitar otra vez; no es idempotente. | Lock inmediato y controles deshabilitados durante guardado/invitación/reenvío. Error conserva el borrador. |
| Confirmación fallida cerraba el diálogo y escapaba como rechazo sin manejar | Regresión de cambio de rol fallaba y Vitest reportaba unhandled rejection. | Captura el rechazo, explica el error y conserva confirmación/rol para reintentar; lock impide duplicar confirmaciones. |
| Respuesta tardía de otro negocio sobrescribía el formulario actual | Dos regresiones fallaban sobre la base publicada: GET del negocio anterior y guardado antiguo que iniciaba su loader tras cambiar sesión. | Generación de solicitudes, invalidación al cambiar alcance/desmontar y comprobación de negocio cargado antes de habilitar escritura. El loader antiguo no reinicia carga en otro negocio. |

Se preservan endpoints y payloads, facturación, permisos del servidor, cookies y RLS.
No se modificaron migraciones, fixtures ni expectativas existentes para ocultar fallos.

## API y navegador con datos reales aislados

Base desechable `kova_access_v2`, PostgreSQL local 55432. FastAPI local 58005 y
frontend 5195. Runtime `kova_app`: superuser=false y bypassrls=false;
inicio del servidor verificó RLS de las 60 tablas runtime.

- Cuenta gerente sintética: navegó y guardó perfil y papel de recibo 58 mm;
  relectura API confirmó persistencia. Cero solicitudes a empleados/invitaciones.
- Al abortar GET perfil local, formulario desaparece, error se anuncia y reintento
  recupera exactamente la configuración persistida; no se realiza escritura.
- Axe del recibo corregido: cero infracciones. Navegadores y dos servidores propios
  detenidos al finalizar; el cluster compartido quedó disponible para el coordinador.
- Prueba API parametrizada: gerente GET/PUT perfil y recibo permitidos; cajero
  GET permitido y PUT403. Para ambos, empleados, invitaciones y suscripción403.
  Verifica autorización del backend, sin depender de controles frontend.

## Validación y reproducción

- 141 tests frontend aprobados en 21 archivos: settings, auth, billing, Dialog
  y BranchesSettings. Incluyen siete regresiones nuevas de recuperación/concurrencia.
- 19 tests backend aprobados: dos contratos de rol nuevos y 17 escenarios del
  módulo de empleados existentes. Ruff del archivo nuevo aprobado.
- Cuatro Playwright de configuración aprobados: logo, invitación/roles,
  móvil y ciclo de datos/borrado en entorno simulado. La dependencia compartida
  por symlink produce advertencias locales de fuentes fuera de allowlist Vite;
  no se alteró la política de archivos para ocultarlas ni se atribuyeron a producción.
- TypeScript, ESLint sin warnings y `git diff --check` aprobados.
- Evidencia red previa: cinco regresiones originales fallaban; las dos de cambio
  de negocio también fallaban al ejecutar la implementación de la base publicada.

Comandos focales desde `frontend`, con Node 24/npm disponibles:

```sh
npm test -- --run src/settings src/billing src/auth src/components/ui/dialog.test.tsx src/branches/BranchesSettings.test.tsx
node node_modules/@playwright/test/cli.js test e2e/settings.spec.ts --config playwright.mocked.config.ts --project=e2e-dev-chromium
npm run typecheck
npm run lint
```

Backend con URLs locales exclusivas y `APP_ENV=local`:

```sh
pytest app/tests/test_settings_role_contract.py app/tests/test_employee_rbac.py -q
ruff check app/tests/test_settings_role_contract.py
```

Archivos: `frontend/src/settings/SettingsView.tsx`, su nuevo
`SettingsView.recovery.test.tsx`, `backend/app/tests/test_settings_role_contract.py`
y esta evidencia. No se cambió backend productivo.

### Revisión adicional antes de integrar

Se comprobaron cuatro casos pendientes adicionales con promesas controladas;
los cuatro fallaban antes del segundo arreglo y pasan después:

- Upload o borrado de logo que terminaba después de desmontar el campo por
  cambio de negocio/ruta seguía actualizando logo de sesión y recibo del padre.
- Una relectura de recibo iniciada tras borrar el logo también aplicaba su resultado
  después de desmontar. Ahora toda continuación comprueba el ciclo de vida; tampoco
  inicia un upload si el campo desapareció durante preparación de imagen.
- Una confirmación de empleado persistía al cambiar de negocio y su petición vieja
  podía cerrar la nueva confirmación. Se limpia al cambiar alcance y se ignoran
  resultados/error/finalización de la confirmación del alcance anterior.

No se confirmó el supuesto setter de `submitReceipt`: su respuesta sólo actualiza
el caché de ancho del negocio capturado; su loader ya está protegido por alcance.
El fallo demostrado del setter corresponde al campo de logo.

Validación adicional: 24 pruebas settings aprobadas (once regresiones nuevas en
total entre ambos commits), TypeScript y ESLint sin warnings. No se reabrió sesión
productiva ni se repitieron las suites backend/E2E previamente aprobadas.

## Límites

Sin mutaciones productivas, correos, contraseña/roles/conexiones o pagos live.
Sin lector de pantalla físico, Safari/iOS, terminales ni impresoras reales.
No se certifican escenarios ilimitados ni se afirma que todas las oportunidades
de mejora sean defectos. El coordinador debe integrar, validar el conjunto y
comprobar la versión publicada antes de presentar estas correcciones como live.
