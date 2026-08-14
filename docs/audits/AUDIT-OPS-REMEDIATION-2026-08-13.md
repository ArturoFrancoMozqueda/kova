# Auditoría de remediación OPS — 2026-08-13

Rama: `feature/audit-operations-remediation`

Alcance: parte segura y local de OPS-1…OPS-6.

Principio: ningún check local equivale a evidencia externa de Inbox, DNS, restore, conteo de caja,
purga o firma legal.

## Resultado

| ID | Estado exacto | Evidencia reproducible | Bloqueo para cerrar |
|---|---|---|---|
| OPS-1 | **En curso** | Las cinco funciones transaccionales existen en `backend/app/email/service.py`; `docs/email-deliverability.md` conserva la evidencia Gmail y enlaza el registro sin PII; el gate local falla si desaparece una plantilla. | Falta Inbox/render/enlaces/spam/móvil en Outlook y Hotmail, además de la revisión humana y monitoreo de rebotes. No se enviaron correos en este trabajo. |
| OPS-2 | **Pendiente externo** | `frontend/src/lib/support.ts` mantiene `posprojectsupport@gmail.com`; Home y legales consumen esa constante y el gate comprueba que JSON-LD y acuerdo beta coincidan. | Crear/probar recepción **y respuesta** de `soporte@kovasuite.com`, monitorear rebotes y ejecutar transición con Gmail en paralelo. No se modificaron DNS, proveedor ni buzones. |
| OPS-3 | **Pendiente externo** | Los nuevos dumps publican SHA-256 como metadata R2. `scripts/check_ops_readiness.py restore-preflight` valida localmente dump custom, checksum, SSL, session pooler 5432 y ref distinto de producción. El runbook exige preflight y registra RTO/RPO, RLS, smoke y limpieza. Hay cuatro pruebas negativas/positivas del preflight. | Hace falta backup real, destino fresco autorizado, restore, roles/RLS, conteos, smoke read-only, RTO/RPO y limpieza verificada. No se conectó ni restauró/destruyó ningún proyecto. |
| OPS-4 | **Implementado localmente; falta operación autorizada** | `docs/runbooks/shift-hygiene.md` define jornada, responsable, escalación, cola offline, conteo humano y evidencia sin PII; prohíbe cierre automático. | El turno QA observado sólo puede cerrarse con tenant confirmado, autorización y efectivo contado. No se consultó cliente real ni se cerró turno alguno. |
| OPS-5 | **Implementado localmente; falta drill autorizado** | La suite existente cubre ZIP/CSV, owner-only, reautenticación, cancelación, guard interno y purga aislada. Se añadió una aserción explícita de ventana ≥30 días. `docs/account-lifecycle.md` documenta el drill desechable y hasta 7 días adicionales en dumps R2 después de purgar. | Falta recorrer exportación → solicitud → cancelación → purga en un tenant desechable integrado, negar acceso posterior y reconciliar retención/hold legal. No se purgó ninguna cuenta. |
| OPS-6 | **Pendiente externo** | El template beta conserva precio/etapa/canal vigente. `docs/runbooks/ops-beta-gate.md` reúne límites de soporte, incidentes, escalación, datos, cambios, claims y registro por tenant sin PII. | Revisión legal profesional, identidad de las partes, acuerdo firmado y aceptación individual antes de ampliar beta pagada. |

Ningún OPS se marca **Cerrado** porque todos conservan al menos un criterio externo o autorizado sin
evidencia completa. El trabajo reduce la ambigüedad y hace repetibles los pasos previos sin afirmar
que ocurrió una operación que no ocurrió.

## Checks ejecutados

```text
python scripts/check_ops_readiness.py repository
OK: contratos locales OPS-1..OPS-6 consistentes (sin validar gates externos).

python -m unittest discover -s scripts/tests -v
5 tests, OK

git diff --check
OK
```

La CI ejecuta desde ahora el gate del repositorio y sus pruebas antes de migraciones. El check es
read-only, no requiere secretos ni red y no sustituye los drills externos.

`uv run ruff check app/tests/test_account_lifecycle.py` pasó. La ejecución local de
`uv run pytest app/tests/test_account_lifecycle.py` quedó **no verificada**: la migración de setup
no pudo autenticarse contra el PostgreSQL que ya escuchaba en `localhost:5432`. Docker Desktop no
estaba disponible para levantar `docker-compose.test.yml`; no se alteró esa base ni se intentaron
credenciales alternativas. La CI dispone de un PostgreSQL desechable y ejecutará esta suite.

## Archivos y contratos afectados

- `.github/workflows/ci.yml`: gate OPS local.
- `.github/workflows/db-backup.yml`: checksum SHA-256 verificable en metadata R2.
- `scripts/check_ops_readiness.py` y `scripts/tests/test_check_ops_readiness.py`: checks y preflight.
- `docs/runbooks/restore-supabase-backup.md`: guard de destino y evidencia RTO/RPO.
- `docs/runbooks/shift-hygiene.md`: política humana de jornada y corte.
- `docs/runbooks/ops-beta-gate.md`: checklist consolidado de ampliación beta.
- `docs/account-lifecycle.md`: drill desechable y retención residual de backups.
- `docs/email-deliverability.md`: alcance pendiente y evidencia sin PII.
- `backend/app/tests/test_account_lifecycle.py`: prueba explícita de gracia mínima.

## Acciones externas no ejecutadas

- enviar correos o inspeccionar buzones;
- cambiar DNS, Resend, Cloudflare o canal de soporte;
- consultar/cerrar turnos o usar tenants de clientes;
- descargar backups reales, crear/restaurar/eliminar proyectos Supabase;
- solicitar o ejecutar purgas reales;
- recopilar firmas o emitir conclusiones legales.
