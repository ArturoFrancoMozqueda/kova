# Clipo mediante MCP para Kova · BORRADOR

Leer al aplicar o revisar un montaje real. Las herramientas y sus esquemas actuales son la autoridad de ejecución; los nombres de esta guía ayudan a descubrirlas y no prometen una capacidad o un límite permanente. Esta referencia mantiene el procedimiento de Clipo; marca, audio y calidad se comparten con el paquete de Kova.

## Estado y capacidades reales

Comenzar por `clipo_status`, si está expuesto. Leer conexión, proyecto abierto, revisión, estado de guardado, trabajos y capacidades/catálogos pertinentes. No abrir Clipo sólo para redactar un plan o mantener esta skill. Resolver conexión con las herramientas disponibles cuando se pida editar; no pedir al usuario iniciar un transporte especial que el MCP no requiera.

Las operaciones de importación, montaje, transformación de clips y exportación se ejecutan por MCP. Leer documentación, investigar fuentes/licencias, obtener un recurso autorizado y guardar notas puede usar herramientas apropiadas; su aplicación al montaje se hace en Clipo. Eso no convierte un comando directo de FFmpeg, Computer Use o una edición externa en ejecución MCP. Si falta una operación, registrar el hueco concreto y una adaptación que el MCP sí permita, sin cambiar de editor por iniciativa propia.

Consultar proyecto y revisión con `clipo_get_project`; listar/crear/abrir proyectos con las herramientas disponibles. Una variante no debe sobrescribir el montaje de otro encargo: crear un proyecto separado cuando corresponda y conservar su origen. Si el usuario pide modificar el proyecto actual, trabajar en ése. Confirmar proyecto y revisión inmediatamente antes de mutar. Releer tras edición del usuario, conflicto o timeout; no repetir a ciegas una mutación cuyo resultado se desconoce.

Leer respuestas compactas con los campos necesarios, sin volcar todo el proyecto, Base64 ni miniaturas incrustadas. Mantener la tabla de ID editorial ↔ archivo ↔ asset/elemento real; los IDs y revisiones de una sesión anterior no sirven como autoridad actual.

## Importar y explorar

Importar únicamente las rutas locales aportadas o autorizadas usando `clipo_import_media` u otra capacidad expuesta. Comprobar errores por archivo; una importación correcta no prueba reproducción, búsqueda, audio o exportación. Consultar límites actuales de los tools antes de dividir un lote, sin fijar tamaños heredados en esta skill.

Usar metadata, búsqueda y preview disponibles para localizar momentos, distribuyendo la exploración por la extensión pertinente de clips largos. La cobertura registra qué se observó y por qué método. Una normalización/proxy no acredita revisión ni debe sustituir silenciosamente la fuente final. Mantener un clip fallido como pendiente técnico y explorar el resto, sin descartarlo por tamaño.

Antes de un lote con una representación nueva, probar un intervalo representativo: importación, búsqueda interior, imagen, color, audio y muestra exportada leída de vuelta cuando la entrega lo requiera. Si se pretende exportar con el chat delante, verificar también avance en segundo plano. Reutilizar una ruta ya comprobada para recortes ordinarios; no repetir todas las pruebas por cada clip.

ASR puede ayudar a localizar un tema o revisar una cita del material; no habilita voz en la entrega. `clipo_get_audio` y `clipo_review_audio`, cuando existan, inspeccionan audio de origen: no certifican la mezcla de la timeline ni sustituyen escuchar el archivo final. No generar captions de voz como paso automático de una pieza que debe narrarse con textos propios. Si se usan palabras del material, corregirlas en contexto y distinguir cita y copy editorial.

## Aplicar el montaje

Usar `clipo_plan_edit` si está disponible para validar un lote sin cambios; sus IDs ilustrativos no se reutilizan como si fueran los definitivos. Aplicar con `clipo_edit`, `clipo_action` o las herramientas tipadas que exponga el editor, respetando esquema, proyecto y revisión actuales. Confirmar recibos e IDs reales después de cada lote coherente. No hace falta pedir aprobación adicional por cada corte o SFX ya autorizado.

Cuando una función esté en paneles, leer controles con `clipo_get_ui` y operar con IDs observados mediante `clipo_ui_action` u otra herramienta MCP documentada. No adivinar controles, selectores o acciones desde el nombre de un panel. Consultar los catálogos reales para SFX, medios, fuentes, plantillas o export, sin asumir que un recurso del plan ya está instalado.

Conservar in/out en segundos de origen, corte dentro de la copia cuando exista, velocidad e inicio de timeline. Las pistas principales pueden ser consecutivas y los textos/overlays/audio usar tiempos absolutos; comprobar el contrato actual y recalcular lo afectado después de recortar. Los movimientos del reencuadre y las animaciones necesitan comprobación propia, no sólo que exista un elemento.

Para adaptar horizontal a vertical, inspeccionar el encuadre real de las opciones de ajuste, recorte y reencuadre. En la versión revisada de Clipo, `fit: "fit"` sobre un horizontal en 9:16 genera una franja central con fondo duplicado desenfocado: no usarlo como supuesto `contain` limpio. `fit: "fill"` ocupa el lienzo recortando campo; verificar sujeto, acción, resolución útil y movimiento antes de aceptarlo. Para desplazar o animar el encuadre, descubrir controles/capacidades actuales; no inventar parámetros. La alternativa de dos planos requiere una composición real revisada, no duplicar el mismo video como relleno. Las capturas/UI mantienen su imagen completa mediante una composición que cumpla la política de la entrada, sin confundirlas con metraje horizontal ordinario.

Aplicar textos de Kova en elementos editables con tipografía, lectura y contraste comprobados. Si el editor no reproduce una fuente, registrar la limitación y usar una alternativa de composición autorizada, sin inventar que la fuente se cargó. No sustituir el logo por uno generado ni adoptar un preset como nueva identidad.

Retirar o silenciar el audio de fuente conforme a la política vigente de Kova; comprobar separación de pistas y ganancias reales. Insertar SFX seleccionados como medios/pistas cuando se permita, sincronizados con un evento concreto. No elegir voces, narración, música o ambiente del catálogo sólo porque estén disponibles. Música/ambiente y una excepción de voz requieren el alcance expresamente indicado por el usuario.

Tras `clipo_seek`, usar preview para inspeccionar el cuadro y confirmar que la imagen ya decodificada corresponde al cabezal. `clipo_preview` muestra el editor, no un export. Para comprobar movimiento o sincronía hace falta reproducción; un screenshot o mover el cabezal por varios puntos no equivale a verla completa. Cuando las herramientas no permitan observar una revisión continua, declararla pendiente.

## Trabajos, exportación y archivos

Un trabajo encolado no acredita finalización. Consultar su ID con `clipo_get_job` o la herramienta específica hasta estado terminal; leer errores, resultado y recibo. No iniciar otro render porque siga trabajando ni repetir una mutación tras timeout sin releer. Una cancelación solicitada también se comprueba hasta estado terminal. No cerrar, refrescar el editor o cambiar de proyecto durante trabajos por iniciativa propia.

Al solicitarse exportación, comprobar formato, dimensiones/fps y fuentes reales de render. Leer el artefacto con las herramientas disponibles y guardar el archivo completo mediante `clipo_export_file` cuando esté expuesto, en la ruta acordada y sin sobrescribir. Las miniaturas, un chunk Base64 o el recibo no sustituyen el archivo de entrega. Verificar identidad/tamaño/hash cuando se proporcionen y revisar el archivo exacto según [calidad y exportación](../../kova-content-studio/references/video-editing.md#calidad-y-revisión-de-la-exportación).

Si hay una traba, comparar el intervalo con origen, representación y timeline, mirando el metraje bajo gráficos animados. Probar una corrección corta antes de repetir el render completo y revisar de nuevo toda la nueva exportación. Si el MCP no permite una comprobación necesaria, mantenerla pendiente; no desarrollar el editor, instalar herramientas o bajar calidad como supuesto arreglo.

## Guardado y cierre

Esperar la finalización de las mutaciones/trabajos e inspeccionar errores de guardado. Guardar con la herramienta correspondiente, comprobar una carga real desde almacenamiento y medios presentes; leer otra vez el proyecto ya abierto no demuestra reapertura. Releer la revisión después de abrir o guardar cuando cambie y dejar el proyecto de entrega abierto si se pidió editable. Cerrar la app requiere una instrucción de ese alcance; no es parte de la revisión por defecto.

Documentar acciones aplicadas, adaptaciones y pendientes con tiempo y elemento localizables. Separar preview, reproducción observada, escucha, exportación y reapertura. Un proyecto guardado o un export terminado por el renderizador no certifican la calidad editorial ni una revisión continua.
