# Plan de pruebas locales — Dashboard interno de operaciones (Kova Ops)

Documento de continuidad para retomar/delegar (ej. a Codex) las pruebas
locales del dashboard interno implementado en la branch
`feat/internal-ops-dashboard`. Contiene: qué ya se hizo, qué se arregló, qué
falta probar, y el checklist de verificación final antes de abrir el PR.

## Contexto

Se implementó el dashboard interno de operaciones (`/internal/ops`, "Kova
Ops") completo: backend (`backend/app/ops/`) con auth por allowlist,
KPIs cross-tenant, conectores externos (Sentry/Fly/Vercel/UptimeRobot),
incidentes con triage, trace correlacionado; y frontend
(`frontend/src/internal-ops/`) con guard, shell propio y 8 páginas. Todo el
trabajo está commiteado en 14 commits en `feat/internal-ops-dashboard`.
Todas las suites automatizadas pasan (backend 367 tests, frontend 109 tests,
lint/typecheck/build limpios). **Lo que falta es la verificación manual E2E
en el entorno local con Docker**, que reveló dos bugs de infraestructura de
desarrollo (no relacionados al feature en sí, pero bloqueaban probarlo) que
ya se arreglaron.

## Bugs de entorno ya encontrados y corregidos (no tocar de nuevo)

1. **Dependencias del contenedor frontend desactualizadas.** El contenedor
   Docker de frontend no tenía instalado `@tanstack/react-query` (o tenía
   caché vieja de Vite). Se arregló corriendo dentro del contenedor:
   ```
   docker compose exec frontend npm install
   docker compose exec frontend rm -rf node_modules/.vite
   docker compose restart frontend
   ```
   Si vuelve a pasar un error `Failed to resolve import` en el navegador,
   repetir esta secuencia.

2. **Proxy de Vite mal configurado para Docker.** `frontend/vite.config.ts`
   tenía el proxy de `/api` fijo a `http://localhost:8000`, que solo
   funciona corriendo el frontend fuera de Docker. Dentro del contenedor,
   `localhost` apunta al propio contenedor del frontend, no al backend, así
   que ninguna petición a la API llegaba nunca. Se corrigió:
   - `frontend/vite.config.ts`: el proxy ahora usa
     `process.env.VITE_API_BASE_URL || "http://localhost:8000"`.
   - `docker-compose.yml`: el servicio `frontend` ahora define
     `VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://backend:8000}` (nombre
     del servicio backend en la red interna de Docker Compose).

   **Verificado:** tras este fix, las peticiones de signup ya llegan al
   backend (se ven en `docker compose logs backend` con status 422/200 en
   vez de no aparecer nada).

3. **Confusión de bases de datos.** La base de datos local de Docker
   (`db` en `docker-compose.yml`) está completamente separada de
   producción/Supabase. Una cuenta que existe en producción (ej.
   `posprojectsupport@gmail.com`) **no existe** en la base local — hay que
   crearla de nuevo vía `/signup` en `localhost:5173` y marcarla verificada
   a mano (ver Paso 3 abajo). Esto es esperado, no es un bug.

## Estado justo antes de este documento

- `backend/.env` ya existe localmente con:
  ```
  INTERNAL_ADMIN_EMAILS=posprojectsupport@gmail.com
  ```
  (archivo en `.gitignore`, no se sube al repo).
- El backend ya se reinició después de crear ese archivo.
- Se intentó crear la cuenta `posprojectsupport@gmail.com` vía `/signup` con
  una contraseña de **4 caracteres**, lo cual el backend rechaza
  correctamente con **422** porque la contraseña mínima son **8 caracteres**
  (`backend/app/auth/schemas.py`, `_PASSWORD_MIN_LENGTH = 8`). El signup en
  sí **funciona** — el error era una contraseña inválida, no un bug.
- El frontend muestra un mensaje genérico ("No pudimos completar la acción")
  en vez de decir específicamente "la contraseña debe tener al menos 8
  caracteres". Esto **no es parte del alcance del dashboard de ops** — es
  una oportunidad de mejora de UX preexistente en el formulario de signup,
  fuera de esta tarea. No es necesario arreglarlo para poder probar el
  dashboard, pero queda anotado.

## Checklist paso a paso para completar la prueba local

Ejecutar en orden, desde la raíz del repo (`point_of_sale`), en PowerShell.

### 1. Confirmar que los contenedores están sanos
```
docker compose ps
```
Los tres servicios (`db`, `backend`, `frontend`) deben mostrar estado
`running`/`healthy`. Si no, `docker compose up -d`.

### 2. Confirmar el allowlist
```
Get-Content backend\.env
```
Debe mostrar exactamente:
```
INTERNAL_ADMIN_EMAILS=posprojectsupport@gmail.com
```
Si se necesita agregar otro correo de administrador, usar coma sin espacios:
`INTERNAL_ADMIN_EMAILS=correo1@x.com,correo2@y.com`, y correr
`docker compose restart backend` después de editar el archivo.

### 3. Crear la cuenta local de prueba (con contraseña válida)
1. Abrir `http://localhost:5173/signup`.
2. Llenar:
   - Nombre del negocio: cualquier valor, ej. `Admin`.
   - Correo: `posprojectsupport@gmail.com`.
   - Contraseña: **mínimo 8 caracteres**, ej. `KovaOps2026!`.
3. Marcar la casilla de términos y dar clic en "Crear cuenta".
4. Debe redirigir a un flujo de verificación de email (o directo al
   dashboard de tenant, dependiendo del flujo actual) — **no** debe mostrar
   el error rojo genérico.

Si vuelve a fallar con 422, revisar `docker compose logs backend --tail 20`
para ver el detalle exacto del error de validación (el JSON de error trae el
campo que falló).

### 4. Verificar/forzar el email como verificado
En local no se envían correos reales. Verificar el estado:
```
docker compose exec -T db psql -U pos -d pos -c "SELECT email, is_email_verified, is_active FROM users WHERE email = 'posprojectsupport@gmail.com';"
```
- Si `is_email_verified` es `f` (falso), forzarlo:
  ```
  docker compose exec -T db psql -U pos -d pos -c "UPDATE users SET is_email_verified = true WHERE email = 'posprojectsupport@gmail.com';"
  ```

### 5. Iniciar sesión
1. Ir a `http://localhost:5173/login`.
2. Entrar con `posprojectsupport@gmail.com` y la contraseña del paso 3.
3. Debe entrar normalmente al dashboard de tenant (`/dashboard`).

### 6. Abrir el dashboard interno
1. Ir a `http://localhost:5173/internal/ops`.
2. **Resultado esperado:** carga la portada "Kova Ops" con:
   - Tarjetas de estado general (db en verde/ok, sentry/fly/vercel/uptimerobot
     en "Sin configurar" — es correcto, no hay tokens puestos).
   - KPIs de dinero (todo en 0 si no hay datos de Stripe locales — normal).
   - Sección de riesgo y operación.
   - Nav superior con: Portada, Clientes, Revenue, Funnel, Técnica,
     Incidentes, Trace.

### 7. Probar el guard de seguridad (negativo)
1. Editar `backend/.env` y cambiar el correo a uno distinto, ej.
   `INTERNAL_ADMIN_EMAILS=otro@ejemplo.com`.
2. `docker compose restart backend`.
3. Refrescar `http://localhost:5173/internal/ops` (sesión sigue activa con
   `posprojectsupport@gmail.com`, que ya NO está en el allowlist).
4. **Resultado esperado:** página de "no encontrado" (NotFound), **no** debe
   mostrar contenido del dashboard ni redirigir revelando que la ruta existe.
5. Revertir: volver a poner
   `INTERNAL_ADMIN_EMAILS=posprojectsupport@gmail.com` en `backend/.env` y
   `docker compose restart backend`.

### 8. Recorrer cada página del dashboard
Con el acceso restaurado (paso 7.5), navegar cada tab y confirmar que carga
sin errores en consola del navegador (F12 → Console) y sin pantalla roja de
Vite:
- **Portada** (`/internal/ops`)
- **Clientes** (`/internal/ops/tenants`) — puede aparecer vacío o con el
  tenant "Admin" creado en el paso 3; probar el buscador de texto.
- **Revenue** (`/internal/ops/revenue`) — sin datos de Stripe locales,
  debe mostrar estados vacíos, no errores.
- **Funnel** (`/internal/ops/funnel`) — probar los botones 7d/30d/90d.
- **Técnica** (`/internal/ops/technical`) — todas las integraciones deben
  decir "Sin configurar" excepto la base de datos (ok).
- **Incidentes** (`/internal/ops/incidents`) — probablemente vacío en local
  (no hay webhooks fallidos ni tenants past_due); ver paso 9 para forzar uno.
- **Trace** (`/internal/ops/trace`) — debe mostrar el formulario vacío con
  el mensaje de "ingresa un identificador"; no debe llamar a la API sin
  parámetros.

### 9. (Opcional) Forzar un incidente de prueba para ver el flujo completo
Insertar un webhook fallido directamente en la base local:
```
docker compose exec -T db psql -U pos -d pos -c "INSERT INTO webhook_events (id, stripe_event_id, event_type, processing_status, process_attempts, error_reason, payload, created_at) VALUES (gen_random_uuid(), 'evt_test_local_1', 'invoice.payment_failed', 'failed', 3, 'card_declined', '{}', now());"
```
Luego:
1. Ir a `/internal/ops/incidents` — debe aparecer un incidente `critical`
   (3 intentos fallidos activa la regla de severidad crítica).
2. Abrir el detalle — debe mostrar timeline, y un link a Stripe (dashboard
   de test, ya que no hay `STRIPE_SECRET_KEY` configurada localmente puede
   no aparecer el link o apuntar al dashboard live por defecto — verificar
   que no rompe la página).
3. Cambiar el estado de triage con el selector — debe mostrar un toast de
   éxito y persistir tras refrescar la página.
4. Agregar una nota en el textarea de abajo — debe aparecer en la lista
   inmediatamente tras guardar.
5. Ir a `/internal/ops/trace?stripe_event_id=evt_test_local_1` — debe
   mostrar ese evento en la línea de tiempo.

### 10. Confirmar que el dashboard NO aparece en la navegación normal
1. Iniciar sesión con una cuenta de tenant normal (no
   `posprojectsupport@gmail.com`) — puede ser cualquier cuenta de prueba
   existente o una nueva.
2. Revisar el menú lateral/inferior de la app (`AppShell`) — no debe existir
   ningún link a `/internal/ops` en ningún lado.
3. Intentar navegar manualmente a `/internal/ops` con esa cuenta — debe dar
   NotFound (mismo comportamiento del paso 7).

## Pendiente / fuera de alcance de esta tarea (anotar, no bloquea)

- **Mensaje de error genérico en signup**: el formulario de registro no
  distingue "contraseña muy corta" de otros errores; muestra siempre "No
  pudimos completar la acción". Es un problema preexistente del formulario
  de signup (`frontend/src/auth/AuthView.tsx` o similar), no del dashboard
  de ops. Si se quiere arreglar, es una tarea aparte.
- **Tokens de integraciones externas** (Sentry, Fly, Vercel, UptimeRobot):
  no configurados en este entorno de prueba. Guía completa de cómo
  generarlos y qué scope mínimo necesitan está en
  `docs/runbooks/ops-dashboard.md`. No es necesario para validar el
  dashboard — funciona correctamente mostrando "Sin configurar".

## Checklist final antes de abrir el PR

- [ ] Pasos 1–8 completados sin errores de consola ni pantallas rojas.
- [ ] Paso 7 (guard de seguridad) confirmado: sin allowlist, da NotFound.
- [ ] Paso 9 (flujo de incidente) probado al menos una vez end-to-end.
- [ ] Paso 10 (aislamiento de navegación) confirmado.
- [ ] `docker compose exec backend uv run pytest` sigue en verde tras
      cualquier cambio adicional.
- [ ] `cd frontend && npm run lint && npm run typecheck && npm test -- --run && npm run build`
      sigue en verde tras cualquier cambio adicional.
- [ ] Revertir cualquier dato de prueba insertado a mano en la base local si
      se desea dejarla limpia (el webhook de prueba del paso 9, el tenant
      "Admin" del paso 3) — opcional, es una base local descartable.
- [ ] Confirmar con el usuario si se abre el PR de
      `feat/internal-ops-dashboard` hacia `main`.
