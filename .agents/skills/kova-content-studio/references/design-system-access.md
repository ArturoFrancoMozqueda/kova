# Paquete estático del design system de Kova

La ejecución diaria usa un paquete versionado y autocontenido. No inspecciona ni recompila el repositorio en cada pieza.

## Fuente diaria

Antes de producir una imagen, carrusel, composición tipográfica o video, lee:

1. `../assets/design-system.json` para tokens, tipografías, roles de componentes y versión de origen.
2. [brand-system.md](brand-system.md) para gramática visual, fotografía, logo y uso de producto.
3. `../assets/kova-mark-dark.svg` o `../assets/kova-mark-light.svg` según el fondo.

Estos archivos forman un solo contrato. Durante una ejecución normal no sustituyas un token empaquetado por un valor encontrado casualmente en código, documentación o una pieza histórica. Esto mantiene consistencia entre publicaciones del mismo ciclo.

## Aplicación por tipo de pieza

- **Pieza editorial sin UI:** usa paleta, tipografía, logo y reglas de composición del paquete.
- **Tarjeta de datos o analítica:** aplica el rol `data_story` y la gramática de tarjetas, cifras tabulares, bordes y sombras.
- **Caja o recibo:** aplica el rol `receipt_story`; no inventes transacciones ni montos presentados como reales.
- **Marca o cierre:** aplica el rol `brand` y usa el SVG incluido, nunca una recreación generativa.
- **Video o animación:** usa los tokens `motion` empaquetados y las reglas del flujo de video.
- **Captura de producto:** la captura no forma parte del design system. Obtén una captura actual, aprobada y sin datos sensibles, e inspecciónala antes de componer.

Los `component_sources` del JSON son trazabilidad y una guía para mantenimiento; la ejecución diaria no necesita abrirlos salvo que el usuario pida reproducir un componente con precisión no cubierta por el paquete.

## Cuándo actualizar

No actualices por fecha ni en cada corrida. Refresca sólo cuando:

- se apruebe un cambio de marca, tokens, tipografía, logo, componentes base o motion;
- el usuario solicite sincronizar la skill con el producto;
- una pieza requiera un componente nuevo que el contrato estático no describe;
- una comprobación explícita indique que el paquete está desactualizado.

Comprobación manual de sólo lectura:

```powershell
python scripts/refresh_design_system.py --repo <ruta-del-repositorio> --check
```

Actualización explícita del paquete:

```powershell
python scripts/refresh_design_system.py --repo <ruta-del-repositorio> --write
```

Después de actualizar, revisa `warnings_at_refresh`, inspecciona los cambios del JSON y los SVG generados desde `frontend/public/favicon.svg`, y valida la skill. El código fuente señalado por el paquete tiene prioridad durante el mantenimiento; las advertencias registran documentación que estaba desfasada al generar la versión.

## Límites

- El paquete gobierna identidad y composición, no funciones, precios, promociones ni datos del producto; esas afirmaciones sí deben verificarse en fuentes actuales.
- Images sirve para fotografía, ilustración o textura. Copy, logo, cifras, gráficos y UI permanecen en capas deterministas.
- No uses `21st-design-sync` para esta tarea: publica un tema en la biblioteca pública de 21st.dev.
- No ejecutes el `buildCmd` de `.design-sync/config.json` para producir contenido diario.
