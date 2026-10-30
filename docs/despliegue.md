# Despliegue, rollback y operación

Escrito desde el código el 2026-10-27. Las fuentes de verdad son `.github/workflows/ci.yml`,
`frontend/scripts/release.mjs`, `frontend/scripts/release-recovery.mjs` y `deploy/*/`.

## Cómo llega un cambio a producción

No hay deploy manual. **Cada push a `main` con cambios de código publica a producción** si pasa
`CI required`. Los cambios que solo tocan Markdown en `docs/`, `README.md` o `CHANGELOG.md` no
publican.

```text
PR ──► CI (suites aplicables) ──► CI required ──► merge a main
                                                     │
                       main ──► CI required ──► job "publish and verify release"
                                                     (environment: production)
```

Un push a `main` reutiliza el resultado del PR si el árbol de archivos es idéntico
(`scripts/ci_policy.py`). Los releases se serializan; nunca se cancelan entre sí.

## Pasos del job de release

1. **Capturar producción actual.** Lee `release_sha` de `https://api.kovasuite.com/health`,
   verifica el sitio, el backend, la base y el proxy contra ese SHA, y guarda en el artefacto
   `release-rollback-<sha>` (7 días):
   - el deployment de Vercel que está sirviendo,
   - la versión exacta del Worker `kova-frontend`,
   - las versiones de `kova-backend-jobs`, `kova-backend` y `kova-backend-gateway`,
   - la imagen del Container nativo.

   Si algo falta o es incoherente, el release se detiene antes de tocar nada.
2. **Candidato.** Construye el frontend en Vercel como deployment inmutable (`*.vercel.app`) sin
   asignar dominios.
3. **Backend** (fase `candidate`):
   1. `alembic upgrade head` con `SUPABASE_DB_URL`.
   2. Construye la imagen nativa `kova-native:<sha>` (linux/amd64).
   3. Publica en orden: `kova-backend-jobs` → `kova-backend` (Container) → `kova-backend-gateway`.
   4. Espera a que el proceso nativo reporte el nuevo SHA (hasta 30 min por el drenado de
      Containers).
4. **Verificar el candidato** contra el backend nuevo.
5. **Promoción** (fase `promotion`): publica los mismos archivos estáticos al Worker
   `kova-frontend` y promueve Vercel.
6. **Aceptación** (fase `acceptance`): espera que `kovasuite.com` y `api.kovasuite.com` sirvan el
   SHA nuevo y corre la verificación pública completa.

El job tiene un timeout de 90 minutos.

## Recuperación automática

Si algo falla después de empezar a modificar producción, `release-recovery.mjs` restaura según la
última fase alcanzada:

| Fase | Qué restaura |
|---|---|
| `candidate` | Solo el backend: los tres Workers y la imagen del Container capturados |
| `promotion` / `acceptance` | Primero el frontend (Worker Cloudflare, luego Vercel) y después el backend |

Después vuelve a verificar todo contra el SHA anterior. Reglas:

- **La base de datos nunca se revierte.** Por eso cada migración debe funcionar también con la
  versión anterior de la app.
- Un release recuperado deja CI en rojo (`RELEASE_FAILED_RECOVERED`).
- `RECOVERY_BLOCKED` es un incidente: no reintentes a ciegas. Revisa el estado en Cloudflare
  (incluido un rollout de Container en curso) y usa el artefacto `release-rollback-<sha>` exacto de
  ese run. Nunca elijas versiones "por la más reciente".

## Configuración del entorno `production` en GitHub

Variables (`vars`):

| Variable | Valor esperado | Efecto |
|---|---|---|
| `KOVA_CLOUDFLARE_FRONTEND` | `1` | Rutas `kovasuite.com/*` y `www` en el Worker del frontend |
| `KOVA_CLOUDFLARE_BACKEND` | `1` | Dominio `api.kovasuite.com` en el gateway; el release falla si falta |
| `KOVA_NATIVE_BACKEND` | `1` | Backend en Container nativo en lugar de Python Workers |
| `KOVA_HYPERDRIVE_APP_ID`, `KOVA_HYPERDRIVE_PRIVILEGED_ID` | IDs | Bindings de Hyperdrive |

Secretos (solo nombres, nunca valores): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_DB_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_URL`,
`VERCEL_AUTOMATION_BYPASS_SECRET`.

Los secretos de runtime de la app (Stripe, Resend, sesión, URLs de base) viven sellados en
Cloudflare, no en GitHub. Las publicaciones no los rotan ni los leen.

Peligro: **no** hagas un deploy de preview del Worker del frontend sin
`KOVA_CLOUDFLARE_FRONTEND=1`, porque quita las rutas de producción. Usa siempre el workflow.

## Base de datos

- Supabase Postgres, un proyecto por entorno. Solo como Postgres; las migraciones son de Alembic.
- Rol runtime `kova_app`, creado con `backend/scripts/provision_app_role.sql`, sin `BYPASSRLS`.
  Producción no arranca si el rol runtime puede saltarse RLS o si una tabla de tenant no tiene
  RLS forzado.
- El backend nativo tiene su propio login, que hereda solo de `kova_app`. Se aprovisionó una vez
  con `native-backend.yml` (`provision_once`); **no lo repitas**.

## Backups y restore

- `db-backup.yml`: `pg_dump` diario 09:00 UTC → R2 (`supabase/postgres/`), retención 7 días.
  Secretos: `SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
  `CLOUDFLARE_ACCOUNT_ID`.
- Supabase mantiene además sus backups físicos.
- Restore: [runbooks/restore-supabase-backup.md](runbooks/restore-supabase-backup.md) y el workflow
  manual `db-restore-drill.yml`.

## Verificación manual

```bash
curl -s https://api.kovasuite.com/health
```

```bash
curl -s https://api.kovasuite.com/health/db
```

La aceptación del backend residente (latencia, identidad del proceso, caché de fotos públicas) se
puede repetir con el workflow manual `native-backend.yml` (`verify_public_images=true`).

## Costos y límites

- Cuenta Cloudflare en Workers Paid. El frontend y el gateway limitan CPU a 100 ms por invocación;
  la API y los jobs, a 30 s.
- `KOVA_BUDGET_PAUSED=1` en `kova-backend-jobs` pausa los jobs sin perder trabajo pendiente.
- Detalle de precios del Container y de alertas: `deploy/cloudflare-native/README.md` y
  `deploy/cloudflare-backend/README.md`.

## Protección de main

Comprobada en GitHub el 29 de octubre de 2026: `main` exige un PR y el check `CI required`,
con la rama actualizada antes de fusionar. La regla también aplica a administradores, exige
resolver conversaciones y bloquea pushes forzados y borrados. No exige una aprobación humana
adicional. Esta configuración vive en GitHub; verificarla de nuevo si se cambian las reglas o
el plan del repositorio. Activarla no publica código ni cambia el entorno `production`.
