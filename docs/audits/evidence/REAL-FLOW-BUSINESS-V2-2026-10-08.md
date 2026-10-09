# Flujo empresarial real: segunda ronda — 2026-10-08

Equipo de catálogo, inventario, importación, compras, clientes y análisis. Base publicada
`fb47b342489c0a32aad34bee0ad53c5538fcc4f2`, confirmada con `/version.json` en el navegador.
Se utilizó una sesión propia autenticada del propietario; no se guardaron credenciales,
cookies, estados autenticados ni trazas productivas. La sesión se cerró al terminar.

## Navegación de producción

- Catálogo real: 15 productos; búsqueda/categorías/ordenación y editor de costos abiertos.
  Formulario nuevo inspeccionado con inventario y lotes habilitados, sin guardar.
- Plantilla CSV respondió 200. CSV UTF-8 y XLSX de una hoja previsualizaron una fila válida,
  cero errores y confirmación disponible. No se confirmó ninguna importación.
- Encabezados no reconocidos, fórmula XLSX y múltiples hojas se rechazaron con explicación;
  la confirmación quedó deshabilitada. Las solicitudes usaron `dry_run=true`.
- Inventario: 11 productos controlados; filtro y búsqueda, historial de un producto con
  19 movimientos reales, vista móvil de 390 px sin desbordamiento horizontal.
- Conteo físico negativo mostró «La cantidad contada no puede ser negativa» y bloqueó
  Guardar. Diálogo cerrado sin registrar conteo o ajuste.
- Compras/proveedores y clientes mostraron estados vacíos reales después de esperar la
  carga. Crear compra permaneció deshabilitado sin proveedor. No se crearon entidades.
- Análisis: presets y rango personalizado del 25 de agosto al 8 de octubre (45 días).
  UI y API `business-story` coincidieron en ventas netas de $18,294.00, 131 tickets y
  ticket promedio de $139.65. La comparación entre sucursales mostró la misma venta neta.
- No se observaron excepciones JavaScript. Los HTTP 400 de archivos inválidos son
  rechazos esperados. No se registraron ventas, stock, compras, clientes ni facturas,
  se invocó inferencia externa o se modificaron conexiones, flags o consentimientos.

## Hallazgos y arreglos

1. **Se perdía la configuración de lotes al guardar productos.** `ProductForm` entregaba
   `track_lots`, `rotation_label`, `rotation_days` y `expiry_days`, pero `productPayload`
   los eliminaba. El backend ya admite esos campos y configura los lotes. Se agregan a
   la lista explícita del serializador; se mantienen los campos de imagen/modificadores
   exclusivamente en cliente. Tres regresiones fallaron antes del arreglo: alta, edición,
   y desactivación/limpieza con `false`/`null`. Edición parcial de costo continúa sin
   enviar configuración omitida.
2. **El historial de movimientos no permitía desplazamiento por teclado.** Axe sobre
   el historial real informó `scrollable-region-focusable` serious. El contenedor ahora
   es una región con nombre por producto, `tabIndex=0` y foco visible. El caso Chromium
   verifica foco y desplazamiento con End. Se documenta una excepción puntual del lint
   de tabIndex: una región de desplazamiento necesita foco aunque no sea un botón.
3. **Contraste insuficiente en cantidades de movimientos.** Axe real detectó salidas
   rojas con contraste 4.13 y 10 px (mínimo 4.5). Las entradas también utilizaban el
   color decorativo verde claro. Se conserva fondo y signo de las cantidades y se usa
   texto `red-700`/`emerald-700`, sin cambiar cifras ni definiciones financieras.

## Validación local

- 65 pruebas frontend en siete archivos: API/productos, catálogo, inventario, lotes,
  análisis, clientes y compras. Las tres regresiones nuevas del serializador pasan.
- 62 pruebas backend originales de catálogo, importación, lotes y compras en PostgreSQL
  desechable `kova_business_v2`; no se cambiaron fixtures ni expectativas existentes.
- 16 recorridos Chromium de catálogo, inventario y lotes. Nuevo caso de historial pasa
  axe WCAG A/AA después de esperar animaciones finitas, y valida scroll por teclado.
- Nuevo recorrido sin mocks en `e2e/integration.spec.ts`, incluido en la suite real de CI:
  alta/edición desde la UI, relectura API después de recargar y sugerencias de fechas
  persistidas. Usa servidor real/Postgres con rol `kova_app` y postura RLS verificada para
  60 tablas. Duraciones de rotación/caducidad 14/30 pasan a 7/null correctamente.
- TypeScript, ESLint de archivos modificados y `git diff --check` aprobados.
- Configuraciones temporales de Vite/Playwright permitieron reutilizar dependencias en
  worktree y puertos propios; se retiraron antes de entregar. No forman parte del producto.

## Límites

No hay clientes, proveedores ni compras existentes en esta cuenta; historiales y escrituras
de esas entidades se cubren con pruebas aisladas, no operaciones en el negocio productivo.
No se habilitaron gastos ni conexiones del asistente. Las transferencias requieren distintas
sucursales y no se ejecutaron en producción. No se probaron terminales físicas, Safari/iOS,
lectores de pantalla humanos, pagos live ni emisión fiscal. Los arreglos están verificados
localmente; su publicación y comprobación posterior corresponden al equipo integrador.

## Corrección tras integración: dependencias de configuración — 2026-10-09

El preview integrado reprodujo un fallo en el recorrido original de sucursales. La política
fail-closed de Configuración exigía perfil, recibo y empleados antes de montar cualquier
pestaña, aunque Sucursales y Cierres fiscales ya tienen sus propios loaders. Un error de
perfil ajeno a esas operaciones bloqueaba injustificadamente ambas secciones.

`SettingsView` ahora omite esas lecturas exclusivamente para Sucursales y Cierres fiscales.
Las secciones de formularios siguen exigiendo datos confirmados; empleados conserva su
restricción de propietario y fiscal conserva su flag/rol. La identidad de carga incluye
la pestaña efectiva: respuestas o callbacks de guardado de otra pestaña no recargan ni
sobrescriben la sección actual. Volver al perfil exige cargarlo nuevamente, sin permitir
guardar valores por defecto si su lectura falla.

- Se reprodujo `branches.spec.ts` sobre el preview original, sin modificar ese test.
- Cinco regresiones nuevas fallaron con la implementación anterior y pasan con el arreglo:
  independencia de sucursales/fiscal, carga pendiente durante navegación, guardado pendiente
  durante navegación y regreso a perfil que debe fallar cerrado.
- 22 pruebas de recovery, logo y gates fiscales aprobadas; 17 recorridos originales de
  sucursales/configuración/cierres fiscales aprobados sobre el artefacto recompilado.
- Build/TypeScript/SSR/prerender, ESLint de los dos archivos y diff-check aprobados.
  No se cambiaron fixtures, selectores, mocks ni expectativas de recorridos existentes.
- No se abrió otra sesión productiva ni se hicieron cambios de datos productivos.
