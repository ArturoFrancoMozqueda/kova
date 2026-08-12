# Estrategia de Marketing — Kova Suite

> Documento de estrategia, posicionamiento y ejecución para Kova.
> Idioma: español (es-MX). Audiencia del documento: founder + equipo (técnico y no técnico).
> Basado en el producto real inspeccionado en el repo (no en supuestos).
> Última revisión: junio 2026.

---

## 0. Resumen ejecutivo

**Qué es Kova hoy (en el código, no en la promesa):** una app única que junta caja (POS), inventario, empleados con roles, turnos con cuadre de efectivo y —lo más importante— una **capa de analítica que narra y recomienda**: motor "Historia del negocio", recomendaciones por oportunidad/riesgo/buena señal, detección de hora pico, ventas por franja del día, tendencias de producto (creciendo / bajando / lento), comparación contra ayer/semana/mes y un puntaje de **"Salud del negocio"**. Precio: **un solo plan de $299 MXN/mes**, 7 días gratis, sin tarjeta, sin comisión por venta, sin cobro por empleado.

**El problema de posicionamiento:** la página vende muy bien la parte de *cobrar* (POS) y subutiliza lo que de verdad diferencia a Kova: convertir las ventas diarias en **decisiones**. El propio sitio ya dice "Otros POS te dejan cobrar. Kova te deja entender" — pero el CTA principal ("Crear mi POS gratis") y la primera pregunta del FAQ ("Es un punto de venta en línea…") siguen anclando a Kova como *un POS más*.

**La tesis de reposicionamiento:** Kova no compite en "cobrar más rápido". Compite en **"saber exactamente qué pasa en tu negocio"**. El POS es el caballo de Troya; la analítica es el valor que justifica pagar mes a mes. El enemigo no es otro POS — es **operar a ciegas y decidir por corazonada**.

**Los 3 movimientos de mayor impacto (próximos 30 días):**
1. **Reencuadrar el mensaje raíz** de "POS gratis" a "control y claridad de tu negocio" en hero, FAQ #1 y la sección de reportes. (Cambios de copy puntuales, ya identificados.)
2. **Construir el motor de contenido founder-led** alrededor de un hilo: *"Los negocios exitosos no adivinan. Analizan."* — usando datos/ejemplos reales del producto (hora pico, productos que se acaban, descuadres).
3. **Activar adquisición de beta por comunidad y alianzas locales** (grupos de dueños de cafeterías/panaderías, tostadores, proveedores) en vez de quemar presupuesto en ads antes de tener prueba social.

---

## 1. Statement de posicionamiento y pitch

### Statement de posicionamiento

> Para dueños de negocios pequeños en México —cafeterías, panaderías, tiendas de mostrador— que operan con libretas, Excel y WhatsApp y **toman decisiones sin saber realmente qué pasa en su negocio**, Kova es la app que une caja, inventario y reportes en un solo lugar y traduce cada venta en información clara y accionable. A diferencia de un POS tradicional, que solo te deja cobrar, Kova te deja **entender y dirigir**: qué se vende, qué se acaba, quién cobró y cómo cuadra el día — para que dejes de adivinar y empieces a decidir con datos.

### Pitch de una línea

**"Kova es la app que te dice exactamente qué pasa en tu negocio — para que dejes de adivinar y empieces a dirigir."**

Variantes según canal:
- **Corta (bio / ad):** "Deja de operar a ciegas. Caja, inventario y reportes en una sola app." 
- **Funcional (directorios):** "POS + inventario + reportes en vivo para negocios de mostrador en México. $299/mes, todo incluido."
- **Emocional (founder/redes):** "Tu negocio ya te está diciendo qué hacer. Kova te ayuda a escucharlo."

---

## 2. Estrategia de marketing

### 2.1 Audiencia objetivo

Negocios de **mostrador con catálogo de productos** en México que venden todos los días y hoy operan a mano. Validado en el producto (`messages.ts:173-180`):

| Segmento | Prioridad | Por qué |
|---|---|---|
| **Cafeterías** | 🟢 Recomendado / **punta de lanza** | Hora pico intensa, extras (tamaños/leches), ticket medio, dueño suele ser operador. Caso de uso más pulido del producto. |
| **Panaderías** | 🟢 Recomendado | Venta por pieza, inventario claro, cierre de caja sin sumar tickets. |
| **Food trucks** | 🟡 Compatible | Venden el dolor "offline": cobra aunque se caiga la señal. |
| **Tiendas pequeñas** (misceláneas, abarrotes, concept stores) | 🟡 Compatible | Catálogo simple, varios métodos de pago, inventario a la vista. |
| **Restaurantes de mostrador** (taquerías, fondas, loncherías) | 🟠 Caso por caso | Funciona en barra; **no** sirve para flujo de comandas a cocina con mesas. |
| **Servicios / emprendimientos** | 🟠 Caso por caso | Bazares, ferias, venta suelta. No reemplaza agenda de citas. |

**Foco de adquisición para beta:** cafeterías y panaderías de 1–3 sucursales. Es donde el producto brilla, el dolor es agudo y la comunidad está concentrada y es referenciable.

### 2.2 Perfil de cliente ideal (ICP)

- **Quién es:** dueño/a-operador/a de 1 a 3 locales. 28–50 años. Está en el mostrador o muy cerca.
- **Cómo opera hoy:** libreta + calculadora + Excel + notas de WhatsApp. El "reporte" es contar el efectivo en la noche.
- **Nivel técnico:** bajo-medio. Si usa WhatsApp y el cajero del banco, es suficiente.
- **Qué lo desvela:** no saber si ganó o perdió en el día, descuadres de caja que no puede explicar, productos que se acaban en hora pico, sospecha (sin pruebas) de mermas o errores del personal.
- **Disparador de compra:** un susto reciente —un descuadre grande, una venta perdida por falta de stock, abrir un segundo local— o simplemente cansancio de "cargar el negocio en la cabeza".
- **Quién NO es (descalificar rápido):** restaurante full-service con meseros y comandas a cocina; negocio sin catálogo de productos; empresa que ya tiene ERP.

### 2.3 Dolores principales (atados a features reales)

| Dolor del dueño | Cómo se vive | Qué feature de Kova lo resuelve |
|---|---|---|
| **"No sé si gané hoy"** | Cuenta efectivo en la noche, no sabe el neto real | KPIs en vivo (Ventas netas, Ticket promedio, Devoluciones), comparación vs ayer/semana |
| **Descuadres de caja** | Falta dinero y nadie sabe por qué | Apertura/cierre de turno con cálculo de diferencia y movimientos de efectivo |
| **Se acaba el producto en hora pico** | Pierde ventas, cliente se va | Alertas de stock bajo + velocidad de inventario ("se agota en ~X días") |
| **No sabe qué impulsar** | Decide por corazonada qué promover | Productos top, tendencias (creciendo/bajando), márgenes por producto |
| **No sabe cuándo reforzar al equipo** | Sobra o falta gente | Detección de hora pico y ventas por franja (mañana/tarde/noche) |
| **Sospecha de errores/mermas del personal** | No tiene pruebas | Ventas y devoluciones por empleado, roles, auditoría por turno |
| **Se cae el internet y deja de vender** | Cliente en la fila, caja muerta | Modo offline con sincronización automática |
| **Todo vive en libretas y Excel** | Información dispersa, frágil, no comparable | Una sola app + respaldo en la nube |

### 2.4 Disparadores emocionales

- **Control:** "Yo mando en mi negocio, no al revés."
- **Claridad:** "Por fin veo qué está pasando sin tener que adivinar."
- **Tranquilidad:** "Puedo salir del local y seguir sabiendo cómo va."
- **Orgullo / profesionalismo:** "Mi negocio se ve y se opera como un negocio serio."
- **Alivio del miedo:** "Dejé de tener miedo a los descuadres y a las sorpresas."

### 2.5 Promesa central

> **"Sabe exactamente qué pasa en tu negocio."**

Soportes de la promesa (todos verificables en el producto): ventas en vivo, qué se vende y a qué hora, qué se está acabando, quién cobró cada turno, y cómo cuadra el día — sin sumar tickets, sin cruzar Excel, sin llamar al local.

### 2.6 Posicionamiento

Kova es una **plataforma de control y decisiones para tu negocio**, no "un POS más". El cobro es la puerta de entrada; el valor que se paga mes a mes es **entender y dirigir**. Categoría mental que queremos ocupar: *"el sistema que me dice qué hacer con mi negocio"*, no *"la cajita para cobrar"*.

### 2.7 Diferenciadores

1. **De cobrar a entender.** La mayoría de POS registran transacciones; Kova las **interpreta** (historia del negocio, recomendaciones, tendencias, hora pico).
2. **Precio honesto y plano.** $299 MXN/mes, todo incluido. Sin comisión por venta, sin cobro por empleado, sin módulos escondidos.
3. **Funciona sin internet.** Sigue cobrando y sincroniza solo. Crítico para food trucks y locales con WiFi flaco.
4. **Cero fricción de adopción.** "Si usas WhatsApp, ya sabes usar Kova." Sin instalaciones, sin máquinas caras, cobra el mismo día.
5. **Hecho en México y atendido por humanos.** Soporte por correo/WhatsApp con personas, no bots. Contexto local real.
6. **Multidispositivo.** Compu, tablet o teléfono que ya tienes.

### 2.8 Propuesta de valor

> Junta caja, inventario, empleados y reportes en una sola app, y convierte tus ventas diarias en decisiones claras — para que controles tu negocio, dejes de perder dinero por adivinar y operes con la tranquilidad de saber qué pasa, todo por $299 al mes.

### 2.9 Pilares de mensaje

Cada pieza de marketing debe colgar de uno de estos cuatro pilares:

1. **Claridad** — "Ve qué pasa en tu negocio de un vistazo." (reportes, KPIs, historia del negocio)
2. **Control** — "Tu inventario, tu caja y tu equipo, bajo control." (cuadre, stock, roles)
3. **Decisiones con datos** — "Decide con datos reales, no con corazonadas." (recomendaciones, tendencias, hora pico)
4. **Hecho en México + humano** — "Pensado para tu negocio, atendido por personas." (local, soporte, precio honesto)

### 2.10 Voz de marca

Anclada en `.claude/rules/brand-ux-copy.md`:
- **Clara, específica, segura, humana.** Hablamos como un socio que conoce el negocio de mostrador, no como software corporativo.
- **Orientada a resultados:** control, claridad, velocidad, mejores decisiones, menos errores.
- **Tono es-MX, cercano sin ser informal de más.** "Tú", "tu negocio", "tu local".
- **Evitar:** clichés, "AI-powered", promesas vagas, relleno corporativo, tecnicismos.
- **Honestidad de fit:** decir cuándo *no* es para ti ("caso por caso") genera más confianza que prometer todo.

### 2.11 Objeciones y cómo rebatirlas

| Objeción | Rebatir con |
|---|---|
| **"$299 al mes es un gasto."** | Reencuadre a costo de NO tenerlo: una sola venta perdida por stock-out o un descuadre al mes ya cuesta más de $299. Es ~$10 al día por dejar de operar a ciegas. Todo incluido, sin sorpresas. |
| **"Mi negocio es muy chico."** | "Justo por eso." Entre más chico, más duele cada error y cada venta perdida. Empieza en 1 día, sin instalaciones. 7 días gratis sin tarjeta. |
| **"No sé de tecnología."** | "Si usas WhatsApp, ya sabes usar Kova." Cero curva, cero curso, soporte de humanos por WhatsApp. |
| **"Ya uso libreta / otro POS y me funciona."** | "Cobrar ya lo haces. ¿Pero sabes a qué hora vendes más, qué se está acabando y quién cuadró el turno?" Kova no reemplaza tu forma de cobrar — le suma cerebro. |
| **"¿Y mis datos? ¿Es confiable? (es beta)"** | Respaldo automático en la nube, datos aislados por negocio, modo offline. Beta privada con negocios reales y atención directa del equipo — eres prioridad, no número. |
| **"¿Y si se va el internet?"** | Sigue cobrando offline y sincroniza solo cuando vuelve la señal. |
| **"¿Me amarra un contrato?"** | No. Cancelas con un click, sin penalización ni preguntas. |
| **"¿Puedo facturar desde Kova?"** | "Hoy Kova no emite CFDI. Puedes mantener tu proceso fiscal actual y usar Kova para caja, inventario y análisis. CFDI está en el roadmap mediante un PAC verificado, pero no prometemos una fecha hasta validarlo con 10 pilotos. Si facturar dentro del POS es indispensable hoy, Kova todavía no reemplaza esa parte de tu operación." |
| **"¿Kova cobra la tarjeta o se conecta con mi terminal?"** | "Hoy Kova registra la forma de pago para que el corte cuadre, pero el cobro se procesa por separado en tu terminal de Clip, Mercado Pago u otro proveedor. La integración está diferida hasta validar demanda y proveedor con 10 pilotos. No presentamos el registro manual como cobro integrado." |

### 2.12 Canales de adquisición recomendados (priorizados para etapa beta)

**Importante:** estamos en **beta privada**. No inventamos prueba social (conteos de negocios, testimonios). Primero generamos casos reales, luego los amplificamos.

**Prioridad 1 — Founder-led + comunidad (ahora):**
- Contenido del founder en Instagram/LinkedIn mostrando aprendizajes reales de negocios de mostrador (con datos del producto, sin datos falsos).
- Entrar a grupos/comunidades de dueños de cafeterías y panaderías (Facebook, WhatsApp, foros locales) aportando valor, no spam.
- Onboarding 1:1 de los primeros beta-users → convertirlos en casos de éxito documentados (con permiso).

**Prioridad 2 — Alianzas locales (semanas 2–4):**
- Tostadores de café, proveedores de insumos para panadería, distribuidores: ellos ya tienen la audiencia exacta. Co-marketing / referidos.
- Cámaras y asociaciones de comercio local.

**Prioridad 3 — SEO + directorios (continuo, bajo costo):**
- Página comparativa "Kova vs [POS genérico]" enfocada en *reportes/control*, no en cobrar.
- Directorios de software/SaaS y de herramientas para PyMEs en México (backlinks + descubrimiento).
- Contenido educativo evergreen (ver §4) que rankee por dolores ("cómo saber qué producto vendo más", "cómo cuadrar la caja sin Excel").

**Prioridad 4 — Paid (solo cuando haya prueba social y un funnel que convierta):**
- Instagram/Facebook Ads geosegmentados a dueños de negocios de mostrador, con creativos de "problema" (40% del mix de contenido) llevando a la landing.
- Google Ads sobre intención ("punto de venta para cafetería", "sistema de inventario para panadería").

---

## 3. Narrativa de ventas (framework de mensaje)

Usar esta estructura como columna vertebral de la landing, los pitches y el contenido largo.

**1. El problema.**
La mayoría de los dueños de negocio operan a ciegas. La información vive en libretas, notas, WhatsApp y hojas de cálculo. Saben cuánto hay en la caja, pero no qué pasó realmente en el día: qué se vendió, qué se está acabando, quién cobró, a qué hora se llenó el local. Las decisiones se toman por corazonada.

**2. El costo de ignorar el problema.**
Operar a ciegas se paga caro, aunque no lo veas en un solo lugar: ventas perdidas por quedarte sin producto en hora pico, dinero que "no cuadra" al cierre y nadie sabe por qué, promociones a productos que no dejan margen, personal mal distribuido, y la sensación constante de que el negocio te maneja a ti. Lo más caro: no puedes crecer lo que no entiendes.

**3. La transformación deseada.**
Imagina abrir tu teléfono y ver en segundos cómo va el día, qué se está vendiendo, qué tienes que reabastecer y cómo cuadra tu caja — sin sumar tickets ni llamar al local. Decides qué impulsar y cuándo reforzar al equipo con datos, no con corazonadas. Sales del local con tranquilidad. Diriges tu negocio en vez de perseguirlo.

**4. Por qué existe Kova.**
Porque los negocios pequeños merecen la misma claridad que tienen las grandes cadenas — sin equipos de analistas ni sistemas caros. Kova existe para que cualquier dueño en México pueda **saber exactamente qué pasa en su negocio** y tomar mejores decisiones, desde el primer día.

**5. Cómo lo resuelve Kova.**
Una sola app junta caja, inventario, empleados y turnos, y traduce cada venta en información clara: reportes en vivo, historia del negocio, alertas de stock, hora pico, tendencias de producto y cuadre automático de caja. Funciona en lo que ya tienes, incluso sin internet. Sin tecnicismos, sin curva de aprendizaje.

**6. Por qué ahora.**
Cada día que operas a ciegas es un día de decisiones a la suerte y de dinero que se escapa sin que lo notes. Empezar toma un día y la primera semana es gratis, sin tarjeta. No hay razón para seguir adivinando.

**7. CTA final.**
**"Empieza gratis y mira qué pasa realmente en tu negocio."** → *Crear mi cuenta · 7 días gratis · Sin tarjeta · Cancela cuando quieras.*

---

## 4. Estrategia de contenido

### 4.1 Mix de contenido

- **40% — Problemas comunes del negocio:** inventario, ventas, pérdidas, falta de control, no saber qué vende.
- **30% — Insights y descubrimientos con datos:** patrones, hora pico, métricas que el dueño no mira.
- **20% — Casos / escenarios de ejemplo:** historias reales de beta-users (con permiso) o **escenarios ilustrativos** claramente marcados como ejemplo. *Nunca testimonios inventados.*
- **10% — Venta directa:** producto, precio, prueba gratis.

### 4.2 Pilares de contenido (mapeados a los pilares de mensaje)

1. **"Deja de adivinar"** (problemas) → dolores de operar a ciegas.
2. **"Tu negocio te está hablando"** (insights) → enseñar a leer datos simples.
3. **"Un día con Kova"** (casos/escenarios) → antes/después operativo.
4. **"Hecho para ti"** (marca/venta) → precio honesto, local, humano, prueba gratis.

### 4.3 Ideas de posts (por plataforma)

**Instagram (feed + carrusel):**
- "5 señales de que estás operando tu negocio a ciegas." (carrusel, pilar 1)
- "Lo que tu caja NO te dice (y por qué importa)." (pilar 1)
- "La hora más rentable de una cafetería no es la que crees." (pilar 2)
- "Por qué te quedas sin tu producto estrella justo cuando más vendes." (pilar 2)
- "Un día en una cafetería con y sin Kova." (pilar 3, escenario de ejemplo)

**LinkedIn (founder-led, más reflexivo):**
- "Hablé con X dueños de cafeterías. Todos tenían el mismo problema y no era el dinero." (pilar 1)
- "La diferencia entre un negocio que crece y uno que sobrevive: uno mide, el otro adivina." (pilar 2)
- "Por qué construimos Kova empezando por los reportes, no por la caja." (marca/founder)

**Video corto (Reels / TikTok):**
- POV: cierras la caja y no cuadra. (problema, gancho fuerte)
- "Te enseño a saber qué producto te deja más dinero en 30 segundos." (insight)
- "Esto pasa cuando un food truck pierde el internet a media venta." (offline, demo)

### 4.4 Ideas de carrusel

1. **"Los negocios exitosos no adivinan. Analizan."** — 6 slides: cada slide, una decisión por corazonada vs. con datos.
2. **"Cómo saber qué se vende de verdad en tu negocio"** — paso a paso con la lógica de reportes de Kova.
3. **"5 fugas de dinero invisibles en un negocio de mostrador"** — stock-outs, descuadres, mermas, mal horario de personal, promos sin margen.
4. **"Tu primer día con un POS que sí te entiende"** — onboarding en 4 pasos (mapea a la sección "Qué pasa cuando empiezas").

### 4.5 Ideas de video corto

- **Demo de 15s:** tocar producto → cobrar → ver el reporte actualizado en vivo.
- **"Hora pico detectada":** mostrar cómo Kova marca la hora más fuerte y qué haces con eso.
- **"Se cayó el internet":** cobrar offline y ver la venta subir sola al volver la señal.
- **Founder a cámara:** "El error #1 que veo en dueños de negocio" (serie semanal).

### 4.6 Ejemplos de ganchos (hooks)

- "Tu negocio ya te está diciendo qué hacer. ¿Lo estás escuchando?"
- "Si cuentas el efectivo en la noche para saber cómo te fue… esto es para ti."
- "El 90% de los dueños no sabe cuál es su producto más rentable. ¿Y tú?"
- "Dejé de adivinar en mi negocio y esto fue lo que descubrí."
- "Perder una venta por quedarte sin producto cuesta más de lo que crees."

### 4.7 Ejemplos de CTA

- "Empieza gratis y mira qué pasa realmente en tu negocio."
- "7 días gratis. Sin tarjeta. Cancela cuando quieras."
- "Crea tu cuenta hoy y cobra tu primera venta el mismo día."
- "¿Dudas si es para tu negocio? Escríbenos, te contestamos honestamente."

### 4.8 Contenido educativo (evergreen, SEO + autoridad)

- "Cómo cuadrar la caja de tu negocio sin Excel."
- "Qué es el ticket promedio y por qué deberías mirarlo."
- "Cómo saber cuál es tu hora pico (y qué hacer con ella)."
- "Inventario para negocios chicos: cuándo reabastecer sin perder ventas ni sobre-comprar."
- "Roles de empleado: cómo dar acceso sin perder el control."

### 4.9 Contenido founder-led

- Serie "Construyendo Kova": por qué empezamos por reportes, decisiones de producto, qué aprendemos de los beta-users.
- "Lo que aprendo hablando con dueños de cafeterías" (insights de research, sin datos sensibles).
- Behind-the-scenes del soporte humano: una pregunta real, una respuesta real.
- Postura de marca: "Por qué un POS no debería cobrarte comisión por vender."

### 4.10 Calendario de contenido de ejemplo (4 semanas)

Cadencia sugerida: **IG 3x/sem, LinkedIn 2x/sem, Reels/TikTok 3x/sem.** Respeta el mix 40/30/20/10.

| Semana | Lun | Mié | Vie |
|---|---|---|---|
| **1 — Problema** | IG carrusel: "5 señales de que operas a ciegas" (40%) | Reel: "POV: la caja no cuadra" (40%) | LinkedIn founder: "El problema que todos tenían" (40%) |
| **2 — Insight** | IG: "La hora más rentable no es la que crees" (30%) | Reel: "Tu producto más rentable en 30s" (30%) | LinkedIn: "Mide o adivina" (30%) + IG educativo: "Qué es el ticket promedio" (30%) |
| **3 — Caso/Escenario** | IG carrusel: "Un día con y sin Kova" (20%) | Reel: "Food truck sin internet" (20%) | LinkedIn: caso de beta-user con permiso (20%) |
| **4 — Venta + iteración** | IG: "Todo lo que incluye $299/mes" (10%) | Reel: demo cobrar→reporte (mix 30%) | LinkedIn founder: "Por qué no cobramos comisión" (10%) + CTA prueba gratis |

> Regla: en cada semana, al menos una pieza de problema (40%) abre el embudo; la venta directa (10%) solo aparece cuando ya hubo valor antes.

---

## 5. Auditoría de mensajes del sitio

Fuente de copy: `frontend/src/i18n/messages.ts` (objeto `copy.landing`). Render: `frontend/src/routes/Home.tsx`.
Marcado: **[APLICAR AHORA]** = cambio incluido en esta entrega · **[RECOMENDADO]** = propuesta para que el founder apruebe después.

### 5.1 Hero — headline `[OK, conservar]`
- **Actual:** "Deja de operar a ciegas. **Empieza a dirigir** tu negocio." (`hero.titlePart1/Emphasis/Part2`, líneas 20–22)
- **Veredicto:** excelente y perfectamente alineado a la promesa. **No tocar.** Es el activo de mensaje más fuerte del sitio.

### 5.2 Hero — subheadline `[APLICAR AHORA]`
- **Actual:** "Caja, inventario y reportes en una sola app. Mira en vivo qué se vende, qué se acaba y cómo va el día — desde tu celular, tablet o compu." (`hero.subtitle`, línea 23)
- **Qué cambiar:** anteponer el *resultado* (saber qué pasa) antes de la lista de features.
- **Por qué:** la lista "caja, inventario y reportes" suena a POS-checklist; abrir con el beneficio refuerza el posicionamiento de control/claridad.
- **Copy mejorado:** "Caja, inventario y reportes en una sola app para que sepas exactamente qué pasa en tu negocio. Mira en vivo qué se vende, qué se acaba y cómo va el día — desde tu celular, tablet o compu."
- **Dónde:** `copy.landing.hero.subtitle`.

### 5.3 CTAs `[APLICADO]`
- **Antes:** primario "Crear mi POS gratis", secundario "Ver cómo funciona →".
- **Qué cambió:** el primario llamaba a Kova "POS", reforzando justo la categoría que queremos desinflar. Se reemplazó por **"Empieza gratis"** en los 4 CTAs (consistencia de marca).
- **Por qué:** "POS" en el botón más visible ancla la categoría equivocada; "Empieza gratis" mantiene la claridad y la baja fricción sin encasillar a Kova.
- **Copy aplicado:** "Empieza gratis" (el de pricing conserva la flecha: "Empieza gratis →").
- **Dónde (aplicado):** `nav.createAccount` (línea 17), `hero.ctaPrimary` (37), `firstDay.ctaButton` (167), `pricing.ctaButton` (208).
- **Seguimiento recomendado:** medir conversión del nuevo CTA contra el histórico de "Crear mi POS gratis" cuando haya volumen suficiente, e idealmente formalizar como A/B test (ver `marketing-skills:ab-testing`).

### 5.4 Sección "Más que un punto de venta" / Why Kova `[OK, amplificar]`
- **Actual:** "Otros POS te dejan cobrar. Kova te deja entender." (`whyKova.title`, línea 74)
- **Veredicto:** es el corazón del posicionamiento correcto. **Conservar y subir su jerarquía** — considerar moverla más arriba en la página o reflejar su mensaje en el hero/CTA. Ningún cambio de copy necesario.

### 5.5 Features `[OK]`
- **Actual:** 6 features orientadas a problemas concretos (offline, marca, pagos, datos en vivo, cierre de caja, cero instalaciones). (`features.items`, líneas 121–152)
- **Veredicto:** sólido y específico. Sin cambios. (Opcional `[RECOMENDADO]`: reordenar para que "Datos del día, en vivo" suba al 1.º o 2.º lugar, reforzando el pilar de decisiones.)

### 5.6 Reportes / Analítica `[RECOMENDADO — mayor oportunidad]`
- **Estado actual:** el producto tiene una capa de analítica potente (historia del negocio, recomendaciones, tendencias, hora pico, salud del negocio) que en la landing **solo aparece de pasada** dentro de "Entiende" (`threeNodes.items[2]`) y el preview de tablet. No hay una sección dedicada que muestre el músculo de decisiones.
- **Qué cambiar:** crear una sección específica "Reportes que deciden por ti" / "Tu negocio, explicado" que muestre 3–4 outputs reales: resumen ejecutivo (historia del negocio), recomendaciones (oportunidad/riesgo), hora pico, salud del negocio.
- **Por qué:** es el diferenciador #1 y hoy está infrarrepresentado frente a la parte de "cobrar". Es lo que justifica el pago recurrente.
- **Copy sugerido (eyebrow/title):** "No solo cobras. Entiendes." → "Kova convierte tus ventas del día en una historia clara: qué funcionó, qué reabastecer y qué hacer mañana."
- **Dónde:** nueva sección en `Home.tsx` + nuevo bloque en `messages.ts` (p. ej. `copy.landing.reports`). *Requiere diseño/maquetación — fuera del alcance de esta entrega de copy; se deja como recomendación priorizada.*

### 5.7 Pricing `[OK]`
- **Actual:** "Un solo plan. Todo tu negocio bajo control." $299 MXN/mes, 8 features, sin comisiones/sin cobro por empleado. (`pricing`, líneas 199–220)
- **Veredicto:** claro, honesto y bien estructurado. **No tocar precio, moneda, intervalo ni nombre de plan** (regla dura). Sin cambios. (Opcional `[RECOMENDADO]`: añadir una línea de reencuadre de valor: "Menos de $10 al día por dejar de operar a ciegas.")

### 5.8 FAQ — pregunta #1 `[APLICAR AHORA]`
- **Actual:** "¿Qué es exactamente Kova?" → "**Es un punto de venta en línea** para negocios pequeños y medianos. Te sirve para cobrar, llevar tu inventario, organizar a tu equipo y ver reportes…" (`faq.items[0].a`, línea 186)
- **Qué cambiar:** la definición abre con "punto de venta", anclando la categoría equivocada en el momento de máxima intención (FAQ).
- **Por qué:** es la respuesta donde el prospecto define mentalmente qué es Kova. Debe liderar con control/decisiones y dejar el POS como una capacidad, no como la identidad.
- **Copy mejorado:** "Es la app para tener tu negocio bajo control: cobras, llevas tu inventario, organizas a tu equipo y entiendes qué se vende, cuándo y cuánto entra. Más que un punto de venta: es donde dejas de adivinar y empiezas a decidir con datos. Todo en una sola app, sin sistemas separados ni hojas de cálculo."
- **Dónde:** `copy.landing.faq.items[0].a`.

### 5.9 CTA final / Footer `[OK]`
- **Actual:** tagline del footer: "El punto de venta con el que negocios pequeños y medianos en México cobran con orden, controlan su inventario y entienden qué se vende…" (`footer.tagline`, línea 222)
- **Veredicto:** ya incluye "controlan" y "entienden". Aceptable. (Opcional `[RECOMENDADO]`: reordenar para liderar con "entienden y controlan" antes de "cobran", consistente con el reposicionamiento.)

---

## 6. Roadmap de ejecución de 30 días

### Semana 1 — Posicionamiento y mensaje
- Validar y socializar el statement de posicionamiento y el pitch de una línea (§1) con el equipo.
- **Aplicar los 2 cambios de copy [APLICAR AHORA]** (hero subtitle + FAQ #1) — *incluidos en esta entrega.*
- Definir el calendario de mensajes y los 4 pilares de contenido.
- Research ligero: 5–10 conversaciones con dueños de cafeterías/panaderías para validar dolores y lenguaje (alimenta el contenido).

### Semana 2 — Sitio y conversión
- Revisar y aprobar los cambios `[RECOMENDADO]`: nueva sección de Reportes/Decisiones (§5.6), reencuadre de valor en pricing (§5.7), orden del footer (§5.9).
- Instrumentar analítica de conversión de la landing (signups, scroll, click en CTA) para medir el nuevo CTA **"Empieza gratis"** (ya aplicado, §5.3) y, con volumen, formalizar un A/B test.
- Asegurar que la landing mide correctamente el funnel (ver `specs/marketing/landing_metrics.md`; no mostrar métricas no verificables).

### Semana 3 — Contenido y lanzamiento
- Producir el primer lote de contenido (2 semanas adelantadas) siguiendo el mix 40/30/20/10.
- Lanzar la serie founder-led en IG/LinkedIn.
- Iniciar outreach a comunidades de dueños y a 3–5 aliados locales (tostadores/proveedores).
- Documentar el primer caso de éxito de un beta-user (con permiso) como escenario real.

### Semana 4 — Testing, iteración y sales enablement
- Revisar la conversión del CTA "Empieza gratis"; si hay dudas, formalizar A/B test y quedarse con el ganador.
- Iterar el contenido según engagement (qué hook/pilar funcionó).
- Crear material de **sales enablement**: one-pager de Kova, guion de objeciones (§2.11), respuestas tipo para WhatsApp/DM, página comparativa "Kova vs POS genérico".
- Definir métricas base y metas para el siguiente ciclo (signups → activación → retención de trial).

---

## 7. Próximos cambios recomendados (priorizados)

### Sitio / mensaje
1. **[Alta]** Nueva sección dedicada a Reportes/Decisiones en la landing (§5.6) — el mayor gap entre lo que el producto hace y lo que el sitio comunica.
2. **[Hecho]** CTA cambiado a "Empieza gratis" en los 4 botones para soltar "POS" (§5.3); pendiente medir conversión vs histórico.
3. **[Media]** Subir la jerarquía de "Otros POS te dejan cobrar. Kova te deja entender" (§5.4).
4. **[Media]** Reencuadre de valor en pricing ("menos de $10/día") (§5.7).
5. **[Baja]** Reordenar features para priorizar "Datos del día, en vivo" (§5.5) y el tagline del footer (§5.9).

### Producto (apoyan el posicionamiento de "decisiones")
1. **[Media]** Hacer del "resumen ejecutivo / historia del negocio" algo compartible (imagen/PDF) → contenido orgánico generado por el usuario y prueba de valor.
2. **[Media]** Notificación/resumen diario ("Tu día en Kova") por correo/WhatsApp → hábito + retención + material para casos.
3. **[Baja]** Empaquetar 2–3 "decisiones recomendadas" como insight semanal destacado dentro del dashboard.

### Marketing / datos
1. **[Alta]** Instrumentar analítica de la landing y del funnel de trial antes de invertir en paid (ver `marketing-skills:analytics`).
2. **[Media]** Construir biblioteca de casos/escenarios reales (con permiso) para llenar el 20% del mix sin inventar testimonios.
3. **[Baja]** Página comparativa SEO "Kova vs [POS]" enfocada en reportes/control.

---

## Apéndice — Restricciones respetadas

- **Precio intacto:** no se modificó monto, moneda, intervalo ni nombre de plan ($299 MXN/mes). Regla de `brand-ux-copy.md` y CLAUDE.md.
- **Sin datos falsos:** no se inventaron testimonios, conteos de negocios ni volumen procesado. Beta privada; casos = ejemplos marcados o reales con permiso. Coherente con `specs/marketing/landing_metrics.md`.
- **es-MX preservado** en todo el copy propuesto.
- **Cambios de código mínimos:** solo 2 strings de copy aplicados en esta entrega (`hero.subtitle`, `faq.items[0].a`); todo lo demás queda como recomendación para aprobación explícita.
