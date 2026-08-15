# Auditoría CI/CD y trabajos programados — 2026-08-14

## Resultado ejecutivo

Los cinco workflows tienen una responsabilidad vigente y distinta. **No se depreca ninguno** en
esta épica. Retirar o combinar alguno hoy eliminaría cobertura de release, recuperación,
cumplimiento de eliminación, conversión de trials o preparación fiscal. La decisión fue coordinada
con el tech lead antes de modificar workflows.

Se aplicaron cuatro endurecimientos que no reducen gates:

1. permisos explícitos mínimos para todos los workflows;
2. releases de `main` serializados, sin cancelar un release activo; los runs obsoletos del mismo PR
   sí se cancelan porque nunca despliegan;
3. todas las GitHub Actions fijadas a SHA inmutable, conservando como comentario la versión
   revisada;
4. contrato estático en `check_ops_readiness.py` para impedir actions mutables, permisos implícitos,
   pérdida de serialización o drift silencioso del scheduler fiscal.

Esto mejora la seguridad y reduce carreras, pero no permite afirmar “100 %” de disponibilidad. La
restauración real, la aprobación humana del environment y el rollback coordinado posterior a una
promoción fallida siguen siendo controles externos o trabajo posterior.

## Alcance y evidencia

Revisado:

- todos los archivos bajo `.github/workflows/`;
- scripts invocados por CI (`check_ops_readiness.py`, export OpenAPI, verificación de deployment,
  recordatorios y stack desechable);
- comandos definidos por `frontend/package.json` y `backend/pyproject.toml`;
- arquitectura, despliegue, release checklist, restauración y evidencia operativa existente;
- listado de workflows y runs mediante GitHub CLI, sin consultar valores de secretos.

Evidencia reciente:

| Workflow | Run observado | Resultado | Minutos reales de jobs | Estimación por redondeo de jobs |
|---|---:|---|---:|---:|
| CI/release, push a `main` | [31835239771](https://github.com/ArturoFrancoMozqueda/point_of_sale/actions/runs/31835239771) | verde | 20.95 | 28 |
| CI, pull request | [31834707394](https://github.com/ArturoFrancoMozqueda/point_of_sale/actions/runs/31834707394) | verde | 16.68 | 21 |
| Backup | [31790446557](https://github.com/ArturoFrancoMozqueda/point_of_sale/actions/runs/31790446557) | verde | 0.72 | 1 |
| Purga | [31788242274](https://github.com/ArturoFrancoMozqueda/point_of_sale/actions/runs/31788242274) | verde | 0.07 | 1 |
| Recordatorios | [31779116768](https://github.com/ArturoFrancoMozqueda/point_of_sale/actions/runs/31779116768) | verde | 0.25 | 1 |

“Minutos reales” suma duración de jobs concurrentes, no tiempo de pared. La columna redondeada es
una estimación conservadora de consumo; GitHub Billing es la fuente final.

## Matriz keep / consolidate / deprecate

| Workflow | Trigger y concurrencia | Valor que no duplica otro workflow | Decisión | Costo/nota |
|---|---|---|---|---|
| `ci.yml` | PR y push a `main`; PR cancelable por número, `main` serializado sin cancelación | lint, tests, Postgres, RLS, Playwright mock/real, accesibilidad, auditoría de dependencias/secretos, reproducibilidad, SBOM, reversibilidad, deploy exacto, smoke, promoción y aceptación | **Keep** | Aproximadamente 21 min redondeados por PR y 28 por release en la muestra. No usar filtros por ruta hasta diseñar checks requeridos equivalentes. |
| `db-backup.yml` | diario y manual; una ejecución a la vez | dump lógico propio, checksum, R2 y retención; no lo sustituye el backup del proveedor | **Keep** | ~30 min/mes por redondeo diario. El restore real continúa pendiente. |
| `account-purge.yml` | diario y manual; una ejecución a la vez | ejecuta la retención/eliminación auditada después del periodo de gracia | **Keep** | ~30 min/mes. Compartir scheduler no compensa acoplar una operación destructiva a otros jobs. |
| `trial-reminders.yml` | diario y manual; una ejecución a la vez | entrega recordatorios idempotentes y protege conversión trial→pago | **Keep** | ~30 min/mes. Su acceso directo a DB es distinto de los endpoints internos. |
| `fiscal-global-drafts.yml` | cada seis horas y manual; una ejecución a la vez | prepara, con catch-up idempotente, periodos cerrados según zona/fecha configurada | **Keep** | Hasta ~122 min/mes por redondeo de cuatro ejecuciones diarias. El catch-up conserva periodos omitidos sin depender de una hora exacta. |

### Consolidaciones evaluadas y no aplicadas

- **Scheduler único para purga, recordatorios y fiscal:** mezcla diferentes credenciales, frecuencias,
  blast radius y responsables. Un fallo bloquearía operaciones no relacionadas; no hay cobertura
  equivalente demostrada.
- **Unir Playwright mock con integración real:** las suites detectan clases diferentes de error y
  hoy corren en paralelo. Consolidar aumentaría latencia y reduciría aislamiento diagnóstico.
- **Mover auditoría de dependencias o reproducibilidad sólo a cron:** permitiría fusionar una
  dependencia o imagen vulnerable/no reproducible antes del siguiente cron.
- **Omitir CI para cambios de documentación:** podría ahorrar minutos, pero puede dejar checks
  requeridos eternamente pendientes o saltarse contratos operativos que viven en documentación.
  Requiere diseñar primero un job agregador estable; no se cambia en esta épica.

## Seguridad y supply chain

### Permisos

| Workflow | Permiso efectivo declarado |
|---|---|
| `ci.yml` | `contents: read`; únicamente secret scan agrega `pull-requests: read` |
| `trial-reminders.yml` | `contents: read`, necesario para checkout |
| backup, purga y fiscal | `{}`; no usan el token de GitHub ni checkout |

La configuración observada del repositorio también define permisos por defecto de workflows en
`read`, pero cada workflow queda autocontenido y no depende de ese ajuste externo.

### Actions fijadas

| Action | SHA revisado | Versión de referencia |
|---|---|---|
| `actions/checkout` | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | v5 |
| `actions/setup-python` | `ece7cb06caefa5fff74198d8649806c4678c61a1` | v6 |
| `astral-sh/setup-uv` | `d0cc045d04ccac9d8b7881df0226f9e82c39688e` | v6 |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4 |
| `actions/setup-node` | `a0853c24544627f65ddf259abe73b1d18a591444` | v5 |
| `gitleaks/gitleaks-action` | `ff98106e4c7b2bc287b24eaf42907196329070c7` | v2 |
| `docker/setup-buildx-action` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | v3.12.0 |
| `anchore/sbom-action` | `e22c389904149dbc22b58101806040fa8d37a610` | v0.24.0 |
| `superfly/flyctl-actions/setup-flyctl` | `ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1` | v1 |

Los SHAs se resolvieron contra los repositorios upstream mediante GitHub API. El gate local exige
40 caracteres hexadecimales para cualquier futura línea `uses:`. Como no hay Dependabot para
GitHub Actions, revisar actualizaciones y volver a resolver el SHA upstream de forma periódica.

Los ejecutables obtenidos dinámicamente fuera de `uses:` todavía requieren mantenimiento:
`vercel@59.0.0` y `wait-on@9.0.1` están fijados por versión, mientras `pip-audit` se resuelve en
tiempo de ejecución y el backup instala el cliente PG17 desde el repositorio apt oficial. No se
cambiaron porque sustituirlos exige validar compatibilidad e integridad del artefacto resultante.

## Release, promoción y rollback

Se conserva el grafo actual:

`gates → migración reversible → Fly + candidato Vercel → smoke exacto → promoción → aceptación`.

Aspectos correctos:

- PRs nunca ejecutan jobs de despliegue;
- Fly y Vercel se construyen desde `github.sha`;
- el candidato Vercel se verifica antes de promoverse y no se reconstruye;
- health verifica SHA, backend y DB;
- si Fly fue desplegado pero el candidato/smoke previo a promoción falla, el job existente restaura
  la imagen Fly capturada;
- la nueva concurrencia impide que un SHA anterior sobrevenga a otro release de `main`.

Riesgos abiertos, deliberadamente no modificados en esta épica:

1. `rollback-fly` no depende de `promote-vercel` ni de `release-acceptance`. Un fallo durante
   promoción o después de promover no tiene rollback coordinado Fly+Vercel.
2. restaurar una imagen Fly no revierte migraciones; todas las migraciones de producción deben ser
   aditivas/backward-compatible o tener un plan de datos probado.
3. el environment `Production` observado no tiene reglas de protección. Los workflows usan el
   environment, pero hoy no existe aprobación requerida en GitHub. El repositorio privado respondió
   que branch protection requiere un plan superior. Resolver con el dueño antes de considerar el
   gate de aprobación cerrado.
4. varios jobs de CI no tienen `timeout-minutes`; un proceso colgado puede consumir minutos hasta el
   límite general de GitHub. Añadir límites requiere medir los percentiles de runs para evitar falsos
   negativos.

## Scheduler fiscal: contrato crítico

El nuevo workflow:

- corre cuatro veces al día y delega el cálculo de fecha a
  `America/Mexico_City` en backend;
- usa `INTERNAL_API_KEY` únicamente como variable enmascarada y header; no imprime su valor;
- reintenta errores de transporte y exige HTTP 2xx;
- valida que la respuesta contenga exactamente cinco contadores enteros no negativos;
- marca el run rojo cuando cualquier tenant falla;
- no timbra CFDI ni genera XML/PDF: sólo prepara el borrador operacional inmutable;
- mantiene `cancel-in-progress: false`; el backend debe resolver reintentos concurrentes de forma
  idempotente.

El contrato estático detecta cambios en endpoint, autenticación, frecuencia, claves de respuesta,
tratamiento de fallos, concurrencia y permisos. La prueba de integración del backend sigue siendo la
fuente de verdad para idempotencia y aislamiento de tenants.

## Validación ejecutada

```text
python -m unittest discover -s scripts/tests -v
9 tests OK

python scripts/check_ops_readiness.py repository
OK

ruff check scripts/check_ops_readiness.py scripts/tests/test_check_ops_readiness.py
All checks passed

PyYAML BaseLoader sobre los cinco workflows
5 YAML OK

actionlint v1.7.12, binario oficial con SHA-256 verificado
sin hallazgos
```

No se ejecutó ningún workflow, no se leyó ningún secreto y no hubo push, merge, PR ni despliegue.
