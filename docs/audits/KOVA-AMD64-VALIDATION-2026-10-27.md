# Validación nativa AMD64 de seguridad de Kova

Fecha: 2026-10-27, America/Mexico_City. Agent Teams; sin despliegue.

## Alcance e identidad

Se construyen las imágenes desde el snapshot completo de las correcciones de seguridad,
en una rama exclusiva de validación. No se modifica main ni se ejecutan jobs de publicación,
provisión, pagos o datos productivos. El checkout original conserva HEAD e índice; los commits
para CI se crean mediante un índice alterno y excluyen output/marketing y output/qa.

La aceptación exige host Linux x86_64, CPU Intel/AMD, Docker x86_64 y RUNNER_ARCH=X64;
el parser exige además plataforma linux/amd64 y coincidencia entre build y runtime del
artefacto inmutable. Es ejecución AMD64 nativa en VM alojada, sin traducción ARM→x86;
no se presenta como bare metal ni como atestación criptográfica del hardware.

## Fallos encontrados y corregidos

- El build semanal no recibía KOVA_RELEASE_SHA. El guard de identidad lo rechazó. Se pasa
  el SHA real a Docker y se conserva la validación de identidad de producción.
- Los pipelines a tee podían ocultar un fallo. El step usa bash explícito con pipefail;
  una regresión ejecuta false|tee y exige detener el script.
- Cuatro workers alteraban simultáneamente el mismo rol PostgreSQL desde distintas bases.
  CREATE/ALTER ROLE se serializan en postgres mediante lock transaccional. Los grants por
  base y RLS permanecen intactos. La regresión observa cuatro conexiones reales esperando
  el mismo lock y luego verifica login sin SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE.
- El test de catálogo omitía plan en su respuesta de facturación y esperaba recuperación
  inline anterior al nuevo gate. Ahora usa el contrato tipado y verifica 402→facturación
  sana→checkout, sin error de render ni intentos duplicados. No cambia el producto.
- Una segunda pasada detuvo aceptación por timeout de una foto. Los logs y la implementación
  son compatibles con DNS del binding privado ausente en Docker, no una prueba directa de
  esa causa. HTTPX síncrono resuelve DNS antes de fijar el timeout de socket. Sólo en CI,
  el hostname virtual apunta a loopback, cuyo puerto 80 debe rechazar conexiones; así se
  representa el outage existente de manera determinista. No se desactiva el limitador ni
  se modifica su política de producción. No hay retry ni aumento de presupuesto.

- El PNG grande estaba cerca del presupuesto de CPU. El resize RGBA reduce por franjas
  alineadas al mismo factor entero de Pillow, conserva el box fraccional y Lanczos y cierra
  explícitamente los temporales. 56 comparaciones permanentes conservan bytes completos
  idénticos; otras tres comprueban límites, fallback y cleanup. La revisión independiente
  también comparó píxeles con alfa variable y bordes impares. El cap de 1 MP es de franjas;
  un aspecto extremo conserva el fallback anterior, bajo el límite de decode de 8 MP.
- Se detectó que dashboard-supervision-real.spec.ts se omitía en preview pero tampoco
  estaba en test:integration. Se incorpora al comando: los 16 casos con stack real se
  ejecutan, incluidos agregados entre sucursales y aislamiento del contexto de Caja.

## Condiciones de aceptación

Se conservan 0.0625 CPU, 256 MiB sin swap adicional, 3000 ms por petición, filesystem de
sólo lectura, capabilities retiradas, no-new-privileges y límite de 64 procesos. Se ejecutan
24 contratos antes y después de reiniciar; JPEG con EXIF y PNG RGBA de 8 MP, 16 lecturas en
400/160 px, cuatro variantes persistidas y readback tras reinicio sin redimensionar.

Trivy bloquea HIGH/CRITICAL, incluidos avisos sin parche, sin exclusiones. No significa
cero CVE de cualquier severidad. El gate adicional del parser valida hashes de binarios,
modelo y parches, seis regresiones XML, suites OCR y avisos públicos upstream nuevos.

## Resultado

**Aprobado** en [CI 40528506489](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40528506489)
sobre `459d20f6e6b910699205a4c634d890745bcbb4a5`, rama
`feature/security-amd64-validation-20261027`. `CI required` y todos los jobs aplicables
terminaron en success. Publicación, provisión y lectura de producción quedaron skipped.
Los informes locales de cierre son posteriores al snapshot; no cambian el código probado.

| Comprobación | Resultado |
|---|---|
| Host de aceptación | Linux x86_64, AMD EPYC 7763, cuatro CPU lógicas; Docker x86_64 y RUNNER_ARCH=X64 |
| Nativa | 24 contratos antes y 24 después de reiniciar; pico **188.13 MiB**, sin OOM |
| Fotos | 16 lecturas aprobadas; máximo **2692.4 ms**, con cuatro variantes persistidas y cero resize tras reinicio |
| ABI | UID 10001, Python 3.12.16, Expat 2.9.0, OpenSSL 3.5.7, 148 CA, 66 extensiones y 132 objetos compartidos |
| Parser AMD64 | 9 unitarias aisladas, 10 smokes reales, ocho suites XML upstream, seis regresiones de backports y 17 suites OCR / 68 casos, sin omisiones |
| SCA de imágenes | Nativa: 19 paquetes OS+57 Python; parser: 82 OS + 2 Python. Ambas y sus builds de mantenimiento tienen **cero HIGH/CRITICAL**, sin exclusiones |
| Backend completo | **2248 aprobadas**, sin fallas/errores/omisiones; la suite completa con pg8000 y los gates workerd también aprueban |
| Frontend | **1471 unitarias aprobadas**, TypeScript/ESLint/build/SSR/prerender y contratos aprobados |
| Navegador | **317 preview + 16 stack real = 333 aprobadas**. Los 16 skips del preview corresponden exactamente a los 16 casos que aprueban con API/Postgres/RLS |
| Migraciones y suministro | Reversibilidad, contenedor reproducible, SBOM, auditorías de cuatro locks npm y locks Python, y secretos aprobados |
| Helpers locales | 88 tests de scripts, 51 helpers de imágenes, 25 focales de rol/RLS y 98 focales de imágenes aprobados. Son subconjuntos/controles, no se suman otra vez al backend completo |

Identidad verificada por artefacto:

- Nativa: `sha256:a694a77d1405c972734bcf555250323b1c7e3d60e6e34463487ffd7c38a3f831`.
- Parser: `sha256:554185c59d70c99d0ca19a832e4af9cab3d1f9620ce2b2b50fdc321289ca9315`.

El ID usado en aceptación nativa coincide con el de su escaneo. El ID inmutable probado
por el gate del parser coincide con su escaneo; el gate confirma plataforma/build/runtime
AMD64, hashes reales y los 19 avisos oficiales revisados. Los builds de mantenimiento
se registran por separado con sus IDs propios. [Evidencia verificable](evidence/KOVA-AMD64-VALIDATION-2026-10-27.json)
conserva resultados, artefactos de GitHub, hashes SHA-256, límites y las ejecuciones previas.
Los artefactos de CI tienen retención de 14 días; el resumen y sus hashes quedan versionados.

## Límites y QA

El pico anterior de referencia fue 201.57 MiB frente a 188.13 MiB en esta ejecución, en
instancias distintas del mismo modelo de CPU. No se afirma una mejora de CPU: los tiempos
fluctúan entre runners compartidos y el gate estricto de 3000 ms sigue obligatorio en cada
build. Las ejecuciones anteriores que fallaron se conservan; no se eligió una exclusión,
retry o umbral mayor para ocultarlas. La prueba del binding local representa su outage,
no una integración viva con Cloudflare; su disponibilidad/fail-closed se comprueba también
en los tests independientes del controlador y del backend.

El flujo de catálogo 402→pantalla sana de facturación→checkout interceptado aprobó sin
errores de render ni requests duplicados. La entrada inmediata, siete días gratis, bloqueo
48 horas tras el primer cobro fallido y conservación de ventas offline pendientes no se
modificaron. Los límites de inferencia signup→login y revocación offline del informe
anterior permanecen por decisión del propietario. No hubo despliegue, compras, migraciones
productivas ni cambios de Stripe/Supabase/Cloudflare de producción.

Archivos principales de este cierre: `.github/workflows/{ci,ci-maintenance,native-backend}.yml`,
`scripts/check_amd64_host.py` y sus regresiones, `backend/scripts/check_parser_runtime.py`,
`check_native_photo_resources.py` y sus tests, `backend/testing_roles.py`, ambos conftest,
`test_runtime_role_provisioning.py`, `backend/app/catalog/image_router.py`,
`test_product_image_striped_resize.py`, `frontend/e2e/catalog.spec.ts` y el comando
`test:integration` de `frontend/package.json`. No se cambiaron migraciones ni seeds de producto.
