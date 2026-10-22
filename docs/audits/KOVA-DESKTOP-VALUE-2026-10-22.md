# Escritorio: resultados visibles y operación cuidada

Fecha: 2026-10-22. Estado: implementación local; publicación pendiente.

## Objetivo y alcance

Hacer que el dueño reconozca el valor de Kova al consultar resultados, identificar
prioridades y continuar una tarea. Cambios de presentación y navegación en Panel,
Caja, Catálogo e Inventario, con encabezados compartidos. Sin cambios de contratos
públicos, consultas nuevas, cálculos financieros, permisos, sesiones, migraciones
ni proveedores de publicación.

## Implementación

- Panel abre con ventas netas y comparación explícita con el periodo anterior.
  Se elimina la barra que podía interpretarse como avance hacia una meta.
  La interpretación y las prioridades aparecen antes de configuración y atajos.
  Los atajos siguen disponibles durante carga/error y respetan el modo offline.
- Reposición abre el producto concreto si sólo hay uno, o Inventario filtrado
  por stock bajo. Producto destacado abre la búsqueda existente del Catálogo.
  Navegar no ajusta stock ni crea registros.
- La instantánea «Tu operación en Kova» muestra catálogo e inventario actuales
  y hasta los últimos 50 cierres, indicando su alcance. Se muestra a dueño y
  gerente con datos del agregado autenticado. La compatibilidad con un backend
  anterior conserva sus lecturas y oculta la nueva instantánea: sus respuestas
  opcionales pueden fallar y no se convierten en ceros verificados. La oferta de
  prueba y sus permisos de facturación conservan su lógica existente.
- Catálogo usa una franja de categorías, herramientas sin cajas anidadas y una
  lista integrada. Herramientas y modificadores permiten envolver controles en
  pantallas pequeñas.
- Inventario presenta alertas compactas y filas alineadas. Ajustar e Historial
  permanecen visibles; Conteo y Definir umbral pasan a «Más acciones». El
  desplegable admite Tab, Escape, clic exterior y retorno de foco al cerrar el
  diálogo. Sólo monta listeners mientras está abierto.
- Caja integra carrito y pago en escritorio. La lista larga de artículos tiene
  desplazamiento acotado y el único total permanece junto al botón explícito de
  cobro. El verde del botón usa el tono de texto accesible de la marca. La
  confirmación, impresión, pagos divididos, turnos e idempotencia no cambian.
- Encabezados comunes mantienen Inter y los tokens existentes, con una escala
  consistente de título y texto secundario. Sin dependencias nuevas.

## Archivos

Implementación:

- `frontend/src/dashboard/DashboardView.tsx`
- `frontend/src/dashboard/InsightStrip.tsx`
- `frontend/src/dashboard/BusinessActivityRecap.tsx`
- `frontend/src/register/RegisterView.tsx`
- `frontend/src/catalog/CatalogView.tsx`
- `frontend/src/inventory/InventoryView.tsx`
- `frontend/src/components/ui/view-header.tsx`
- `frontend/src/components/ui/action-disclosure.tsx`
- `frontend/src/i18n/messages.ts`

Pruebas:

- `frontend/src/dashboard/DashboardView.owner-flow.test.tsx`
- `frontend/src/inventory/InventoryView.test.tsx`
- `frontend/src/components/ui/action-disclosure.test.tsx`
- `frontend/e2e/desktop-premium.spec.ts`
- `frontend/e2e/inventory.spec.ts`

Las pruebas existentes cambian sólo la expectativa de orden del Panel y la
apertura del nuevo desplegable. Los resultados financieros y las validaciones
de escritura conservan sus expectativas. Las pruebas nuevas comprueban alcance
de datos, permisos, navegación, geometría, foco, contraste y carritos largos.

## Validación

- Suite completa de frontend: 1,326 pruebas en 191 archivos aprobadas.
- Revalidaciones focales después de los ajustes finales de presentación y
  disponibilidad de la instantánea: aprobadas.
- Build de producción, SSR y prerender: aprobados; incluye TypeScript.
- ESLint completo, guard de imports E2E y `git diff --check`: aprobados.
- Aceptación en navegador del build final: 49 recorridos aprobados. Incluye
  320/390/1100/1366/1440/1920 px, falta de desbordamiento, contraste con axe,
  navegación a inventario filtrado, filtros de categoría, teclado y retorno de
  foco, carrito de 12 productos, cobro explícito, pagos divididos, falta de
  turno, venta offline y confirmación/recibo en móvil y escritorio.
- Se revisaron las capturas de Panel, Caja, Inventario y Catálogo. La batería
  de 320 px detectó desbordamiento de herramientas y modificadores en Catálogo;
  se corrigió la implementación conservando la comprobación de geometría.

## Límites

Los recorridos de navegador usan las APIs interceptadas por el guard existente
y datos exclusivos de pruebas; no hay ventas ni cambios en tenants reales.
No equivalen a una aceptación autenticada en producción ni a una auditoría
completa de accesibilidad. Zoom real al 200%, hardware físico de impresión y
percepción de valor con usuarios reales quedan para QA posterior.
