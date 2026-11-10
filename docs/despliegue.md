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
   3. Publica en orden: `kova-backend-jobs` → controlador `kova-backend` sin rollout de imagen →
      comprobación externa del controlador → `kova-backend` con rollout → `kova-backend-gateway`.
      La configuración pide actualización inmediata y [ADR-027](adr/ADR-027-native-controller-before-image.md)
      comprueba su adopción antes de sustituir la imagen. La baseline debe conservar su SHA y
      marcador de arranque; sólo `x-kova-controller-sha` debe identificar al controlador nuevo.
      Un fallo impide iniciar el cambio de imagen. Durante el rollout independiente de imagen,
      [ADR-024](adr/ADR-024-bounded-native-image-handoff.md) permite continuar únicamente al proceso
      anterior ya sano, con SHA y marcador propios verificados, dentro de una concesión absoluta
      de hasta treinta minutos. No se reinicia esa imagen con la nueva configuración ni se
      presenta como versión nueva. Imágenes ajenas o mal arrancadas siguen bloqueadas.
      Ante un reinicio reconocido durante esa concesión, [ADR-025](adr/ADR-025-native-pre-forward-startup-wait.md)
      comparte una espera acotada antes de enviar los payloads. Cada solicitud se envía una sola
      vez al proceso verificado; nunca se repite una escritura ya enviada.
   4. Espera a que el proceso nativo reporte el nuevo SHA (hasta 30 min por el drenado de
      Containers).
4. **Verificar el candidato** contra el backend nuevo. El ejecutable de release también compara
   `/api/v1/billing/plans` por API directa y proxy del candidato con la oferta revisada en
   `frontend/scripts/release-billing-offer.mjs`: revisión coincidente, planes exactos, importe,
   MXN, mensualidad, capacidades, límites y tratamiento inclusivo de los precios nuevos.
   La revisión se ancla al catálogo del backend aprobado. Se vuelve a comprobar después
   de la aceptación pública. Un sitio sano con una oferta incorrecta no se promueve.
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
- La recuperación verifica el artefacto anterior sin exigirle la oferta comercial nueva. Apagar
  nuevas ofertas no elimina las referencias de los Prices que necesitan las suscripciones existentes.
- Las verificaciones rechazan redirecciones HTTP; un header de bypass del candidato no se
  reenvía a otro origen. La aceptación pública no utiliza bypass.
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
| `STRIPE_ESENCIAL_PRICE_ID` | `price_…` | Precio público de Esencial, enviado a API y jobs |
| `STRIPE_GESTION_PRICE_ID` | `price_…` distinto del anterior | Precio público de Gestión, enviado a API y jobs |
| `STRIPE_STANDARD_PORTAL_CONFIGURATION_ID` | `bpc_…` | Configuración de Portal para acuerdos Standard |
| `STRIPE_TIERED_PORTAL_CONFIGURATION_ID` | `bpc_…` | Configuración de Portal para la nueva cohorte |

Secretos (solo nombres, nunca valores): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_DB_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_URL`,
`VERCEL_AUTOMATION_BYPASS_SECRET`.

Los secretos de runtime de la app (Stripe, Resend, sesión, URLs de base) viven sellados en
Cloudflare, no en GitHub. Las publicaciones no los rotan ni los leen.

### Preparación de los identificadores comerciales

Los cuatro IDs anteriores son configuración pública, no credenciales. El job de release los toma
del environment `production` y los declara como bindings TEXT versionados en `kova-backend` y
`kova-backend-jobs`; el gateway y el frontend no los reciben. No se incluyen en argumentos de
Docker ni se copian claves o URLs de base. `STRIPE_STANDARD_PRICE_ID` conserva su binding anterior
y no pertenece a esta allowlist.

La configuración es todo o nada: cuatro IDs con formato válido y dos precios distintos. La
ausencia total sigue admitida para CI/local y despliegues previos; una configuración parcial o
malformada falla antes de migrar o publicar. Los dos campos de Portal pueden compartir un ID
básico si los cambios de suscripción están deshabilitados. Para habilitar cambios por cohorte se
requiere su configuración aceptada, preservando la prohibición de cambios de plan para Standard.
Validar el formato de un ID no acredita su cuenta, modo, importe ni tratamiento fiscal en Stripe.

El release revisa solo nombres de bindings sellados de ambos Workers. Si alguno de los cuatro
IDs ya existe como secreto, se detiene antes de modificar servicios: no convierte tipos, no lee
su valor y no lo elimina automáticamente. Cualquier migración de ese binding debe revisarse
expresamente. No se usa `provision_once` para instalar precios.

El comparador fijado de `cf` admite únicamente esos cuatro IDs y la transición de SHA capturada
para API/jobs. Exige que los valores del artefacto coincidan con los inputs públicos del release;
el resto de variables, flags, referencias a secretos y recursos conserva la comparación estricta.
La recuperación restaura las versiones exactas capturadas, sin reconstruir con los IDs actuales
ni usar `--bypass-deployment-checks`.

Esta preparación conserva `BILLING_TIERED_PLANS_ENABLED=false` y
`BILLING_PORTAL_ENABLED=false` en el controlador nativo. No activa altas, Portal ni cambios de
suscripción. El primer release preparatorio todavía captura como rollback una versión anterior
sin esos IDs: es seguro mientras la oferta siga apagada. Antes de activar, debe haber terminado
ese release y la siguiente publicación debe capturar como base aceptada versiones que ya
contengan los cuatro bindings en API y jobs. No usar el artefacto anterior al transporte como
base de una activación. Tampoco retirar los IDs al apagar ofertas: siguen siendo necesarios para
resolver acuerdos tiered ya asignados.

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


## Continuidad observada y pendiente

El [release 42729913216](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/42729913216)
terminó saludable sobre `4aeaa973044d`. La observación confirmó el controlador nuevo atendiendo
con la imagen anterior y sus marcadores originales antes del cambio. Aun así, durante la
sustitución hubo 503 y solicitudes que excedieron treinta segundos. La primera respuesta con
imagen/controlador nuevos se completó a las 01:01:49 UTC del 10 de noviembre de 2026. La aceptación
final de los 25 contratos no acredita continuidad durante el rollout.

La espera de ADR-027 y el cierre HTTP privado de ADR-028 no preparan una segunda instancia.
Para cerrar este gate hace falta mantener la versión anterior disponible mientras se prepara y
verifica una instancia separada, cambiar tráfico después de comprobar imagen/controlador/base y
drenar la anterior. Deben preservarse roles/RLS, límites compartidos, credenciales selladas,
compatibilidad de migraciones, recuperación exacta e idempotencia; no se autoriza un replay de
escrituras para esconder fallos. Esta capacidad todavía no está implementada.
