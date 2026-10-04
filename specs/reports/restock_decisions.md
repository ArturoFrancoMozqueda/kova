# Reposición desde Análisis

## Objetivo

Convertir existencias, reservas y salida por ventas ya registradas en una decisión revisable de
reposición, con navegación al producto y comprobación posterior mediante el inventario real.
Esta mejora amplía las recomendaciones existentes; no crea órdenes de compra ni nuevos proveedores.

## Fuentes y cálculo

- `GET /inventory/stock`: existencias, reservas y cantidad disponible del tenant autenticado.
- `GET /inventory/velocity`: salida media de inventario por ventas registradas durante los últimos
  siete días. Puede incluir consumo de inventario distinto del número de tickets.
- Horizonte elegido por el dueño: 3, 7 o 14 días; inicial de 7 días.
- Objetivo estimado: `ceil(units_per_day_7d * horizonte)`.
- Cantidad sugerida: `max(0, objetivo - available_quantity)`.
- La disponibilidad ya descuenta reservas según el contrato del backend; no se descuentan dos veces.
- Se consideran todos los productos con seguimiento, independientemente de los productos líderes
  o del rango histórico del reporte. La interfaz identifica explícitamente esta ventana actual.

## Exactitud y límites

La sugerencia no demuestra ventas perdidas, ahorro, retorno de la suscripción ni demanda futura.
El dueño debe ajustar por caducidad, compras en tránsito y plazos de entrega. Un stock negativo,
reservas/disponibilidad inconsistentes o un ritmo ausente, cero o inválido no produce una cantidad.
La falta de respuesta del inventario se presenta como fallo recuperable; no equivale a ausencia de
seguimiento. El estado sin necesidades se limita a productos con datos suficientes.

## Recorrido y seguridad

1. Análisis presenta cantidad, existencias y reservas de inmediato; la fórmula y límites se consultan
   en un detalle accesible. El plazo tiene una pregunta visible y controles táctiles de al menos 44 px.
2. Cambiar horizonte recalcula la planificación; no escribe en el backend.
3. Revisar un producto abre `/inventory?product=<id>` y muestra únicamente ese producto del stock
   devuelto por la API autenticada. Un ID ausente muestra un aviso, sin buscar datos de otro tenant.
4. Navegar no crea compras, entradas ni acciones completadas. Registrar una entrada exige el formulario
   existente, permisos y confirmación explícita de la cantidad recibida.
5. Volver a Análisis consulta nuevamente las fuentes; la sugerencia cambia según existencias reales.
6. Los enlaces de recomendaciones R2/R4/R12 abren el producto concreto. R5 lleva al catálogo filtrado
   para editar un producto existente, sin abrir un formulario de creación.
7. La telemetría conserva categorías existentes R2/R4; no transmite productos, cantidades ni importes.
   Revisiones sin una cantidad estimable no se interpretan como recomendaciones cuantitativas.

## Verificación

- Cálculo con reservas, horizontes, demanda fraccionaria, faltantes de datos y cantidades inválidas.
- Fallos de stock/velocidad recuperables y ausencia de falsas recomendaciones de inventario no vinculado.
- Plan disponible incluso cuando el rango seleccionado no tiene ventas.
- Recorrido Análisis → producto → entrada recibida → Análisis en escritorio y móvil.
- Un producto inexistente no expone otros productos y el enfoque puede quitarse sin mutaciones.

Estas pruebas usan datos de prueba aislados; no certifican producción ni resultados económicos.
