# Panel como centro de control del dueño

Fecha: 2026-10-23. Branch: `feat/dashboard-business-status`.
Base: `origin/main` en `168220ed` (#273), actualizado al iniciar el trabajo.
Estado: implementado y validado localmente; sin publicación.

## Resultado

Abre todas las sucursales autorizadas y permite consultar una sin cambiar Caja.
Combina ventas consolidadas y por sucursal, pendientes atribuidos a su origen,
estado factual del negocio y seis áreas con indicadores reales. Los indicadores
adicionales y herramientas se expanden dentro de cada área para conservar claridad.

Incluye caja/turnos/pedidos, inventario/reservas/lotes/compras, clientes/CRM/
cotizaciones/seguimiento/lealtad, casos/agenda/bandeja, conciliación/gastos/utilidad
y reglas/catálogos/equipo/suscripción/disponibilidad de integraciones. Respeta
permisos y funciones habilitadas. Un dato faltante o una fuente fallida nunca se
presenta como cero ni como negocio saludable. No hay puntuación inventada.

Continuar un pendiente en otra sucursal requiere confirmar el cambio operativo;
cancelar conserva Caja. Sincronización aclara que corresponde a este dispositivo.

## Archivos y contrato

- `backend/app/reports/control.py` y `control_schemas.py`: agregados exactos,
  alertas y aislamiento de fallos por área mediante savepoints.
- `backend/app/reports/dashboard.py` y `router.py`: scope validado y campo aditivo
  en el overview. Sin migraciones ni cambios de modelos.
- `frontend/src/dashboard/`: filtro, alertas, resumen, sucursales, áreas y enlaces
  que conservan contexto hasta confirmar un cambio operativo.
- `frontend/src/layout/AppShell.tsx`: lealtad exclusiva del dueño conforme al API.
- `frontend/src/offline/useSyncQueue.ts`: espera las tres lecturas antes de mostrar
  cantidades locales; ninguna modificación del trabajador de sincronización.
- `specs/openapi.json` y `specs/reports/dashboard_control_center.md`: contrato,
  definiciones, bases temporales y limitaciones de las señales.

## Validación

- 25 pruebas de control/overview con PostgreSQL: ventas/devoluciones, inventario
  por sucursal incluyendo cero movimientos, reservas/lotes, conteos mayores que
  las páginas operativas, límite de 12 grupos sin truncar totales, permisos,
  funciones, aislamiento de tenants/sucursales, fallos SQL reales y RLS. Las mismas 25 pasan con psycopg y pg8000 (Workers).
- 23 pruebas relacionadas de sucursales, cola operativa y reportes de devoluciones.
- Suite completa frontend: 1381 aprobadas y dos fallos de `AbortSignal` en
  `AuthContext.identity.test.tsx`. Ambos reproducidos en una extracción limpia de
  `168220ed` con el mismo runtime/dependencias. No se alteraron auth ni expectativas
  para ocultarlos. Las pruebas de los archivos modificados pasan.
- 19 recorridos Chromium sobre el build: 320, 390, 768, 1366, 1440 y 1920 px;
  filtros/periodos, cancelación, permisos, compatibilidad, errores, ausencia de
  overflow y axe WCAG AA en el nuevo control. Incluye regresión visual anterior.
- Un recorrido completo sin interceptar API, con FastAPI y PostgreSQL bajo
  `kova_app` y RLS verificado en 92 tablas: registro/login, dos sucursales,
  productos/existencias/turnos/ventas, pendientes reales, consolidado $300,
  Norte $200 conservando Caja, cancelación y cambio confirmado a Norte.
- Inspección visual de capturas de escritorio y móvil.
- TypeScript, ESLint focal, Ruff/formato, build cliente/SSR/prerender, contrato
  OpenAPI/API, reglas de imports E2E y escaneo de secretos del bundle.

Vite conserva su advertencia previa de ciclo vendor/vendor-react. No hay npm en
el runtime local: los pasos equivalentes se ejecutaron con Node y herramientas
del proyecto. Los configs locales y enlaces de dependencias no se incluyen.

## Límites de QA

Sin despliegue productivo, pagos, timbrado ni envío de mensajes/correos externos.
La disponibilidad de integraciones es la registrada por Kova, sin probar al
proveedor. Sin sesión de lector de pantalla nativo ni QA en hardware de caja.
Las capturas de escenarios de prueba se guardan fuera de producción.
