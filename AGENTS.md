# Kova — guía para agentes

Kova es un SaaS de punto de venta (POS) y analítica para PyMEs mexicanas. Está **en producción** y
cobra con suscripciones de Stripe. Todo lo que llega a `main` se publica a clientes reales: prioriza
seguridad, claridad y no romper lo que ya funciona.

Si este archivo y el código no coinciden, manda el código; corrige el archivo en el mismo cambio.

## Stack real

- **Frontend** (`frontend/`): React 18 + Vite + TypeScript, PWA, TanStack Query y Dexie para el modo
  offline. Lo sirve el Worker `kova-frontend` de Cloudflare (Static Assets). Vercel es candidato de
  publicación y respaldo.
- **Backend** (`backend/`): FastAPI + SQLAlchemy + Alembic. Monolito modular, un paquete por dominio
  en `backend/app/`. Corre nativo en un Container de Cloudflare detrás de `kova-backend-gateway`.
- **Datos:** PostgreSQL; Supabase solo como Postgres administrado. La auth es propia de Kova
  (contraseñas, sesiones y cookies); no se usa Supabase Auth.
- **Pagos:** suscripciones de Stripe. Fly.io está retirado; no lo reintroduzcas.

## Mapa del repo

| Ruta | Qué hay |
|---|---|
| `backend/` | API, modelos, migraciones en `alembic/versions/`, pruebas en `app/tests/` y `migration_tests/` |
| `frontend/` | App en `src/<dominio>/`, Playwright en `e2e/`, scripts de release y checks en `scripts/` |
| `deploy/` | Workers de Cloudflare: `cloudflare/` (frontend), `cloudflare-backend/`, `cloudflare-native/` |
| `specs/` | Contrato funcional vigente por dominio (`.md`), escenarios `.feature` que ejecuta `backend/app/tests/bdd/` y el contrato `openapi.json` |
| `docs/` | Arquitectura, despliegue, ADR y runbooks; índice en `docs/README.md` |
| `scripts/` | Política de CI (`ci_policy.py`), `test-stack.sh`, drills de operación |
| `.github/workflows/` | CI, release y tareas programadas |

`workspace/` (ignorado por git) y `output/` son material de marketing y video; no son parte de la app.

## Lo que ningún cambio puede debilitar

- **Auth y sesión:** access y refresh token solo en cookies HttpOnly; nada sensible en
  `localStorage` ni `sessionStorage`. CSRF por cookie + header `X-CSRF-Token`.
- **Tenant:** se resuelve siempre desde la sesión del servidor, nunca desde lo que mande el
  navegador. Los endpoints de escritura declaran su permiso RBAC.
- **RLS:** el backend usa `APP_DATABASE_URL` (rol `kova_app`, sin `BYPASSRLS`) y fija `app.tenant_id`
  por transacción. `MIGRATION_DATABASE_URL` es solo para migraciones y rutas privilegiadas explícitas.
  Nunca desactives RLS ni filtres tenants "por conveniencia". El frontend no recibe credenciales de
  base de datos.
- **Billing:** webhooks de Stripe con firma e idempotentes, tolerantes a eventos repetidos o fuera de
  orden. Nunca confíes en el éxito de pago que reporta el cliente. Llaves de prueba y live separadas.
  Los gates de acceso comercial no se aflojan.
- **Offline:** ventas con `client_uuid` e `Idempotency-Key`; un reintento no duplica ventas, pagos ni
  inventario, y una venta fallida no se borra sola.
- **Dinero:** siempre `Decimal` en backend, nunca `float`.
- **Secretos:** no leas, imprimas, registres ni subas `.env`, llaves de Stripe, URLs de base de
  datos, cookies ni cabeceras de auth.
- **Datos reales:** nada de analítica, métricas o estados de suscripción falsos en rutas de
  producción. Si faltan datos, usa un estado vacío que oriente.

## Cómo trabajar

1. Clasifica el riesgo: copy/UI, comportamiento de frontend, backend/API, auth/seguridad, billing,
   datos/reportes, offline/PWA, migración, despliegue o planeación.
2. Lee lo mínimo necesario antes de editar: el código, su spec en `specs/`, las migraciones y las
   pruebas relacionadas. No asumas esquemas, políticas RLS, payloads ni definiciones de métricas.
3. Haz el cambio más pequeño y seguro. No reescribas áreas amplias sin que lo pidan.
4. Mantén estables los contratos públicos salvo que la tarea exija cambiarlos.
5. Si cambias comportamiento, agrega o actualiza pruebas que lo demuestren.
6. Corre las verificaciones más estrechas que apliquen y reporta lo que no pudiste verificar.

No cambies tests, snapshots, fixtures, migraciones ni resultados esperados solo para que pasen:
arregla la implementación, o explica por qué el comportamiento esperado cambió de verdad.

## Comandos

Ruta recomendada: Docker. El detalle y lo que valida CI está en `docs/desarrollo-y-ci.md`.

| Qué | Comando | Dónde |
|---|---|---|
| App completa (web `:5173`, API `:8000`) | `docker compose up --build --wait` | raíz |
| Backend con Postgres desechable | `scripts/test-stack.sh backend` | raíz |
| Stack real + Playwright | `scripts/test-stack.sh integration` | raíz |
| Lint y pruebas backend | `uv run ruff check .` y `uv run pytest -n 4 --dist loadgroup` | `backend/` |
| Contrato OpenAPI | `uv run python scripts/export_openapi.py --check` | `backend/` |
| Lint, tipos y unit tests | `npm run lint`, `npm run typecheck`, `npm test -- --run` | `frontend/` |
| Contrato API del frontend | `npm run check:api-contract` | `frontend/` |
| Build y navegador sobre el build | `npm run build` y `npm run test:e2e-preview:built` | `frontend/` |

Las pruebas de backend necesitan Postgres real: SQLite no prueba locks, constraints, grants ni RLS.

## Contratos, migraciones y specs

- **Migración nueva:** Alembic, con `downgrade()`, y compatible con la versión anterior de la app.
  Un rollback de release nunca baja la base de datos. Conserva `tenant_id`, índices y RLS forzado.
- **Endpoint nuevo o cambiado:** regenera `specs/openapi.json` con
  `uv run python scripts/export_openapi.py` y verifica `npm run check:api-contract`.
- **Funcionalidad P0/P1 visible al usuario:** spec en `specs/<dominio>/` (formato en
  `specs/README.md`). Si una spec deja de describir el producto, actualízala en el mismo PR que
  cambia el código o retírala. Las decisiones de arquitectura van en un ADR nuevo en `docs/adr/`; los
  ADR existentes no se editan, se reemplazan.

## Release

No hay deploy manual. `main` exige un PR y el check `CI required`, con la rama al día. **Cada merge
a `main` que no sea solo Markdown de `docs/` o `README.md` publica a producción**; esto incluye
`AGENTS.md`, `CLAUDE.md` y `.claude/`.

- Fusiona de uno en uno y espera a que termine el release de cada PR. Si un release se cancela o
  expira, confirma que frontend y backend en producción reporten el mismo SHA antes de fusionar otro.
- No hagas deploy de preview del Worker del frontend sin `KOVA_CLOUDFLARE_FRONTEND=1`: quita las
  rutas de producción. Usa siempre el workflow.
- Un release fallido y recuperado deja CI en rojo; `RECOVERY_BLOCKED` es un incidente, no lo
  reintentes a ciegas. Detalle en `docs/despliegue.md`.
- No hagas commit, push, merge, deploy, disparo de workflows ni cambios al entorno `production` de
  GitHub sin que el usuario lo pida.

## Producto y copy

- Español de México por defecto. Voz segura pero sin exagerar, comprensible para un dueño no técnico.
- La experiencia debe sentirse premium, clara y que vale lo que cuesta; prioriza el flujo diario de
  caja y la historia accionable del negocio sobre la densidad de funciones.
- Ninguna pantalla de cliente o comercio muestra UUID, versiones internas, errores crudos ni
  etiquetas de desarrollador. Conserva folios, SKU, RFC e identificadores fiscales útiles.
- Reutiliza `ViewLayout`, `ViewHeader`, `ViewEmpty`, `ViewError` y los controles compartidos; carga y
  error nunca se presentan como "sin datos". Revisa 390 y 1440 px, teclado y modo offline.
- Términos: "pedido" es compromiso operativo, "venta" registra el cobro y "solicitud" requiere
  revisión. Entregar y cobrar son estados separados.
- No presentes WhatsApp, CFDI, terminal ni otros proveedores externos como disponibles sin
  confirmarlo en `docs/current-sprint.md` y en el código.

## No asumas

- Precios, nombres de plan, IDs de Stripe, impuestos, textos de facturación ni reglas de
  suscripción: verifícalos en el código, `docs/billing-state-copy-matrix.md` y `docs/adr/`.
- Tablas, políticas RLS, identificadores de tenant ni definiciones de métricas: usa la fuente
  (`docs/report-metric-definitions.md`, migraciones, modelos).
- Que algo está terminado: no lo marques completo sin código y validación que lo respalden.

## Dónde leer más

| Documento | Cuándo |
|---|---|
| `docs/arquitectura.md` | Qué corre dónde, datos, multi-tenant, auth, offline, billing |
| `docs/despliegue.md` | Release, rollback, entorno `production`, backups |
| `docs/desarrollo-y-ci.md` y `docs/testing-ci.md` | Levantar local, pruebas y qué valida CI |
| `docs/current-sprint.md` | Trabajo en curso y gates abiertos |
| `docs/claude/product-context.md` | Producto, mercado y decisiones del dueño |
| `docs/claude/ui-experience-contract.md` | Antes de tocar flujos o pantallas |
| `docs/claude/manual-qa-checklist.md` | Antes de cerrar un cambio de producto |
| `docs/claude/release-ga-checklist.md` | Cambios de lanzamiento, billing, auth u onboarding |
| `.claude/rules/*.md` | Reglas por área (auth, backend, billing, frontend, offline, pruebas, copy) |

## Al terminar

Resume qué cambió y por qué, qué archivos tocaste, qué pruebas corriste y con qué resultado, qué QA
manual hiciste y qué queda sin verificar.
