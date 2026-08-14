# ADR-013: Importación transaccional del catálogo por CSV y XLSX

## Estado

Aceptado — 2026-07-18.

## Contexto

Los negocios que migran a Kova necesitan cargar productos, costos e inventario sin capturarlos uno por uno. Una importación parcial o repetida podría dejar categorías huérfanas, SKUs duplicados o existencias sin trazabilidad.

## Decisión

- Se usa un flujo de dos pasos: `dry_run` valida y normaliza; confirmar vuelve a validar y escribe todo en una sola transacción.
- El commit exige `Idempotency-Key` y vincula la respuesta al hash exacto del archivo.
- CSV y XLSX convergen en una sola canalización de normalización, validación, preview y commit. No existen reglas de negocio ni escrituras separadas por formato.
- Ambos formatos admiten hasta 1,000 productos, 2 MB y las mismas ocho columnas conocidas. CSV usa UTF-8 con o sin BOM; la plantilla descargable incluye BOM para conservar acentos de es-MX en Excel.
- XLSX admite exactamente una hoja y rechaza fórmulas, macros, libros cifrados, paquetes corruptos, más de ocho columnas, celdas de más de 2,000 caracteres y paquetes con tamaño descomprimido fuera de límites. Las fórmulas nunca se evalúan ni se sustituyen por valores cacheados.
- El formato seleccionado en la API debe coincidir con el `Content-Type`; el frontend deriva ambos de una extensión `.csv` o `.xlsx` admitida y rechaza `.xls`/`.xlsm` antes de enviar.
- Las categorías activas se reutilizan por nombre; las faltantes se crean. Una categoría desactivada produce un error explícito y nunca se reactiva de forma implícita.
- El stock inicial se registra como movimiento de ajuste en el ledger de inventario, no como actualización directa.
- La operación requiere `catalog.create`, acceso comercial vigente y genera un evento de auditoría agregado.
- Si una fila falla, no se escribe ninguna fila.

## Consecuencias

El usuario obtiene la misma vista previa y garantías al migrar desde CSV o un libro moderno de Excel. Puede reintentar con seguridad porque el hash e idempotencia se calculan sobre los bytes exactos del archivo. La importación privilegia consistencia, límites de recursos y trazabilidad sobre aceptar libros ambiguos o parcialmente válidos.
