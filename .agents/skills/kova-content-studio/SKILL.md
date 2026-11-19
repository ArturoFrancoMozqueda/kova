---
name: kova-content-studio
description: "Crear contenido de Kova y editar videos horizontales o verticales con identidad y afirmaciones verificables. Usar para conceptos, textos, imágenes, carruseles y videos; no para prospección por DM ni cambios en la interfaz del producto."
---

# Kova Content Studio

Convierte una tensión real del negocio mexicano en una pieza clara, visual y publicable. La situación capta atención; Kova demuestra la respuesta.

## Fuentes de verdad

La petición actual y los materiales aprobados fijan el encargo. Para identidad y composición visual, el contrato versionado está en `assets/design-system.json` y [references/brand-system.md](references/brand-system.md). El manifiesto `assets/media-library.json` limita los medios visuales del repositorio que pueden usarse; los materiales aportados por el usuario pueden sustituirlos y los SFX tienen su propia selección documentada.

El repositorio vivo es autoridad para funciones, precios, promociones, disponibilidad, capturas y datos del producto. Verificar sólo las afirmaciones necesarias no sustituye ni regenera el contrato visual. No explorar `showcase/`, `output/`, `videos/` u otras carpetas para añadir medios no listados. La producción cotidiana no requiere inspeccionar ni recompilar el sistema de diseño; su mantenimiento explícito se describe en `references/design-system-access.md`.

## Contrato creativo

Antes de producir, resuelve en pocas líneas:

- audiencia o giro;
- tensión operativa concreta;
- una sola idea o trabajo editorial;
- prueba disponible: escena real, captura aprobada, dato verificable o demostración;
- acción que el dueño podrá tomar;
- formato, canal, dimensiones o relación de aspecto y CTA.

Haz suposiciones razonables y decláralas. Pregunta sólo si falta el tema o si elegir imagen frente a video cambia materialmente el encargo. Para una pieza social nueva sin dimensiones indicadas, usa 1080×1350 en estático/carrusel y parte de 9:16 en video vertical; 1080×1920 es una opción para composición nueva. Con metraje existente, elige resolución y fps según fuentes, recorte y destino, sin reducir calidad por un preset. Mantén el copy en español de México.

Cada pieza debe demostrar al menos una de estas tres cosas: una fricción desaparece, una señal del negocio se vuelve visible o una decisión se vuelve más segura. Abre con el problema o la escena, no con una lista de funciones ni con el logo.

## Enrutamiento

- **Concepto, calendario o campaña:** lee [references/content-playbook.md](references/content-playbook.md). Entrega una tesis, formatos y piezas suficientemente distintas; no dupliques una idea sólo para llenar frecuencia.
- **Claims de producto, comerciales, de mercado o de clientes:** lee [references/claim-verification.md](references/claim-verification.md). Conserva sólo afirmaciones verificadas; reformula u omite las demás.
- **Sistema visual:** antes de producir imágenes, carruseles o video, lee [references/design-system-access.md](references/design-system-access.md) y usa el paquete estático; no ejecutes el inspector diario.
- **Imágenes o videos de referencia:** lee [references/media-orientation.md](references/media-orientation.md), resuelve `assets/media-library.json` para la relación de aspecto final y registra la selección antes del storyboard o prompt. Los materiales aportados por el usuario pueden sustituir esa selección; otros archivos del repositorio no.
- **Imagen, portada, carrusel, miniatura o visual estático:** lee [references/image-workflow.md](references/image-workflow.md) y usa la skill `imagegen`.
- **Montaje vertical de videos aportados por el usuario en Clipo:** usa [kova-content-vertical](../kova-content-vertical/SKILL.md), que aplica el MCP de Clipo y comparte marca, políticas y criterios de edición de este paquete. Conservar esa ruta al leer referencias comunes; no volver a enrutar a HyperFrames.
- **Video, reel animado, demo o motion graphic de composición nueva:** lee [references/video-workflow.md](references/video-workflow.md), que enruta a los criterios de montaje horizontal/vertical y revisión según la tarea. Para crear, editar o renderizar una composición HyperFrames, carga primero la skill `hyperframes`. La ruta de Clipo conserva su MCP; un plan editorial no requiere renderizar.
- **Copy sin producción visual:** aplica el contrato creativo y el playbook; no invoques herramientas de imagen o video.

Si una campaña mezcla imágenes y video, define primero el sistema común y luego ejecuta cada asset por su ruta correspondiente.

## Invariantes de marca y verdad

- Usa el contrato visual empaquetado y sus assets. Nunca tomes la estética de un competidor como plantilla.
- El isotipo y el wordmark no se regeneran con IA. Usa los assets oficiales o compón el wordmark `kova` con la tipografía aprobada.
- La IA puede crear la escena, textura o fotografía. El copy, logo, subtítulos, gráficos y UI se componen de forma determinista cuando deben ser exactos.
- Los videos deben entenderse sin audio y no llevan voz. El [flujo de video](references/video-workflow.md) concentra la política de SFX, música, subtítulos y revisión; leerlo al producir video.
- No inventes pantallas de Kova, analítica decorativa ni resultados de negocio. Usa capturas reales, aprobadas y sin información sensible. Mantén la UI intacta al integrarla.
- No expongas datos de clientes. Una historia o métrica real requiere permiso y anonimización cuando corresponda.
- Evita promesas genéricas, superlativos, cifras sin fuente, engagement bait, estereotipos del negocio mexicano y stock corporativo impersonal.

## Dependencias y mantenimiento

Las rutas anteriores cargan sólo las referencias del encargo. Copy y planificación no requieren herramientas de imagen o video; la producción visual usa `imagegen`, `hyperframes` o el MCP de Clipo según la ruta. Si falta una dependencia, conservar el brief y declarar el entregable afectado, sin afirmar que se generó, aplicó o renderizó.

La fuente mantenida vive en `.agents/skills/kova-content-studio/` del repositorio de Kova; la instalación personal es una copia sincronizada. No depende del repositorio AL_DESTINO. El contrato visual se actualiza con el procedimiento de `references/design-system-access.md`; el catálogo de medios se mantiene según `references/media-orientation.md`. No regenerar ambos por cambiar instrucciones editoriales. Los scripts de mantenimiento usan Python 3; `catalog_media.py` requiere además Pillow para leer dimensiones de imágenes. No son pasos obligatorios de producción cotidiana.

Al mantener las instrucciones o estructura de esta skill, aplicar `skill-creator` y su validador cuando PyYAML esté disponible; no convertir esa dependencia de validación en un requisito para crear contenido.

## Entrega y revisión

Inspecciona el arte final, no sólo el prompt o el código. Corrige defectos evidentes de composición, texto, logo, UI, contraste, recorte o continuidad. En proyectos, guarda los finales bajo `output/marketing/<campaña>/` con nombres descriptivos y sin sobrescribir archivos existentes.

Al terminar informa:

- concepto y decisión editorial;
- formato y dimensiones/duración;
- herramienta o flujo usado;
- archivos finales y prompt o brief final;
- fuentes usadas para las afirmaciones publicables;
- afirmaciones, datos o elementos de producto que se reformularon, omitieron o quedaron pendientes.
