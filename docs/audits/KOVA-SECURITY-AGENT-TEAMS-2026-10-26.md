# Auditoría de seguridad de Kova con equipos de agentes

Fecha: 2026-10-26, America/Mexico_City. Código revisado: `22dce337b277e2389555f90e752ec87db95da185`, rama `ci/fix-preview-workers`.

Estado posterior: se implementaron correcciones locales, sin despliegue. La [remediación y validación](KOVA-SECURITY-REMEDIATION-2026-10-26.md) registra el cierre del fallo de facturación, bibliotecas actualizadas, cobertura ampliada de CI y los pendientes de SO y signup compuesto. Los hallazgos y resultados que siguen son el snapshot original del commit auditado.

La revisión confirmó un fallo de prioridad alta que permite recuperar acceso comercial mediante un checkout histórico, un riesgo bajo de enumeración de cuentas y dos pendientes de prioridad media sobre dependencias y su auditoría automática. Debe corregirse la reconciliación antes de considerar cerrado el control de acceso por suscripción. No se confirmó una fuga entre negocios en el alcance revisado. Aprobaron 429 pruebas focales; tres escenarios adicionales reproducen el defecto de facturación.

Se trabajó con tres agentes especializados —autenticación y API; datos, RLS y offline; Stripe, frontend y edge— y una revisión coordinadora de evidencias, dependencias y CI/CD. Esta auditoría corresponde al checkout local indicado. No demuestra que producción ejecute el mismo código ni certifica ausencia de otras vulnerabilidades.

## SEC 01 Reconciliar un checkout histórico reactiva acceso comercial

**Prioridad alta. Confirmado mediante reproducción local de lógica real con E/S simulada.** Afecta al acceso de pago del propio negocio; no demuestra acceso a otro tenant ni compromiso de Stripe.

Entrada: `POST /api/v1/billing/checkout/reconcile`, en [billing/router.py](../../backend/app/billing/router.py#L79). Un propietario autenticado conserva `BILLING_MANAGE` cuando su suscripción está bloqueada porque necesita recuperar la facturación. Esa accesibilidad es correcta; el error está en cómo se decide la activación.

En [billing/service.py](../../backend/app/billing/service.py#L387), `payment_status == paid` **o** `status == complete` basta para activar. El upsert de un objeto `checkout.session` fuerza `subscription.status = active` en la línea 575. Aunque `_retrieve_live_period` consulta la suscripción de Stripe, sólo conserva fechas y descarta su estado. [billing/access.py](../../backend/app/billing/access.py#L62) concede acceso al estado `active`, incluso si las fechas guardadas pertenecen a un período vencido.

Un propietario que ya utilizó Checkout puede guardar el identificador de su sesión de retorno, esperar a que la suscripción quede cancelada o impagada y enviarlo de nuevo a la ruta de reconciliación. La verificación de pertenencia al tenant no impide este recorrido: la sesión antigua sí pertenece al negocio. No se necesita falsificar firmas de webhook ni modificar metadata de Stripe.

La reproducción ejecutó tres escenarios sobre funciones compiladas sin modificaciones desde el AST del código revisado:

| Estado actual devuelto por Stripe | Pago del checkout histórico | Acceso antes | Resultado después |
|---|---|---|---|
| `canceled` | `paid` | Denegado | `active`, permitido |
| `unpaid` | `paid` | Denegado | `active`, permitido |
| `incomplete` | `unpaid`, checkout `complete` | Denegado | `active`, permitido |

En los tres casos el período ya estaba vencido. La simulación sustituye repositorio y clientes externos; acredita el defecto de lógica, sin realizar una compra, llamar a Stripe o explotar producción. [Script reproducible](evidence/KOVA-SECURITY-BILLING-2026-10-26.py).

Además, la reconciliación adelanta el watermark de ciclo de vida a la hora actual (`service.py:406`). Por inspección, esto puede hacer que eventos legítimos más antiguos sean descartados y prolongar la divergencia; ese efecto de ordenamiento no se reprodujo de extremo a extremo.

La resincronización automática de fechas al consultar suscripción/dashboard no restaura el estado comercial. La reconciliación interna privilegiada sí puede corregirlo; requiere clave interna y no se encontró una ejecución automática configurada en workflows, scripts o despliegue. No se presupone que el acceso incorrecto sea indefinido.

**Corrección requerida:** autorizar el acceso desde el estado actual de la suscripción de Stripe, conservando pertenencia, customer y separación Live/Test. Una sesión histórica no debe reemplazar una suscripción posterior ni borrar sus estados de cancelación, deuda o gracia. Si no se puede obtener el estado autoritativo, no activar por inferencia. Mantener la ruta de recuperación disponible y serializar reconciliación/webhook sin adelantar artificialmente la precedencia.

**Criterios de cierre:** pruebas de API con PostgreSQL para `canceled`, `unpaid`, `incomplete`, `past_due` fuera de gracia, `complete/unpaid`, sesión ajena, replay sobre una nueva suscripción y concurrencia con webhook. Verificar que el checkout recién pagado y la recuperación legítima siguen funcionando.

Stripe documenta que un checkout `complete` puede seguir procesando el pago; `payment_status` es un atributo separado. [Contrato oficial de Checkout](https://docs.stripe.com/api/checkout/sessions/object).

## SEC 02 Dependencias con avisos pendientes de resolución

**Prioridad media de mantenimiento, con exposición condicionada por componente.** Se consultó OSV el 2026-10-27 UTC para 1,038 combinaciones únicas de ecosistema, paquete y versión de cuatro lockfiles npm, `backend/uv.lock` y `deploy/cloudflare-backend/pylock.toml`. Ocho paquetes tienen coincidencias con 59 identificadores GHSA distintos; se excluyeron alias PYSEC del conteo. Esto no significa 59 vulnerabilidades explotables en Kova. El detalle trazable está en [la evidencia JSON](evidence/KOVA-SECURITY-DEPENDENCIES-2026-10-26.json).

| Paquete fijado | Ubicación | Versión que cubre las correcciones consultadas en esa línea | Alcance observado |
|---|---|---|---|
| Mako `1.3.12` | `backend/uv.lock:611` | `1.4.2` | Aviso de traversal en Windows. Producción usa Linux y no se encontró entrada pública de selección de templates; no se confirmó explotación. |
| pypdf `6.10.0` | `deploy/cloudflare-backend/pylock.toml:134` | `6.21.2` | 42 avisos de consumo de recursos y parsing. El canvas de Workers escribe PDFs propios; no se demostró entrada de PDF externo en esa ruta. |
| `@vitest/mocker 4.1.11` | Frontend y lockfile de backend Workers | `4.1.12` | Avisos de inyección en plugin público y traversal Windows. No se encontró registro del plugin público afectado en la configuración revisada. |
| `fast-uri 3.1.8` | `frontend/package-lock.json:5881` | `3.1.9` | Cuatro avisos de interpretación de URI. Uso observado en validación de build; no se demostró flujo público explotable. |
| `serialize-javascript 7.0.5` | `frontend/package-lock.json:9734` | `7.1.3` | XSS condicionado al control del código de una función serializada. No se encontró esa entrada en Kova. |
| `undici 7.29.1` | Los tres lockfiles npm de despliegue | `7.30.1` | Avisos de DoS y SRI del cliente Node. No equivalen a un fallo del `fetch` nativo de Workers; alcance observado de tooling. |
| Vite `6.4.3` | `frontend/package-lock.json:10932` | `6.4.4` | Cinco avisos del servidor de desarrollo/editor. `vite.config.ts:175` permite acceso de red con `host: true`; explotación requiere las condiciones del aviso. Producción sirve archivos estáticos. |
| Zod `4.6.5` | Los tres lockfiles npm de despliegue | `4.6.6` | DoS con validación de colecciones grandes. No se demostró que entrada pública llegue al uso de tooling afectado. |

Los avisos y mínimos corregidos se contrastaron con los registros publicados de OSV, incluyendo [pypdf](https://github.com/py-pdf/pypdf/security/advisories/GHSA-6c7f-9265-g8fw), [Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8), [Vite](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22), [Undici](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) y [fast-uri](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg). Las versiones de la tabla son objetivos de corrección de los avisos consultados, no una certificación de compatibilidad ni de ausencia de avisos futuros.

También se inspeccionó [assistant-parser/Dockerfile](../../backend/assistant-parser/Dockerfile#L3): fija `pypdf==6.9.1`, anterior a los rangos corregidos. [parse.py:54](../../backend/assistant-parser/parse.py#L54) sí procesa PDFs externos. La ingesta documental está desactivada en la política nativa; cuando se habilita, existen contenedor sin red ni secretos, filesystem de sólo lectura, límites de CPU/memoria, timeout y presupuesto por tenant. Esas defensas reducen el impacto, pero no reparan el parser. Actualizar y ejecutar los casos adversariales antes de habilitar documentos. Esa versión adicional se detectó en Dockerfile; no forma parte de las 1,038 consultas de lockfiles.

**Criterios de cierre:** actualizar con cambios acotados y lockfiles completos, repetir el análisis de las versiones resueltas, ejecutar build/contratos y pruebas de los componentes afectados. Mantener las excepciones por falta de exposición documentadas con responsable y fecha de revisión. No cambiar expectativas de pruebas para ocultar avisos.

## SEC 03 CI deja superficies fuera de la auditoría de dependencias

**Prioridad media. Hueco de cobertura confirmado por configuración; no es prueba de explotación.** [ci.yml:380](../../.github/workflows/ci.yml#L380) audita Python del backend y npm del frontend. No audita los tres `deploy/*/package-lock.json`, el `pylock.toml` de Workers ni los paquetes instalados directamente en el Dockerfile del parser. El gate npm de build/test sólo rechaza avisos críticos; los avisos altos y medios pueden pasar por esa política.

[ci-maintenance.yml:39](../../.github/workflows/ci-maintenance.yml#L39) comprueba reproducibilidad y genera un SBOM para `backend/Dockerfile`; no ejecuta un escáner de CVE y no cubre la imagen nativa activa definida por `backend/Dockerfile.api`. Un SBOM o una firma antivirus actualizada no sustituyen la revisión de vulnerabilidades de las bibliotecas o del sistema operativo.

**Criterios de cierre:** incluir todos los lockfiles, parser e imágenes realmente desplegadas en SCA; escanear imagen nativa y parser; publicar evidencia sin secretos. Definir umbrales por exposición y excepciones explícitas en vez de omisiones de superficie. Mantener las Actions fijadas por SHA y el gate obligatorio existente.

## SEC 04 Signup permite distinguir cuentas existentes

**Prioridad baja. Riesgo de privacidad confirmado, comportamiento explícito del producto.** [auth/router.py:100](../../backend/app/auth/router.py#L100) distingue `201/account_created`, `200/email_in_use` y `200/verification_resent`; [auth/service.py:147](../../backend/app/auth/service.py#L147) decide según existencia y verificación del correo.

Un atacante puede enviar signup con el correo objetivo, una contraseña válida elegida por él y aceptación de términos. La respuesta permite distinguir si hay cuenta y si está verificada, sin controlar el buzón. Esto ayuda a seleccionar objetivos para phishing o intentos de acceso; no permite iniciar sesión.

Existen límites por IP y cuenta, normalización del correo y respuestas uniformes en login. Reducen el abuso, pero no eliminan la diferencia pública del signup. Las pruebas existentes esperan ese comportamiento; no se modificaron durante la auditoría.

**Criterio de cierre:** registrar una aceptación explícita del riesgo de privacidad o diseñar respuestas públicas uniformes con un flujo de recuperación comprensible. Ese cambio exige revisar el contrato y sus pruebas, evitando romper el reenvío legítimo de verificación.

## Controles corroborados en código

La revisión encontró defensas concretas que deben preservarse al corregir los hallazgos:

- Cookies HttpOnly para acceso y refresh, sin tokens de sesión en localStorage/sessionStorage; sesión persistida y validación de usuario/membresía en servidor; refresh y recuperación con consumo bloqueado para evitar reuso concurrente.
- CSRF para escrituras autenticadas y validación de origen donde corresponde; limitación por cuenta/IP y cierre ante fallos del limitador en rutas críticas de autenticación.
- Ops restringido por identidad inmutable y correo verificado, con MFA obligatorio, step-up por sesión y consumo único de recuperación.
- Rol runtime sin bypass RLS, contexto de tenant por transacción, grants acotados y rutas privilegiadas explícitas. Las exportaciones usan listas de campos y neutralización de fórmulas.
- Webhooks Stripe con firma raw, comparación constante, ventana de firma, control Live/Test, registro único de evento y ordenamiento por familias. El defecto SEC 01 está en la reconciliación de Checkout.
- React escapa texto; los usos de HTML crudo revisados insertan CSS constante. Markdown del asistente descarta HTML e imágenes. CSP restringe scripts, objetos y framing.
- API privada sin caché compartida; excepción acotada para imágenes raster públicas versionadas sin cookies. PWA conserva recursos estáticos y usa red para API.
- Edge con upstream fijo y normalización de metadatos de proxy; puentes de jobs/limitación privados y con entradas limitadas. Runtime nativo sin binario ni socket Docker y ejecutado con usuario no root.
- Actions externas fijadas por SHA, permisos declarados, gate de publicación y liberación limitada a `main`; Gitleaks presente con excepciones acotadas a datos sintéticos.

## Validación y límites

### Comprobación de metadatos en Supabase Production

Se usó el plugin conectado de Supabase para consultar `get_advisors(type=security)` y SELECT acotados a catálogos PostgreSQL (`pg_class`, `pg_namespace`, `pg_roles`, `pg_auth_members`, `information_schema.table_privileges` y `has_table_privilege`). No se consultaron filas del negocio, hashes de contraseñas, credenciales ni configuración secreta. Snapshot del 2026-10-27 UTC:

- 105 tablas públicas; ninguna con RLS deshabilitado.
- `kova_app`: sin superusuario, bypass RLS, creación de bases ni creación de roles.
- Login aprovisionado `kova_native_app`: hereda `kova_app`, sin esos privilegios y propietario de cero tablas públicas.
- `anon` y `authenticated`: cero tablas públicas con SELECT o permisos de escritura efectivos, incluyendo privilegios heredados.
- Asesor: nueve hallazgos `INFO rls_enabled_no_policy`, sin avisos de nivel WARN/ERROR en esa respuesta. Corresponden a `alembic_version`, tablas Ops/MFA y referencias globales/tokens descritos en [ADR 009](../adr/ADR-009-backend-only-rls-no-policy-tables.md). RLS sin políticas en esas tablas es cierre por defecto; no debe añadirse una política permisiva para eliminar el aviso. [Explicación oficial del linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

El propietario privilegiado `postgres` también es miembro de `kova_app`; su bypass y propiedad de tablas no se atribuyen al login nativo. Esta consulta comprueba atributos del rol aprovisionado, no qué URL secreta está utilizando cada proceso desplegado ni la corrección de todas las políticas o funciones. No reemplaza un smoke autenticado entre dos tenants en producción.

### Pruebas locales

| Comprobación | Resultado |
|---|---|
| `python -m unittest discover -s scripts/tests` | 62 aprobadas: políticas de CI, despliegue, jobs, recursos y recuperación. |
| `node --test deploy/cloudflare-native/test/*.test.mjs deploy/public-images.test.mjs` | 36 aprobadas. |
| Vitest: `auth/permissions`, `AuthContext.identity`, `api.identity`, `lib/csrf`, `offlineAccess`, `offline/db`, persistencia de queue/sync/syncWorker y `App.pwa-session` | 57 aprobadas en diez archivos. |
| Vitest: `deployment/dependency-security` y `deployment/vercel-config` | Siete aprobadas. La regresión de `fast-uri` protege un aviso anterior; no cubre los cuatro nuevos avisos. |
| Backend: RLS enforcement/startup/literal inventory, tenant isolation y rutas, offline/resilience, account lifecycle/export/CFDI, storefront y branches/transfers | 114 aprobadas en trece módulos, con PostgreSQL dedicado y migraciones completas. |
| Backend: auth, hardening, caducidad de sesión, refresh concurrente, límite de bytes de password, CSRF, security/remediation, Ops auth/MFA y rate limit | 153 aprobadas en once módulos; cero fallas, errores u omisiones. |
| Reproducción SEC 01 | Tres escenarios demuestran el defecto. Son evidencia de vulnerabilidad, no regresiones de una corrección. |

Total: 429 pruebas focales aprobadas, sin contar por duplicado las ejecuciones de los agentes. Las 267 pruebas backend se ejecutaron en bases separadas `kova_security_auth` y `kova_security_data`, creadas sólo para esta auditoría en un clúster PostgreSQL dedicado al puerto 55467. Los primeros intentos no alcanzaron las aserciones porque el sandbox impide TCP local; se reejecutaron con permiso fuera de esa restricción y aprobaron. La advertencia de deprecación de httpx/TestClient no afectó los resultados.

Las pruebas HTTP convencionales usan la conexión propietaria del harness y acreditan controles de aplicación; los escenarios de enforcement RLS sí conectan con `kova_app` real. No deben confundirse ambas capas de evidencia. El clúster temporal se detuvo después de terminar ambos agentes, sin modificar servicios de bases existentes. Las firmas WhatsApp, uploads y herramientas del asistente se inspeccionaron por código; sus suites específicas no se ejecutaron en esta ronda.

Para repetir las suites backend se requiere una base local desechable preparada con pgvector y definir `DATABASE_URL` exclusivamente hacia ella. Desde `backend`, con `.venv/bin` en `PATH`, se ejecutaron estos conjuntos con `pytest -q --tb=short`:

```text
app/tests/test_auth.py app/tests/test_auth_hardening.py
app/tests/test_auth_session_expiry.py app/tests/test_auth_refresh_concurrency.py
app/tests/test_auth_password_byte_limit.py app/tests/test_csrf.py
app/tests/test_security.py app/tests/test_security_remediation.py
app/tests/test_ops_auth.py app/tests/test_ops_mfa.py app/tests/test_rate_limit.py
```

```text
app/tests/test_rls_enforcement.py app/tests/test_rls_startup_batch.py
app/tests/test_rls_literal_inventory.py app/tests/test_tenant_isolation.py
app/tests/test_tenant_isolation_routes.py app/tests/test_offline_sync.py
app/tests/test_offline_sync_resilience.py app/tests/test_account_lifecycle.py
app/tests/test_connected_export.py app/tests/test_cfdi_account_lifecycle.py
app/tests/test_storefront.py app/tests/test_branches.py app/tests/test_branch_transfers.py
```

No se han modificado código del producto, contratos, migraciones, fixtures ni expectativas de pruebas.

Las suites de `deploy/cloudflare/worker.test.mjs`, `deploy/cloudflare/patch-cf.test.mjs` y `deploy/cloudflare-backend/test/gateway.test.mjs` no pudieron completarse por dependencias locales ausentes (`esbuild` y/o `cf`). Son validaciones pendientes, no defectos de seguridad confirmados. No se ejecutó el conjunto completo de pruebas de la aplicación ni un nuevo build de frontend.

Se crearon únicamente este informe y dos archivos de evidencia en `docs/audits`. Los directorios no versionados `output/marketing` y `output/qa` preexistían y se conservaron.

La revisión no incluyó ataques ni mutaciones en producción, compras, envío de mensajes, lectura manual de secretos, escaneo completo del historial de secretos, escaneo de CVE del SO de contenedores, pruebas de carga, navegador autenticado productivo o verificación completa de configuración real de DNS, WAF, IAM, R2, Stripe y Supabase. La consulta de catálogos anterior cubre sólo la postura indicada de PostgreSQL. Las configuraciones de proveedores pueden diferir del código y necesitan evidencia independiente. No se verificó la efectividad operativa de alertas, rotaciones, restauración de backups o respuesta a incidentes durante esta ronda.

La siguiente entrega debe cerrar SEC 01 con regresiones de API, resolver SEC 02 y SEC 03 según exposición, decidir SEC 04 y comprobar en el entorno desplegado el SHA, rol runtime/RLS, acceso privado al contenedor, caché y reglas de proveedores. Esta auditoría y su evidencia están consolidadas; las correcciones y la aceptación productiva permanecen pendientes.
