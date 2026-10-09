# POS: segunda ronda de navegación real — 2026-10-08

Ronda iniciada el 8 de octubre y cerrada el 9 de octubre de 2026, hora de México.
Base: `fb47b342489c0a32aad34bee0ad53c5538fcc4f2`. Se verificó en navegador
`version.json` = `fb47b342489c`; no había un service worker esperando actualización.
Se utilizó una sesión propia, cerrada al terminar. No se guardaron credenciales,
cookies, estados autenticados, trazas ni datos personales.

## Navegación productiva

Se recorrieron caja, pedidos, ventas, detalle de una venta existente, recibo,
devolución, cancelación de venta, turnos, movimiento de efectivo, un corte histórico
y cola de sincronización. Los formularios financieros se abrieron y cerraron con
Escape; nunca se confirmó una operación del negocio.

- Caja real: un producto de $56, descuento de $10 e impuesto adicional de 16%
  produjeron total $53.36; «Exacto» rellenó ese importe sin diferencia.
- El resumen móvil a 390 px recibió foco de diálogo; Escape devolvió foco al
  botón que lo abrió. No hubo desbordamiento horizontal.
- Al retirar la red, el catálogo ya cargado siguió disponible y apareció «Sin
  conexión». Se restauró la red; no se creó una venta ni elemento de cola.
- Cola: sin acciones operativas pendientes y cero infracciones axe WCAG A/AA en
  su contenido. Se revisó lectura de recibo y corte sin imprimir físicamente.
- La cuenta tenía 15 productos y ninguno con modificadores o lotes. Esos casos,
  reservas y cancelación de pedidos se verificaron con datos aislados, sin
  presentarlos como recorridos completados con datos del negocio real.

## Defectos reproducidos y correcciones

1. **Enter podía cobrar al terminar una captura.** En producción, con efectivo
   válido, Enter en descuento generó un submit implícito. Para observarlo sin
   operar el negocio se bloqueó el evento en captura DOM mediante
   `preventDefault`/`stopImmediatePropagation`, antes de llegar al código de venta.
   Se añadieron tres regresiones Chromium que fallaron antes del arreglo.
   El listener de teclado existente ahora evita ese submit en los inputs del
   formulario. Enter/Space sobre «Cobrar» y Ctrl+Enter fuera del editor siguen
   completando exactamente una venta; no se bloquean botones ni formularios ajenos.
2. **«Mes» en Ventas describía 30 días móviles.** Producción mostró el botón
   seleccionado para 9 de septiembre–8 de octubre. Se cambian sólo las etiquetas
   a «7 días»/«30 días», conservando rangos, contratos y cifras. La regresión
   comprueba duración inclusiva de cada consulta y falló con las etiquetas anteriores.
3. **Cancelación de pedido perdía contexto al fallar.** Chromium aislado reprodujo
   que un rechazo cerraba el modal y el estado de error podía sustituir el detalle.
   Ahora el error se anuncia dentro del modal, la nota se conserva y «Actualizar
   pedido» relee la versión antes de un nuevo intento explícito. No se elimina ni
   neutraliza la validación 409 del servidor. Motivo/Nota reciben nombres accesibles.
4. **Detalle guardado declaraba «Solo lectura» pero ofrecía escrituras.** Un GET
   503 estando online usa la caché; la vista seguía ofreciendo editar/cobrar/cancelar.
   Se comprobó antes del arreglo. `writable` exige conexión y detalle fresco,
   oculta esas acciones y bloquea la mutación y el modal si una recarga usa caché.
5. **El modal abierto podía cancelar después de refrescar a pagado o cancelado.**
   Dos regresiones adicionales fallaron antes del arreglo. `canCancel` refleja
   el contrato backend: unpaid permite; paid/partially_refunded bloquea;
   refunded/voided permite sólo a owner/manager; fulfilled/cancelled bloquea.
   Se conservan los casos positivos de gerencia tras reversión financiera.

## Validación

- 47 pruebas unitarias de caja/listado ventas/formulario y checkout de pedidos.
- 46 escenarios Chromium en caja, pedidos, modificadores, ventas, turnos y sync.
  Incluyen nombre de controles, conflicto/relectura de versión, caché 503,
  modal que pasa a caché y roles manager/cashier para refunded/voided.
- 1 nuevo recorrido **sin mocks** con FastAPI, Postgres y rol runtime RLS:
  producto/stock/turno creados por API/UI pública en negocio sintético;
  Enter en editor deja 0 ventas y stock 5; Enter en «Cobrar» registra una única
  venta de $37.50/cambio $2.50 y stock 4, verificados después de reload.
- 37 regresiones backend de lotes, integridad/modificadores, reservas y pedidos;
  incluyen consumo multi-lote, reintentos, cancelación/liberación, devolución,
  inventario y permisos financieros. Base de datos local separada.
- ESLint, TypeScript y `git diff --check` aprobados; revisión React aplicada a
  los tres componentes, sin nuevas dependencias ni listeners globales adicionales.
- No se cambiaron resultados esperados existentes para hacer pasar fallos; los
  nuevos tests demuestran el defecto y el contrato. La helper de sesión mocked
  admite rol explícito para ampliar cobertura manteniendo owner por defecto.

Los logs de pruebas usan sólo datos sintéticos y quedan fuera del repositorio.
El equipo principal debe integrar, ejecutar CI y verificar publicación antes de
declarar estas correcciones disponibles en producción.

## Límites

No se realizaron cobros, ventas, pedidos, cambios de stock/turno, reembolsos,
correos, facturas ni cambios de configuración productivos. No se validaron
impresoras/terminales físicas, Safari/iOS ni instalación PWA en un dispositivo.
La navegación real y la reproducción local se distinguen arriba; no equivalen
a certificar todos los escenarios posibles.
