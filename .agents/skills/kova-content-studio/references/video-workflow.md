# Flujo de video · v1.1 · BORRADOR

Ampliación solicitada por Arturo el 18 de noviembre de 2026: incorporar buenas prácticas de las skills horizontal y vertical de AL DESTINO, adaptadas a Kova. Este paquete mantiene sus instrucciones operativas completas; no depende de ese repositorio ni adopta su marca, editor, personajes o recursos de viajes.

Carga primero el paquete estático indicado en [design-system-access.md](design-system-access.md), incluidos sus tokens de movimiento y assets. Fija después la relación de aspecto del master y resuelve `../assets/media-library.json` con [media-orientation.md](media-orientation.md) antes del storyboard. Registra el pool y las rutas seleccionadas en el brief.

Para editar los videos aportados por el usuario como pieza vertical en Clipo, usar [kova-content-vertical](../../kova-content-vertical/SKILL.md) y su MCP, según la petición de Arturo del 18 de noviembre de 2026. Las secciones de audio, marca, narrativa y revisión de este paquete se comparten; leerlas no cambia el editor ni requiere HyperFrames. Para composiciones nuevas y motion graphics en HyperFrames, cargar primero esa skill y seguir su enrutamiento; `imagegen` sólo produce imágenes de apoyo cuando hacen falta.

La selección del manifiesto prevalece sobre la captura o búsqueda automática de medios de otros flujos. No permitas que HyperFrames añada archivos del sitio, `showcase/`, outputs anteriores o el proyecto actual si no están listados o aportados por el usuario. Resuelve `product_ui` por separado sólo cuando el storyboard justifique una demostración concreta; nunca lo uses como fallback creativo.

El manifiesto gobierna la selección visual. Los SFX externos autorizados abajo se descargan y documentan por separado; no requieren regenerar ese manifiesto ni permiten añadir imágenes o videos externos.

## Lectura según la tarea

- Con metraje nuevo o una adaptación: aplicar [cobertura, selección y continuidad](video-editing.md#cobertura-selección-y-continuidad), reutilizando el trabajo que ya exista.
- Para apertura, historia y encuadre: aplicar [montaje horizontal](video-editing.md#montaje-horizontal) o [montaje vertical](video-editing.md#montaje-vertical) según el formato real. Si se encargan ambos, compartir brief y evidencia con decisiones propias de encuadre.
- Para acabado gráfico: aplicar [efectos, lectura y aplicación](video-editing.md#efectos-lectura-y-aplicación). La política de audio y stock SFX se mantiene una sola vez en este flujo.
- Para convertir medios o entregar un render: aplicar [calidad y revisión de la exportación](video-editing.md#calidad-y-revisión-de-la-exportación). Planificar una pieza no exige ejecutar esas comprobaciones; dejarlas pendientes hasta que corresponda.

## Rutas frecuentes de composición HyperFrames

- `product-launch-video`: showcase de Kova, el sitio o un flujo del producto.
- `general-video`: reel narrativo, campaña social o composición personalizada.
- `motion-graphics`: unidad corta, sin narración y normalmente menor de 10 s.
- `talking-head-recut`: footage existente usado visualmente, con su voz eliminada y overlays diseñados.

Cuando el editor elegido sea HyperFrames, sigue la ruta que determine esa skill; esta lista no reemplaza sus contratos ni se aplica al montaje MCP en Clipo.

Si el material fuente contiene una persona hablando, la eliminación de su audio forma parte del encargo. No uses `embedded-captions` como ruta final cuando conservaría la voz; usa la ruta de edición que permita mutear o retirar el audio y mantener los subtítulos integrados.

## Política permanente de voz y audio

- No generes ni añadas locución, narración, TTS, doblaje o voz clonada.
- No propongas voz durante entrevistas de intención ni durante el media opportunity pass, aunque otro flujo la recomiende.
- Usar SFX puntuales cuando mejoren la comprensión o el énfasis de una acción o gráfico, sin una cuota ni autorización adicional por efecto. La música y las pistas de ambiente siguen requiriendo petición explícita; la autorización de SFX no incluye voz.
- El video debe funcionar completamente en silencio. La secuencia visual y los subtítulos cargan toda la historia.
- Si una ruta presupone narración, conserva su estructura narrativa pero conviértela en beats visuales y subtítulos; no generes un archivo de voz temporal.

Esta política prevalece sobre sugerencias opcionales de audio de otras skills del flujo.

### SFX gratuitos autorizados

Instrucción de Arturo del 16 de noviembre de 2026: Mixkit y Freesound CC0 son las fuentes preferidas para los videos de Kova, incluidos los orgánicos de la propia marca. Reutilizar primero un archivo documentado si encaja; para nuevas búsquedas:

- [Mixkit](https://mixkit.co/free-sound-effects/): primera opción para clics, apariciones de gráficos y transiciones discretas. Su [licencia de SFX](https://mixkit.co/license/modal/sfxFree/) permite incorporarlos a videos comerciales sin atribución obligatoria. No redistribuir el sonido aislado, en paquetes, herramientas, plantillas o archivos fuente, ni registrarlo como propio en sistemas de gestión de derechos.
- [Freesound](https://freesound.org/): alternativa para sonidos específicos. Filtrar por **CC0** y comprobarla en la ficha de cada archivo; excluir CC BY, CC BY-NC y Sampling+ en este flujo. Consultar sus [licencias](https://freesound.org/help/faq/#licenses) y [CC0](https://creativecommons.org/publicdomain/zero/1.0/).

Verificar la licencia vigente al seleccionar cada recurso. Registrar en el brief archivo/ID, autor, URL de la ficha, licencia y URL, fecha de consulta, comprobante local, motivo y tiempos de uso. Guardar sólo los audios seleccionados y sus comprobantes con los medios de trabajo del proyecto, fuera de carpetas públicas y de Git; si la licencia no puede verificarse, buscar otro o dejar pendiente el acento. Esta autorización es para SFX; no se extiende a música ni a otros recursos de esas webs.

Insertar el archivo local en una pista editable, sincronizado con el evento visual. Elegir acentos contenidos sin sonorizar cada corte ni fingir que Kova emite un sonido real de interfaz. El video conserva toda su información en silencio. Comprobar el movimiento en imagen y el nivel/sincronía por escucha del render; si no hay acceso auditivo, marcar esa revisión pendiente. Licencias consultadas el 16 de noviembre de 2026; no garantizan ausencia de reclamaciones automáticas.

## Subtítulos como narrativa

- Integra los subtítulos dentro del video final; no entregues únicamente un `.srt` o `.vtt`.
- Escribe para lectura móvil: fragmentos breves, una idea por beat y máximo dos líneas visibles.
- Sincroniza cada bloque con la acción o evidencia que explica; evita subtítulos que anticipen una pantalla todavía invisible.
- Conserva español de México, acentos, puntuación y términos exactos del producto.
- Usa la tipografía, contraste y zonas seguras del paquete de Kova. No tapes controles, cifras ni rostros.
- Entrega un archivo lateral de subtítulos sólo si el usuario lo solicita.

## Brief adicional de Kova

Además del brief del flujo de video, registra:

- giro, tensión y decisión del dueño;
- evidencia real de producto disponible;
- una sola promesa;
- frase exacta de cierre y CTA;
- formato y duración;
- selección de fuentes con dimensiones y tratamiento `contain`, `cover` o `inset`;
- bloques narrativos con su aporte, evidencia y enlace al siguiente; hook elegido y alternativas sólo cuando aporten;
- tiempos de origen de selecciones reales, orden y posición en la composición, recorte/velocidad, recursos y pistas aplicados;
- identificador de pieza/campaña y variante, enlazando el origen de un derivado y reutilizando el brief y la cobertura;
- elementos que requieren verificación antes del render final.

Para una pieza social nueva sin especificación: partir de vertical 9:16; para búsqueda o educación horizontal, de 16:9. 1080×1920 y 1920×1080 son opciones de composición, no reducciones obligatorias de material superior. Elegir resolución y fps según fuentes, destino y capacidad real del render. Orientación, duración y plataforma son decisiones distintas; respetar cualquier proporción explícita, incluido cuadrado.

Como rangos para estimar un primer storyboard se pueden ensayar 20–40 s en una pieza social, 45–75 s en una minihistoria o 3–7 min en una explicación horizontal. La historia y la lectura deciden la duración: recortar repeticiones y colas, sin rellenar para alcanzar esos rangos ni omitir pasos que hacen comprensible la demostración. Respetar un máximo explícito y registrar qué desarrollo queda fuera. No afirmar mejoras de retención o CTR sin datos propios comparables.

## Gramática narrativa y visual

1. Abre con una escena o tensión reconocible.
2. Introduce pronto una sola acción real en Kova.
3. Muestra la consecuencia: caja, inventario, señal o decisión.
4. Cierra con una línea útil y un CTA proporcional.

La UI demuestra; no es decoración. Mantén capturas reales como capas sin deformar ni reescribir sus datos. Si falta producto aprobado, diseña placeholders explícitos para insertar una captura después, no una UI ficticia.

Usa movimientos breves, limpios y seek-safe: transform y opacidad, jerarquía clara, transiciones según función y pausa estable de lectura. Da más agilidad al vertical con cortes, variación de escala, demostraciones y cambios de información; en horizontal deja espacio al desarrollo de cada paso. Evita zooms constantes, partículas, glitch, 3D gratuito y ritmo frenético que compita con la explicación. Los subtítulos deben poder leerse en móvil y permanecer en zonas visibles de la interfaz del canal, comprobadas para el destino cuando sea necesario.

Construye el ritmo con cortes, movimiento y duración de los subtítulos. No dependas de una pista de audio para que el montaje tenga sentido.

## Recursos generativos

Cuando una toma de apoyo necesite IA, aplica `imagegen` y el sistema de [brand-system.md](brand-system.md). Marca las recreaciones como tales cuando puedan confundirse con un negocio o cliente real. No inventes testimonios, resultados ni capturas.

## QA de composición y entrega

- inspecciona fotogramas temprano, medio y final;
- revisa textos, acentos, montos y subtítulos;
- confirma que logo, colores y tipografía coinciden con marca;
- confirma que toda función, oferta y cifra es vigente y verificable;
- verifica continuidad, encuadre vertical u horizontal y zonas seguras;
- confirma que el master vertical use prioritariamente fuentes verticales y el horizontal fuentes horizontales; documenta cualquier fallback;
- confirma que no exista voz, que los SFX sean pertinentes y estén documentados, y que no se haya añadido música o una pista de ambiente sin petición explícita;
- si hay SFX, escucha el render para comprobar sincronía, niveles y entradas/salidas; registra cualquier escucha pendiente;
- reproduce una revisión completa en silencio y confirma que los subtítulos sean suficientes, estén sincronizados y no oculten la evidencia;
- ejecuta los checks y el render del flujo elegido: `hyperframes` para sus composiciones o el MCP de Clipo para el montaje vertical aportado; comprueba las capacidades reales de esa ruta;
- aplica [la revisión completa del archivo exacto](video-editing.md#calidad-y-revisión-de-la-exportación): avance de imagen, fidelidad de fuente, comparación con preview y revisión nueva para cada render. Los fotogramas temprano/medio/final son preflight, no prueba de fluidez;
- guarda y reabre el proyecto editable cuando forme parte del encargo y comprueba medios, fuentes y tiempos; no confundir el proyecto ya abierto con una carga desde almacenamiento.

Entrega el video con subtítulos integrados, duración, brief, archivos editables solicitados y cualquier fuente o afirmación pendiente. Distingue plan preparado, aplicado, verificado por muestras y revisado completo; indica qué se vio, escuchó, exportó y reabrió. Marca las propuestas nuevas como BORRADOR hasta una decisión expresa; no confundir render completado con aprobación o publicación. Si sólo se pidió un plan o proyecto, no exportes por defecto. Indica expresamente si se comprobó la ausencia de voz y qué audio adicional autorizado contiene. Guarda finales en la ubicación del proyecto establecida en la skill, fuera de esta carpeta de instrucciones y sin sobrescribir originales.
