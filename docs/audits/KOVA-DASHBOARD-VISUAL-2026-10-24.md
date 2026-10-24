# Panel visual y lectura profunda en Análisis

Fecha: 2026-10-24. Branch: `feat/dashboard-business-status`.
Continuación del centro de control de `c880dece`, a petición del dueño: menos
texto y una primera pantalla gráfica. Implementación local, sin publicación.

## Resultado

Panel abre con cuatro cifras compactas: ventas netas, órdenes, ticket y turnos.
Una gráfica de ventas ocupa la lectura principal, con pendientes compactos al
lado en escritorio. Hoy usa el desglose horario; 7/30 días usa el diario del
mismo overview y alcance. Un selector permite consultar importes exactos con
teclado. No agrega consultas, interpolación de valores ni datos de ejemplo.
Si no existe desglose horario, lo comunica sin inventar la serie.

Las sucursales se comparan con barras proporcionales y conservan su filtro de
supervisión independiente de Caja. Productos y horas usan barras; cobros usan
un anillo calculado a partir de importes brutos, con devoluciones explícitas.
Valores negativos se conservan en las series y cifras. Las barras de ranking
no presentan un saldo negativo como positivo.

Cada área muestra dos señales prioritarias. Los indicadores restantes y todos
los accesos autorizados permanecen bajo «Ver detalle y herramientas». Pendientes
muestra tres grupos principales y permite expandir los restantes; conserva los
totales exactos y el aviso de fuentes no disponibles, sin puntuación de salud.
Los cambios de sucursal para actuar conservan su confirmación anterior.

Análisis conserva periodos personalizados, comparaciones, rentabilidad, tablas y
plan de acción. Añade regreso al Panel y navegación por secciones. Reposición
queda junto a la tabla de productos; sigue disponible si no hubo ventas. Los
accesos sólo aparecen cuando existe su sección y respetan las funciones habilitadas.
El inicio de sesión de dueño/encargado ya dirigía al Panel; no se modifica auth.

## Archivos

- `frontend/src/dashboard/DashboardVisualOverview.tsx` y `visualData.ts`: cifras,
  serie responsive y desglose visual sin nuevas dependencias.
- `DashboardView.tsx`: gráficos primero, sin duplicar el resumen extenso debajo.
  El fallback anterior conserva su comportamiento para servidores antiguos.
- `DashboardSupervision.tsx`: pendientes, sucursales y filtro compactos.
- `BusinessControlCenter.tsx`: dos métricas iniciales por área y expansión.
- `frontend/src/reports/ReportsView.tsx` y `components/ReportsHeader.tsx`:
  organización de lectura profunda y navegación contextual.

## Validación

- 94 pruebas focales aprobadas: Panel, datos visuales y Análisis. Incluyen
  atribución por hora/fecha, huecos sin venta, importes negativos, ausencia de
  desglose, expansión del detalle y lectura con teclado. Las expectativas de
  texto se actualizan por la jerarquía solicitada; no se rebajan permisos ni
  definiciones de indicadores.
- Suite completa: 1386 aprobadas, dos fallos de `AbortSignal` en autenticación,
  ya reproducidos sobre `main` sin estos cambios en la validación anterior.
- 34 recorridos Chromium aprobados: Panel/Análisis, 320/390/768/1366/1440/1920 px,
  gráfica antes de listas, ausencia de overflow, filtros/periodos, caja estable,
  navegación de secciones, compatibilidad, errores, permisos y axe WCAG AA.
- Un flujo sin interceptar API con FastAPI y PostgreSQL, runtime `kova_app`,
  RLS verificado: registro/login, dos sucursales, ventas netas consolidadas $300,
  Norte $200 sin cambiar Caja, gráfica horaria y apertura confirmada de pedidos.
- Inspección de capturas desktop/móvil. Se corrigieron el filtro estrecho a
  320 px y la escala de la gráfica móvil observados durante esa inspección.
- TypeScript, ESLint focal, build cliente/SSR/prerender, contrato API/OpenAPI,
  imports E2E y escaneo de secretos del bundle. Continúa la advertencia previa
  de ciclo vendor/vendor-react; no se cambió la configuración de chunks.

Sin migraciones, cambios de API, operaciones productivas, pagos, timbrado ni envíos
externos. No se realizó lector de pantalla nativo ni QA de hardware de caja.
Capturas con escenarios de prueba guardadas fuera del producto; configuraciones
locales de pruebas y enlaces de dependencias no se incluyen en Git.

## Capturas revisadas

Escenarios de prueba; no representan operaciones productivas.

- [Panel completo en escritorio](screenshots/dashboard-control-center/desktop.png).
- [Primera pantalla móvil](screenshots/dashboard-control-center/mobile.png).
