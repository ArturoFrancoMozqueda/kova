# Seguridad: apoyo a la evaluación productiva de Kova

Fecha local: 2026-10-08 (America/Mexico_City). Base: `f9d875c103b090c9f08a888db7464b3a2321bbd1`.
Rama: `codex/production-audit-security`.

Se inspeccionaron auth propia, sesiones/cookies/CSRF, permisos de empleados,
dependencias de tenant/sucursal, RLS runtime y acceso/lifecycle de suscripciones.
Los hallazgos se reprodujeron y corrigieron en PostgreSQL 16 local, base desechable
`audit_security`, con datos y firmas sintéticos. No se modificó información productiva
ni se invocaron Stripe, correo, PAC o inferencia externa.

## Hallazgos corregidos

| Hallazgo reproducible | Corrección | Evidencia |
| --- | --- | --- |
| HTTP 422 reflejaba contraseñas, tokens, claves y cuerpos completos en `input` del error. | Handler de validación conserva `detail` con `loc`, `msg`, `type`; excluye `input` y `ctx`. El contrato OpenAPI permanece idéntico. | Cinco regresiones RED→GREEN: password, reset, input anidado, cuerpo incorrecto y campo extra. |
| `/auth/logout-all` devolvía 204 pero RLS dejaba vivas sesiones del mismo usuario en otros negocios. | La identidad sigue autenticándose con la conexión runtime/RLS. La revocación usa la conexión privilegiada, limitada exclusivamente al `user_id` autenticado. | Prueba API con rol real `kova_app`: revoca ambas sesiones propias, preserva sesión ajena del mismo tenant y rechaza access/refresh de la propia en el otro tenant. |
| Un webhook Stripe firmado de test podía activar una suscripción con configuración productiva; el prefijo `whsec_test` no detecta secretos reales opacos. | Antes de cualquier persistencia, producción que exige live requiere estrictamente `Event.livemode is True`. Conserva el opt-in explícito de test y el entorno local. | Cuatro casos RED→GREEN (false, ausente, string y número); tres positivos (live, opt-in test productivo, local). |
| Firma Stripe no ASCII y cuerpo UTF-8 inválido provocaban 500. | HMAC sobre bytes originales y comparación constante de bytes; payload inválido recibe 400. | Cinco pruebas de cuerpos escalares/lista/nulo/UTF-8 inválido y firma no ASCII. |
| Origin/Referer con brackets/IPv6 inválido provocaba 500 en el endpoint anónimo. | `urlsplit` inválido devuelve origen no confiable; la autorización rechaza con 403. | Cuatro casos RED→GREEN, sin relajar allowlist ni CSRF. |

El modo del evento y la firma se verificaron contra documentación primaria:
[Event.livemode](https://docs.stripe.com/api/events/object) y
[firma de webhooks](https://docs.stripe.com/events/manage-webhook-endpoints#signature-errors).

## Validación final

- **308 pruebas aprobadas** en 36.46 s: auth, refresh concurrente, expiración,
  longitud UTF-8, authz, CSRF, security, rate limits, RLS real, tenant isolation,
  rutas entre tenants, RBAC de empleados, billing API/lifecycle/orden temporal/access,
  input validation, privacidad de errores, logout-all runtime y telemetry origin.
- `ruff check .`: aprobado.
- `python scripts/export_openapi.py --check`: aprobado; contrato público sin cambios.
- `git diff --check`: aprobado.
- Advertencia conocida del runtime local: deprecación del TestClient Starlette/httpx.

Artefactos locales de validación: `/tmp/kova-audit-security-final.xml` y
`/tmp/kova-audit-security-final.log`. Los tests requieren PostgreSQL real y ejecutan
`alembic upgrade head`; la prueba de logout usa conexiones separadas owner/runtime,
con semillas comprometidas que elimina al terminar.

## Archivos

Implementación: `backend/app/main.py`, `backend/app/auth/router.py`,
`backend/app/billing/service.py`, `backend/app/shared/origin.py`.
Regresiones: `test_validation_response_privacy.py`, `test_logout_all_rls.py`,
`test_billing_webhook_mode.py`, `test_telemetry_origin_guard.py`, dentro de
`backend/app/tests/`. No se alteraron migraciones, fixtures existentes ni resultados
esperados de pruebas anteriores.

## Límites y QA posterior

Esta evidencia acredita la reproducción y corrección local, no la publicación ni
QA autenticada posterior al deploy. El coordinador realiza la evaluación productiva.
Al publicar, verificar login/refresh/logout, mensajes de validación sin valores
sensibles, CSRF, acceso por rol, lectura de facturación y cierre global al final
de los recorridos. El guard Stripe queda validado mediante eventos sintéticos:
no enviar eventos falsos ni crear/cancelar cobros productivos para comprobarlo.

## Seguimiento: privacidad de caché HTTP

El coordinador observó en producción que `/api/v1/auth/session`, `/auth/me`,
`/reports/sales-summary`, `/catalog/products` y `/billing/subscription`, a través
del proxy de kovasuite.com, devolvían `Cache-Control: public, max-age=0,
must-revalidate`, sin exclusión explícita de almacenamiento. No se reprodujo ni
se afirma fuga entre usuarios. La revisión confirmó que el backend solo declaraba
`no-store` para ops y Vercel no tenía una política específica para `/api/`.

Corrección: las respuestas privadas backend de `/api/v1/`, incluyendo identidad,
datos del negocio, emisión de tokens/cookies y errores de ruta, incluyen
`Cache-Control: private, no-store, max-age=0`, `CDN-Cache-Control: no-store`,
`Vercel-CDN-Cache-Control: no-store` y `Pragma: no-cache`. El proxy Vercel añade
las tres directivas de caché exclusivamente bajo `/api/(.*)`; landing, documentos
y assets mantienen sus políticas previas. La caché de la aplicación/offline no
cambia. El endpoint `/health` directo al backend conserva su política anterior.
La integración conserva además el `no-store` explícito de exportaciones y las
cabeceras públicas originales de las dos rutas anónimas de imágenes (logo del
recibo e imagen de producto), verificadas por ruta, tipo de contenido y estado
200. No se admite como excepción una respuesta JSON con caché pública. La suite
backend completa final conserva esos contratos y pasa sus 1277 pruebas.

La precedencia y consumo de cabeceras se verificaron en la
[documentación oficial Vercel](https://vercel.com/docs/caching/cache-control-headers).
`Vercel-CDN-Cache-Control` tiene prioridad y el proxy lo consume; no se debe exigir
su presencia visible en la respuesta final del navegador. Verificar los otros
dos headers en el proxy y los tres en el origen, sin deducir una fuga del valor
de `x-vercel-cache` por sí solo.

Regresiones nuevas: ocho casos backend fallaron antes del fix y pasan después;
incluyen las cinco lecturas productivas observadas, probe anónimo/401, emisión,
rotación y eliminación de cookies, y token de telemetry. El caso de `/health`
confirma que su política directa no cambia. Una regresión de configuración de
Vercel falló antes del fix y ahora comprueba los headers, el alcance API y la
conservación de assets immutable.

Validación final del seguimiento: **63 tests backend aprobados** (cache privacy,
security, ops auth, auth) en 20.59 s; **3 tests Vercel aprobados**; TypeScript,
ESLint del test, Ruff y diff aprobados. Evidencia local:
`/tmp/kova-audit-security-cache-final.xml` y
`/tmp/kova-audit-security-cache-final.log`. Archivos adicionales:
`backend/app/middleware/security_headers.py`,
`backend/app/tests/test_api_cache_privacy.py`, `frontend/vercel.json` y
`frontend/src/deployment/vercel-config.test.ts`. QA del proxy tras deploy queda
a cargo del coordinador.
