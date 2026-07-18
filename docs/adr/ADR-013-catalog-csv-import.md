# ADR-013: Importación transaccional del catálogo por CSV

## Estado

Aceptado — 2026-07-18.

## Contexto

Los negocios que migran a Kova necesitan cargar productos, costos e inventario sin capturarlos uno por uno. Una importación parcial o repetida podría dejar categorías huérfanas, SKUs duplicados o existencias sin trazabilidad.

## Decisión

- Se usa un flujo de dos pasos: `dry_run` valida y normaliza; confirmar vuelve a validar y escribe todo en una sola transacción.
- El commit exige `Idempotency-Key` y vincula la respuesta al hash exacto del archivo.
- El CSV admite hasta 1,000 filas y 2 MB, codificación UTF-8 y columnas conocidas únicamente.
- Las categorías activas se reutilizan por nombre; las faltantes se crean. Una categoría desactivada produce un error explícito y nunca se reactiva de forma implícita.
- El stock inicial se registra como movimiento de ajuste en el ledger de inventario, no como actualización directa.
- La operación requiere `catalog.create`, acceso comercial vigente y genera un evento de auditoría agregado.
- Si una fila falla, no se escribe ninguna fila.

## Consecuencias

El usuario obtiene una vista previa fiel antes de escribir y puede reintentar con seguridad. La importación privilegia consistencia y trazabilidad sobre aceptar archivos ambiguos o parcialmente válidos.
