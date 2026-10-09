# Integración de ramas de correcciones — 2026-10-08

Base: `a18ba1e6b59752c73ed73b43bb3a1bb6b4ba2ef5` (`main`, PR #181).
Rama de entrega: `codex/integrate-audit-fixes`.
Fuente integrada: `codex/audit-verified`, commit `e31c8a2`.

## Alcance y revisión

Se incorporan las 24 ramas `codex/audit-*` enumeradas en la
[auditoría original](KOVA-AUDIT-2026-10-08.md#ramas-y-reproducciones).
Se compararon los parches de las ramas individuales con la integración: 21 son
equivalentes; las otras tres conservan sus correcciones y pruebas en archivos
compartidos con otras ramas:

- `audit-checkout-transient-sync-retry`: conserva temporizadores, Retry-After y
  cancelación por sesión, junto con liberación de leases y la identidad original
  de ventas rechazadas.
- `audit-expense-business-dates`: conserva fechas del negocio y añade protección
  contra respuestas de periodos anteriores.
- `audit-invitation-transient-recovery`: conserva reintentos y descarte de
  respuestas/redirecciones antiguas, junto con validación de contraseñas UTF-8.

La revisión incluye sesiones, permisos, contratos, idempotencia, cobros, reembolsos,
gastos, asistentes, navegación móvil, prerender y PWA. No agrega migraciones,
cambia precios ni habilita proveedores o capacidades del asistente.
Los PR históricos ya integrados mediante squash no se vuelven a aplicar.
La organización de materiales de marketing y planes históricos no se incluye en
esta integración del producto. `codex/production-verification` contiene un
workflow de diagnóstico para un SHA anterior; se conserva como trabajo separado.

## Corrección adicional encontrada durante la revisión

Un HTTP 400 de Checkout seguido por una consulta fallida, una suscripción cancelada,
incompleta o ausente todavía mostraba «Tu suscripción ya está activa».
`BillingView` ahora muestra ese mensaje únicamente tras confirmar `active` o
`trialing`; conserva la recuperación para `past_due`/`unpaid` y presenta el error
de operación en los demás casos. Se añadieron seis regresiones sin alterar las
expectativas existentes: cuatro fallaron antes de corregir la implementación.

## Validación local repetida

Entorno: Node 24.19.0, instalación limpia con `npm ci`, Python 3.12,
PostgreSQL 16/pgvector local y bases desechables. Ninguna conexión de pruebas
apunta a Supabase alojado, Stripe, PAC o inferencia de pago.

| Comprobación | Resultado |
| --- | --- |
| Suite completa frontend, código final | 865/865 pruebas, 150 archivos |
| Backend focalizado: auth, catálogo, pedidos y sugerencias | 54/54 |
| Suite completa backend con PostgreSQL en UTC | 1,245/1,245 |
| Chromium con respuestas interceptadas, escritorio y móvil | 174 aprobadas, 13 omitidas |
| Build construido: navegación móvil, SEO y precaché | 19/19 |
| Chromium con FastAPI/PostgreSQL/RLS reales, sin interceptar API | 4/4 |
| Contratos del repositorio | 50/50 |
| Contratos de release frontend | 24 aprobadas, 1 omitida para Windows |
| ESLint, TypeScript, Ruff y contratos OpenAPI | Aprobados |
| Build cliente/SSR/prerender y escaneo de bundle | Aprobados; 99 JS sin patrones prohibidos |
| Auditoría npm de dependencias runtime | Cero hallazgos |

Los cuatro recorridos reales verifican venta persistida tras recargar, cambio
de inventario, aislamiento entre dos negocios creados mediante UI/API pública
y axe sin violaciones serias/críticas en vistas y modal financiero.
El rol runtime local `kova_app` es `NOSUPERUSER` y `NOBYPASSRLS`; el backend
confirmó la postura RLS de 60 tablas.

El primer recorrido backend completo obtuvo 1,244 aprobadas y una diferencia
en la representación de timestamps de gastos: la instalación local de PostgreSQL
heredó America/Mexico_City, mientras creación y lectura representaron el mismo
instante con offsets diferentes. El código y la prueba de ese módulo no cambian
respecto a `main`. Se configuró únicamente la base desechable en UTC, como CI,
para repetir la suite: 1,245/1,245 aprobadas. No se modificaron fixtures ni
resultados esperados.

Los recuentos de comprobaciones focalizadas y completas se solapan.
Logs de esta ejecución: `/tmp/kova-integration-*.log` y JUnit backend en
`/tmp/kova-integration-backend*.xml`, fuera del repositorio.

## Publicación y límites

La comprobación pública de solo lectura confirmó que `kovasuite.com`, su proxy,
`api.kovasuite.com` y la base responden para la versión existente `a18ba1e`.
Eso no acredita el despliegue de esta integración ni QA autenticada productiva.

La entrega queda en PR para CI y revisión. Integrar en `main` dispara el release
automático; la publicación requiere aprobación explícita según
[`release-ga-checklist.md`](../claude/release-ga-checklist.md).
No se modificaron datos productivos ni se efectuaron cobros o emisiones fiscales.
Permanecen pendientes pruebas manuales con lectores de pantalla/dispositivos reales,
proveedores externos y los límites históricos de la auditoría original, incluidos
reembolsos entre múltiples medios y advisories de herramientas que requieren
migraciones mayores.
