# Correcciones y validación de seguridad de Kova

Fecha local: 2026-10-26. Rama de trabajo: `ci/fix-preview-workers`, sobre `22dce337b277e2389555f90e752ec87db95da185`. Cambios locales sin desplegar ni publicar. Se preservaron los archivos preexistentes de `output/marketing` y `output/qa`.

El fallo de facturación está corregido y el acceso comercial ahora se exige también en lecturas, sesiones abiertas y sincronización. Se aplicó la decisión del propietario: entrada inmediata, siete días de prueba y bloqueo a las 48 horas del primer cobro fallido. Ambas imágenes finales pasan Trivy sin HIGH/CRITICAL y sin exclusiones de CVE; los componentes compilados del parser tienen además procedencia, regresiones y vigilancia de avisos propias. Permanecen los límites explícitos de entrada inmediata, revocación sin conexión y validación de recursos AMD64 descritos abajo. No se desplegó.

## Estado de los hallazgos originales

| Hallazgo | Implementación local | Evidencia y límite |
|---|---|---|
| SEC 01 Checkout histórico reactiva acceso | Corregido, incluida protección contra carreras y eventos de una suscripción sustituida | 47 regresiones nuevas; la suite backend completa aprueba. Stripe se simula en los tests, sin compras ni llamadas al proveedor. |
| SEC 02 Bibliotecas con avisos | Versiones afectadas actualizadas en todos los locks y parser | OSV sin coincidencias para 1,038 versiones; npm y pip-audit sin avisos en sus inventarios completos. Esto no incluye una afirmación de ausencia de CVE del SO. |
| SEC 03 Falta de cobertura SCA | Corregida la cobertura y reforzados los umbrales | Cuatro locks npm, dos locks Python, paquetes directos del parser y ambas imágenes; escaneos finales sin HIGH/CRITICAL. El gate adicional del parser detecta avisos upstream nuevos y verifica artefactos reales. |
| SEC 04 Enumeración de cuentas | Corregida la revelación directa mediante status, reason, mensaje e identificadores | Respuesta uniforme fuera de desarrollo local. Persiste la inferencia signup → login mientras se permite entrar sin acreditar el correo. No se declara cerrado ese riesgo completo. |

## Facturación

[service.py](../../backend/app/billing/service.py) recupera la suscripción actual de Stripe y valida el checkout solicitado, modalidad de suscripción, tenant, customer, identificadores y Live/Test. No deduce acceso de `complete` ni de un pago histórico. Una lectura fallida del estado autoritativo devuelve error sin activar acceso ni modificar precedencias.

Checkout, webhooks y reparación interna comparten el lock por tenant; el bloqueo de fila refresca el identity map con `populate_existing`. El reparador consulta Stripe después de bloquear y leer el mapping vigente, evitando restaurar una referencia anterior durante una recuperación concurrente.

Un mapping distinto sólo puede sustituirse después de verificar ambos objetos actuales: mismo customer/tenant/modo, suscripción anterior terminada y nueva posterior por fecha de creación de Stripe. Esta protección permanece después del primer webhook. Facturas de otra suscripción se ignoran; un evento histórico de lifecycle no impone su estado frente al snapshot actual.

Los timestamps reales de los watermarks se conservan durante la reconciliación de Checkout; un marcador obliga a consultar la fuente actual ante la siguiente entrega. No se cambiaron precios, planes ni firmas de webhooks.

El [gate central](../../backend/app/billing/policy.py) cierra lecturas y escrituras comerciales después de resolver sesión, tenant y permisos. Mantiene sólo autenticación, recuperación de pago, derechos sobre datos y revocación de accesos. Las rutas públicas y los jobs tienen controles separados documentados en [la especificación](../../specs/billing/access_control.md). Los assets raster y logos conservan su contrato público; no habilitan operaciones comerciales.

La prueba dura siete días. La gracia se limita a 48 horas desde el primer fallo, incluso con una configuración o fecha de gracia antigua de siete días; los reintentos no la amplían. Una suscripción activa exige período vigente y observación de Stripe de máximo 24 horas. Una consulta fallida o sin período comprobable cierra el acceso con `verification_required`, sin inventar una cancelación ni crear un cobro duplicado.

El primer fallo requiere `invoice.payment_failed` firmado, `attempt_count` entero igual a uno y `event.created` válido. Una consulta a Stripe, Checkout, un cambio de lifecycle o `updated_at` nunca inician una gracia nueva. La mora sin esa evidencia queda bloqueada. Dos regresiones reprodujeron el acceso incorrecto antes de corregirlo; otras protegen reintentos, fechas antiguas y recepción tardía de la primera factura verificable.

`/auth/session` conserva `authenticated=true` y añade `commercial_access`. El frontend cierra módulos, cachés de reportes y permiso offline ante 402, y respeta el plazo aun con la caja abierta. Tanto una ventana abierta como un arranque offline necesitan verificación online como máximo cada 12 horas, acotada además por facturación. Los snapshots antiguos sin permiso comercial fallan cerrados. Las ventas pendientes mantienen UUID, leases y presupuesto de reintentos; un 402 pausa la sincronización hasta recuperar acceso. Se corrigieron carreras entre verificaciones/402 y un bucle de navegación al vencer un permiso offline.

Las [regresiones](../../backend/app/tests/test_billing_checkout_reconciliation_security.py) cubren cancelación, deuda, trial, gracia vencida, lookup fallido, pertenencia, Live/Test, sesión antigua, misma marca temporal, familias de eventos y concurrencia con transacciones PostgreSQL independientes. La [reproducción original](evidence/KOVA-SECURITY-BILLING-2026-10-26.py) está fijada al commit auditado para conservar evidencia histórica sin comprobar por error la versión corregida.

## Dependencias y CI

Versiones resueltas: Mako `1.4.2`, pypdf `6.21.2` tanto en Workers como en parser, Vitest/mocker `4.1.12`, Vite `6.4.5`, fast-uri `3.1.9`, serialize-javascript `7.1.3`, Undici `7.30.1` y Zod `4.6.6`. Se conservaron las versiones del tooling Cloudflare y sus parches estrechos existentes. `npm ci` aprobó en los cuatro proyectos. El wheel universal de pypdf se verificó contra su SHA-256 publicado; la instalación completa del lock WASM aprobó sin modificar los demás paquetes fijados.

[audit_dependencies.py](../../scripts/audit_dependencies.py) comprueba el inventario versionado y falla ante locks nuevos sin clasificar. Consulta Python por versiones concretas sin resolver ni instalar los paquetes auditados; npm incluye dependencias de desarrollo. Bloquea cualquier aviso Python y HIGH/CRITICAL en npm. Las imágenes bloquean HIGH/CRITICAL, incluidos los que no tienen parche. Reportes ausentes, incompletos en los campos requeridos o inválidos y errores de herramientas bloquean la validación.

Se fijaron `pip-audit==2.10.1` y Trivy `0.76.1` por digest oficial. El scanner recibe el archivo de imagen por stdin, no monta el socket Docker ni recibe credenciales; usa filesystem de sólo lectura, capabilities retiradas, `no-new-privileges`, tmpfs y una caché Docker dedicada. No se añadieron exclusiones de CVE ni `continue-on-error`.

Los jobs existentes de backend nativo y parser ejecutan el escaneo de sus imágenes antes de continuar. El gate agregado conserva esas dependencias. El mantenimiento semanal revisa paquetes e imágenes; los reportes se guardan como artefactos de CI. No se ejecutó CI remoto durante esta entrega.

## Signup y decisión del propietario

[Signup](../../backend/app/auth/router.py) devuelve 201, `reason: "signup_received"` y el mismo mensaje para cuenta nueva, existente verificada o pendiente. Fuera de `APP_ENV=local`, IDs y token diagnóstico son `null`. Cada intento aceptado realiza un hash bcrypt; un duplicado no reemplaza contraseña, cuenta ni permisos. Se preserva el reenvío seguro de verificación.

El cliente presenta una recuperación neutra y sólo autentica mediante contraseña. OpenAPI, DTOs, especificación y verificador de contrato reflejan el nuevo status y reason; las expectativas antiguas cambiaron porque el comportamiento público se corrigió, no para ocultar fallos.

**Límite comprobado en revisión cruzada:** crear una cuenta con un correo objetivo y una contraseña elegida, y luego intentar login, distingue una cuenta recién creada de una existente con otra contraseña. Respuestas genéricas y rate limit no eliminan esa deducción. Acreditar control del correo antes del primer acceso —por enlace, código o identidad externa verificada— cambia el flujo de entrada inmediata vigente. Tras explicar esta consecuencia, el propietario indicó explícitamente «Mantén la entrada inmediata». Se preserva esa decisión; la inferencia compuesta sigue registrada como límite y no se declara corregida. La verificación del correo en la frontera de pago se mantiene.

## Resultados de validación

| Validación final local | Resultado |
|---|---|
| Backend completo, PostgreSQL desechable, cuatro workers | 2,188 aprobadas; cero fallas, errores u omisiones. Incluye BDD; las focales de facturación son 186 aprobadas y forman parte de ese total. |
| Frontend completo, 199 archivos | 1,471 aprobadas; cero fallas o errores. |
| Scripts de repositorio y auditor | 71 aprobadas, incluidas nueve regresiones de cobertura y fallo cerrado. |
| Proxy/gateway/controlador/packaging/caché pública | 74 aprobadas, incluidas pruebas reales en workerd. |
| Contratos de release/recuperación simulados | 128 aprobadas; una prueba exclusiva de Windows omitida en macOS. No se realizó ningún release. |
| Workers Python: runtime, compatibilidad y jobs | 9 + 4 + 1 aprobadas contra PostgreSQL local; incluye PDF determinista tras actualizar pypdf. |
| Navegador sobre build final con APIs interceptadas | 31 recorridos de auth, billing, bloqueo comercial, onboarding y offline aprobados. |
| Parser final | Diez comprobaciones aprobadas: cuatro archivos válidos, incluido OCR español, y seis rechazos, incluido EICAR; nueve unitarias en contenedor. Tesseract: 17 suites/68 casos sin omisiones; libxml2: ocho suites upstream y seis programas de regresión con bordes de memoria. |
| Scripts de imágenes y evidencia | 41 unitarias backend/scripts aprobadas, incluidas 17 del nuevo gate de parser y cuatro del ensamblador nativo. |
| Navegador con API y PostgreSQL/RLS reales | En 390 px: entrada inmediata sin verificar correo, acceso durante prueba, vencimiento con 402 en catálogo/reportes y sesión abierta redirigida a pago; exportación y estado de eliminación accesibles; logout CSRF y posterior 401. |
| Build y análisis estático | Build Vite/SSR/prerender, TypeScript, ESLint, Ruff focal, OpenAPI export/check, contrato frontend y scanner del bundle aprobados. |
| SCA de bibliotecas | npm: cero avisos en los cuatro locks. pip-audit: cero avisos/omisiones para 74 versiones backend, 44 Workers y dos paquetes directos del parser. |
| Imágenes | Nativa AMD64: 19 paquetes OS + 57 Python, sin HIGH/CRITICAL. Parser ARM64: paquetes OS y dos Python, sin HIGH/CRITICAL; gate de binarios/parches/modelo y 19 avisos oficiales aprobado. No son afirmaciones de cero CVE de toda severidad. |

No se suman subconjuntos de tests otra vez al total de sus suites completas. Los warnings de fixtures sintéticas, jsdom/axe y httpx/TestClient no produjeron fallos. No se cambió ninguna migración ni seed de producto. Las pruebas HTTP del harness y los escenarios de RLS con rol restringido se distinguen; el flujo real de navegador utilizó el rol runtime y verificó su postura al arrancar.

## Corrección de las imágenes y evidencia histórica

La nativa usa Python 3.12.16 y Distroless Debian 13 fijados por digest. Se retiraron realmente shell, gestor de paquetes, Perl, herramientas de montaje y extensiones interactivas/GUI no utilizadas. Las dependencias ELF necesarias se descubren y conservan paquete Debian, copyright y SHA-256; no se oculta el inventario. El probe aislado comprobó UID 10001, 148 CA, Expat 2.9.0, OpenSSL 3.5.7, 66 extensiones y 132 objetos compartidos, además de crypto, Pillow, PDF, XLSX, QR y zona horaria.

El parser usa Alpine estable 3.24, ClamAV 1.4.6 y fuentes Tesseract oficiales fijadas a `f139e578a37c5c18717195c7d603ddb357717e23`. Conserva versión real 5.5.3, con los arreglos revisados del mantenedor; no finge una versión 5.5.4. El modelo español tiene hash fijo y permisos de lectura; `--tessdata-dir` constante evita buscar modelos por el filesystem. El instalador pip se desinstala realmente tras preparar la imagen.

El feed de Alpine omitía seis avisos de libxml2 2.13.9. Se aplicaron parches oficiales y adaptaciones revisadas para CVE-2026-86138/139/140/142/143/144, manteniendo ABI y versión 2.13.9-r2. El APK local se identifica como build Kova y conserva fuentes, hashes, licencia y reportes. La revisión cruzada encontró y corrigió bordes adicionales de suma de tamaños, buffer vacío y argumento namespace; las regresiones usan asignadores acotados y páginas protegidas, y cubren las rutas con/sin encoder. No se falsificó una versión corregida ni se excluyeron esos avisos.

El [gate propio](../../backend/scripts/check_parser_runtime.py) prueba el artefacto inmutable sin red ni privilegios, valida hashes reales y reportes y consulta el feed público oficial de Tesseract. Un GHSA nuevo, incluso menor, o un fallo de consulta bloquea hasta revisarlo. Trivy y este gate se ejecutan juntos en CI y mantenimiento.

Las cifras siguientes son el estado **intermedio histórico**, antes de sustituir las bases y componentes. Ya no describen los artefactos finales:

`apt-get upgrade --no-install-recommends` aplica los parches disponibles manteniendo distribución, digest base y usuarios. Los avisos de las bibliotecas de aplicación quedan en cero; los siguientes pertenecen al SO y herramientas incluidas en las imágenes:

| Imagen | Antes de actualizar Debian | Después | Gate |
|---|---|---|---|
| Native | 100 registros, 28 CVE únicos | 44 registros HIGH, ocho CVE únicos | Bloqueado |
| Parser | 166 registros, 56 CVE únicos | 110 registros: 109 HIGH y uno CRITICAL, 36 CVE únicos | Bloqueado |

Los registros cuentan pares CVE/paquete; un CVE puede aparecer en varias bibliotecas del mismo paquete fuente. Hay solapamiento entre imágenes: no deben sumarse sus CVE como riesgos independientes. Los registros restantes no tienen `FixedVersion` en Debian estable según el scanner consultado. La evidencia resumida con IDs y paquetes está en [el JSON de remediación](evidence/KOVA-SECURITY-REMEDIATION-2026-10-26.json).

En ese corte, ClamAV y bibliotecas de procesamiento de archivos merecían prioridad: el antivirus interpreta entradas antes del parser Python. [ClamAV corrigió siete avisos en 1.4.5/1.5.3](https://blog.clamav.net/2026/07/clamav-153-and-145-security-patch.html), mientras Debian ofrecía 1.4.3. [libxml2 CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653) se clasificó CRITICAL en aquella imagen; no se demostró RCE en Kova. La versión 2.13.9 del artefacto final ya es posterior al arreglo de ese CVE; los seis avisos posteriores se trataron con los backports descritos arriba. Las cargas/ingesta documental permanecen deshabilitadas por la política existente.

Otros avisos requieren rutas más limitadas: [util-linux](https://security-tracker.debian.org/tracker/CVE-2026-78408) depende de operaciones locales privilegiadas, [Tesseract](https://github.com/tesseract-ocr/tesseract/security/advisories/GHSA-2hm8-q5c7-c373) de modelos controlados por el atacante y [curl](https://curl.se/docs/CVE-2026-12064.html) de opciones/protocolos que el parser sin red no utiliza. Estas condiciones reducen exposición, pero no equivalen a una declaración de ausencia de riesgo y no se usaron para excluir avisos.

## Límites y validación antes de publicar

La entrada inmediata conserva la inferencia compuesta ya explicada. Un dispositivo desconectado tampoco puede conocer una cancelación remota antes de reconectar: su permiso está limitado a 12 horas o al vencimiento comercial, lo que ocurra primero. Las API siempre comprueban el acceso en servidor.

La imagen nativa AMD64 aprobó ABI, bibliotecas, crypto y SCA. En el host ARM, una comprobación intermedia del mismo runtime emulado pasó 24 contratos HTTP bajo 0.0625 CPU/256 MiB, pero el primer procesamiento de fotos de 8 MP excedió tiempo/memoria y hubo OOM; no se presenta como aceptación de recursos AMD64. La misma fuente construida para ARM64 directo aprobó arranque, 24 contratos antes/después de reiniciar, ocho lecturas de fotos bajo 3 s, persistencia de cuatro variantes y lecturas tras reinicio sin redimensionar, con pico de unos 225 MiB y sin OOM. Los umbrales de CI AMD64 no se redujeron: esa ejecución remota sigue pendiente antes de publicar. El parser se validó en ARM64, con CI AMD64 también pendiente.

No hubo compras, cambios en Stripe/Supabase de producción, despliegue, activación de documentos ni modificación de migraciones o seeds de producto. La [evidencia agregada](evidence/KOVA-SECURITY-REMEDIATION-2026-10-26.json) conserva el corte histórico y los resultados finales por artefacto.

## Archivos principales para revisión

- Facturación y control de acceso: `backend/app/billing/{policy,access,service,repository,schemas}.py`, `backend/app/shared/dependencies.py`, `backend/app/assistant/access.py`, `backend/app/config.py` y regresiones de facturación.
- Auth y contrato: `backend/app/auth/{router,schemas,service}.py`, pruebas de auth, `specs/openapi.json`, especificaciones de sesiones y DTOs frontend.
- Sesiones abiertas y offline: `frontend/src/auth/{AuthContext,RequireAuth}.tsx`, `frontend/src/offline/{accessPolicy,offlineAccess,sync,syncWorker}.ts`, tipos y pruebas; billing, shell y recuperación de datos en ajustes.
- Imagen nativa: `backend/Dockerfile.api`, `backend/scripts/{prepare_native_runtime,check_native_runtime,test_prepare_native_runtime}.py`.
- Parser: `backend/assistant-parser/Dockerfile`, `parse.py`, seis parches originales y sus backports/procedencia, seis regresiones C, scripts de build/evidencia OCR y sus unitarias; `backend/scripts/{check_parser_runtime,test_check_parser_runtime}.py`.
- Dependencias y automatización: cuatro manifests/locks npm, locks Python nativo/Workers, `scripts/audit_dependencies.py` y sus pruebas, `.github/workflows/{ci,ci-maintenance,native-backend}.yml`, documentación de CI y políticas de billing/offline.

Las expectativas modificadas representan el contrato público uniforme de signup, el campo aditivo comercial de sesión, períodos pagados realmente vigentes y la nueva regla de 48 horas. No se retiraron regresiones ni se cambiaron migraciones/fixtures de producto para ocultar errores.
