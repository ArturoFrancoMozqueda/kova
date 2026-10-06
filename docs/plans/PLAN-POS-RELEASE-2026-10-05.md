# Expansión POS: agentes, integración y release

Fecha del plan: 2026-10-05 (America/Mexico_City). Base auditada:
`dbd5f8cac201e66ad966b9964a9cbd111119f59f`.

## Objetivo y límites externos

Completar los flujos cotidianos de tiendas mexicanas: precios y descuentos claros,
códigos de barras, clientes, compras y recepción, traspasos entre sucursales y
preparación fiscal. El usuario autorizó implementación, integración y despliegue.
No tiene contratado un PAC (proveedor autorizado que timbra CFDI) ni proveedor de
cobro con terminal. Preparar información y estados de disponibilidad no permite
emitir una factura válida ni procesar una tarjeta: ambos requieren contrato,
credenciales y verificación del proveedor antes de activarse.

## Trabajo aislado y responsabilidades

Cada agente usa una rama y un worktree nacidos de
`feature/pos-expansion-integration-20261005`. El integrador recibe commits,
revisa conflictos y mantiene una secuencia única de migraciones y contratos.
Ningún agente despliega una rama individual a producción.

| Agente / área | Rama | Worktree | Resultado y aceptación |
|---|---|---|---|
| Precios e impuestos | `feature/pos-pricing-20261005` | `/workspace/kova-wt-pricing` | Descuento/impuesto persistidos; total, devoluciones, fiscal y offline coherentes con dinero decimal |
| Clientes y código de barras | `feature/pos-customers-barcodes-20261005` | `/workspace/kova-wt-customers` | Búsqueda/cobro con código; cliente e historial aislados por tenant; venta sin cliente sigue permitida |
| Compras | `feature/pos-purchasing-20261005` | `/workspace/kova-wt-purchasing` | Proveedor, compra y recepción; recepción repetida no duplica existencias; permisos y costos verificables |
| Sucursales | `feature/pos-branch-transfers-20261005` | `/workspace/kova-wt-transfers` | Traspaso con origen/destino y acceso por sucursal; stock insuficiente rechazado; sin movimientos duplicados |
| Preparación fiscal y terminal | `feature/pos-fiscal-readiness-20261005` | `/workspace/kova-wt-fiscal` | Disponibilidad honesta; captura fiscal y borradores; sin timbrado ni cobros simulados en producción |
| Release | `feature/pos-release-audit-20261005` | `/workspace/kova-wt-release` | PostgreSQL desechable, evidencia CI y matriz de validación; gates externos permanecen abiertos |
| Integración | `feature/pos-expansion-integration-20261005` | `/workspace/kova` | Merges revisados, navegación coherente, OpenAPI generado y release del mismo SHA en ambos hosts |

Las ramas concretas de producto son las asignadas por el integrador; verificar
`git worktree list` antes de ejecutar comandos sobre ellas.

Orden: acordar contratos y numeración de migraciones; validar cada rama; integrar
clientes, precios, compras, sucursales y preparación fiscal resolviendo sus
dependencias; generar OpenAPI una vez; ejecutar regresión integrada; publicar PR;
esperar checks; merge autorizado a main; observar despliegue y aceptación.

## Matriz de validación

| Área | Pruebas requeridas | Evidencia para cerrar |
|---|---|---|
| Venta | Descuentos límites/centavos, impuestos, lector y producto inexistente, cliente opcional | Tests backend/frontend y venta real en stack local |
| Fiscal | Total fiscal concilia con venta; readiness sin proveedor; permisos; borrador no se presenta como CFDI | Tests API/UX y revisión de texto/estados |
| Compras | Recepción parcial/completa, replay, rollback ante stock/costo inválido, proveedor ajeno | Tests transaccionales y RLS con rol de aplicación |
| Traspasos | Tenant/sucursal ajenos, permisos, stock concurrente, destino correcto, replay | Tests API/RLS y movimientos conciliados |
| Offline | Payload anterior compatible, replay, precio/costos históricos, errores recuperables | Suite sync/offline y prueba de recarga de PWA |
| Migraciones | Un head, upgrade con datos existentes, downgrade/upgrade en BD desechable, grants runtime | Alembic y `migration_tests`; CI `migration reversibility` |
| Regresión | Auth cookies/CSRF, billing, devoluciones, reportes, permisos, UI móvil y teclado | Suite completa, E2E mock dev/preview, integración real y axe |
| Contratos | OpenAPI versionado, consumidores TypeScript y secretos ausentes | export/check OpenAPI, `check:api-contract`, lint/typecheck/build/secret scan |
| Producción | Fly health + DB, HTML público, API por proxy, SHA de backend y frontend | CI `release acceptance` verde para el SHA final; no basta CI de una rama anterior |

## PostgreSQL local compartido con bases aisladas

Creado en esta sesión con `docker compose -p kova-pos-test -f
docker-compose.test.yml up -d --wait db`: contenedor `kova-pos-test-db-1`,
PostgreSQL 16.15, puerto local `55432`. Las credenciales `pos:pos` son sólo
locales y ya forman parte del compose de pruebas. Bases separadas:
`pos_pricing`, `pos_customers`, `pos_purchasing`, `pos_transfers`, `pos_fiscal`,
`pos_release`, `pos_integration`. No comparten filas ni migraciones. El rol
`kova_app` es global al cluster; los fixtures lo provisionan con la contraseña
local común. No cambiarla por agente mientras corren suites paralelas.

Desde el backend del worktree correspondiente, con su BD:

```sh
export DATABASE_URL=postgresql+psycopg://pos:pos@127.0.0.1:55432/pos_integration
export UV_PROJECT_ENVIRONMENT=/workspace/kova/backend/.venv
uv run --no-sync alembic upgrade head
uv run --no-sync pytest
uv run --no-sync ruff check .
uv run --no-sync python scripts/export_openapi.py --check
```

El entorno Python existente contiene las dependencias necesarias. Si una rama
cambia dependencias, crearle un entorno propio con `uv sync --locked` en vez de
mutar el compartido mientras otro agente ejecuta pruebas. No ejecutar `down
--volumes`, downgrade o limpieza sobre una BD de otro agente. La reversibilidad
se prueba en una BD dedicada y desechable, nunca sobre producción.

## Camino de despliegue y recuperación

Fuente de verdad: `.github/workflows/ci.yml`, `docs/deployment.md` y
`frontend/scripts/release-recovery.mjs`. La liberación conserva sus protecciones:
checks de backend/frontend, E2E dev/preview, integración, auditoría de
dependencias/secretos y build reproducible → reversibilidad → captura de imagen
Fly/deployment Vercel/SHA actualmente sirviendo → Fly exact commit y candidato
Vercel sin promoción → smoke de candidato → promoción del mismo artefacto →
aceptación en alias público. Un fallo activa recuperación según la fase y el
artefacto capturado; no reconstruir una imagen supuestamente equivalente.

1. Revisar y mergear ramas locales al integrador, conservando tests e historial.
2. Actualizar contrato generado y revisar migraciones/grants/RLS en conjunto.
3. Ejecutar validación local; push de integración y PR a main disparan CI.
4. Confirmar SHA del PR y checks verdes antes de mergear; corregir fallos sin
   bajar gates ni cambiar resultados para ocultarlos.
5. El merge a main dispara CI/release automáticamente. No desplegar con CLI en
   paralelo. Mantener observación hasta `release acceptance` o recuperación.
6. Registrar PR, SHA final, run URL, migraciones, resultado de aceptación y
   limitaciones operativas. El código integrado no implica release confirmado.

## Evidencia observada y restricciones de acceso

- GitHub app `get_repo` confirmó permisos push/admin para el repo. Los tools de
  creación de PR, merge y lectura Actions están disponibles. No se encontró tool
  de workflow dispatch; el flujo automático PR/push main es suficiente.
- CLI `gh run list` devuelve `Forbidden` desde este entorno. La política de red
  permite GitHub git/package hosts, pero no `api.github.com` ni hosts Fly/Vercel/
  Kova. No evadir el proxy ni imprimir credenciales.
- Runtime observado actual: sin secretos, variables runtime ni identidades
  externas configuradas. Esto no describe el almacén de secretos de Actions.
- GitHub app `fetch` con GET de `actions/runs` sí permite inspección. Parsear
  `structuredContent.content` como JSON y resumir IDs, SHA, status y conclusión;
  no volcar logs indiscriminadamente. El tool `fetch_commit_workflow_runs` filtra
  por evento PR y no demuestra ausencia de un release push.
- [Run main 37403449665](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/37403449665)
  del SHA base terminó `success`; se verificaron jobs de Fly, Vercel candidato,
  promoción y aceptación todos `success`. Es evidencia del release previo,
  no de las funciones nuevas ni de ausencia de fallos de producto.
- [Backup 37352357597](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/37352357597),
  [recordatorios 37315147141](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/37315147141)
  y [borradores fiscales 37392500871](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/37392500871)
  terminaron `success`. Backup creado no demuestra restauración; correo enviado
  no demuestra bandeja de entrada; borrador no demuestra timbrado.
- Validación local del agente release: `alembic upgrade head` contra
  `pos_release` pasó; `python scripts/check_ops_readiness.py repository` pasó;
  `python -m unittest discover -s scripts/tests` pasó (12 tests). Las pruebas
  funcionales y producción del nuevo integrador siguen pendientes hasta existir
  el SHA final y evidencia correspondiente.

## Gates externos que siguen abiertos

| Gate | Estado documental verificable | Requisito para cierre |
|---|---|---|
| CFDI real | Sin PAC contratado; producto fiscal actual prepara evidencia/borradores | Contratar PAC, certificados/credenciales, sandbox y aceptación de emisión/cancelación |
| Cobro terminal | Sin proveedor contratado; tarjeta actual es registro manual | Elegir proveedor, contrato/credenciales, confirmación y conciliación probadas |
| Stripe live | Lifecycle test-mode documentado; `docs/current-sprint.md` no cierra live | Evidencia de checkout/webhook/past_due/grace/cancel/resume live con responsable; no realizar cargo como prueba técnica |
| Correo real | `ops-beta-gate.md`: Gmail/DNS parcial; Outlook/Hotmail pendiente | Bandeja real, enlaces/render/móvil e identidad remitente para todos los correos |
| Restore real | Último registro 2026-08-14 bloqueado por capacidad/costo, ambos slots Free ocupados | Target fresco, backup real, roles/RLS/conteos/smoke y RTO/RPO, limpieza documentada |
| Venta amplia | Acuerdos y otros gates beta no cerrados | Evidencia comercial/legal y operativa del responsable; no confundir deploy con GA |

No se cambian estas casillas a completas por implementar preparación fiscal,
pasar mocks, observar workflows verdes o tener autorización general de deploy.
Runbooks: `docs/runbooks/restore-supabase-backup.md`,
`docs/email-deliverability.md`, `docs/runbooks/ops-beta-gate.md` y
`docs/current-sprint.md`. La firma comercial y verificaciones que requieren
proveedores/personas siguen sus dueños; no se inventan evidencia ni contratos.
