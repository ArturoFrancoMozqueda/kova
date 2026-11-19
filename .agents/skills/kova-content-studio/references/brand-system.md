# Sistema de marca empaquetado de Kova

Esta referencia forma parte del paquete estático descrito en [design-system-access.md](design-system-access.md). Los valores exactos viven en `../assets/design-system.json`; este archivo explica cómo aplicarlos. Se actualizan juntos mediante el flujo explícito de mantenimiento, no durante la producción diaria.

## Posición y sensación

Kova es el sistema operativo claro del negocio mexicano: punto de venta, inventario, caja y analítica conectados. Debe sentirse premium, confiable, sereno, humano y útil; simple sin parecer básico.

El tono verbal es seguro sin grandilocuencia. Escribe como alguien que entiende el mostrador y ayuda al dueño a tomar una decisión. Usa español de México y términos reales: “Cobrar”, “Corte de caja”, “Ventas de hoy”, montos MXN con cifras tabulares.

## Paleta del paquete

- tinta: `#0F1117`;
- niebla: `#F5F6FA`;
- superficie: `#FFFFFF`;
- texto sobre tinta: `#F0F4FF`;
- azul Kova: `#3563D0`;
- azul claro para acento sobre fondos oscuros: `#7BA7FF`;
- crecimiento o estado positivo: `#1EBF8A`;
- texto secundario: `#61728C`;
- texto terciario: `#667185`;
- borde: `#E2E6EF`;
- borde sobre tinta: `#1E2330`;
- peligro: `#DC2626`.

El azul es acento, no relleno indiscriminado. El verde sólo significa mejora o estado positivo. Prefiere fondos tinta con interfaces luminosas, o superficies blancas/niebla con contraste alto. Usa bordes finos, sombras sutiles y radios compactos de 7–12 px.

## Tipografía y composición

- Inter Variable para lectura, datos, subtítulos y wordmark.
- Bricolage Grotesque Variable sólo para titulares selectivos de marketing.
- Titulares grandes, contenidos y de una sola promesa.
- Números de negocio con cifras tabulares.
- Mucho aire, alineación limpia y una jerarquía dominante. Evita mosaicos densos y párrafos en cubiertas.
- En video, subtítulos integrados, legibles y con contraste suficiente; no tapes la evidencia visual.

## Logo

Usa `../assets/kova-mark-dark.svg` sobre superficies claras y `../assets/kova-mark-light.svg` sobre tinta. Para el lockup horizontal, coloca el isotipo junto a `kova` en Inter, peso 500, tracking `-0.02em`. No deformes, gires, añadas efectos ni recrees el símbolo con un modelo generativo.

Durante la producción diaria usa los SVG incluidos. Si el logo cambia oficialmente, actualiza el paquete antes de crear nuevas piezas.

## Fotografía y escenas

Muestra negocios mexicanos reconocibles por su operación, no por clichés: tienditas, ferreterías, boutiques, panaderías, papelerías y servicios. Prioriza personas trabajando, manos, objetos del mostrador, inventario, apertura/cierre y decisiones reales. Busca textura natural, luz plausible y una mirada editorial; evita stock corporativo, sonrisas posadas, hologramas, futurismo genérico y símbolos culturales decorativos sin relación con la historia.

La escena puede ser creada con IA si se presenta como ilustración o recreación. No la hagas pasar por un cliente real ni inventes testimonios.

## Producto como evidencia

- Usa primero los materiales aprobados que aporte el usuario. Para archivos del repositorio, usa exclusivamente el pool `product_ui` de `../assets/media-library.json`; no explores `showcase/`, `output/`, `videos/` ni banners por tu cuenta.
- El pool `product_ui` no es una biblioteca de estilo ni relleno visual. Incluye una captura sólo cuando el storyboard necesite demostrar exactamente el trabajo indicado en su campo `usage`.
- No pidas al generador de imágenes que invente una pantalla de Kova.
- No alteres cifras, etiquetas, permisos, estados ni resultados de una captura real.
- Integra la captura como capa separada, con perspectiva y recorte controlados, conservando legibilidad.
- Si no hay evidencia aprobada o no corresponde al trabajo narrativo, crea la pieza alrededor de la tensión o el proceso y deja un espacio definido para incorporar producto después.

## Diferenciación visual

No adoptar el amarillo/negro de Treinta, el turquesa editorial de Pulpos o Alegra, el azul eléctrico de PoloTab ni el naranja delineado de Soft Restaurant. Kova se distingue con escenas oscuras y limpias, interfaces luminosas, tipografía contenida y detalles humanos.
