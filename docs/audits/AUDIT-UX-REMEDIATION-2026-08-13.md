# Evidencia de remediación UX — 2026-08-13

Rama: `feature/audit-ux-remediation`

Alcance: UX-1..UX-8 del plan de auditoría. No se modificó el plan maestro ni se tomó la decisión de producto PROD-1.

## Resultado por tarea

- **UX-1:** el shell conserva un fallback de ruta con el nombre real de la vista; Caja, Turnos, Catálogo e Inventario muestran el nombre y estado mientras cargan datos. Se distinguen la espera de sesión, bundle de ruta y datos mediante fallbacks separados.
- **UX-2:** el acceso directo a Gastos con `margin_reports` apagado ya no redirige silenciosamente. Explica el gate real y ofrece volver intencionalmente a Análisis; la navegación continúa ocultando la ruta según el entitlement vigente.
- **UX-3:** los rangos de Ventas y Análisis usan labels únicos `Desde`/`Hasta`, asociación `htmlFor`/`id` y restricciones `min`/`max`. La prueba de Ventas incluye axe.
- **UX-4:** Caja tiene un único `h1` y secciones `h2` para Catálogo/Carrito. El enlace `Ver análisis por hora` tiene un target de 44 px y foco visible.
- **UX-5:** el total de Ventas y copys analíticos observados pluralizan 0, 1 y n en es-MX.
- **UX-6:** Cola de sincronización usa `useDocumentTitle` y produce `Cola de sincronización · Kova`.
- **UX-7:** `removeItem` mantiene el updater de `setCart` puro; el toast y undo ocurren fuera del updater y preservan el orden original.
- **UX-8:** `Badge` usa un elemento inline, eliminando el `<div>` anidado dentro de `<p>`. Axe también detectó y se corrigió un encabezado vacío en la tabla de Ventas.

## Verificación ejecutada

- `npm run typecheck`: verde.
- `npm run lint -- --quiet ...`: verde; el script del repositorio ejecutó ESLint sobre el frontend completo.
- Vitest focalizado: **7 archivos, 37 pruebas verdes**.
- `21st review` sobre las superficies UI modificadas: **0 hallazgos, 0 fixes automáticos**.
- `git diff --check`: verde antes del commit.

Pruebas de regresión nuevas o ampliadas cubren: nombre de fallback, gate de Gastos, labels/restricciones/axe de fechas, singular/plural, jerarquía de Caja, title de SyncQueue, warning de React en `removeItem` y `validateDOMNesting`.

## QA manual y límites

Revisión estática contra `docs/claude/manual-qa-checklist.md`: semántica, nombres accesibles, target móvil, estados de carga y copy es-MX preservados. No se ejecutó navegador E2E ni build completo en este cierre focalizado; tampoco se validaron tiempos reales de cold cache/PWA con throttling. La suite focal emite warnings `act(...)` ya existentes en casos asíncronos de cache/reportes, distintos de los dos warnings objeto de UX-7/UX-8.
