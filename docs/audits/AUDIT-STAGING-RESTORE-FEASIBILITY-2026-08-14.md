# Viabilidad de staging y restore — 2026-08-14

Rama: `feature/audit-staging-feasibility`

Commit base: `b49585c5396fd6c7a469a3b4610cc0a57001b0de`.

## Alcance y regla de seguridad

Se ejecutaron únicamente consultas de lectura sobre Supabase, GitHub Actions y Fly. No se leyeron
valores de secretos ni datos de tenants; no se creó, pausó, restauró o eliminó un proyecto; no se
desplegó una app; no se descargó el dump de producción.

La condición de este corte fue intentar cerrar OPS-3 y preparar OFF-6/BILL-4 sólo si existía un
destino desechable sin costo nuevo y separado de producción.

## Resultado

**No existe actualmente un destino Supabase desechable sin costo nuevo.** La organización `PoS`
está en plan Free y tiene dos proyectos activos, que es la capacidad gratuita documentada:

- `PoS Project`, saludable, PostgreSQL 17, `us-west-1` (producción de Kova);
- `CENEVAL Study App`, saludable, PostgreSQL 17, `us-east-1` (aplicación ajena a este alcance).

No se pausó ni reutilizó el segundo proyecto. Hacerlo sería una mutación destructiva sobre otra
aplicación y no constituiría un staging aislado válido.

La consulta de costo de Supabase devolvió:

- proyecto: USD 0/mes, pero sin un tercer slot Free disponible;
- branch: USD 0.01344/hora.

No se confirmó costo ni se creó branch/proyecto. La documentación vigente también indica que
«Restore to a New Project» para backups físicos está reservado a planes pagados y genera un
proyecto adicional con costo. Para este dump lógico sigue siendo válida la ruta de `pg_restore` a
un proyecto Free nuevo, en cuanto exista un slot autorizado.

## Backup real disponible

El workflow `Supabase database backup` run `31689517306` terminó correctamente:

- inicio UTC: `2026-08-13T10:05:04Z`;
- SHA de workflow: `82cd0c3cc5ed94b324ee74860371e2b4a638afe1`;
- dump: `kova-2026-08-13T10-05-39Z.dump`;
- tamaño reportado: 2.3 MiB;
- cliente: PostgreSQL 17.10;
- upload R2 y retención: aprobados; ocho objetos conservados.

Ese run fue producido antes de que el workflow publicara metadata SHA-256. Por ello, el artefacto
es seleccionable pero conserva la limitación explícita del runbook: al descargarlo se deben
contrastar tamaño, cabecera custom y run exacto. Para tener checksum remoto confiable hay que
ejecutar el workflow actualizado después de integrarlo en la rama que GitHub utiliza.

Las credenciales R2 sólo existen como secretos de GitHub Actions y no están disponibles en esta
estación. No se intentó extraerlas ni publicar el dump como artifact de Actions.

## Fly y prerequisitos OFF-6/BILL-4

Fly sólo muestra `pos-project-backend`, que es producción y ejecuta dos Machines de 1 GiB en `dfw`.
No existe app de staging. La documentación vigente de Fly indica que Machines iniciadas se cobran
por segundo y que no existe una garantía general de free tier; crear otro backend no cumple la
condición de costo cero sin revisar antes la factura/allowance privada de la organización.

Además:

- no hay branch Supabase existente para `PoS Project`;
- Supabase CLI, AWS CLI y Stripe CLI no están instalados localmente;
- `pg_restore` y `psql` 17.10 sí están disponibles;
- el backend de producción no es un destino aceptable para OFF-6 o BILL-4;
- sin Postgres aislado no es seguro crear tenants desechables ni probar webhooks Stripe test.

## Decisión de gates

| Gate | Estado en este corte | Motivo verificable |
|---|---|---|
| OPS-3 | **Bloqueado por capacidad/costo** | Hay backup real y cliente PG17, pero no destino Supabase Free disponible ni dump accesible localmente. |
| OFF-6 | **Bloqueado por staging** | No hay Postgres/backend/frontend aislados; producción no puede usarse para un corte real de red con datos desechables. |
| BILL-4 | **Bloqueado por staging/Stripe test** | No hay base/backend aislados ni Stripe CLI/secret store test; no se reutilizaron secretos live. |

## Desbloqueo mínimo

Una de estas decisiones humanas permite continuar OPS-3:

1. pausar o eliminar **de forma autorizada por su propietario** un proyecto Free que ya no se use;
2. crear una organización/cuenta Supabase con slot Free legítimo y acceso autorizado;
3. aprobar el costo de una branch/proyecto temporal, después de que Supabase muestre el importe y
   antes de confirmar la creación.

Después: disparar el workflow actualizado, descargar el dump desde R2, validar checksum/cabecera,
ejecutar `restore-preflight`, restaurar, verificar roles/RLS/conteos/smoke, medir RTO/RPO y limpiar
únicamente el project ref temporal validado. OFF-6 y BILL-4 requieren además backend/frontend de
staging y secretos Stripe test separados; una app Fly mínima tiene costo medido mientras corre.

## Fuentes actuales consultadas

- Supabase: Database Backups, Restore to a New Project, Backup and Restore using the CLI, Billing
  FAQ y Branching.
- Fly: Resource Pricing y Cost Management.
- Estado conectado de Supabase, GitHub Actions y Fly al momento del corte.
