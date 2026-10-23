# Panel como centro de control del dueño

Fecha: 2026-10-23. Branch: `feat/dashboard-business-status`.
Base: `origin/main` en `168220ed` (#273), actualizado al iniciar el trabajo.
Estado: base visual implementada y validada localmente; sin publicación.

## Alcance de esta base

El resumen de ventas y la lectura de salud se presentan juntos en escritorio.
Se conservan comparación, periodo, acciones, onboarding y reportes existentes.
El nuevo mapa reúne seis áreas: ventas/caja, productos/inventario, clientes,
atención/agenda, finanzas/análisis y configuración. Reutiliza exclusivamente
los destinos que AppShell ya permite por rol, funciones, capacidades y sesión.
Los únicos contadores nuevos reutilizan el overview confirmado: órdenes del
periodo, productos activos actuales y productos con stock bajo. Las otras áreas
invitan a consultar su sección; no afirman que no haya pendientes ni que existan
conexiones activas. El fallback anterior no se presenta como inventario verificado.
Se corrigió el contraste de la etiqueta de salud crítica sin alterar su cálculo.

No agrega lecturas, cambia contratos, modifica datos ni afecta permisos,
facturación, sesiones o sucursal operativa.

## Archivos

- `frontend/src/dashboard/DashboardView.tsx`: jerarquía, encabezado y mapa.
- `frontend/src/dashboard/BusinessControlCenter.tsx`: áreas y alcance de señales.
- `frontend/src/dashboard/BusinessHealthCard.tsx`: contraste y etiquetas completas.
- `frontend/src/dashboard/InsightStrip.tsx`: densidad de prioridades.
- `frontend/src/layout/AppShell.tsx` y `workspaceNavigation.ts`: contexto con destinos permitidos.
- `BusinessControlCenter.test.tsx`, `DashboardView.owner-flow.test.tsx` y
  `frontend/e2e/dashboard-control-center.spec.ts`: cobertura de la nueva experiencia.

## Validación

- 91 pruebas focales de componentes, panel y navegación aprobadas.
- 13 recorridos Chromium sobre el build final aprobados: 320, 390, 768, 1366,
  1440 y 1920 px; periodos, enlaces, teclado, estados de error, permisos,
  funciones, ausencia de llamadas de compatibilidad y contraste de salud.
- TypeScript, ESLint focal y `git diff --check` aprobados.
- Build cliente, SSR y prerender aprobados. Vite advierte un ciclo entre los
  chunks vendor y vendor-react; esta entrega no modifica su configuración.
- Inspección visual de capturas de escritorio y móvil. Pruebas de navegador
  con APIs interceptadas; sin nuevas operaciones de negocio ni QA autenticada productiva.

El runtime local no incluye npm: se ejecutaron directamente los mismos pasos
`tsc --noEmit`, `vite build`, build SSR y `node scripts/prerender.mjs`.
El runner de navegador usó una configuración temporal que conserva el config
preview del repositorio y cambia sólo el comando de arranque a Node/Vite local.
Esa configuración y el enlace de dependencias no forman parte del cambio.

## Siguiente diseño: supervisión operativa

El dueño pidió continuar el brainstorming para integrar desglose por sucursal y
pendientes importantes de todas las funciones. Esta base visual no acredita
un resumen operativo completo. Hay que acordar prioridades y definir agregados
antes de incorporar contadores de los módulos restantes.

La revisión de código confirma scope implícito de sucursal en los reportes y
comparación autorizada entre sucursales ya existente. Falta explicitar ese
alcance en el panel y decidir su vista consolidada. El filtro de supervisión
debe ser independiente de la sucursal operativa que usa Caja.
La cola operativa tiene muestras limitadas por sección y `has_more`; su longitud
no es un total global de pendientes. Un resumen completo requiere agregados reales.
