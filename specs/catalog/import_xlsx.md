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
