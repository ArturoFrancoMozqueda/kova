# Flujo de imágenes y carruseles

Carga primero el paquete estático indicado en [design-system-access.md](design-system-access.md). Fija el tamaño final y resuelve `../assets/media-library.json` con [media-orientation.md](media-orientation.md) antes de generar o componer. Después carga y sigue la skill `imagegen` antes de llamar al generador. Usa el modo integrado de `image_gen` por defecto; no cambies al CLI/API salvo petición o confirmación explícita del usuario.

Cuando el generador necesite referencias locales, pásale exactamente las rutas seleccionadas y etiqueta su rol. No incluyas imágenes anteriores de la conversación ni outputs previos salvo que el usuario los haya elegido explícitamente. Para una escena nueva sin referencia seleccionada, omite entradas de imagen; no reutilices por conveniencia la última imagen visible.

## Separar generación y composición

Para una pieza de marca precisa:

1. Genera con IA sólo la escena, fotografía, textura o ilustración que realmente lo necesite.
2. Pide la escena sin texto, sin logo, sin watermark, sin pantallas inventadas y con espacio negativo definido para la composición.
3. Compón después copy, logo, marcos, datos, gráficos y capturas reales con HTML/CSS, SVG o el medio determinista adecuado.
4. Si el usuario exige texto dentro de la imagen generada, usa el texto verbatim, inspecciónalo carácter por carácter e itera ante cualquier error.

No conviertas un isotipo, diagrama simple, tarjeta tipográfica o UI existente en un problema generativo: créalo con código o usa el asset fuente.

## Prompt visual base

Incluye sólo campos que ayuden:

```text
Use case: ads-marketing
Asset type: <canal, formato y dimensiones>
Primary request: <situación operativa concreta>
Scene/backdrop: <negocio mexicano y momento del día>
Subject: <persona, manos, producto u objeto principal>
Style/medium: fotografía editorial natural, premium y creíble
Composition/framing: <plano y espacio negativo para copy/UI>
Lighting/mood: luz plausible, contraste limpio, calma con tensión operativa
Color palette: tinta y neutros; acento azul Kova sólo cuando sea natural
Text: none; composed later
Constraints: personas y operación creíbles; sin marcas ajenas; sin UI inventada
Avoid: stock corporativo, clichés mexicanos, neón futurista, dashboards holográficos, watermark
```

No pidas al modelo que pinte la paleta completa en cada escena. La marca puede vivir en la composición, el layout, el logo y la interfaz real.

## Carruseles

- 5–7 láminas; una idea por lámina.
- La cubierta plantea tensión o utilidad y no excede una promesa.
- El cuerpo entrega un diagnóstico, checklist o mecanismo completo.
- El cierre convierte lo aprendido en una acción y un CTA relevante.
- Conserva una retícula, posiciones de marca y jerarquía constantes; permite que cada lámina cambie de evidencia.

## Validación

Inspecciona a resolución útil:

- anatomía, manos, objetos, dinero y entorno plausibles;
- ausencia de marcas y texto accidentales;
- espacio negativo suficiente;
- copy y logo exactos en la composición final;
- contraste y legibilidad en móvil;
- captura de Kova legible, sin alteraciones ni datos sensibles;
- consistencia entre láminas o variantes.
- correspondencia entre la orientación de las fuentes y la salida, sin recortes destructivos.

Guarda cada final del proyecto en el workspace. Reporta el prompt final y distingue visual generado, composición y fuentes reales integradas.
