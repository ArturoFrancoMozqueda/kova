# ADR-040 — Insumos y unidades base enteras, en todos los planes

Estado: aceptada; implementación local (E2), publicación no acreditada.
Fecha: 2026-11-26.

## Contexto

El segmento prioritario (cafeterías, panaderías y pastelerías) necesita llevar insumos que no se
venden y que se usan por porción, antes de poder costear recetas y producción. El inventario de
Kova guarda cantidades `Integer` en movimientos, existencias, reservas, lotes, conteos, compras y
traspasos. `cost_price` es `Numeric(12,2)`. [`deferred-scope.md`](../deferred-scope.md) dejaba
recetas y producción fuera del alcance hasta una decisión del dueño.

## Decisión

1. **Unidad base entera por producto** (`pza`, `g`, `ml`). Toda cantidad de inventario existente
   conserva su significado como enteros de esa unidad. Se descartó migrar columnas a decimales:
   tocaría decenas de tablas, contratos offline y reportes con riesgo alto y sin ganancia real
   para porciones de café o panadería.
2. **Unidad de compra opcional** que congela su factor en cada partida de compra. `cost_price`
   significa costo por unidad de compra cuando existe; así un costo por litro cabe en dos
   decimales y el costo por ml se deriva sin redondeo intermedio.
3. **Insumo = `is_sellable = false`**, filtrado en servidor en cada canal de venta. Una venta
   offline ya cobrada no se pierde: se conserva y se marca para revisión.
4. **Plan:** por decisión del dueño (26-nov-2026), insumos, unidades, recetas y producción son
   parte del núcleo de inventario en Esencial, Gestión y Standard. No cambia precios ni otras
   funciones; Compras sigue en Gestión.

## Consecuencias

- Recetas (E3) y producción (E4) consumirán enteros de unidad base y usarán el costo derivado.
- Cambiar la unidad base de un producto con movimientos queda prohibido.
- Un rollback de app no baja la base; una app anterior ignora las columnas nuevas, salvo la
  recepción de partidas con factor distinto de 1 (documentado en la spec).
- `deferred-scope.md` retira recetas y producción del alcance diferido.
