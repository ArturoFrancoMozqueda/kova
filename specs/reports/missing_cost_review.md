# Revisión del costo faltante desde Análisis

Estado: implementación local autorizada, 2026-10-26.

Cuando el reporte real de margen está incompleto, el dueño puede desplegar los productos
con `missing_cost` y abrir `/catalog?edit=PRODUCT_ID`. Sólo se listan productos devueltos
por el reporte; no se calculan márgenes ni costos estimados en el cliente.

Catálogo resuelve el ID exclusivamente contra su lista autenticada del negocio y exige
`catalog.update`. Consume el intento al abrir el editor existente, conserva otros filtros,
hash y estado de navegación, y no escribe por visitar el enlace. Un ID ausente informa
que el producto no está disponible; un cajero sin permiso no puede abrir el editor.

Completar el costo actual sirve para las próximas ventas registradas. No rellena el costo
histórico de ventas anteriores ni transforma margen bruto en utilidad neta.

Aceptación: el producto correcto se abre sin una consulta arbitraria por UUID; cancelar
no repite el intento; un usuario sin permiso no edita; el reporte y sus importes permanecen
iguales. Las pruebas de MarginAnalysis y CatalogView.discovery cubren estas condiciones.
