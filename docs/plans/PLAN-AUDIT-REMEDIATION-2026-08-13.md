# Plan de remediación de auditoría integral — Kova

Última actualización: 2026-08-13
Estado: ejecución local integrada; publicación y gates externos finales en curso
Fuente: auditoría paralela técnica, consumidor/UX y marketing/CRO, complementada con recorrido
autenticado de producción sobre el tenant de QA autorizado.

## Corte de ejecución — 2026-08-13

Este corte sustituye los estados iniciales de “Pendiente” incluidos más abajo como baseline del
backlog. Todo el trabajo local se integró en `main` mediante feature branches por épica. No se hizo
push, deploy, cargo Stripe, cambio DNS, envío de correo, cierre de turno, restore, purga ni operación
sobre tenants de clientes.

| Épica | Estado verificable | Evidencia | Gate que permanece abierto |
|---|---|---|---|
| OFF | OFF-1..5 implementados y verificados localmente | [`AUDIT-OFF`](../audits/AUDIT-OFF-REMEDIATION-2026-08-13.md) | OFF-6: drill staging/PWA con conciliación real |
| BILL | BILL-1..3 implementados; Ruff/contratos verdes | [`AUDIT-BILL`](../audits/AUDIT-BILL-REMEDIATION-2026-08-13.md) | BILL-4 y pytest/migración integrada con Postgres/Stripe test |
| SEC | SEC-1/2/4/5/6 implementados; SEC-3 automatizado | [`AUDIT-SEC`](../audits/AUDIT-SEC-REMEDIATION-2026-08-13.md) | Smoke staging de dos tenants, build/SBOM del contenedor |
| REL | REL-1..4 implementados; E2E mocked y contratos verdes | [`AUDIT-REL`](../audits/AUDIT-REL-REMEDIATION-2026-08-13.md) | Primer deploy exacto y smoke productivo autorizado |
| TEST | TEST-1..4 automatizados y conectados a CI | [`AUDIT-TEST`](../audits/AUDIT-TEST-REMEDIATION-2026-08-13.md) | Ejecutar stack Docker/axe en CI y TEST-5 manual |
| UX | UX-1..8 implementados; 37 tests, lint, typecheck y build verdes | [`AUDIT-UX`](../audits/AUDIT-UX-REMEDIATION-2026-08-13.md) | Pase manual de dispositivos/lector cubierto por TEST-5 |
| MKT | MKT-1/2/3/4/6 y MKT-7 inmediato implementados | [`AUDIT-MKT`](../audits/AUDIT-MKT-REMEDIATION-2026-08-13.md) | MKT-5 consentimiento/caso; SEO profundo condicionado por entrevistas |
| OPS | Controles y runbooks locales reproducibles | [`AUDIT-OPS`](../audits/AUDIT-OPS-REMEDIATION-2026-08-13.md) | OPS-1..6 conservan evidencia externa u operación autorizada pendiente |
| PROD | PROD-1 cerrado como decisión; PROD-2 protocolizado | [`AUDIT-PROD`](../audits/AUDIT-PROD-REMEDIATION-2026-08-13.md), [`ADR-015`](../adr/ADR-015-expenses-standard-plan-rollout.md) | PROD-2 requiere 5–10 señales consistentes por segmento |

### Corte adicional de cierre — 2026-08-14

- Se incorporó el `origin/main` vigente (`4cc6bfe`) sin conflictos y se repitieron las 29 pruebas
  focalizadas de landing, signup, legales y precio: todas verdes.
- El backend migró hasta `head` sobre Postgres 16 efímero. La primera suite detectó dos fallos de
  integración legítimos; tras corregir el contrato de `/health` y el orden del fixture concurrente,
  la segunda suite completa terminó con salida 0.
- Vercel tiene ahora un token CI restringido al proyecto, con renovación prevista antes de
  2027-08-14; `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` están almacenados en GitHub sin
  exponer sus valores.
- Se creó un tenant productivo dedicado al smoke autenticado y sus credenciales quedaron en el
  environment `Production`. `PRODUCTION_SMOKE_ALLOW_MUTATIONS` permanece sin configurar: el smoke
  es deliberadamente read-only.
- La integración Git de Vercel queda deshabilitada por configuración para que no compita con el
  candidato inmutable, smoke y promoción del workflow.
- El gate de supply chain exige doble build reproducible y SBOM SPDX antes de migraciones o deploy.
  BuildKit local se bloqueó sin producir contenedores; GitHub Actions Linux conserva este gate
  fail-closed y será la evidencia autoritativa de publicación.
- El backup real `kova-2026-08-13T10-05-39Z.dump` fue localizado. No existe staging gratuito:
  Supabase Free ya ocupa sus dos slots y una branch temporal cuesta USD 0.01344/h, además del
  consumo medido de Fly. No se reutilizó ni alteró el proyecto CENEVAL fuera de alcance.

### Ramas integradas localmente

- `feature/audit-offline-remediation`
- `feature/audit-billing-remediation`
- `feature/audit-security-remediation`
- `feature/audit-release-remediation`
- `feature/audit-testing-remediation`
- `feature/audit-ux-remediation`
- `feature/audit-marketing-remediation`
- `feature/audit-operations-remediation`
- `feature/audit-product-remediation`

Las ramas `feature/audit-rel-test-integration`, `feature/audit-ops-preflight-hostname` y
`feature/audit-offline-e2e-race` cerraron hallazgos de revisión cruzada antes del corte final. La
última verificación integrada de offline y reportes quedó en 17/17 pruebas E2E mocked verdes. Los
gates externos anteriores impiden declarar cerrado el plan global o avanzar a venta amplia; no son
fallos ocultos de merge.

Las ramas de cierre `feature/audit-integrated-stack-closeout`,
`feature/audit-release-security-closeout`, `feature/audit-external-gates-closeout` y
`feature/audit-staging-feasibility` agregan la evidencia integrada, el supply chain reproducible,
el inventario externo y el preflight de costo/capacidad de staging.

## 1. Propósito

Este documento convierte los hallazgos pendientes de la auditoría en un backlog ejecutable. El
objetivo no es agregar alcance indiscriminadamente, sino cerrar los riesgos que separan a Kova de
una operación segura y vendible más allá de una beta controlada.

El plan distingue:

- correcciones de código;
- validaciones que requieren un entorno integrado;
- gates externos de Stripe, correo, DNS, backups y producción;
- mejoras de experiencia y confianza comercial;
- decisiones de producto que no deben implementarse sin señal de clientes.

## 2. Documentos relacionados y reglas de coordinación

- [`docs/current-sprint.md`](../current-sprint.md): tablero activo. Este plan sólo debe enlazarse
  desde allí cuando se apruebe su ejecución; no debe duplicarse completo.
- [`PLAN-GROWTH-EXECUTION.md`](PLAN-GROWTH-EXECUTION.md): fuente para correo, pilotos, telemetría,
  tarjeta, CFDI y decisiones condicionadas por señal.
- [`PLAN-CRO-FUNNEL.md`](PLAN-CRO-FUNNEL.md): fuente para experimentos y medición de conversión.
- [`../claude/release-ga-checklist.md`](../claude/release-ga-checklist.md): gate antes de GA.
- [`../claude/manual-qa-checklist.md`](../claude/manual-qa-checklist.md): QA manual de UI y a11y.
- [`../risk-register.md`](../risk-register.md): riesgos persistentes del producto.
- [`../runbooks/restore-supabase-backup.md`](../runbooks/restore-supabase-backup.md): restauración.
- [`../email-deliverability.md`](../email-deliverability.md): entregabilidad transaccional.

Reglas:

1. No marcar una tarea como cerrada sólo porque el código fue escrito. Deben existir pruebas,
   despliegue cuando corresponda y evidencia reproducible.
2. No cambiar precio, plan, trial, impuestos, Stripe ni claims comerciales sin verificar la fuente
   vigente. La evidencia actual es Standard Plan, $299 MXN/mes.
3. No resolver riesgos offline eliminando ventas pendientes. La recuperación y el aislamiento deben
   preservar los datos del negocio correcto.
4. No probar aislamiento usando datos de clientes reales. Usar dos tenants desechables y sin PII.
5. No ejecutar cargos live, cancelaciones, cierres de turno ni restauraciones destructivas sin un
   runbook, entorno objetivo y autorización explícita.
6. Los tests existentes son safety rails: no modificar expectativas para ocultar fallos.

## 3. Prioridades, tamaños y estados

### Prioridad

- **P0:** bloquea autoservicio amplio o puede comprometer ventas, acceso, tenant isolation o cobros.
- **P1:** debe cerrarse antes de GA o antes de aumentar adquisición pagada.
- **P2:** mejora de calidad, accesibilidad, conversión o mantenibilidad; no bloquea beta controlada.
- **P3:** polish o alcance condicionado por señal.

### Tamaño orientativo

- **S:** hasta 1 día efectivo.
- **M:** 2–3 días efectivos.
- **L:** 4–5 días efectivos.
- **XL:** requiere dividirse antes de entrar a sprint.

### Estado permitido

- **Pendiente:** no iniciado.
- **En curso:** implementación o evidencia parcial.
- **Implementado; falta producción:** código listo, gate desplegado pendiente.
- **Pendiente externo:** depende de proveedor, DNS, inbox, negocio o autorización.
- **Decisión requerida:** no debe implementarse antes de acordar producto/alcance.
- **Cerrado:** aceptación y evidencia completas.

## 4. Resumen ejecutivo del backlog

| ID | Resultado | Prioridad | Tamaño | Gate |
|---|---|---:|---:|---|
| OFF-1..6 | Cola offline aislada por tenant y recuperable tras crash | P0 | L | Autoservicio amplio |
| BILL-1..4 | Webhooks Stripe resistentes a eventos fuera de orden | P0 | L | Cobro amplio/live |
| SEC-1..3 | RLS productivo fail-closed y probado cross-tenant | P0 | M | Autoservicio amplio |
| REL-1..4 | Smoke real después de Vercel y Fly | P0 | M | Cada deploy a main |
| SEC-4..6 | Body limit, IP confiable y build reproducible | P1 | M | GA |
| TEST-1..5 | Suite integrada frontend–API–Postgres | P0/P1 | L | Release gate |
| UX-1..8 | Loading, a11y, navegación y warnings de React/HTML | P1/P2 | M | GA |
| MKT-1..7 | Promesas comerciales y de seguridad verificables | P1 | M | Adquisición pagada |
| OPS-1..6 | Stripe, correo, restore, turnos y evidencia operativa | P0/P1 | XL | Beta amplia/GA |
| PROD-1..2 | Decidir Gastos, Clientes y Proveedores por señal | P2/P3 | — | Decisión de producto |

### Checklist maestro de ejecución

Este checklist sirve como índice operativo. El detalle y la evidencia obligatoria de cada elemento
viven en su sección correspondiente; marcar aquí una casilla no sustituye actualizar su estado y
adjuntar evidencia.

- [ ] **Offline:** OFF-1 contrato tenant-scoped; OFF-2 migración Dexie; OFF-3 scoping completo;
  OFF-4 leases; OFF-5 pruebas; OFF-6 drill real.
- [ ] **Billing:** BILL-1 política temporal; BILL-2 watermark; BILL-3 reconciliación; BILL-4 gate
  Stripe test-mode.
- [ ] **Seguridad:** SEC-1 URL runtime obligatoria; SEC-2 RLS fail-closed; SEC-3 cross-tenant;
  SEC-4 body streaming; SEC-5 IP confiable; SEC-6 pin de build.
- [ ] **Release:** REL-1 suites explícitas; REL-2 requests inesperadas; REL-3 pipeline; REL-4 smoke
  productivo seguro.
- [ ] **Pruebas:** TEST-1 integración efímera; TEST-2 ergonomía backend; TEST-3 OpenAPI; TEST-4 axe
  real; TEST-5 QA WCAG manual.
- [x] **UX:** UX-1 loading; UX-2 Gastos; UX-3 fechas accesibles; UX-4 headings/targets; UX-5
  pluralización; UX-6 title sync; UX-7 updater React; UX-8 HTML válido.
- [ ] **Marketing:** MKT-1 tarjeta manual; MKT-2 CFDI; MKT-3 claims de Seguridad; MKT-4 etapa;
  MKT-5 prueba social; MKT-6 objeciones; MKT-7 precio/SEO.
- [ ] **Operación:** OPS-1 correo; OPS-2 soporte de dominio; OPS-3 restore; OPS-4 turnos; OPS-5
  lifecycle de cuenta; OPS-6 gate legal/comercial.
- [ ] **Producto:** PROD-1 decisión de Gastos; PROD-2 validación de Clientes/Proveedores.

---

## 5. Épica OFF — Integridad y aislamiento offline

**Resultado esperado:** una venta offline pertenece de forma inequívoca al tenant que la creó, no
puede verse ni sincronizarse bajo otra sesión y siempre vuelve a un estado recuperable después de un
crash, reload o cierre inesperado.

### OFF-1 — Diseñar el contrato tenant-scoped de la cola

- **Prioridad / tamaño / estado:** P0 / S / Pendiente.
- **Objetivo:** definir identidad, ownership y ciclo de vida antes de migrar IndexedDB.
- **Áreas:** `frontend/src/offline/types.ts`, `db.ts`, `queue.ts`, `sync.ts`, `syncWorker.ts`,
  `useSyncQueue.ts`, `SyncQueueView.tsx`.
- **Trabajo:**
  1. Añadir `tenant_id` obligatorio a nuevas filas `OfflineSaleQueueItem`.
  2. Definir cómo identificar el tenant actual desde la sesión autenticada sin aceptar un valor
     arbitrario del usuario.
  3. Definir el tratamiento de filas legacy sin tenant: cuarentena local y recuperación guiada;
     nunca asignarlas automáticamente al tenant que esté conectado.
  4. Definir si el identificador primario continúa siendo `client_uuid` o pasa a compuesto lógico
     `tenant_id + client_uuid`.
- **Criterios de aceptación:** ADR o comentario contractual aprobado; no existe un camino que
  convierta una fila legacy en venta de otro tenant; compatibilidad con clientes PWA antiguos
  documentada.

### OFF-2 — Migrar Dexie sin perder ventas

- **Prioridad / tamaño / dependencia:** P0 / M / OFF-1.
- **Trabajo:**
  1. Crear una nueva versión de `pos_offline` con índices por `tenant_id`, `status` y `updated_at`.
  2. Migrar filas conocidas conservando `client_uuid`, payload, recibo, turno, intentos y fechas.
  3. Mover filas legacy sin tenant a estado recuperable no sincronizable.
  4. Hacer la migración idempotente ante cierre durante `upgrade()`.
- **Pruebas:** upgrade desde cada versión soportada; base vacía; miles de filas; cierre/reapertura;
  legacy sin tenant; colisión de UUID.
- **Criterio de aceptación:** ninguna venta desaparece; ninguna fila sin tenant se envía; la PWA
  puede reabrir después del upgrade.
- **Rollback:** mantener lectura de la versión anterior durante una ventana de compatibilidad; no
  publicar un downgrade que elimine el nuevo ownership.

### OFF-3 — Acotar todas las lecturas, vistas y reintentos al tenant actual

- **Prioridad / tamaño / dependencia:** P0 / M / OFF-2.
- **Trabajo:**
  1. Encolar siempre con el tenant autenticado.
  2. Cambiar worker, contador, indicador, dead-letter y reintento manual para consultar únicamente
     el tenant actual.
  3. Revalidar tenant justo antes del `fetch`; un cambio de sesión durante el sync debe abortar el
     lote de forma segura.
  4. Impedir que recibos o mensajes de error de otro tenant aparezcan en la UI.
  5. Al logout, conservar filas del tenant A pero desmontar workers, timers y estado reactivo; al
     login de B, sólo B es visible.
- **Pruebas:** A encola → logout → B entra; cambio de sesión durante backoff; dos pestañas;
  reintento manual; dead-letter; contador de top bar.
- **Aceptación:** B nunca ve ni envía contenido de A; volver a A conserva y recupera sus ventas.

### OFF-4 — Introducir lease recuperable para `syncing`

- **Prioridad / tamaño / dependencia:** P0 / M / OFF-2.
- **Trabajo:**
  1. Añadir `sync_owner`/`lease_id` y `sync_started_at` o contrato equivalente.
  2. Reclamar filas en una transacción Dexie antes de enviarlas.
  3. Al arranque, devolver a `pending` leases vencidos; nunca rescatar un lease activo de otra
     pestaña.
  4. Mantener el mismo `client_uuid` e idempotency identity en todos los reintentos.
  5. Distinguir errores reintentables, 429 y fallos permanentes.
- **Pruebas:** crash después de marcar `syncing`; reload; cierre de pestaña; respuesta tardía;
  dos workers; pérdida de red después de que el servidor confirme.
- **Aceptación:** ninguna venta permanece indefinidamente en `syncing`; el backend no crea
  duplicados.

### OFF-5 — Añadir pruebas cross-tenant y de crash al gate E2E

- **Prioridad / tamaño / dependencia:** P0 / M / OFF-3, OFF-4.
- **Áreas:** `frontend/e2e/offline-sync.spec.ts`, tests unitarios de cola y worker.
- **Escenarios mínimos:**
  - A/B en navegador compartido;
  - fila legacy en cuarentena;
  - crash/reload con lease vencido;
  - servidor procesó pero cliente no recibió respuesta;
  - logout durante backoff;
  - cola con más de 100 elementos;
  - recibo local antes y después de sincronizar.
- **Aceptación:** escenarios verdes en CI y sin requests inesperadas al backend.

### OFF-6 — Ejecutar drill offline real en staging

- **Prioridad / estado:** P1 / Pendiente externo.
- **Trabajo:** usar navegador instalado/PWA, cortar red, vender con datos desechables, cerrar y abrir
  navegador, restaurar red y comprobar orden, stock, turno, reportes e idempotencia.
- **Evidencia:** fecha, commit, navegador/SO, UUID anonimizado, requests/resultados y checklist de
  limpieza. No usar tenant de un cliente.

---

## 6. Épica BILL — Orden temporal y convergencia de Stripe

**Resultado esperado:** Stripe sigue siendo fuente de verdad y un evento retrasado no puede
reactivar, cancelar o degradar incorrectamente una suscripción.

### BILL-1 — Definir la política de orden y autoridad

- **Prioridad / tamaño:** P0 / S.
- **Áreas:** `backend/app/billing/service.py`, `models.py`, `schemas.py`, `repository.py`, ADR/docs.
- **Decisiones que deben quedar explícitas:**
  1. Qué eventos mutan status, periodo, cancelación y past-due.
  2. Uso de `event.created`, versión por subscription o consulta autoritativa a Stripe.
  3. Tratamiento de reloj empatado, eventos sin `created`, replay y objetos incompletos.
  4. Qué campos pueden actualizarse aunque el evento sea stale.
- **Aceptación:** tabla evento → estado/campos/precedencia aprobada; no depender únicamente del orden
  de llegada.

### BILL-2 — Persistir watermark y rechazar eventos stale

- **Prioridad / tamaño / dependencia:** P0 / M / BILL-1.
- **Trabajo:**
  1. Crear migración backward-compatible para watermark por suscripción y, si aplica, por familia
     de estado.
  2. Bloquear la fila de suscripción durante la comparación y actualización.
  3. Registrar eventos stale como procesados/ignorados con razón observable, sin reintento infinito.
  4. Preservar deduplicación existente por `stripe_event_id`.
  5. No enviar correos duplicados por eventos stale o replay.
- **Pruebas:** `active(new)` → `canceled(old)`; `payment_succeeded(new)` → `payment_failed(old)`;
  deleted/created fuera de orden; mismo timestamp; replay; dos workers concurrentes.
- **Aceptación:** el estado final coincide con la política, no con el último request recibido.

### BILL-3 — Reconciliar con Stripe en estados ambiguos

- **Prioridad / tamaño / dependencia:** P0 / M / BILL-1.
- **Trabajo:** consultar la suscripción real sólo cuando el payload no permita una decisión segura;
  aplicar timeout/retry; no convertir una falla temporal del proveedor en acceso indefinido ni en
  bloqueo injustificado; emitir métrica/alerta de divergencia.
- **Aceptación:** el webhook responde en tiempo acotado, los fallos quedan reintentables y existe un
  job/runbook de reconciliación protegido.

### BILL-4 — Gate Stripe test-mode completo

- **Prioridad / estado:** P0 / Pendiente externo.
- **Cobertura:** checkout, webhook, active, renovación, payment_failed, grace, cancelación,
  `cancel_at_period_end`, reanudación si está soportada y eventos fuera de orden.
- **Restricciones:** entorno Stripe test separado, sin tarjetas reales, sin usar tenants de clientes.
- **Evidencia de cierre:** IDs test redactados, timeline de eventos, estado API/UI y ausencia de
  duplicados. Live mode sólo se habilita después de este gate.

---

## 7. Épica SEC — Tenant isolation y hardening de borde

### SEC-1 — Hacer obligatoria la conexión RLS separada en producción

- **Prioridad / tamaño:** P0 / S.
- **Áreas:** `backend/app/config.py`, `db.py`, `main.py`, tests de configuración.
- **Trabajo:**
  1. En producción exigir `APP_DATABASE_URL` explícita y distinta del fallback owner.
  2. Rechazar roles `rolsuper`, `rolbypassrls` o propietarios de tablas tenant-scoped.
  3. Mantener `MIGRATION_DATABASE_URL`/sesión privilegiada sólo para rutas explícitamente
     autorizadas.
  4. No imprimir URLs, passwords ni secretos en logs de postura.
- **Aceptación:** producción no arranca con owner/super/BYPASSRLS ni sin URL runtime dedicada.

### SEC-2 — Convertir `assert_rls_active` en gate fail-closed

- **Prioridad / tamaño / dependencia:** P0 / M / SEC-1.
- **Trabajo:** comprobar `FORCE ROW LEVEL SECURITY`, policies `USING`/`WITH CHECK` y rol runtime
  sobre una lista canónica de tablas tenant-scoped; fallar boot en producción ante error o postura
  incompleta; permitir modo diagnóstico sólo en local/CI explícito.
- **Pruebas:** DB inaccesible, tabla sin FORCE, policy faltante, owner, BYPASSRLS, rol correcto.
- **Aceptación:** no existe rama de producción que sólo registre el error y continúe.

### SEC-3 — Smoke cross-tenant de datos reales desechables

- **Prioridad / tamaño / dependencia:** P0 / M / SEC-2.
- **Escenarios:** dos tenants; IDs adivinados; list/detail; creación con tenant forjado; update/delete;
  reportes; imágenes; recibos; billing; exportación; cola offline si aplica.
- **Aceptación:** app y SQL/RLS bloquean ambos sentidos; pruebas corren con rol runtime no-owner.
- **Evidencia:** commit, migración, usuario DB/flags sin secretos y matriz endpoint × operación.

### SEC-4 — Aplicar límite real a bodies sin `Content-Length`

- **Prioridad / tamaño:** P1 / M.
- **Áreas:** `backend/app/middleware/body_size.py`, tests, proxy/deployment.
- **Trabajo:** envolver `receive` ASGI y contar bytes acumulados; abortar con 413 al superar el
  máximo; preservar límites menores de logo/producto; verificar límite equivalente en proxy.
- **Pruebas:** JSON y multipart con/sin longitud, chunked, valor inválido, exactamente en el límite,
  cliente que corta conexión.

### SEC-5 — Definir una fuente de IP confiable para rate limit

- **Prioridad / tamaño:** P1 / S.
- **Trabajo:** documentar headers garantizados por Fly/Vercel; no confiar en el primer
  `X-Forwarded-For` aportado por cliente; normalizar IPv4/IPv6; mantener rate limit fail-closed en
  auth.
- **Pruebas:** header falsificado, cadena de proxies, header ausente, IPv6, dos clientes reales.
- **Aceptación:** cambiar `X-Forwarded-For` desde internet no permite rotar el bucket.

### SEC-6 — Pin del runtime de build backend

- **Prioridad / tamaño:** P2 / S.
- **Área:** `backend/Dockerfile`.
- **Trabajo:** sustituir `uv:latest` por versión y preferentemente digest; documentar proceso de
  actualización; verificar SBOM/audit del contenedor.
- **Aceptación:** builds repetidos desde el mismo commit resuelven el mismo runtime.

---

## 8. Épica REL — Deploy y smoke de producción

### REL-1 — Separar nombres de suites

- **Prioridad / tamaño:** P0 / S.
- **Trabajo:** distinguir en scripts y CI `e2e-mocked`, `integration` y `production-smoke`; impedir
  que un job llamado smoke termine verde si todos los casos live fueron skipped.
- **Aceptación:** CI reporta cantidad ejecutada/omitida y falla si el smoke productivo ejecuta cero
  pruebas.

### REL-2 — Hacer fallar E2E ante requests API inesperadas

- **Prioridad / tamaño:** P1 / M.
- **Trabajo:** allowlist explícita por escenario; cualquier request no interceptada contra el proxy
  local debe fallar, salvo telemetría declarada; eliminar verdes con `ECONNREFUSED` ocultos.
- **Aceptación:** retirar un mock o cambiar un endpoint rompe la prueba con URL/método legibles.

### REL-3 — Reordenar el pipeline alrededor de Vercel y Fly

- **Prioridad / tamaño:** P0 / M.
- **Área:** `.github/workflows/ci.yml`.
- **Orden propuesto:** checks → migrations → deploy Vercel/Fly → health/read-only smoke → smoke
  autenticado autorizado → promoción/aceptación.
- **Trabajo:** esperar ambos deployments exactos del commit; no validar un Vercel nuevo contra Fly
  anterior sin registrarlo; definir rollback si health o contrato falla.
- **Aceptación:** ningún deploy backend a main queda sin prueba posterior.

### REL-4 — Diseñar smoke productivo seguro e idempotente

- **Prioridad / tamaño / dependencia:** P0 / M / REL-3.
- **Cobertura mínima:** landing, login, session refresh, billing read, catálogo, inventario, turno,
  una venta marcada como smoke si está autorizada, recibo, reportes y logout.
- **Seguridad:** tenant exclusivo, producto/stock controlado, referencia única, limpieza definida,
  nunca cancelar suscripción ni tocar Stripe live.
- **Aceptación:** cero errores consola/red; correlación por `request_id`; datos creados identificables
  y conciliables; credenciales sólo en secret store.

---

## 9. Épica TEST — Integración y ergonomía de pruebas

### TEST-1 — Entorno efímero frontend–FastAPI–Postgres

- **Prioridad / tamaño:** P0 / L.
- **Trabajo:** levantar Postgres limpio, aplicar migraciones, provisionar rol runtime RLS, iniciar API
  y frontend, crear dos tenants fixtures por API segura y ejecutar Playwright sin mocks para flujos
  críticos.
- **Aceptación:** reproducible local/CI; ninguna dependencia de Supabase/Stripe live; teardown
  automático sólo del entorno efímero validado.

### TEST-2 — Gate backend fácil de ejecutar en Windows y CI

- **Prioridad / tamaño:** P1 / M.
- **Problema observado:** pytest local produjo errores de setup por credenciales de Postgres, no
  fallos de assertions.
- **Trabajo:** comando documentado para iniciar DB, migrar y ejecutar pytest; health previo con error
  accionable; evitar problemas de `.venv/lib64`; mantener CI como fuente de release.
- **Aceptación:** una máquina limpia sigue el runbook y obtiene resultados funcionales, no cientos de
  errores de conexión.

### TEST-3 — Contratos OpenAPI frontend/backend

- **Prioridad / tamaño:** P1 / M.
- **Trabajo:** exportar OpenAPI en CI, detectar diff, validar clientes/DTO críticos y exigir revisión
  explícita ante cambios de contrato.
- **Aceptación:** un campo renombrado o status code cambiado falla antes del deploy.

### TEST-4 — Accesibilidad automatizada que sí evalúe contraste

- **Prioridad / tamaño:** P1 / M.
- **Trabajo:** ejecutar axe en navegador real, no depender del canvas ausente de JSDOM; incluir login,
  catálogo, Caja, Ventas, Análisis, Settings y modales financieros.
- **Aceptación:** cero violaciones críticas/serias; contraste auditado en superficies reales.

### TEST-5 — Pase manual WCAG y dispositivos

- **Prioridad / estado:** P1 / Pendiente externo.
- **Cobertura:** teclado completo, lector NVDA/VoiceOver, focus traps, retorno de foco, zoom 200%,
  reduced motion, 320/360/390 px, tablet y escritorio.
- **Evidencia:** checklist firmado con navegador/SO, capturas de defectos y retest.

---

## 10. Épica UX — Experiencia, accesibilidad y calidad visible

### UX-1 — Estados de carga en hard navigation

- **Prioridad / tamaño:** P1 / M.
- **Rutas observadas:** `/register`, `/shifts`, `/catalog`, `/inventory`.
- **Trabajo:** conservar shell y renderizar skeleton con nombre de la vista; diferenciar sesión,
  bundle y datos; no mostrar main vacío; medir tiempo hasta contenido accionable.
- **Pruebas:** red lenta, cold cache, sesión fresca, PWA returning, navegación SPA.
- **Aceptación:** feedback visible antes de 500 ms y ninguna pantalla vacía durante cargas de 1–5 s.

### UX-2 — Resolver la redirección silenciosa de Gastos

- **Prioridad / tamaño:** P1 / S.
- **Áreas:** `frontend/src/expenses/ExpensesView.tsx`, feature flags y routing.
- **Decisión:** si `margin_reports` está apagado, mostrar explicación y destino intencional o no
  registrar la ruta; si Gastos es parte del plan activo, habilitarlo con su gate correcto.
- **Aceptación:** abrir `/expenses` nunca transporta silenciosamente a Análisis; copy y navegación
  coinciden con el entitlement.

### UX-3 — Etiquetar filtros de fecha para accesibilidad

- **Prioridad / tamaño:** P1 / S.
- **Áreas:** `frontend/src/orders/OrderListView.tsx` y rango personalizado de Análisis.
- **Trabajo:** `label` + `htmlFor`/`id`, nombre accesible único, error y ayuda asociados.
- **Pruebas:** Testing Library por role/name y axe real.
- **Aceptación:** lector anuncia “Desde” y “Hasta” con tipo/estado correctos.

### UX-4 — Corregir jerarquía de headings y targets móviles

- **Prioridad / tamaño:** P2 / S.
- **Trabajo:** un `h1` por Caja; conservar jerarquía de catálogo/carrito; ampliar “Ver análisis por
  hora” a mínimo 24×24 CSS px y preferentemente 44 px para comodidad.
- **Aceptación:** heading outline lógico y targets WCAG 2.2 AA.

### UX-5 — Pluralización es-MX

- **Prioridad / tamaño:** P2 / S.
- **Casos observados:** “1 ventas”, “1 órdenes”.
- **Trabajo:** helpers/copys con singular/plural, incluyendo 0, 1 y n; revisar Pedidos, empleados,
  productos y turnos.
- **Pruebas:** snapshots semánticos o unit tests de mensajes para 0/1/2.

### UX-6 — Título de Cola de sincronización

- **Prioridad / tamaño:** P2 / S.
- **Trabajo:** usar `useDocumentTitle`, añadir copy `Cola de sincronización · Kova` y test de ruta.
- **Aceptación:** title correcto al entrar, volver y navegar desde PWA.

### UX-7 — Eliminar side effect dentro del updater de React

- **Prioridad / tamaño:** P1 / S.
- **Área:** `frontend/src/register/RegisterView.tsx` en `removeItem`.
- **Trabajo:** calcular/remover de forma pura; disparar toast fuera de `setCart`; preservar undo y
  orden de líneas.
- **Pruebas:** StrictMode, doble render, undo, producto inexistente; cero warning
  “Cannot update ToastProvider while rendering”.

### UX-8 — Corregir HTML inválido en reportes

- **Prioridad / tamaño:** P2 / S.
- **Áreas:** `ProductInventoryAnalysis.tsx`, `badge.tsx` o contenedor apropiado.
- **Trabajo:** evitar `<div>` dentro de `<p>` sin cambiar la semántica visual.
- **Aceptación:** cero `validateDOMNesting` y árbol accesible correcto.

---

## 11. Épica MKT — Precisión comercial y confianza

### MKT-1 — Aclarar tarjeta manual en los puntos de decisión

- **Prioridad / tamaño:** P1 / S.
- **Superficies:** landing, precio, FAQ, signup/billing cuando corresponda y Seguridad.
- **Copy contractual sugerido:** “Kova registra pagos hechos en tu terminal; Kova no procesa el
  dinero”. Debe revisarse con producto/legal antes de publicar.
- **Aceptación:** ningún texto “cobrar con tarjeta” puede interpretarse razonablemente como terminal
  integrada; no se degrada la claridad del hero.

### MKT-2 — Responder CFDI sin prometer roadmap

- **Prioridad / tamaño:** P1 / S.
- **Trabajo:** FAQ explícita: CFDI no disponible actualmente; el texto fiscal del recibo no equivale
  a factura; enlazar contacto para confirmar fit; no nombrar PAC ni fecha.
- **Aceptación:** landing, recibo, ventas y soporte no generan expectativas contradictorias.

### MKT-3 — Auditar y versionar claims de Seguridad

- **Prioridad / tamaño:** P1 / M.
- **Trabajo:** inventariar cada claim de `/seguridad`; asociar control, owner, última evidencia y
  caducidad; suavizar absolutos como “infalible”; no afirmar restore probado hasta completar OPS-3;
  evitar detalles criptográficos frágiles que envejezcan.
- **Aceptación:** cada claim tiene evidencia vigente o lenguaje de alcance honesto.

### MKT-4 — Alinear etapa de producto

- **Prioridad / tamaño:** P1 / S.
- **Problema:** landing parece abierta/estable; Seguridad y Billing hablan de beta.
- **Decisión:** beta controlada, beta abierta o GA. Definir disponibilidad, soporte, límites y CTA.
- **Aceptación:** landing, signup, billing, legales, emails y soporte usan la misma etapa.

### MKT-5 — Fortalecer prueba social con consentimiento

- **Prioridad / tamaño:** P2 / M.
- **Trabajo:** convertir al menos un testimonio en mini caso verificable con persona/cargo, ciudad,
  contexto, periodo y resultado; obtener permiso; no inventar métricas.
- **Aceptación:** autorización archivada fuera de git si contiene PII y copy trazable a evidencia.

### MKT-6 — Completar objeciones comerciales

- **Prioridad / tamaño:** P2 / S.
- **Preguntas:** terminal vs. Kova, CFDI, IVA/impuestos, fin del trial, soporte/tiempos, exportación
  después de cancelar, funcionamiento offline y anti-fit.
- **Aceptación:** respuestas verificadas contra producto, billing y legales; FAQ sigue escaneable.

### MKT-7 — Eliminar drift de precio/SEO y ampliar adquisición con señal

- **Prioridad / tamaño:** P1/P2 / M.
- **Trabajo inmediato:** derivar JSON-LD de la fuente canónica `standardPlan.ts`; actualizar robots,
  sitemap/lastmod y rutas privadas; probar canonical/noindex.
- **Trabajo condicionado:** crear 3–5 páginas profundas por vertical/problema sólo después de
  entrevistas; evitar páginas programáticas delgadas.
- **Aceptación:** precio UI/JSON-LD/test idéntico; nuevas páginas aportan contenido verificable.

---

## 12. Épica OPS — Gates externos y disciplina operativa

### OPS-1 — Cerrar entregabilidad de los cinco correos

- **Prioridad / estado:** P0 / En curso en `PLAN-GROWTH-EXECUTION`.
- **Trabajo:** dominio remitente, SPF, DKIM, DMARC y MX; Gmail, Outlook y Hotmail; verificar sender,
  enlaces, idioma, spam y móvil para verificación, reset, bienvenida, recibo y fin de trial.
- **Aceptación:** evidencia de inbox por proveedor sin exponer direcciones ni tokens.

### OPS-2 — Migrar soporte a dominio propio

- **Prioridad / dependencia:** P1 / OPS-1.
- **Trabajo:** crear `soporte@kovasuite.com` sólo cuando entregue correctamente; centralizar constante;
  actualizar landing, app, JSON-LD, legales y plantillas; monitorear rebotes.
- **Aceptación:** no retirar Gmail hasta comprobar recepción y respuesta del dominio.

### OPS-3 — Ejecutar restore drill R2 → Supabase fresco

- **Prioridad / estado:** P0 / Pendiente externo.
- **Trabajo:** seleccionar backup real, crear destino vacío autorizado, restaurar, aplicar/verificar
  roles/RLS, comparar conteos y checksums seguros, ejecutar smoke read-only y destruir únicamente el
  proyecto temporal verificado.
- **Aceptación:** RTO/RPO medidos, gaps documentados y runbook actualizado.

### OPS-4 — Hygiene de turnos del tenant QA

- **Prioridad / tamaño:** P1 / S operativo.
- **Problema observado:** turno activo con 22 días.
- **Trabajo:** definir política de jornada, responsable y recordatorio/escalación; cerrar el turno QA
  sólo con autorización y efectivo contado; no automatizar un cierre financiero sin humano.
- **Aceptación:** tenants piloto no acumulan múltiples jornadas silenciosamente.

### OPS-5 — Verificar exportación, eliminación y retención

- **Prioridad / estado:** P1 / Pendiente externo.
- **Trabajo:** tenant desechable con datos; export ZIP/CSV, solicitud, ventana reversible ≥30 días,
  cancelación y purga; contrastar legales y backups.
- **Aceptación:** datos exportables completos, tenant inaccesible tras purga y retención documentada.

### OPS-6 — Cerrar gate legal/comercial de beta

- **Prioridad / estado:** P1 / Pendiente externo.
- **Trabajo:** acuerdo firmado, límites de soporte, respuesta a incidentes, canal de escalación,
  política de cambios y claims revisados; no sustituye asesoría legal profesional.
- **Aceptación:** cada tenant pagado conoce etapa, soporte, tratamiento de datos y limitaciones.

---

## 13. Épica PROD — Decisiones de alcance, no implementación automática

### PROD-1 — Decidir el futuro de Gastos

- **Prioridad / estado:** P2 / Decisión requerida.
- **Preguntas:** ¿es parte del Standard Plan actual?, ¿depende de `margin_reports`?, ¿qué tenants lo
  tienen?, ¿la landing/reportes implican margen neto con gastos?
- **Salida esperada:** una decisión de entitlement y navegación. Sólo después se implementa UX-2.

### PROD-2 — Validar Clientes/CRM y Proveedores/Compras

- **Prioridad / estado:** P3 / Diferido por señal.
- **Situación:** clientes sólo existe como datos dentro de Pedidos; no hay CRM independiente ni
  proveedores/compras.
- **Trabajo antes de código:** entrevistar pilotos, medir frecuencia/intensidad, separar directorio,
  historial, fiado, compras, recepción y costo; comparar contra `docs/deferred-scope.md`.
- **Aceptación para abrir implementación:** al menos 5–10 datos consistentes por segmento y decisión
  explícita de alcance. No prometer estas funciones mientras estén diferidas.

---

## 14. Orden recomendado de ejecución

### Fase 0 — Preparación y contención

1. Aprobar este plan y enlazarlo desde el sprint activo sin duplicarlo.
2. No ampliar autoservicio ni Stripe live mientras P0 siga abierto.
3. Crear tenants/Stripe test/staging desechables y secret store para los gates.
4. Registrar riesgos OFF, BILL, RLS y deploy en `risk-register.md` con owner.

### Fase 1 — Integridad crítica

1. OFF-1 → OFF-5.
2. BILL-1 → BILL-3.
3. SEC-1 → SEC-3.
4. REL-1 → REL-4.
5. TEST-1 y TEST-2 en paralelo cuando no interfieran con las migraciones.

### Fase 2 — Hardening y experiencia

1. SEC-4 → SEC-6.
2. UX-1 → UX-3 y UX-7 primero.
3. UX-4 → UX-6 y UX-8.
4. TEST-3 → TEST-5.

### Fase 3 — Confianza comercial

1. MKT-1 → MKT-4 antes de aumentar anuncios.
2. MKT-6 y parte inmediata de MKT-7.
3. MKT-5 y páginas SEO sólo con consentimiento/investigación.

### Fase 4 — Gates externos

1. BILL-4, OFF-6 y smoke productivo.
2. OPS-1 → OPS-3.
3. OPS-5 y OPS-6.
4. Revisar checklist GA completo; decidir expansión.

## 15. Estrategia de PRs

No combinar todos los hallazgos en una rama grande. Secuencia sugerida:

1. `feature/offline-tenant-ownership`
2. `feature/offline-sync-lease-recovery`
3. `feature/stripe-event-ordering`
4. `feature/rls-fail-closed`
5. `feature/post-deploy-production-smoke`
6. `feature/integration-test-environment`
7. `feature/authenticated-loading-states`
8. `feature/a11y-route-cleanup`
9. `feature/trust-copy-card-cfdi`
10. `feature/security-claims-evidence`

Cada PR debe incluir una sola historia principal, migración sólo cuando sea necesaria, rollback,
pruebas estrechas y evidencia manual proporcional al riesgo.

## 16. Verificación mínima por tipo de cambio

### Frontend

```powershell
cd frontend
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Añadir el E2E específico de la tarea; no depender únicamente de la suite mocked.

### Backend

```powershell
cd backend
$env:UV_PROJECT_ENVIRONMENT=".venv-win"
uv run ruff check .
uv run pytest <tests focalizados>
```

Para migraciones: upgrade → downgrade seguro cuando aplique → re-upgrade, un solo head y prueba con
rol runtime RLS.

### Producción/staging

- commit/deployment exacto;
- health API y DB;
- consola y red sin fallos;
- request IDs relevantes sin payload sensible;
- fresh y returning PWA;
- desktop y móvil;
- rollback verificado o ensayado.

## 17. Definition of Done global

Una tarea sólo puede cerrarse cuando:

- implementación revisada;
- contratos públicos preservados o versionados explícitamente;
- pruebas nuevas demuestran el escenario original y el negativo;
- tests existentes siguen verdes;
- no se debilitan auth, cookies, CSRF, RLS, billing, tenant isolation ni idempotencia;
- logs/telemetría no contienen PII, cookies, tokens, IDs de pago o secretos;
- documentación/runbook actualizado;
- producción o proveedor validado cuando la tarea depende de ello;
- evidencia y limitaciones registradas;
- QA manual proporcional completado.

## 18. Gate para avanzar de beta controlada a venta amplia

Todos los siguientes puntos deben estar cerrados o aceptados formalmente con riesgo documentado:

- OFF-1..6.
- BILL-1..4.
- SEC-1..5.
- REL-1..4.
- TEST-1, TEST-2, TEST-4 y TEST-5.
- OPS-1, OPS-3, OPS-5 y OPS-6.
- Claims de tarjeta, CFDI, beta y Seguridad alineados.
- Stripe live sólo después del smoke test-mode completo y aprobación explícita.

La ausencia de fallos en el recorrido feliz del tenant QA no sustituye estos gates: esa evidencia
confirma que el núcleo funciona, pero no prueba crashes, replays, aislamiento cross-tenant,
restauración ni proveedores externos.
