# Restauración lógica del respaldo real R2

Fecha: 10 de octubre de 2026. Alcance autorizado: leer el último respaldo real,
validar checksum y restaurar únicamente `public` y `assistant_control` dentro de
PostgreSQL 17 desechable en un runner alojado de GitHub. Sin SQL en producción,
sin proyecto Supabase nuevo y sin acceso de red desde el contenedor restaurado.

## Primer intento y corrección

- Ejecución: [38072748701](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38072748701).
- Fuente: `e915e3760e0ff479cdb1d2dbef76449fc8964b43`, evento manual sobre `main`.
- Job `114273379625`: restauración fallida en etapa `container`; limpieza posterior
  completada correctamente; artefacto agregado omitido. El script también ejecutó
  su limpieza interna. No se publicó un dump ni datos de filas.
- El registro seguro indicó solamente `Restore failed during container`; no se
  imprimieron salidas del proveedor, PostgreSQL ni credenciales. Según el orden
  del script, alcanzar esa etapa significa que descarga, tamaño, encabezado custom
  y checksum SHA-256 ya habían pasado. El intento no acredita restauración íntegra.
- La implementación forzaba el socket `/tmp`, incluido en el servidor temporal
  que inicia la imagen para crear la base. El entrypoint oficial ejecuta su psql
  interno con PGHOST vacío y espera el socket predeterminado `/var/run/postgresql`.
  Esa incompatibilidad impide completar la inicialización. Fuente primaria:
  [docker-library/postgres](https://github.com/docker-library/postgres/blob/master/17/bookworm/docker-entrypoint.sh).
- [PR 188](https://github.com/ArturoFrancoMozqueda/kova/pull/188), fuente candidata
  `2c995ef5bd30bbea858a454ca1827f46a39a4aed`: conserva la ruta predeterminada en
  servidor, psql y pg_restore; declara modo 1777 para el tmpfs `/tmp` y desglosa
  etapas de diagnóstico genéricas. Conserva contenedor sin red ni puertos,
  usuario postgres, raíz de sólo lectura, capacidades eliminadas, tmpfs sin
  volúmenes persistentes y limpieza del respaldo descargado.
- Regresión del socket: falla contra el script previo y pasa con la corrección.
  Las 60 pruebas de operaciones, Ruff y `git diff --check` pasan localmente.
  No hay Docker local; el siguiente runner comprobará el arranque real corregido.

## Restauración real completada

[PR 188](https://github.com/ArturoFrancoMozqueda/kova/pull/188) se integró a main.
La nueva ejecución manual [38073545892](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/38073545892)
usó `628fac303faced6a6e95f7e8cb1317d282d9516c`. El job `114275704091`
completó correctamente restauración, limpieza posterior y artefacto agregado.
Esto confirma el arranque real corregido; no se trata de un dump sintético.

Se descargó exclusivamente `kova-r2-restore-628fac303faced6a6e95f7e8cb1317d282d9516c`,
artefacto `11677821475`, 756 bytes comprimidos. El SHA-256 del ZIP se contrastó
con el digest publicado por GitHub:
`174b40f224f874395ac8998495dab8e6adb377fb6169bab8beaaadce4f501974`.
El ZIP contiene únicamente el JSON de campos agregados esperados, con SHA y run ID
coincidentes. No se descargó el respaldo al equipo del operador.

| Comprobación real | Resultado |
| --- | --- |
| Respaldo R2 | `supabase/postgres/kova-2026-10-10T15-04-09Z.dump` |
| Fecha UTC del snapshot | 2026-10-10 15:04:09 |
| Edad al inicio | 10,139.826 s, aproximadamente 2 h 49 min |
| Tamaño del dump | 3,070,011 bytes |
| SHA-256 del dump, coincide con metadata R2 | `3b6d6d2ba2f1938dc3a83209374072c24d98adfcf0f032abee63aa83885fc8c1` |
| PostgreSQL | 17.11 (`server_version_num=170011`) |
| Revisión restaurada | `0078_drawer_bridge` |
| Restore dentro de PostgreSQL | 0.323 s |
| Drill completo con limpieza | 13.605 s |
| Tenants / órdenes / productos | 13 / 1,018 / 33 |
| Tablas public / assistant_control | 72 / 5 |
| Políticas public | 72 |
| FKs validadas / legacy sin validar | 159 / 1 |
| RLS real bajo kova_app, scope vacío y tenant seleccionado | Aprobado |
| Conciliación de pagos y lotes | Aprobada |
| Grants directos Data API en public | 0 |
| Eliminación de contenedor y dump temporal | Verificada |

El snapshot antecede los cambios de producción y operaciones posteriores a su
fecha; conserva revisión 0078, no acredita recuperar automáticamente migraciones
posteriores como 0079. El reporte distingue explícitamente una FK legacy sin
validar: el drill no presenta todos los constraints como validados. Los controles
aprobados incluyen rol runtime sin superusuario/BYPASSRLS, RLS en tablas públicas,
FORCE RLS en tablas con tenant salvo la excepción interna documentada `ops_notes`,
consulta real con scope vacío y comprobación de ausencia de órdenes ajenas.

Este drill no prueba restauración regional ni recuperación de un nuevo host
Supabase, Auth/Storage/Vault del proveedor, transferencia de tráfico, aplicación
de migraciones posteriores al snapshot ni un RTO completo del servicio. Los
13.605 segundos corresponden sólo a este ejercicio lógico en el runner.

## Revisión de la FK legacy en producción (sólo lectura)

Se consultó únicamente metadata y conteos mediante transacciones `READ ONLY`,
sin filas identificables, DDL ni cambios en registros. La única FK sin validación
histórica es `public.shifts.fk_shifts_branch`:
`FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) NOT VALID`.
No es diferible; sus cuatro triggers de enforcement están presentes y ninguno
está deshabilitado.

Conteos actuales: 13 turnos totales; uno carece de sucursal y pertenece a un tenant
que ya no existe; cero incumplimientos para tenants existentes; cero órdenes
referencian ese turno huérfano; cero movimientos de caja lo referencian. El turno
huérfano está cerrado: cero huérfanos abiertos, uno cerrado.

La migración `0068_branches`, líneas 94–122, contempla explícitamente historia
preexistente de tenants eliminados. No inventa negocios ni elimina historial
financiero para poder validar una FK; añade `NOT VALID` y valida cuando no quedan
violaciones históricas. La regresión existente
`backend/migration_tests/test_0068_branches.py::test_legacy_orphan_history_is_retained_without_allowing_new_orphans`
prueba conservar ese historial y rechazar nuevos huérfanos. Se revisó el código
de esa prueba; no se ejecutaron escrituras de prueba en producción.

[PostgreSQL 17](https://www.postgresql.org/docs/17/sql-altertable.html) documenta
que `NOT VALID` omite la comprobación retrospectiva pero mantiene la FK para
operaciones posteriores. Es una excepción histórica prevista y un residuo de
integridad documentado, sin incumplimientos encontrados en tenants existentes.
No procede validarla a ciegas: fallaría con ese registro histórico. No se borra
el turno ni se crea un tenant ficticio para cambiar el indicador del auditor.
Una eventual regularización del archivo histórico necesitaría una política
explícita de conservación y una migración revisada.
