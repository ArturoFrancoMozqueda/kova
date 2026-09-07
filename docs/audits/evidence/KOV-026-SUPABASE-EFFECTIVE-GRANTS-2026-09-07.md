# KOV-026 — permisos efectivos de Supabase

**Fecha:** 2026-09-07  
**Proyecto:** Kova Production (`qpgp…sjrn`)  
**Base revisada:** `833c0b1`  
**Esquema:** `0067_runtime_grant_matrix` sobre PostgreSQL 17

## Resultado

El estado efectivo de los objetos actuales cumple la matriz de Kova. La Data API se deshabilitó
porque Kova accede a PostgreSQL exclusivamente desde el backend y no tiene contrato REST, GraphQL
ni `service_role` contra Supabase.

## Evidencia del proyecto real

La revisión se ejecutó con transacciones de sólo lectura y sin imprimir credenciales, UUIDs ni
filas de clientes.

| Control | Resultado |
|---|---|
| Tablas públicas | 54; todas con RLS habilitado |
| Matriz de grants | 1,296 celdas verificadas; 0 diferencias |
| Grants por columna | 4 esperados; 0 faltantes o extras |
| Rol de aplicación | `kova_app` con LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB y NOCREATEROLE |
| RLS tenant | 42 tablas con política exacta y FORCE RLS; 0 diferencias |
| Policies especiales | 46 policies totales; `tenants`, `users` y telemetría anónima coinciden con el contrato |
| Lectura A/B | Dos tenants reales; 39 tablas legibles coincidieron con ambos contextos |
| Sin contexto | `products`, `tenants` y `users` devolvieron 0 filas |
| Tablas internas | `kova_app` recibió `42501` en las 13 tablas sin permiso SELECT |
| Roles Data API | `anon`, `authenticated` y `service_role`: 0 tablas con CRUD y 0 funciones ejecutables |
| Data API HTTP | Antes del apagado, una consulta anónima `limit=0` devolvió HTTP 401 / PostgreSQL `42501` |
| Security Advisor | 0 WARN/ERROR; 9 INFO por tablas internas con RLS y sin policy, que es el diseño fail closed |

## Remediación aplicada

En producción se aplicaron las migraciones administradas
`harden_kova_direct_data_api_access` y `harden_kova_service_role_data_api_access`. Revocan acceso
actual y defaults del propietario `postgres` para tablas, secuencias y funciones públicas. Después
de aplicarlas, los tres roles de Data API quedaron con cero acceso a los objetos Kova actuales.

Supabase también conserva defaults administrados del propietario `supabase_admin`. La identidad
SQL `postgres` alojada no puede modificar esos defaults. Deshabilitar Data API cierra esa ruta para
objetos futuros creados por el proveedor. El script de aprovisionamiento ahora neutraliza esos
defaults cuando se ejecuta con una identidad capaz de asumir `supabase_admin`; de lo contrario,
emite un aviso explícito para conservar este requisito operativo. A las 13:05 (America/Mexico_City)
se apagó **Enable Data API** en el Dashboard; una recarga completa conservó el switch apagado y
mostró que ningún schema puede consultarse por `/rest/v1/`.

La prueba de migración reproduce los defaults administrados de Supabase, crea una tabla y una
función futuras como `supabase_admin`, vuelve a aprovisionar y demuestra que `anon`,
`authenticated` y `service_role` no adquieren acceso.

## Validación

- `migration_tests/test_0065_tenant_hardening.py::test_fresh_upgrade_and_reprovision_keep_internal_tables_private`: PASS en PostgreSQL 17 desechable.
- Reejecución remota posterior al DDL: 0 tablas con CRUD y 0 funciones ejecutables para los tres roles Data API.
- Supabase Security Advisor posterior al DDL: 0 WARN/ERROR.

La configuración sigue la guía oficial de
[seguridad del Data API](https://supabase.com/docs/guides/api/securing-your-api): los grants de
PostgreSQL y RLS son controles distintos, y un producto que no usa Data API debe deshabilitarla.
