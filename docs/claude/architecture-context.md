# Kova Architecture Context

Arquitectura vigente:

- Frontend: React/Vite.
- Backend: FastAPI.
- Database: Supabase Postgres en entornos alojados; PostgreSQL local para desarrollo y pruebas.
- Auth: implementación propia de Kova en FastAPI/Postgres, con contraseñas hasheadas, sesiones
  persistidas y cookies HttpOnly. Supabase Auth no forma parte del runtime.
- Billing: Stripe subscriptions.
- Frontend hosting: Cloudflare Workers Static Assets; la cuenta usa Workers Paid desde
  el 2026-10-19. Frontend y gateway limitan CPU a 100 ms por invocación.
- Frontend API proxy: Worker de Cloudflare conserva `/api` en el mismo origen y reenvía a FastAPI en Cloudflare,
  sin caché de respuestas privadas ni credenciales de base de datos en el Worker.
- Vercel permanece como candidato de publicación y respaldo durante la transición; el pipeline
  publica sus mismos archivos estáticos validados en Cloudflare y captura la versión anterior
  del Worker para revertir antes de recuperar Vercel.
- Backend hosting público: FastAPI nativo en un Container Cloudflare `basic` residente,
  con una sola instancia y un proceso Uvicorn. El gateway dirige directamente a `api-0`
  con `KOVA_NATIVE_BACKEND=1`; el controlador conserva el Worker y namespace existentes.
  La inactividad no apaga el proceso; mantenimiento o publicaciones pueden reiniciarlo.
  PostgreSQL sigue siendo la autoridad para sesiones, permisos, RLS y escrituras mediante
  conexiones TLS al pooler. Un login dedicado hereda sólo el rol runtime `kova_app`.
  Los coordinadores Python y Hyperdrive quedan como ruta validada de reversión, además
  de seguir atendiendo los jobs privados. SQLite no almacena tablas del negocio.
- El panel agrupa informes y contexto en `GET /api/v1/reports/dashboard` con una sesión
  por petición. Reutiliza las definiciones existentes, zona horaria y sucursal; mantiene
  la autorización comercial y los permisos separados de facturación y personal.
  Un 404 permite las lecturas anteriores durante recuperación; otros errores no activan ese camino.
- Tareas del asistente: Worker privado con alarmas, rol runtime y leases de PostgreSQL; no recibe
  conexión de propietario, claves Stripe ni raíces de MFA.
- Almacenamiento privado: API S3 autenticada al bucket R2 existente desde el proceso nativo,
  con HEAD sin escrituras durante el arranque; jobs conservan su binding. Se mantienen claves de objetos,
  comprobaciones de negocios eliminados, propiedad y retención. Nuevas cargas e ingesta de
  documentos permanecen desactivadas por elección del propietario para controlar el gasto.
- HTTP externo: el backend nativo conserva las librerías TLS originales; jobs y la ruta de
  reversión Workers usan Fetch. El limitador persistente y el aviso inmediato de jobs
  se alcanzan sólo por bindings privados desde el contenedor, sin nuevas rutas públicas.
- Fly fue retirado por solicitud del propietario el 2026-10-19: aplicación y cinco máquinas
  eliminadas, sin volúmenes; credenciales de despliegue e ingesta revocadas. Publicación y
  recuperación requieren versiones exactas de Cloudflare y no tienen proveedor Fly alternativo.
- La identidad pública usa el binding de texto versionado `KOVA_BUILD_SHA`; las publicaciones
  mantienen intactos los secretos y sus protecciones de reversión.

El traslado del backend del 2026-10-18 mantiene Supabase/Postgres, Stripe y los demás proveedores.
El estado de aceptación y corte se registra en [`../current-sprint.md`](../current-sprint.md).
Configuración y límites: [`../../deploy/cloudflare-native/README.md`](../../deploy/cloudflare-native/README.md).

## Safety boundaries

The highest-risk areas are:

- Auth and sessions.
- Supabase RLS and tenant isolation.
- Billing and Stripe webhooks.
- Production deployment.
- Offline POS sync and idempotency.
- Analytics correctness.

## Data and identity boundaries

- El backend es el único cliente de PostgreSQL; el frontend no recibe credenciales de Supabase.
- `APP_DATABASE_URL` usa el rol runtime sin bypass de RLS; `MIGRATION_DATABASE_URL` queda reservado
  para migraciones y rutas privilegiadas explícitas.
- La identidad y el tenant se resuelven desde una sesión válida en el servidor. Nunca se confía en
  un tenant enviado por el navegador para autorizar una operación.
- Access y refresh tokens viajan únicamente en cookies seguras; ningún token sensible se guarda en
  `localStorage` o `sessionStorage`.

## Engineering principles

- Make small, reviewable changes.
- Preserve API contracts unless explicitly changing them.
- Inspect migrations before database work.
- Use real backend data in production flows.
- Do not introduce fake data to make UI look complete.
- Keep environment separation clear.

El índice de setup, pruebas y operación está en
[`../engineering-operations-index.md`](../engineering-operations-index.md). Los estados históricos
de auditorías o sprints no reemplazan [`../current-sprint.md`](../current-sprint.md).
