# CI y política de pruebas de Kova

## Flujo

Un workflow principal valida PR y `main`; `CI maintenance` ejecuta reproducibilidad/SBOM semanalmente, manualmente y como workflow reutilizable cuando cambia su infraestructura.

Todos los PR con código ejecutan **las suites completas**. No hay selección de casos por diff, sharding ni workers de pytest compartiendo una base. El filtro únicamente omite trabajo para documentos o especializa parser/reproducibilidad. Un diff ausente o una ruta desconocida activa todos los gates. Documentación segura: `README.md`, `CHANGELOG.md` y Markdown bajo `docs/`; scripts u otros archivos dentro de `docs/` ejecutan las suites.

`CI required` falla si falta, falla, se cancela o se omite una validación aplicable. Solo admite omisiones indicadas por la clasificación. Publicar requiere este resultado, un push a `main` y cambios de código. Los PR obsoletos se cancelan; los releases se serializan.

## Inventario y dependencias

| Suite | Comportamiento protegido | Dependencias | Medición |
|---|---|---|---|
| Backend pytest + BDD (1,035 casos tras depuración) | Sesiones, CSRF, permisos/RLS, ventas, dinero, billing, CFDI, inventario, concurrencia, offline, reportes y asistente | Python 3.12, uv.lock, Postgres 16 + pgvector, transacciones aisladas | `backend/reports/backend.xml`, 40 casos más lentos con setup/call/teardown |
| Migraciones (9 casos) | Upgrade/downgrade/upgrade; datos poblados, atribución de sucursal y grants | Base Postgres desechable propia, Alembic | `backend/reports/migrations.xml`, durations |
| Vitest (792 casos) | Comportamiento de componentes, persistencia IndexedDB, permisos, cálculos, PWA y secretos en fuente | Node 24, package-lock, jsdom/fake-indexeddb | `frontend/reports/vitest.xml` |
| Playwright preview | Interacciones, rutas/prerender, variantes móviles y offline sobre bundle compilado | Chromium, build de producción; APIs simuladas explícitamente | `frontend/reports/preview.xml`, HTML, screenshots y traces de fallos |
| Playwright stack real (4 casos) | Venta real, stock y cambio; aislamiento entre tenants; accesibilidad de vistas y modal financiero | Docker Compose, API real, Postgres y rol de aplicación sin bypass RLS | `frontend/reports/integration.xml`, HTML y diagnóstico |
| Contratos de release (21 casos; uno exclusivo de Windows) | SHA/health/proxy, orden de promoción y restauración, incidentes de recuperación | Node; proveedores simulados, sin credenciales | Log de `test:release-contract` |
| Contratos operativos/política CI (26 casos) | Filtros conservadores, gates obligatorios, pinning y schedules existentes | Python estándar | Log de `unittest` |
| Parser | Rechazo adversarial y aislamiento de archivos de negocio | Contenedor y firmas antivirus actuales | Log del job |
| Reproducibilidad/SBOM | Dos builds idénticos y lista de dependencias | BuildKit, bases fijadas por digest | SBOM por commit |
| Secretos/dependencias | Gitleaks, cuatro locks npm completos, locks Python nativo/Workers, paquetes directos del parser y bundle público | Git completo, npm audit, pip-audit 2.10.1 | JSON por inventario y comprobación del bundle |
| CVE de imágenes | Imágenes nativa y parser realmente construidas; paquetes OS y Python transitivos | Trivy 0.76.1 fijado por digest, archivos `docker save` sin socket ni credenciales | JSON por imagen, retención 14 días |

Las duraciones de JUnit incluyen trabajo por caso; el tiempo de runner se mide con timestamps de GitHub e incluye preparación. No se comparan estos números como si fueran la misma métrica.

## Política de vulnerabilidades

`scripts/audit_dependencies.py inventory` verifica que todos los lockfiles versionados estén
clasificados: frontend, gateway, controlador Workers y controlador nativo para npm;
`backend/uv.lock` y `deploy/cloudflare-backend/pylock.toml` para Python. Agregar o retirar
un lockfile sin actualizar el inventario falla. Python incluye dependencias de desarrollo
y versiones alternativas del lock, sin instalar ni ejecutar los paquetes auditados. Los
paquetes Python directos del Dockerfile del parser deben usar `nombre==versión`; su grafo
resuelto completo se verifica en la imagen construida.

Npm bloquea HIGH/CRITICAL en **todas** las dependencias, incluidas herramientas de build y
pruebas; los JSON también conservan avisos menores. Python bloquea cualquier aviso conocido,
incluidos paquetes sin versión corregida. Trivy bloquea HIGH/CRITICAL en OS y librerías de
ambas imágenes, también sin corrección disponible. No se usan listas de exclusión ni
`continue-on-error`; fallos de red, herramientas, inventario o reportes también bloquean.
No hay excepciones vigentes. Cualquier excepción futura requiere revisión específica de
CVE/paquete/versión, evidencia de no exposición, responsable y fecha de vencimiento; no
se permiten exclusiones generales por sistema operativo o falta de parche.

El parser incorpora fuentes revisadas de Tesseract y backports de libxml2 porque
el feed de Alpine omite avisos conocidos de esas versiones. Su gate adicional
`backend/scripts/check_parser_runtime.py` verifica el ID inmutable de la imagen,
hashes reales de binarios/modelo/parches, seis regresiones C y los reportes upstream.
Consulta los avisos públicos oficiales de Tesseract sin credenciales: un GHSA nuevo,
de cualquier severidad, o un fallo de consulta bloquea hasta revisarlo. No se presenta
un número de versión ficticio como corrección ni un resultado vacío de Trivy como
cobertura suficiente de los componentes compilados. CI y mantenimiento ejecutan
ambos controles; los reportes quedan en `reports/security`.
Las versiones se verificaron en [PyPI de pip-audit](https://pypi.org/project/pip-audit/2.10.1/)
y la [publicación oficial de Trivy](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1).
El digest inmutable de la imagen oficial del escáner está en el script. El archivo de
imagen entra por stdin de la API Docker y el JSON sale al host; esto también funciona
con un daemon en VM, sin compartir rutas del host. El escáner tiene filesystem de sólo
lectura, capacidades retiradas, `no-new-privileges`, tmpfs efímero y caché en volumen
Docker; nunca recibe el socket Docker ni variables de la aplicación.

`security` sigue siendo obligatorio para todos los PR y pushes. Los jobs de aceptación
nativa y parser escanean las imágenes que acabaron de construir antes de aceptarlas;
`CI required` conserva sus dependencias y bloquea publicación ante un fallo aplicable.
`CI maintenance` repite semanalmente, manualmente y para cambios de infraestructura tanto
los inventarios como el build/scan de ambas imágenes, para detectar avisos nuevos sin
esperar cambios de código. Los escáneres reciben archivos locales y ninguna credencial
de producción; no publican imágenes ni despliegan servicios.

Reproducir: `python3.12 scripts/audit_dependencies.py inventory`, luego `python3.12
scripts/audit_dependencies.py python` y `python3.12 scripts/audit_dependencies.py npm`
con uv 0.13.4 y npm de Node 24 en PATH. Tras construir una imagen local:
`python3.12 scripts/audit_dependencies.py image --name native --image kova-native:SHA`
o `--name parser --image kova-assistant-parser:1`. Los reportes quedan en
`reports/security`; `--output` permite usar una ruta temporal explícita.

## Registro de depuración

No cambió el comportamiento esperado del producto. Se eliminaron cinco tests con protección conservada:

| Caso retirado | Razón | Protección conservada |
|---|---|---|
| `test_split_cash_plus_transfer_totals_correctly` | Suma valores Decimal constantes sin ejercitar una venta | BDD `Cashier completes a split cash and bank transfer payment` y tests de pricing |
| `test_cash_change_on_partial_cash_payment` | Resta constantes fuera del flujo real | `test_cash_change_on_split_partial_cash` valida el cambio devuelto por la API |
| `test_no_change_on_exact_cash_payment` | Resta de cantidades idénticas | BDD de split payment y `test_receipt_single_payment` |
| `test_cash_plus_bank_transfer_split` | Duplica el mismo recorrido API del BDD | BDD existente; se incorporó su aserción de exactamente dos pagos |
| `test_second_open_shift_via_api_is_rejected` | Duplica el escenario BDD de turno ya abierto | BDD `Cannot open a shift if one is already open`; se conserva `test_db_rejects_a_second_open_shift` para el índice ante carreras |

Se conserva el mismatch de pagos, el test directo de la restricción de base de datos y todas las comprobaciones únicas de permisos, persistencia y auditoría. Se añaden dos tests de aislamiento del costo bcrypt: 1,038 - 5 + 2 = 1,035 casos de backend.

`App.test.tsx` tenía una aserción que podía conservar un nodo separado del DOM por revalidación de sesión. La aserción se consulta dentro de `waitFor`, manteniendo la exigencia de llegar a Caja y `/register`; no se añadió retry de la suite ni se eliminó el caso. El primer run local completo detectó esta intermitencia; el run aislado pasó antes del ajuste.

El scan de contraste espera las transiciones finitas de entrada antes de ejecutar axe. Una visibilidad inicial durante el fade del modal había provocado un retry en una de las cinco ejecuciones anteriores; siguen siendo obligatorias todas las comprobaciones serias/críticas de contraste y semántica.

Se retiró la ejecución duplicada de toda la suite browser en Vite dev dentro de CI, conservando `npm run test:e2e-dev` para uso local. Se retiró el typecheck separado: `npm run build` ya ejecuta `tsc --noEmit`. Las unidades y el build/browser corren en dos jobs paralelos; el build sigue ejecutándose una sola vez por validación. Se instala solo Chromium headless y se prueba su arranque; se instalan librerías del sistema únicamente si faltan. Se evita el segundo build de preview con `test:e2e-preview:built`; el build de release conserva su configuración de producción.

## Preparación rápida de usuarios

Solo los módulos de negocio que declaran `pytest.mark.usefixtures("fast_business_auth")` reducen bcrypt a cuatro rondas durante su test. La verificación de contraseña sigue siendo real y rechaza claves incorrectas; signup, login, cookies, CSRF, sesiones, permisos y RLS permanecen reales. `monkeypatch` restaura tanto el costo como el dummy hash después de cada caso. Los módulos de auth/security/CSRF/hardening/rate-limit/ops-auth/ops-mfa no pueden solicitar esa fixture. Producción permanece en doce rondas sin nuevas variables o configuración.

Módulos de negocio que optan explícitamente por la fixture:

- `test_cash_reconciliation.py`
- `test_inventory_negative_floor.py`
- `test_telemetry_origin_guard.py`
- `test_welcome_email.py`
- `test_purchasing.py`
- `test_shift_cash_integrity.py`
- `test_onboarding_presets.py`
- `test_catalog.py`
- `test_telemetry_export.py`
- `test_onboarding_billing.py`
- `test_tenant_isolation.py`
- `test_customers_barcodes.py`
- `test_reports_product_refunds.py`
- `test_feature_flags.py`
- `test_idempotency_retention.py`
- `test_branches.py`
- `test_expenses.py`
- `test_offline_sync.py`
- `test_cfdi_lifecycle.py`
- `test_tenant_isolation_routes.py`
- `test_catalog_import.py`
- `test_business_integer_bounds.py`
- `test_billing_lifecycle.py`
- `test_refund_method_validation.py`
- `test_payment_receipt_email.py`
- `test_fiscal_global_drafts.py`
- `test_customer_orders.py`
- `test_billing_api.py`
- `test_refund_inventory_integrity.py`
- `test_modifier_integrity.py`
- `test_trial_reminders.py`
- `test_offline_sync_resilience.py`
- `test_receipt_logo.py`
- `test_cfdi_account_lifecycle.py`
- `test_employee_rbac.py`
- `test_query_performance.py`
- `test_split_payment.py`
- `test_report_margins.py`
- `test_shifts_open.py`
- `test_refund_money.py`
- `test_payment_mix_reconciliation.py`
- `test_assistant.py`
- `test_orders.py`
- `test_branch_transfers.py`
- `test_sale_pricing.py`
- `test_billing_access_control.py`
- `bdd/test_billing.py`
- `bdd/test_online_sale.py`
- `bdd/test_cash_movements.py`
- `bdd/test_shifts_close.py`
- `bdd/test_refunds.py`
- `bdd/test_voids.py`
- `bdd/test_offline_sync.py`
- `bdd/test_modifiers.py`
- `bdd/test_catalog_foundation.py`
- `bdd/test_reports.py`
- `bdd/test_inventory_basics.py`
- `bdd/test_receipt_settings.py`
- `bdd/test_split_payment.py`
- `bdd/test_shifts_open.py`

- `test_ops_incidents.py`
- `test_ops_notes.py`
- `test_ops_tenants_revenue_funnel.py`
- `test_ops_trace.py`
- `test_integrations_readiness.py`
- `test_cfdi_guards.py`

## Comandos y diagnóstico

Desde `backend/`: `uv sync --frozen` y `uv run pytest --durations=40 --junitxml=reports/backend.xml`. Usar exclusivamente una base desechable y las variables del stack de pruebas, nunca una URL alojada.

Desde `frontend/`: `npm ci`, `npm run lint`, `npm test -- --run`, `npm run test:release-contract`, `npm run build`, `npm run check:bundle-secrets`, `npm run test:e2e-preview:built`. `npm run test:e2e-preview` sigue construyendo primero para uso local.

Stack real: `scripts/test-stack.sh`. CI incluye el mismo stack con teardown incondicional. Los artefactos de diagnóstico contienen únicamente datos sintéticos del stack o mocks; el job de producción no sube traces, cookies, `.vercel` ni configuración de autenticación.

Publicación: un job protegido captura el rollback y lo sube antes de preparar candidatos. El candidato Vercel se construye con configuración de producción y `--skip-domain`; Fly se despliega después. La fase se fija antes de cada posible modificación de producción: `candidate` para Fly/verificación, `promotion` antes del cambio de alias y `acceptance` antes de verificar el alias. La restauración de un deployment Vercel que ya sirvió producción utiliza `rollback`, no una segunda promoción, y no reconstruye el artefacto. La recuperación conserva un CI rojo aunque restaure correctamente; `RECOVERY_BLOCKED` exige intervención. Las pruebas de proveedores simulados cubren cada fallo y la restauración Vercel→Fly. Nunca se revierte automáticamente la base.

El token Vercel del nuevo release se escribe en un `auth.json` temporal con permisos 0600, se usa mediante `--global-config` y se elimina en `finally`; no aparece en argv. El entorno de producción se restringe a los pasos autenticados.

## Medición antes/después

La comparación utiliza cinco PR completos antes del cambio y cinco ejecuciones del mismo árbol después. Para cada uno se registra tiempo desde creación hasta terminación de GitHub (incluye colas), suma de segundos ejecutados por todos los jobs y retries reales en los logs de navegador. No se deduce intermitencia de un check verde.

Objetivo: mediana de validación <= 300 segundos y menor consumo de runner, preservando suites completas. Los resultados y enlaces de las cinco ejecuciones antes/después se registran en la descripción del [PR #168](https://github.com/ArturoFrancoMozqueda/kova/pull/168). Los benchmarks usan el mismo árbol de código y no publican producción; las ejecuciones de ajuste se identifican por separado.

## Configuración de GitHub

El 2026-10-07, la API de la rama informó `protected: false`, sin checks requeridos; el endpoint de rulesets devolvió una lista vacía. El workflow protege el deploy, pero exigir el check `CI required` antes de merge requiere configurar protección de rama en GitHub. No se cambiaron permisos ni reviewers del entorno de producción, backups, purgas, recordatorios o drills.

## Evidencia nativa AMD64 y recursos

La aceptación nativa exige Linux/x86_64, CPU Intel/AMD, Docker AMD64 y RUNNER_ARCH=X64
mediante scripts/check_amd64_host.py. El parser exige además coincidencia de host, daemon,
imagen inmutable y runtime con --require-native-arch x86_64. Las imágenes de mantenimiento
reciben KOVA_RELEASE_SHA real; el guard de identidad no acepta unknown.

El step de recursos usa bash explícito con pipefail y conserva 0.0625 CPU, 256 MiB, 3000 ms,
filesystem readonly y capacidades retiradas. Docker CI no tiene el binding virtual de
Cloudflare: sólo allí su hostname apunta a loopback, tras exigir conexión rechazada en
puerto 80. Se ejerce la política de outage existente sin DNS externo ni cambio del limitador.
Los artefactos always incluyen host, identidad/flags, picos, CPUstat y fases numéricas de
fotos; los diagnósticos no guardan headers arbitrarios ni cuerpos.

CREATE/ALTER del rol de pruebas compartido se serializan en la BD postgres por un lock
transaccional. Un advisory lock en cada BD worker no coordinaría el catálogo global de roles.
Los grants y RLS de cada worker permanecen separados. test:integration ejecuta los casos
que requieren el stack real, incluido dashboard-supervision-real.spec.ts y los escenarios
de tarjeta, recompensas, inscripción y seguimiento incorporados por main. Los 16 casos
son la referencia del snapshot AMD64 459d20f6; la CI del PR integrado amplía ese inventario.
Los skips del preview se ejecutan en el job del stack real. [Ejecución AMD64 aprobada](audits/KOVA-AMD64-VALIDATION-2026-10-27.md).
