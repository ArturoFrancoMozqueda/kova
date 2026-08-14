# Auditoría de remediación SEC — 2026-08-13

## Resumen ejecutivo

Se implementaron los controles automatizables de SEC-1 a SEC-6 sin cambiar
contratos HTTP, cookies, RLS, billing gates ni el alcance de las sesiones
privilegiadas. Producción ahora falla cerrada ante una conexión runtime no
dedicada o una postura RLS incompleta. El body limit cuenta bytes ASGI aunque no
haya `Content-Length`; rate limit usa la IP controlada por Fly; y el runtime de
build está fijado por versión y digest.

El smoke externo de SEC-3 y la verificación del límite equivalente en el proxy
quedan pendientes porque requieren un entorno desplegado y dos tenants
desechables, no tenants de clientes.

## Evidencia por control

### SEC-1 — conexión runtime dedicada

- `backend/app/main.py` exige `APP_DATABASE_URL` explícita en producción y
  distinta de la conexión privilegiada.
- `backend/app/db.py` comprueba en catálogo que el rol runtime no sea
  `rolsuper`, no tenga `rolbypassrls` y no sea propietario de tablas tenant.
- Las URLs y credenciales no se incluyen en logs ni errores.

### SEC-2 — gate RLS fail-closed

- `TENANT_SCOPED_TABLES` es el inventario canónico, incluyendo las tablas
  añadidas por las migraciones 0049, 0050 y 0056.
- El arranque valida RLS habilitado, `FORCE ROW LEVEL SECURITY`, al menos una
  policy con `USING` y una con `WITH CHECK` en cada tabla.
- Una consulta de postura fallida o incompleta lanza `RuntimeError` en
  producción; local/CI conserva modo diagnóstico para permitir el bootstrap de
  migraciones.
- `backend/app/tests/test_security_remediation.py` cubre DB inaccesible, tabla
  ausente, FORCE/policies faltantes, owner, superuser y BYPASSRLS.

### SEC-3 — smoke cross-tenant automatizable

- `backend/app/tests/test_rls_enforcement.py` crea dos tenants y datos
  desechables con owner, conecta como `kova_app` no-owner y prueba aislamiento
  SQL de lectura, inserción, actualización y eliminación.
- `backend/app/tests/test_tenant_isolation_routes.py` y
  `backend/app/tests/test_input_validation.py` prueban referencias de recursos
  de otro tenant en rutas HTTP.

Matriz automatizada disponible:

| Superficie | list/detail | create forjado | update | delete | Capa |
|---|---:|---:|---:|---:|---|
| productos | sí | sí | sí | sí | SQL/RLS + HTTP |
| pedidos cliente | sí | sí | parcial | pendiente live | SQL/RLS + HTTP |
| gastos | sí | sí | rutas existentes | rutas existentes | SQL/RLS + HTTP |
| reportes | sí | n/a | n/a | n/a | HTTP |
| billing | sí | policies verificadas | rutas existentes | n/a | SQL/RLS + HTTP |
| imágenes/recibos | policies verificadas | rutas existentes | rutas existentes | rutas existentes | SQL/RLS + HTTP |
| cola offline | pruebas tenant existentes | sí | n/a | n/a | HTTP |

Pendiente externo: ejecutar la matriz endpoint × operación en un deploy de
staging con dos usuarios/tenants efímeros y confirmar ambos sentidos. Guardar
únicamente IDs redactados y destruir los datos al finalizar.

## SEC-4 — límite streaming

- `backend/app/middleware/body_size.py` conserva el rechazo temprano por
  `Content-Length` y además envuelve `receive`, acumulando chunks ASGI.
- Se acepta exactamente 2 MiB y se rechaza el byte siguiente con 413.
- Los límites menores de logo e imagen permanecen intactos.
- Hay pruebas para chunks sin longitud, límite exacto, longitud inválida y
  desconexión del cliente.

Pendiente externo: confirmar un límite igual o menor en Fly Proxy y enviar JSON
y multipart chunked reales contra staging.

## SEC-5 — IP confiable

- El bucket usa `Fly-Client-IP`, header que Fly Proxy establece desde la
  conexión de borde; ignora `X-Forwarded-For` aportado por internet.
- IPv4, IPv6 y IPv4-mapped IPv6 se validan y normalizan; un header inválido cae
  al peer del socket.
- Auth conserva `fail_closed=True` en producción.
- `docs/security/rate-limiting.md` documenta el límite de confianza: el backend
  debe permanecer detrás de Fly Proxy.

## SEC-6 — build reproducible

- `backend/Dockerfile` fija `uv` 0.8.11 por el digest multi-plataforma
  `sha256:8101ad825250a114e7bef89eefaa73c31e34e10ffbe5aff01562740bac97553c`.
- El digest fue verificado con `docker buildx imagetools inspect`.
- `docs/deployment.md` documenta el proceso de actualización conjunta de tag y
  digest.

Pendiente externo: build doble y comparación de SBOM/imagen en un runner con
Docker Engine; el daemon local no estaba disponible durante esta remediación.

## Validación

- `ruff check` focalizado: aprobado.
- Smoke unitario directo de postura RLS, body chunked e IP: aprobado.
- Pytest focalizado: bloqueado antes de ejecutar casos porque Postgres local no
  estaba disponible (`localhost:5432`); no se alteraron fixtures para ocultarlo.
- Docker manifest: digest resuelto y verificado; build/SBOM pendiente por daemon
  no disponible.

## Cierre local adicional — 2026-08-13

- La imagen base `python:3.12-slim` también quedó fijada por digest
  multi-plataforma; ya no queda una base mutable detrás del runtime `uv` fijado.
- La imagen productiva dejó de instalar `build-essential` y dependencias de
  desarrollo. `uv sync --frozen --no-cache --no-dev` consume estrictamente
  `uv.lock` sin persistir caché y `UV_NO_SYNC=1` impide una resolución implícita
  al arrancar.
- El nuevo check CI `reproducible container and SBOM` construye dos veces sin
  reutilizar capas, normaliza config y filesystem con `SOURCE_DATE_EPOCH=0` y
  `rewrite-timestamp=true`, exige configs y archivos Docker tar idénticos,
  carga el primer archivo verificado y genera desde él un SBOM SPDX JSON con
  una acción fijada por commit. El job de migraciones —y por transitividad
  cualquier deploy— depende de este control.
- Verificaciones locales completadas: digest de Python y `uv` resueltos con
  `buildx imagetools inspect`; instalación Linux productiva congelada resuelve
  42 paquetes sin grupos dev; YAML y `actionlint` 1.7.12 aprobados.

El doble build local sin normalización completó correctamente ambos builds y el
gate detectó la no reproducibilidad esperada: IDs `f69ae6ad…` y `6d1f90e7…`;
las capas generadas tenían timestamps distintos. El workflow ahora pasa
`SOURCE_DATE_EPOCH=0`; una segunda ejecución mostró que la única capa aún
variable era `RUN uv sync`, porque `/root/.cache/uv/archive-v0` incluía nombres
temporales aleatorios. `uv sync --no-cache` elimina ese contenido y el exporter
Docker reescribe timestamps. Dos builds locales independientes produjeron el
mismo config `3718b9b3…` y archivos Docker tar byte-a-byte idénticos
(`fc0b512d…`); `docker load` restauró correctamente `kova-backend:first` desde
ese archivo. Docker Scout indexó 176 paquetes desde el artefacto reproducido.
La comparación exacta no se debilitó; cualquier regresión bloquea
migrations/deploy.
