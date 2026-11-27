# ADR-041 — Recetas versionadas que se consumen al vender

Estado: aceptada; implementación local (E3), publicación no acreditada.
Fecha: 2026-11-26.

## Contexto

Con insumos y unidades base ([ADR-040](ADR-040-insumos-unidades-y-recetas-en-todos-los-planes.md)),
falta que vender un producto preparado descuente sus insumos y registre su costo. Kova acepta
ventas offline que se sincronizan horas después, conserva el costo histórico de cada partida
([ADR-010](ADR-010-product-cost-snapshots.md)) y no debe bloquear el cobro en mostrador.

## Decisión

1. **Versiones inmutables con `effective_from`.** Editar crea una versión; la venta usa la vigente
   al cobrarse. Se descartó editar en sitio porque reescribiría consumo y costo de ventas offline.
2. **Consumo como movimientos `consumption` del inventario existente**, ligados a la partida. No
   hay una tabla paralela de consumo: el inventario sigue siendo la única fuente de existencias.
3. **No bloquear la venta** por existencias de insumos. La diferencia aparece en conteos.
4. **Ajustes con signo por opción de modificador**, reemplazables como conjunto. Las ventas ya
   registradas conservan sus movimientos, así que el historial no depende del ajuste vigente.
5. **Costo de la partida desde la receta**, sin costo si falta el de algún insumo.
6. **Separación de producción:** un producto con receta al vender no controla existencias propias;
   la producción por lote (E4) usará `mode = batch` y piezas terminadas con existencias.

## Consecuencias

- Un rollback de app no baja la base; una versión anterior vende sin consumir insumos.
- El downgrade del esquema se rechaza cuando ya hay recetas o consumo.
- Devolver no repone insumos; anular sí revierte el consumo.
