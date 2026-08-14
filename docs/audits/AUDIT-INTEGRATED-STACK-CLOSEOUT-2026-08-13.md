# Cierre del stack integrado — 2026-08-13

## Alcance

Se intentó cerrar localmente los gates TEST/OFF/SEC/BILL con Docker Desktop, Postgres 16 efímero
y los scripts oficiales del repositorio. No se usaron credenciales alojadas, datos de clientes,
Stripe ni staging.

## Evidencia ejecutada

- Docker Desktop 29.6.1 y Compose 5.2.0 quedaron disponibles; `uv` también estaba instalado.
- `docker compose -f docker-compose.test.yml config --quiet`: aprobado.
- Alembic migró una base vacía desde baseline hasta `20e47faf64eb`.
- Primera fase backend: 515 pruebas aprobadas y 2 fallos legítimos descubiertos.
  - `/health` ya devuelve `release_sha`; su prueba aún exigía el contrato anterior.
  - El seed del replay concurrente de billing no materializaba el tenant antes de insertar la
    suscripción, por lo que Postgres podía intentar primero la fila dependiente.
- Correcciones mínimas: expectativa alineada al contrato versionado vigente y `flush()` explícito
  del tenant antes de la suscripción. No se relajó ninguna expectativa funcional.
- Revalidación focalizada sobre Postgres real: 6 pruebas aprobadas
  (`test_concurrent_replay_is_claimed_once` y todo `test_health.py`).
- La segunda fase backend completa terminó correctamente y el script avanzó a
  `docker compose up -d --build --wait`; por tanto, migraciones y pytest dejaron exit code cero.

## Gate integrado pendiente

La construcción de los servicios frontend/backend no produjo contenedores ni progreso observable
en BuildKit. Se detectaron árboles Compose/Buildx huérfanos de intentos interrumpidos, se detuvieron
únicamente los asociados a este worktree y se reintentó una sola vez en limpio. El build volvió a
quedar detenido antes de crear contenedores, así que se canceló dentro de una ventana acotada.

En consecuencia, esta ejecución **no** declara aprobados:

- TEST-1 Playwright integrado con dos tenants;
- TEST-4 axe en Chromium real;
- OFF-6 PWA instalada, corte real de red y reconciliación;
- SEC-3 smoke HTTP bidireccional completo ni SEC-6 SBOM/build reproducible;
- BILL-4 Stripe test y reconciliación alojada.

TEST-2 contra Postgres efímero y las pruebas backend de RLS, aislamiento y billing sí quedaron
ejecutadas por la suite completa. Los gates restantes conservan su requisito de CI/staging o de un
runner Docker donde BuildKit complete el build; no se infiere evidencia verde de una ejecución
interrumpida.

## Limpieza

No quedaron contenedores del proyecto integrado. Se conservaron intactos los artefactos no
rastreados del checkout principal y no se realizó push, deploy ni operación externa mutable.
