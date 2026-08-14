# Remediación de pruebas TEST — 2026-08-13

## Alcance y estado

Esta entrega automatiza TEST-1 a TEST-4 sin usar Supabase, Stripe ni credenciales live. TEST-5
permanece **pendiente externo**: este documento incluye el formato de evidencia, pero no declara un
pase manual que no se realizó.

| Ítem | Estado | Gate |
| --- | --- | --- |
| TEST-1 | Implementado; ejecución local pendiente de Docker Desktop | `npm run test:integration` contra `docker-compose.test.yml` |
| TEST-2 | Implementado | `scripts/test-stack.ps1 backend` (Windows) o `scripts/test-stack.sh backend` (CI/Linux) |
| TEST-3 | Implementado y verificado | OpenAPI versionado + `--check` + DTO críticos |
| TEST-4 | Implementado; ejecución local pendiente de Docker Desktop | axe-core en Chromium real dentro del gate integrado |
| TEST-5 | Pendiente externo | Checklist firmado de la sección final |

## TEST-1 — stack efímero

`docker-compose.test.yml` levanta un Postgres 16 sin volumen persistente, aplica Alembic, ejecuta el
provisionamiento idempotente del rol `kova_app` y arranca FastAPI con dos conexiones separadas:

- owner `pos`: migraciones y rutas privilegiadas ya delimitadas por la aplicación;
- runtime `kova_app`: `NOSUPERUSER`, `NOBYPASSRLS` y sujeto a políticas RLS.

El frontend usa el proxy de Vite hacia ese backend. `frontend/e2e/integration.spec.ts` crea dos
negocios mediante la UI/API pública, crea un producto real para el tenant A y comprueba que el
tenant B no puede verlo. No usa `page.route`, fixtures simulados ni servicios alojados.

Ejecución completa en Windows:

```powershell
./scripts/test-stack.ps1 integration
```

El script siempre ejecuta `docker compose down --volumes --remove-orphans` en `finally`. Sólo
`-KeepStack` evita el teardown para diagnóstico explícito. En CI, el job `integration` conserva logs
si falla y hace teardown con `if: always()`.

## TEST-2 — backend en Windows y CI

Requisitos: Docker Desktop, `uv` y puertos 55432/5174 disponibles.

```powershell
./scripts/test-stack.ps1 backend
```

El comando valida Docker antes de trabajar, espera el healthcheck de Postgres, instala el entorno
con `uv`, migra y ejecuta pytest. Así una falla de infraestructura termina antes con un mensaje
accionable, en vez de producir cientos de errores de conexión. `uv` gestiona `.venv` de forma nativa
en Windows y no depende de enlaces o rutas Unix `.venv/lib64`.

Equivalente CI/Linux:

```sh
./scripts/test-stack.sh backend
```

## TEST-3 — contrato OpenAPI

`specs/openapi.json` es el contrato revisable. El backend lo genera de forma determinista con claves
ordenadas. CI falla si el archivo generado difiere:

```powershell
cd backend
uv run python scripts/export_openapi.py --check
```

Cuando el cambio es intencional, la revisión debe inspeccionar el diff y actualizarlo explícitamente:

```powershell
uv run python scripts/export_openapi.py
```

Además, `npm run check:api-contract` verifica los status codes y campos consumidos por los clientes
críticos de sesión, catálogo, orden/venta y perfil del negocio. Un rename o status incompatible falla
antes del deploy. El JSON versionado también se publica como artifact de CI.

## TEST-4 — axe en navegador real

`frontend/e2e/accessibility.spec.ts` inyecta la distribución oficial de `axe-core` en Chromium y
mantiene activa la regla `color-contrast`; no usa JSDOM ni un canvas simulado. Audita login,
Catálogo, Caja, Ventas, Análisis, Settings y el modal financiero de apertura de caja. El gate exige
cero violaciones `critical` o `serious` WCAG A/AA.

La skill de Playwright orientó este gate a un navegador real. La prueba automatizada queda dentro
del stack efímero para evaluar CSS calculado y datos reales del backend sin tocar producción.

## Evidencia ejecutada en esta máquina

- `docker compose -f docker-compose.test.yml config --quiet`: **pasa**.
- `uv run ruff check scripts/export_openapi.py`: **pasa**.
- `uv run python scripts/export_openapi.py --check`: **pasa**; la importación reporta que el
  Postgres local ajeno al stack no acepta las credenciales por defecto, sin alterar el contrato.
- `npm run typecheck`: **pasa**.
- `npm run lint` (incluye los archivos e2e y el validador nuevos): **pasa**.
- Playwright `--list`: **3 pruebas descubiertas** en Chromium.
- `npm run check:api-contract`: **pasa**.
- Stack/test integrado y axe: **no ejecutados localmente** porque el daemon de Docker Desktop no
  estaba disponible. CI y el runbook son los puntos de ejecución reproducibles; no se inventa
  evidencia verde.

## TEST-5 — checklist externo pendiente

Quien realice el pase debe registrar fecha, responsable, navegador + versión, SO, dispositivo y
adjuntar capturas de cada defecto y retest. No cerrar TEST-5 sin completar todas las filas:

- [ ] Teclado completo y skip link en login y shell autenticado.
- [ ] NVDA en Windows o VoiceOver en macOS/iOS: login fallido, títulos de diálogo y toasts.
- [ ] Focus trap, Escape y retorno de foco en diálogos y overlay de venta exitosa.
- [ ] Zoom 200% sin controles cortados.
- [ ] `prefers-reduced-motion: reduce` neutraliza movimiento no esencial.
- [ ] Viewports 320, 360 y 390 px; tablet; escritorio.
- [ ] Contraste de texto, iconos y focus ring sobre su superficie real.
- [ ] Retest firmado de todos los defectos encontrados.

Resultado: **pendiente externo; sin firma ni evidencia manual en esta entrega**.
