# Selección de medios por orientación

Usa esta referencia cuando el usuario aporte imágenes o videos, o cuando el proyecto contenga material aprobado que pueda integrarse en una pieza.

## Regla principal

Fija primero las dimensiones del entregable. Después selecciona material por sus dimensiones reales, no por su nombre, carpeta o sufijos como `mobile`, `story` o `desktop`.

`../assets/media-library.json` es la allowlist de referencias pertenecientes al repositorio. Sus pools creativos apuntan a carpetas administradas por el usuario:

- `assets/marketing/references/vertical/` para `9:16`, `4:5` y otras salidas verticales;
- `assets/marketing/references/horizontal/` para `16:9`, `3:2` y otras salidas horizontales;
- `assets/marketing/references/square/` para `1:1`.
- `assets/marketing/references/product-ui/vertical/` para capturas aprobadas de Kova en vertical;
- `assets/marketing/references/product-ui/horizontal/` para capturas aprobadas de Kova en horizontal.

Todo raster compatible colocado en los tres primeros directorios se considera aprobado como referencia creativa. Los directorios `product-ui/` pertenecen exclusivamente al pool `product_ui`: son evidencia visual del producto, deben estar libres de datos personales y sólo se usan para la función visible que corresponda. No añadas archivos encontrados mediante una búsqueda libre. Los medios que el usuario aporte directamente en la conversación también pueden sustituir la selección del manifiesto.

Dentro de `product_ui`, las capturas administradas por el usuario tienen prioridad sobre los assets heredados de `frontend/public/showcase`. La orientación correcta siempre prevalece sobre esa prioridad: una captura vertical no desplaza a una horizontal cuando el entregable es horizontal, ni al contrario.

- Salida vertical `9:16`, `4:5` o similar: prioriza fuentes verticales.
- Salida horizontal `16:9`, `3:2` o similar: prioriza fuentes horizontales.
- Si una campaña necesita ambas salidas, crea dos selecciones y dos decisiones de encuadre. No uses automáticamente un solo master recortado.

Resuelve el pool aprobado y sus dimensiones con:

```powershell
python scripts/catalog_media.py --repo <ruta-del-repositorio> --target 1080x1920
python scripts/catalog_media.py --repo <ruta-del-repositorio> --target 1920x1080
python scripts/catalog_media.py --repo <ruta-del-repositorio> --target 1080x1920 --pool product_ui
```

Sin `--pool`, el script elige `portrait`, `landscape` o `square` según la salida. `product_ui` se resuelve por separado y sólo cuando exista una necesidad explícita de producto. El script reporta dimensiones, orientación, rol, uso permitido, tratamiento y compatibilidad. Si no puede leer un formato, inspecciónalo con las herramientas de imagen disponibles. Para video, usa la metadata y el inspector del flujo elegido: MCP de Clipo para su montaje, o las herramientas de HyperFrames para sus composiciones; `ffprobe` sólo cuando la ruta autorice inspección local. Los videos aportados directamente pueden inventariarse en el MCP sin ejecutar el catálogo del repositorio. Aplica después las mismas reglas de encuadre y autorización.

Si alguien coloca una imagen horizontal dentro de `vertical/`, o viceversa, el resolver la rechaza y lo informa; no la usa como fallback.

## Orden de selección

1. Pool autorizado o material aportado por el usuario.
2. Relevancia narrativa y campo `usage` compatible.
3. Misma orientación que la salida.
4. Relación de aspecto más cercana y mayor `crop_retained`.
5. Resolución suficiente y encuadre que preserve sujeto, espacio negativo y continuidad.

El ranking automático produce una shortlist, no aprueba el encuadre. Inspecciona visualmente los candidatos antes de componer.

## Tratamiento por tipo de fuente

- **Fotografía o ilustración:** permite `cover` sólo si el recorte conserva el sujeto y la evidencia. Reencuadra de forma intencional; no estires ni rotes.
- **Captura de Kova, UI, tabla o gráfico:** usa `contain` y conserva la imagen completa. Nunca cortes navegación, etiquetas, cifras o contexto para llenar el cuadro. En una salida vertical, colócala como tarjeta o ventana dentro del lienzo.
- **Logo o asset de marca:** usa el archivo oficial sin recorte ni regeneración.
- **Fuente con otra orientación:** úsala sólo como fallback explícito: inset, split layout, fondo extendido o marco. No simules una variante vertical/horizontal con generación si eso alteraría UI, datos o identidad.
- **Nueva imagen generada:** pide desde el inicio la relación exacta del entregable y el espacio negativo necesario; no generes cuadrado para recortar después si ya conoces el formato final.

Las entradas `design_reference` se inspeccionan para extraer gramática visual; no se insertan como footage ni se convierten en el contenido de la pieza. Las entradas `product_evidence` se componen intactas y no determinan el estilo.

Si el pool de orientación está vacío o no sirve para la escena, genera una toma nueva en la relación exacta o solicita una fuente. No sustituyas silenciosamente con `product_ui` ni con archivos excluidos. No bloquees todo el encargo si puedes reemplazar el plano sin cambiar la promesa.

## Registro en el brief o storyboard

Para cada plano o lámina anota:

```text
<fuente> | <ancho>x<alto> | <uso> | contain / cover / inset | <recorte o zona segura>
```

En QA confirma que cada fuente elegida corresponde a la orientación final y que ningún recorte oculta producto, texto, logo o evidencia.
