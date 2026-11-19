---
name: kova-content-vertical
description: "Editar los videos aportados en Clipo mediante MCP para Reels, TikTok y Shorts de Kova con enfoque trending: formatos sociales, historia humana, emoción, hooks y ritmo. Incluye montaje, textos, audio autorizado y revisión del proyecto editable."
---

# Kova · Contenido vertical trending con Clipo · v1.3 · BORRADOR

Crear piezas que se sientan propias del feed de Reels, TikTok y Shorts a partir de los videos aportados: un formato social reconocible, una emoción clara y una historia humana de Kova. Tomar decisiones de selección, encuadre y texto que hagan avanzar esa historia. Las propuestas no acreditan viralidad, métricas ni aprobación de la pieza.

## Alcance y fuentes compartidas

**El editor de esta skill es Clipo y las operaciones de edición se ejecutan mediante su MCP.** Mantener el proyecto editable real, usar los clips del encargo y comprobar lo aplicado. Esta ruta tiene prioridad sobre el enrutamiento de creación con HyperFrames de `kova-content-studio`; no portar el montaje a HTML ni construir otro editor por defecto.

La identidad y las políticas compartidas viven en la skill instalada [kova-content-studio](../kova-content-studio/SKILL.md). Leer directamente las referencias necesarias, sin cargar su entrada para volver a enrutar:

- Marca: [paquete estático](../kova-content-studio/references/design-system-access.md), [sistema de marca](../kova-content-studio/references/brand-system.md) y `../kova-content-studio/assets/design-system.json`. Usar sus fuentes y logos oficiales, sin regenerarlos ni recompilar el paquete por editar un video.
- Material: [orientación y fuentes autorizadas](../kova-content-studio/references/media-orientation.md). Los videos aportados por el usuario son fuentes del encargo; los medios adicionales del repositorio se limitan al manifiesto. No usar referencias de diseño como footage ni UI como relleno.
- Selección, narrativa y encuadre: [cobertura y continuidad](../kova-content-studio/references/video-editing.md#cobertura-selección-y-continuidad) y [montaje vertical](../kova-content-studio/references/video-editing.md#montaje-vertical).
- Acabado: [gráficos y efectos](../kova-content-studio/references/video-editing.md#efectos-lectura-y-aplicación) y [política de audio/SFX](../kova-content-studio/references/video-workflow.md#política-permanente-de-voz-y-audio).
- Datos, precios o funciones: [verificación de afirmaciones](../kova-content-studio/references/claim-verification.md), sólo cuando aparezcan en la pieza. Un clip o captura prueba lo visible; no demuestra ahorro, crecimiento ni disponibilidad general.
- Ejecución: [Clipo mediante MCP](references/clipo.md), al montar o revisar el editor. Calidad/exportación: [criterios compartidos](../kova-content-studio/references/video-editing.md#calidad-y-revisión-de-la-exportación), cuando se conviertan medios o se entregue un render.

Esta skill depende del paquete instalado de Kova, no de AL_DESTINO. No copiar assets de esa marca ni buscar el repositorio de Kova dentro del proyecto que esté abierto por casualidad. Resolver el workspace desde el encargo y las fuentes disponibles; sin checkout de Kova, trabajar con el paquete y material aportado y dejar pendientes los claims que no se puedan comprobar.

## Entrar al encargo y explorar

Resolver intención, emoción, punto de vista, audiencia, destino, fuentes y entrega con lo disponible. Conservar el tema del usuario: si habla de su trabajo diario en Kova, contar esa experiencia, sin convertirla en consejos genéricos para dueños de negocios. Respetar el estado del producto indicado y comprobado: perfeccionar algo que ya funciona no equivale a anunciar que todavía se está construyendo. Inferir lo claro y preguntar sólo por un dato que cambie una decisión necesaria. No exigir otro brief si el prompt ya lo contiene. Para una edición solicitada, avanzar hasta aplicación y revisión; un plan no sustituye el montaje cuando el MCP está disponible.

Partir de 9:16 y respetar otra proporción explícita. Elegir dimensiones y fps según originales, recorte, destino y capacidades verificadas: 1080×1920 es una opción, no una reducción obligatoria. Un recorte descarta campo y puede reducir detalle útil; ampliar no lo recupera. Verificar las especificaciones vigentes del destino al necesitarlas, distinguiendo anuncios y orgánico.

Inventariar todos los clips del encargo y reutilizar exploración previa. En los largos, distribuir la búsqueda por los tramos pertinentes y examinar candidatos completos en su contexto; no elegir sólo los primeros segundos. Registrar qué se vio, muestras, intervalos y huecos. Si un archivo falla, mantenerlo como pendiente técnico, sin llamarlo descarte editorial. Probar una representación nueva antes del lote según la referencia de MCP.

## Elegir un formato social y una emoción

Partir del lenguaje de videos trending: diario de construcción, detrás de cámaras, POV, montaje de progreso, expectativa y realidad, microhistoria o contraste con remate. Elegir el formato que mejor exprese el encargo y el material; son opciones, no una plantilla fija ni prueba de que un formato esté en tendencia hoy. Registrar brevemente formato, emoción y por qué alguien se identificaría, lo compartiría o querría seguir la historia.

Cuando se use una tendencia concreta, buscar referencias actuales del destino y mercado pertinentes, preferentemente en fuentes oficiales como TikTok Creative Center. Registrar enlace, fecha, patrón observado y adaptación. Separar tendencia comprobada, referencia duradera y propuesta propia; una guía general de plataforma no prueba una tendencia vigente. Si no hay evidencia accesible, trabajar con un formato social y declararlo, sin prometer viralidad. Las referencias inspiran la edición, no autorizan reutilizar sus videos, marcas o audios.

Si el usuario pide ejemplos de Instagram, TikTok u otra red para orientar el speech, investigar publicaciones reales antes de proponer otra versión. Extraer cómo enlazan apertura, esfuerzo concreto, emoción y propósito, y relacionarlo con el metraje disponible. Registrar si se vio el video, sólo fotogramas o el caption; no afirmar escucha, reproducción completa o popularidad sin evidencia. Escribir una adaptación original, sin copiar el speech ajeno.

El tono lo decide el encargo. Para una historia optimista de trabajo diario, mostrar constancia, pequeños avances, colaboración y propósito; permitir esfuerzo y concentración sin convertirlos en derrota o agotamiento. La primera persona puede apoyarse en lo que el usuario afirma de su experiencia. Distinguir aspiración de resultado: querer resolver necesidades reales de negocios no acredita que todos los negocios ya las tengan resueltas. No inventar entrevistas, jornadas, clientes, horas trabajadas ni logros.

Construir el ritmo con acciones, detalles, miradas, cambios de escala y texto que avanza. La pieza puede sostener una frase durante varios cortes o resolver un remate; no repartir un consejo independiente en cada plano por rutina. Usar texto breve integrado al metraje, con aire para las personas y las manos. Reservar tarjetas grandes, iconos y firma para una función concreta; no convertir todo el reel en diapositivas o un anuncio corporativo. Mantener la identidad Kova con tipografía, acentos y un cierre proporcionado.

Si hay música expresamente autorizada, elegir energía y arco emocional según la historia y montar los acentos pertinentes a su pulso; no sonorizar mecánicamente cada corte. Una petición de «trending» por sí sola no cambia los permisos de música o voz. Verificar licencia y alcance comercial/plataformas del archivo real; un audio popular no implica permiso de reutilización. Conservar la comprensión completa en silencio.

## Construir una pieza que se entienda sola

Elegir una emoción, acción o descubrimiento fiel al tema del usuario y una promesa que el material pueda sostener. Como estructura flexible: hook → contexto mínimo → avance → remate emocional o consecuencia. El CTA puede ser social o quedar implícito si el cierre ya cumple el objetivo; no imponer una venta ni una demo de producto a un diario de construcción. Integrar etapas cuando una escena las resuelva; retirar preparación, recapitulaciones y colas, conservando la comprensión. La duración resulta de la historia, sin rellenar para alcanzar un número.

Hacer que el primer fotograma contenga interés reconocible. Ensayar que en 1–3 segundos se entienda el motivo para seguir; es un punto de partida editorial. Comparar dos o tres hooks útiles si hay material, registrar primer plano/texto/promesa/resolución y elegir uno; respetar una apertura ya elegida. Construir el hook con imagen y texto, sin voz. Evitar negro, saludo o firma larga antes del asunto. No inventar testimonios, reacciones, conflictos ni resultados de Kova.

Dar avance con cambios pertinentes de plano, perspectiva, escala, información, acción y reacción visual. Un acercamiento o acento puntual debe dirigir la mirada y conservar calidad. No imponer cortes cada N segundos, zooms repetidos ni efectos constantes. Dejar tiempo para ver y leer; no acelerar una operación de Kova de modo que sugiera una velocidad de producto no comprobada. Cerrar cuando se cumpla la promesa; una remisión a otra pieza amplía, sin sustituir la respuesta.

Aprovechar el material antes de repetir: no reutilizar fotogramas o intervalos de origen, congelados ni bucles como relleno. Comprobar solapamientos por archivo e in/out. También revisar la repetición perceptual: saltar varias veces entre segundos distintos de un plano casi idéntico puede sentirse como el mismo video repetido. Preferir acciones y encuadres que aporten algo nuevo, o sostener una toma que todavía avanza. Un archivo largo puede aportar momentos distintos cuando cada regreso tenga una función clara; usar cada archivo una sola vez no es una plantilla obligatoria. Un loop expresamente elegido debe tener propósito y quedar registrado.

Reencuadrar por toma y comprobar todo el movimiento: rostro, mano, producto o acción pueden salir después del inicio. Mantener continuidad real de mano, objeto, dirección, estado y fase de una acción.

**Adaptación horizontal → vertical:** no rellenar con una copia ampliada y desenfocada del mismo video, ni dejar el horizontal como una franja central sobre ese fondo. Esta preferencia expresa del usuario prevalece sobre los fallbacks generales de orientación. Elegir un recorte/zoom o reencuadre de Clipo que ocupe el lienzo y conserve la acción importante; ajustar su posición durante la toma sólo cuando haga falta. Si el recorte pierde información necesaria, componer dos planos o regiones complementarias con una función narrativa, conservando su contexto y sin repetir el mismo fragmento como decoración. Si ninguna adaptación sirve, elegir otra toma o registrar la limitación, sin volver automáticamente al relleno desenfocado. No imponer pantalla dividida ni zoom a todo el material.

En capturas/UI, conservar imagen completa y `contain`; no cortar navegación, etiquetas o cifras para llenar 9:16. Integrarlas en una composición legible con diseño propio, sin fondo duplicado desenfocado. La excepción de UI no convierte todo video horizontal en una captura que deba mostrarse intacta. Comprobar en preview y export que el tratamiento real coincide con la decisión: el nombre de un preset no prueba un encuadre aceptable.

## Texto, efectos y audio de Kova

Usar tipografías y composición de Kova; su sistema permite tarjetas y superficies cuando correspondan. Subtítulos/textos narrativos integrados, breves y por unidades de sentido, con una o dos líneas como guía, énfasis selectivo y lectura móvil. Distinguir copy editorial de una cita literal. Escalonar hook, explicación, dato, firma y CTA si compiten; mantener despejados acción y evidencia. Comprobar contraste y controles del destino, sin tratar márgenes internos como zonas oficiales universales.

Cuando el usuario apruebe un speech, conservar sus palabras, intención y orden al montarlo. Ajustar saltos de línea, pausas, tiempos y planos para leerlo con naturalidad; comparar el texto montado con el aprobado. La duración se adapta a esa lectura. Una petición posterior sobre cortes o encuadre no autoriza reescribir el speech ni añadir voz. Conservar autorizaciones expresas de música y otras preferencias ya resueltas durante la iteración.

La política compartida actual exige **sin voz y comprensión completa en silencio**: retirar o silenciar la voz de las fuentes, sin añadir locución, TTS o clonación. No conservar automáticamente el audio original de un clip; puede contener voz, música o ambiente. Música y pistas de ambiente requieren petición explícita; SFX pertinentes ya están autorizados. Una instrucción actual expresa del usuario prevalece y se registra con su alcance; la semejanza con AL DESTINO no cambia por sí sola esta política.

Hacer una pasada de acabado para seleccionar **e insertar** iconos, movimientos y SFX que aporten. Apoyarse en [Mixkit y Freesound CC0](../kova-content-studio/references/video-workflow.md#sfx-gratuitos-autorizados), reutilizando archivos documentados y buscando lo que falte; aplicar su política única de licencia y comprobantes. Para FX visuales, conservar la autorización de fuentes de Kova: diseño propio determinista, paquete o material autorizado/aportado; el permiso de SFX no autoriza stock visual externo. Probar transparencia, tamaño, contraste y movimiento sobre metraje. Registrar el evento, tiempos y elemento real de Clipo; enumerar recursos no acredita aplicación. Escuchar los SFX y el render antes de afirmar sincronía y niveles, sin añadir un sonido a cada corte.

## Plan, proyecto y ejecución

Conservar un ID de pieza/campaña y un brief compartido; vincular origen y variante cuando se adapte una pieza existente. Crear sólo las versiones solicitadas y preservar el proyecto original al derivar otra. Documentar de forma compacta, sin exigir una plantilla ajena:

- Intención, emoción, punto de vista, formato social y referencia de tendencia cuando exista; objetivo/promesa, hook, bloques y evidencia; destino, aspecto, dimensiones, fps y duración.
- Por selección: ID de fuente, in/out originales, motivo, encuadre/velocidad y correspondencia con la timeline.
- Por recurso: archivo/ID, texto exacto, función, tiempos, fuente/licencia cuando corresponda e ID real del editor.
- Cobertura, claims, adaptaciones y pendientes; revisión efectivamente realizada por versión.

Guardar rutas personales, IDs de sesión, recibos y referencias privadas en archivos locales fuera de Git. Al usar proxies/copias, conservar la relación original ↔ intervalo convertido ↔ corte dentro de la copia ↔ elemento de Clipo. Tras cambiar orden, duración o velocidad, revisar texto, audio, overlays, keyframes y solapamientos; no asumir ripple. Aplicar con las capacidades actuales del MCP según [la referencia operativa](references/clipo.md), sin inventar operaciones ni parámetros.

La fuente versionada vive en `.agents/skills/kova-content-vertical/` del repositorio de Kova junto con su dependencia `kova-content-studio/`. Mantener la copia instalada sincronizada al actualizarla; no incorporar videos, briefs privados, recibos de sesión ni cachés al paquete de la skill.

## Revisión y entrega

Revisar la pieza completa a velocidad normal y escala móvil: hook coherente y cumplido, avance, continuidad, lectura, recortes estables, claims, privacidad y cierre. Hacer una pasada completa en silencio y revisar cualquier audio autorizado por escucha. Una captura sólo prueba un estado visual; ASR no acredita escucha. Si faltan herramientas para observar algo, registrar el tramo y la comprobación pendiente.

Preservar originales y calidad según la referencia compartida; renderizar desde fuentes de calidad comprobada, sin bajar resolución/fps/color para ocultar fallos. Exigir avance de imagen sin trabas en cada etapa: fuente, copia de trabajo, preview y exportación. Comparar cualquier negro, congelamiento, repetición o tirón con la misma región de origen para distinguir defecto del archivo y retraso del reproductor. Para una exportación, revisar el archivo exacto completo y compararlo con preview/fuente, incluidas regiones bajo gráficos. Un defecto confirmado, candidato sin resolver, degradación o tramo sin revisar impide presentarlo como terminado. Validar correcciones cortas antes de repetir el render y revisar completo cada nuevo archivo; muestras sin alertas no prueban fluidez continua.

Guardar y comprobar reapertura desde almacenamiento antes de afirmar persistencia; dejar el proyecto editable correcto abierto si forma parte de la entrega. Si se pidió sólo proyecto, no exportar por defecto. Para exports usar la carpeta indicada; con workspace de Kova, su ubicación de `output/marketing/<campaña>/`; sin workspace, una carpeta externa de `Videos/Kova/<pieza>/` del perfil del sistema. Nunca colocar videos en las skills ni sobrescribir originales.

Entregar BORRADOR con qué se aplicó, qué se adaptó, qué se vio/escuchó/exportó/reabrió y pendientes por tiempo/elemento. No publicar ni desarrollar Clipo por esta skill. Si no hay MCP conectado, continuar el plan y registrar qué no se aplicó, sin presentar un montaje simulado como proyecto real.
