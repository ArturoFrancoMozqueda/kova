# Documentación de Kova

Empieza aquí. Si un documento y el código no coinciden, manda el código; corrige el documento en el
mismo PR.

## Base (leer primero)

| Documento | Para qué |
|---|---|
| [arquitectura.md](arquitectura.md) | Qué corre dónde, datos, multi-tenant, auth, offline, billing y jobs |
| [despliegue.md](despliegue.md) | Cómo llega `main` a producción, rollback, entorno de GitHub, backups |
| [desarrollo-y-ci.md](desarrollo-y-ci.md) | Levantar local, correr pruebas, qué valida CI |
| [current-sprint.md](current-sprint.md) | Trabajo en curso y gates abiertos |

## Decisiones (ADR) — `adr/`

Explican por qué el sistema es así. No se editan para reflejar cambios: si una decisión cambia, se
escribe un ADR nuevo que reemplaza al anterior.

## Referencia de producto y negocio

- [report-metric-definitions.md](report-metric-definitions.md): cómo se calcula cada métrica de
  ventas.
- [billing-state-copy-matrix.md](billing-state-copy-matrix.md): estados de suscripción y sus textos.
- [account-lifecycle.md](account-lifecycle.md): exportación y eliminación de cuentas.
- [deferred-scope.md](deferred-scope.md): lo que decidimos no construir todavía.

## Para agentes y diseño — `claude/`

Contexto que leen `CLAUDE.md` y `AGENTS.md`: producto, invariantes de arquitectura, checklist de QA
manual, contrato de experiencia de UI, sistema de movimiento y brief visual de la landing.

## Seguridad — `security/`

Modelo de amenazas de cookies/CSRF y diseño de rate limiting.

## Runbooks — `runbooks/`

Procedimientos paso a paso para operar producción: restore de backup, drill de Stripe, uptime,
panel interno de operación, Sentry del navegador, higiene de turnos, cuarentena offline y pilotos.

## Pruebas — `test-matrixes/`

Matrices de casos por dominio. [testing-ci.md](testing-ci.md) tiene la política detallada de CI.

## Regla para documentos nuevos

- Las auditorías, planes y reportes con fecha son temporales: cuando se cierran, sus conclusiones
  vigentes pasan a un documento base, ADR o runbook y el archivo se borra. Git conserva el
  historial.
- No dupliques lo que ya dice el código. Enlaza el archivo en su lugar.
