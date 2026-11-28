# Importación de catálogo XLSX

## Problema

Muchos comercios mexicanos conservan su catálogo en Excel. Obligarles a convertirlo manualmente a
CSV añade fricción y puede dañar acentos o encabezados.

## Contrato

- `POST /api/v1/catalog/import?dry_run=true|false&format=csv|xlsx` conserva el flujo de dos pasos.
- CSV y XLSX producen las mismas filas normalizadas y usan el mismo commit transaccional.
- El commit requiere `Idempotency-Key`; el hash corresponde a los bytes exactos del archivo.
- XLSX contiene exactamente una hoja, encabezados en la primera fila y hasta 1,000 productos, ocho
  columnas y 2 MB.
- Solo se admite `.xlsx`. `.xls`, `.xlsm`, macros, fórmulas, contraseña/cifrado y libros corruptos
  se rechazan antes de escribir.
- Las fórmulas no se evalúan. El propietario debe reemplazarlas por sus valores visibles.
- La inspección previa limita el número de partes ZIP, el tamaño de cada parte y el total
  descomprimido antes de abrir el workbook.
- Se preservan `catalog.create`, acceso comercial, tenant isolation, auditoría, ledger de stock y
  atomicidad existentes.

## Criterios de aceptación

- Un propietario previsualiza e importa un XLSX válido con acentos, costo e inventario inicial.
- Repetir el mismo archivo y `Idempotency-Key` devuelve la respuesta almacenada sin duplicar filas.
- Una fila inválida bloquea todo el commit igual que CSV.
- Un archivo con fórmula, macro, varias hojas, exceso de filas/columnas/celda, cifrado, corrupción o
  `Content-Type` incompatible devuelve un error accionable y no escribe datos.
- Un cajero recibe `403` con cualquier formato.
- La UI acepta `.csv` y `.xlsx`, explica los límites y muestra el preview existente.

## Exportación del catálogo

`GET /api/v1/catalog/export?format=csv|xlsx` (`catalog.create`, como la importación) descarga los
productos activos del negocio con las columnas exactas de la plantilla, para editarlos en Excel e
importarlos de nuevo:

- `stock_inicial` lleva las existencias de hoy (nunca negativas) y `umbral_stock` el umbral, solo
  para productos con inventario. `tipo` distingue `producto` de `insumo`; `unidad` es la unidad base.
- El CSV usa UTF-8 con BOM, como la plantilla. El XLSX trae una hoja "Catálogo".
- Un valor que empieza con `=`, `+`, `-` o `@` se exporta con un apóstrofo para que la hoja de
  cálculo no lo ejecute como fórmula.
- No incluye productos desactivados ni datos de otros negocios. Un cajero recibe `403`.
- La UI ofrece "Excel" y "CSV" en el diálogo de importación.

Regresiones: `backend/app/tests/test_catalog_export.py` (columnas, reimportación en otro negocio,
XLSX, fórmulas, alcance y permiso) y `frontend/src/catalog/CatalogImportDialog.test.tsx`.
