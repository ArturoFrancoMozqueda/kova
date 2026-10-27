# Contrato de experiencia de Kova

Guía para mantener una experiencia común entre módulos. Conserva los contratos de cada dominio y complementa `product-context.md`, `manual-qa-checklist.md` y `architecture-context.md`.

## Anatomía compartida

1. **Mismo marco:** `ViewLayout` define ancho, márgenes y espaciado. Mantener ese marco al cargar, fallar, negar acceso o perder conexión. No reemplazarlo por un párrafo suelto.
2. **Mismo encabezado:** `ViewHeader` presenta el nombre de la tarea, una explicación breve y la acción principal en `actions`. Agrupar acciones relacionadas; no introducir otro sistema de encabezados por módulo.
3. **Operación antes que configuración:** registros, pendientes y recepción aparecen antes que altas o ajustes. Formularios secundarios se abren desde acciones explícitas, con `aria-expanded`, asociación al panel y foco perceptible. Plegar un formulario no debe perder un borrador sin aviso.
4. **Mismos controles:** reutilizar `Input`, `Select`, `Textarea`, `Label`, `Button` y diálogos compartidos. Cada campo conserva validación, tipo, ref, nombre accesible y asociación única. No reconstruir foco/borde por vista.
5. **Mismos estados:** `ViewEmpty` orienta con acción contextual; `ViewError` permite reintentar; carga y error nunca se presentan como ausencia de datos. No fabricar métricas, registros ni contadores.
6. **Mismo teclado:** filtros de selección usan `SegmentedControl`; no declarar tabs sin paneles y navegación correspondiente. Validar flechas, Home/End y una sola parada de Tab en grupos de radio.
7. **Mismos términos:** “Tarjeta manual” registra un medio declarado; no significa cargo bancario. “Pedido” es compromiso operativo, “venta” registra el cobro y “solicitud” requiere revisión. Usar español de México y explicar efectos comprensibles para el negocio.

Caja conserva su disposición especializada para vender rápido; comparte controles y significado financiero con el cobro de Pedidos. El menú público conserva su experiencia de cliente y no expone cantidades exactas, costos ni herramientas administrativas.

## Navegación por rol

- Caja, Pedidos y Ventas son accesos directos en la barra lateral y en el pie móvil;
  Pedidos conserva su permiso y feature flag. Panel permanece directo para dueño y gerente.
- Los accesos diarios permanecen fijos mientras se desplazan las categorías. En ventanas
  de hasta 700 px de alto, el menú completo admite desplazamiento para conservar acceso a
  todas las categorías; el pie móvil mantiene Caja/Pedidos/Ventas al cerrar el menú. Menú y ventas,
  Clientes y atención, Productos y operación, Análisis y finanzas y Configuración se abren
  con botones de flecha y `aria-expanded`, sin navegar a otra pantalla.
- La categoría de una ruta directa se abre automáticamente. Las demás conservan la elección
  del usuario; las preferencias se separan por negocio, persona y rol y no contienen sesiones.
- Una categoría con una sola opción se muestra como enlace directo. Cajeros y colaboradores
  conservan así una lista corta con Clientes y Turnos, según su acceso existente.
- La barra compacta conserva nombres accesibles; abrir una categoría expande la barra sin
  cambiar de página. El menú móvil conserva el foco, Escape y cierre al elegir destino.
- La búsqueda encuentra también opciones dentro de grupos cerrados. Ningún grupo, resultado
  o acceso contextual debe ampliar permisos, capacidades, funciones contratadas o sesión offline.

## Continuidad del trabajo

Los enlaces por registro llevan al cliente, oportunidad, pedido, venta o compra exactos. Un enlace general sirve para explorar; no sustituye una conversión que conserva origen, identidad y auditoría. No crear un pedido separado al continuar desde una cotización existente.

| Recorrido | Condición y continuación |
|---|---|
| Mostrador | Catálogo → Caja → venta y recibo → inventario, resultados e historial. No exigir oportunidad o cotización para una venta directa. |
| Solicitud del menú | El cliente envía y continúa al seguimiento de su solicitud. El equipo abre Solicitudes desde Pedidos, revisa productos y elige o registra al cliente antes de crear el pedido; una consulta general puede continuar como oportunidad. Enviar solicitud no reserva mercancía, genera venta ni concede permiso de campañas. |
| Propuesta comercial | Oportunidad → cotización → registro de comunicación/aceptación → pedido vinculado. Registrar que se compartió una propuesta no envía un mensaje. Aceptarla no cobra. |
| Pedido | Nuevo → confirmación y reserva → cobro → preparación → listo → entrega. Conservar cliente y referencias. Entregar y cobrar son estados separados; nunca deducir uno del otro. |
| Servicio con cita | Cliente → cita con recurso/horario → venta en Caja → vínculo explícito de venta → historial. Asistencia, atención y cobro conservan su significado. |
| Postventa | Cliente o venta → atención/seguimiento con responsable, notas y estado. Cerrar una atención no devuelve dinero ni acredita contacto externo. |
| Abastecimiento | Faltante → revisión de reposición → proveedor y compra aprobada → compra exacta → recepción parcial/total → existencias. Crear compra no recibe mercancía ni paga al proveedor. |
| Control | Venta y devoluciones → resultados coherentes → prioridad y siguiente acción. Los mismos umbrales alimentan detalle y recomendaciones. |

Formularios y vínculos conservan las comprobaciones de rol, permiso, sucursal, tenant, estado actual y disponibilidad online. No inferir identidad desde teléfono o texto libre ni presentar un estado local pendiente como sincronizado.

Un enlace a compra usa `purchase_id`. Si el registro no está en la página/sucursal consultada, explicar el límite y permitir continuar la consulta; no sustituirlo por otra compra ni recibir automáticamente.

## Criterio de aceptación

- Verificar 390 y 1440 px; agregar 320/768 cuando el contenido lo requiera. Sin desplazamiento horizontal de página, campos/acciones recortados ni pérdida de foco. Un filtro ancho puede tener desplazamiento interno.
- Probar CTA, formulario, carga, vacío, error, permisos, recarga y comportamiento offline relevante. Los vínculos contextuales preservan el registro exacto.
- Usar pruebas por componente para reglas y teclado; navegador sobre el build para composición, accesibilidad y continuación entre módulos.
- Para acreditar el circuito, usar `business-lifecycle-real.spec.ts` con API/PostgreSQL/RLS locales reales: maestros preparados antes del flujo, acciones comerciales mediante UI, lecturas posteriores para conciliar identidad, dinero, reservas y existencias. Identificar como tales los escenarios con APIs interceptadas.
- La aceptación local no acredita publicación, hardware físico, proveedores conectados ni procesamiento de dinero. WhatsApp, CFDI, terminal y Stripe requieren sus propios gates; no activarlos para aparentar un circuito completo.

## Aplicación y límites de este corte

El corte del 25 de octubre adopta controles/CTA/vacíos compartidos en Agenda, Atención postventa, Seguimiento y Bandeja; prioriza operación en Compras; mejora filtros y términos de Pedidos; conserva contexto comercial/abastecimiento y corrige alertas de devolución. No representa una reescritura de todas las pantallas. La validación y pendientes se registran en `../audits/KOVA-EXPERIENCE-CONTINUITY-2026-10-25.md`.
