# Brief visual y UX — Landing "Una venta lo mueve todo"

> **Actualización 6 de agosto de 2026 (dirección de color unificada):** toda la
> landing pública —navbar, secciones y footer— vive sobre un solo lienzo tinta
> Kova. La jerarquía se construye con bordes, tipografía, capturas del producto y
> superficies operativas elevadas; ya no se alternan bandas blancas y oscuras.
> El movimiento es puntual y sin loops: entradas por capas, reveals al scroll y
> microinteracciones de hover, siempre neutralizadas por `prefers-reduced-motion`.

> **Actualización agosto de 2026 (dirección aprobada):** la landing pública abre
> en tinta Kova y después alterna fondos oscuros con blanco. El azul Kova queda
> como acento de marca. El problema operativo se
> cuenta como una secuencia visual, no como una tabla oscura. Hero, recorrido y
> Reportes se apoyan en la interfaz del producto sin leyendas visibles de
> “captura real”. Se eliminan puntos de estado decorativos, pulsos, browser
> dots, pills genéricas y loops ambientales. El verde queda reservado a estados
> semánticos dentro del producto. La firma visual es la secuencia numerada de
> una venta y el recibo térmico de precio.
>
> Orden vigente: **Navbar → Hero → Problema → recorrido de una
> venta → Capacidades → Reportes → Testimonios → Precio → FAQ → CTA final →
> Footer**. El recorrido desktop usa tabs accesibles sin autoavance; en mobile
> muestra los cuatro pasos apilados para no ocultar contenido tras interacción.

> **Actualización julio de 2026:** la implementación vigente es híbrida. Caja
> comparte presentación con el producto; Inventario, Turnos y Reportes usan
> capturas reales sanitizadas. `KovaShowcase` concentra la historia y
> `SaleStory` ya no se monta para evitar duplicación. Consulta
> `docs/marketing-showcase.md` para el flujo de captura actual.

> Documento de especificación para implementación. No es código final.
> Estrategia aprobada: landing product-led y visual-first donde el usuario entiende Kova viendo una venta de $186 de **Sweet Home** propagarse por POS → Inventario → Caja → Reportes.

**Concepto rector:** Una venta lo mueve todo.
**Promesa:** Conoce exactamente qué pasa en tu negocio.
**Emoción:** Control y tranquilidad. **Enemigo:** la incertidumbre.

## Reglas globales (no negociables)

1. **La UI es el copy.** Más interfaz que texto en toda la página. Ninguna sección de solo párrafos.
2. **Sweet Home es consistente en toda la experiencia.** Un solo catálogo, una sola venta, una sola empleada (Sofía), los mismos números de punta a punta. Fuente de verdad: el data contract de la sección 3 (futuro módulo `frontend/src/landing/demo/sweetHome.ts`).
3. **El producto aparece above the fold.** El POS de Sweet Home es visible sin scroll en desktop y mobile.
4. **Fidelidad al producto real.** Cada recreación imita el layout, labels y tokens de la pantalla real correspondiente (`RegisterView`, `InventoryView`, `ShiftView`, `ReportsView`, `DashboardView`). No se inventan features ni pantallas.
5. **Datos demo solo en la landing.** Nada de esto toca rutas de producto ni analytics reales (regla CLAUDE.md: no fake/demo analytics en paths de producción).
6. **Pricing siempre desde constantes.** `STANDARD_PLAN_PRICE_LABEL` ($299 MXN/mes) de `frontend/src/billing/standardPlan.ts` y `BILLING_TRIAL_LABEL` (7 días) de `frontend/src/billing/trial.ts`. Nunca hardcodear precio en copy nuevo.
7. **Solo tokens existentes.** Colores `--kova-*`, radios `--radius-kova-*`, sombras y easings de `frontend/src/styles.css`. Sin librerías de animación nuevas (todo CSS keyframes + el hook `useLandingRevealMotion` existente). `prefers-reduced-motion` se respeta en todo. El movimiento de la app autenticada vive en `docs/claude/motion-system.md` y usa su propio namespace `kv-*`; los selectores `.lp-*` de la landing nunca se comparten.
8. **Copy es-MX vía i18n.** Todo string visible vive en `copy.landing.*` de `frontend/src/i18n/messages.ts`.

### Mapeo de secciones: landing actual → nueva

| Actual (`Home.tsx`) | Nueva | Acción |
|---|---|---|
| Hero + `IntroAnimation` | Hero + `HeroProductPreview` | El visual del hero pasa a ser el POS de Sweet Home. `IntroAnimation` se retira del hero (puede conservarse como detalle de marca en footer o eliminarse). |
| `POSShowcase` + `DesktopPreview` | `GuidedProductStory` (estado POS) | El `DesktopPreview` actual (catálogo viejo: Americano $38, Latte $52…) queda **obsoleto**; su patrón de interacción se hereda en `SweetHomePOSPreview` con el catálogo nuevo. |
| `HeroDemo` (3 pasos) | `GuidedProductStory` (4 estados) | Reemplazado. |
| `Features` (grid 6) | `BentoModules` | Absorbida; mismos 6 hechos, formato bento. |
| `FirstDay` (4 pasos) | CTA final | Se pliega como mini-fila de 4 pasos dentro del CTA final. Desaparece como sección. |
| `BuiltFor`, `FAQ`, `Pricing`, `Footer` | Iguales | Se conservan; solo retoques de copy/estilo indicados abajo. |

---

## 1. Landing Blueprint

Orden final de la página: **Navbar → Hero → GuidedProductStory → OwnerDashboard → BentoModules → BuiltFor → Pricing → FAQ → CTA final → Footer**.

### 1.1 Hero

> **Actualización jun-2026 (decisión del dueño).** El visual del hero es la
> animación de marca `IntroAnimation` (el logo de kova), no `HeroProductPreview`.
> El producto real se muestra al hacer scroll en `GuidedProductStory` y
> `OwnerDashboard`, que ya cargan el POS de Sweet Home con la venta de $186.
> Se mantiene la animación por decisión consciente posterior a este brief;
> `HeroProductPreview` quedó retirado (ver commit `63ad777`). El texto de abajo
> conserva la intención de copy del hero; solo el visual cambió.

- **Objetivo:** que en <5 segundos el visitante entienda la promesa de Kova por el copy del hero y, al primer scroll, vea el producto real en acción.
- **Copy visible:** H1 "Una venta lo mueve todo." · soporte "Cobra, y Kova actualiza inventario, caja y reportes al instante." · CTA primario "Empieza gratis" · CTA secundario "Ver cómo funciona" (ancla a GuidedProductStory) · badge `STANDARD_PLAN_PRICE_LABEL` + "7 días gratis. Sin tarjeta."
- **Visual principal:** `IntroAnimation` (logo de marca animado), a la derecha del copy en desktop. El producto vive en GuidedProductStory/OwnerDashboard, no en el hero.
- **Qué debe sentir/entender:** "Esto es una herramienta de caja moderna y con identidad; el producto real está a un scroll de distancia."
- **Qué evitar:** más de 2 líneas de copy, claims numéricos no verificables. (La animación es corta y respeta `prefers-reduced-motion`.)

### 1.2 GuidedProductStory

- **Objetivo:** contar la propagación venta → inventario → caja → reportes con el producto mismo. Es el corazón de la landing.
- **Copy visible:** kicker "Mira lo que pasa con una sola venta" · 4 pasos con título de 2–3 palabras + 1 línea: "1 Vendes", "2 El stock baja", "3 La caja cuadra", "4 Tú entiendes" (copy completo en sección 5).
- **Visual principal:** escenario fijo (stage) con riel de 4 pasos a la izquierda y panel de preview a la derecha que alterna entre `SweetHomePOSPreview`, `InventoryStatePreview`, `CashRegisterPreview`, `ReportsPreview`. Navegación por click/tap en pasos, con auto-avance suave (≈6 s por paso) que se detiene al primer click del usuario. **No scroll-jacking.**
- **Qué debe sentir/entender:** causa y efecto. "Cobré $186 y todo lo demás se actualizó solo." Tranquilidad: nada se pierde, nada hay que capturar dos veces.
- **Qué evitar:** scrollytelling pesado, pasos que cambien datos inconsistentes (los $186 deben rastrearse en los 4 estados), texto explicativo largo junto a cada preview (máx. 1 línea de callout).

### 1.3 OwnerDashboard

- **Objetivo:** vender la promesa al dueño: el final del día con todo claro. Es el "payoff" emocional de la historia.
- **Copy visible:** kicker "Al final del día" · título "Conoce exactamente qué pasa en tu negocio." · 1 línea: "Sin perseguir tickets ni hojas de cálculo."
- **Visual principal:** `OwnerDashboardPreview` — recreación del Panel real: 4 KPI cards (Ventas netas $4,820 ↑18% vs ayer, Órdenes 37, Ticket promedio $130, Devoluciones 0), "Tus mejores horas" con 5–7 PM resaltado, "Cómo te pagaron" (barra apilada Efectivo/Tarjeta), "Productos top" con Latte Vainilla en #1.
- **Qué debe sentir/entender:** control. "Esto es lo que yo vería de mi negocio cada noche."
- **Qué evitar:** gráficas decorativas sin etiqueta, métricas que no existan en el Panel real, dashboards genéricos tipo stock-photo.

### 1.4 BentoModules

- **Objetivo:** cobertura de capacidades en formato escaneable; absorbe la grid de Features actual.
- **Copy visible:** kicker "Todo en una sola app" · título "Lo que Kova hace por ti todos los días." · cada celda: título 2–4 palabras + 1 línea.
- **Visual principal:** bento grid de 6 celdas (2 grandes + 4 chicas) con mini-viñetas de UI (no íconos solos): pagos divididos, banner offline "Sigue cobrando sin internet", tile "Caja cuadrada", card de alerta de stock, chips de roles (Dueño/Gerente/Cajero), mini-gráfica de reportes. Las 6 capacidades son las ya publicadas hoy (pagos, offline, caja, inventario con avisos, empleados con roles, reportes) — **no agregar features nuevas**.
- **Qué debe sentir/entender:** "No necesito otra herramienta; esto cubre mi operación."
- **Qué evitar:** celdas de puro texto, más de 6 celdas, jerga técnica (PWA, multi-tenant — decir el beneficio, no la tecnología).

### 1.5 BuiltFor

- **Objetivo:** autoselección — "esto es para un negocio como el mío".
- **Copy visible:** se conserva la estructura actual (`copy.landing.builtFor.*`): tipos de negocio con tags Recomendado / Compatible / Caso por caso.
- **Visual principal:** la grid actual, restyling ligero para alinear con el nuevo lenguaje visual (cards claras, icono por giro). Sweet Home aparece referenciada en la card de cafeterías ("como Sweet Home ☕" — opcional, 1 mención).
- **Qué debe sentir/entender:** honestidad. Kova dice para quién sí y para quién no.
- **Qué evitar:** prometer giros que el producto no atiende; cambiar los tags de honestidad actuales.

### 1.6 Pricing

- **Objetivo:** precio sin fricción ni letra chica.
- **Copy visible:** se conserva la sección actual (`copy.landing.pricing.*`): "Plan Kova", precio desde constantes, lista de 8 features, CTA "Empieza gratis →", fineprint "7 días gratis. Sin tarjeta para empezar. Cancela cuando quieras."
- **Visual principal:** card oscura única actual; ajuste: añadir arriba de la card una línea-puente "Todo lo que viste arriba, por" para conectar con la historia.
- **Qué debe sentir/entender:** "Es un solo plan, claro, y ya vi exactamente qué incluye."
- **Qué evitar:** tablas comparativas, planes inventados, descuentos no existentes en código.

### 1.7 FAQ

- **Objetivo:** desactivar objeciones (internet, hardware, datos, cancelación).
- **Copy visible:** los 8 Q&A actuales (`copy.landing.faq.items`) se conservan; solo revisar tono contra el nuevo concepto.
- **Visual principal:** acordeón actual.
- **Qué evitar:** crecer la lista; respuestas de más de 3 líneas.

### 1.8 CTA final

- **Objetivo:** cierre con acción única; absorbe FirstDay.
- **Copy visible:** título "Tu primera venta en Kova puede ser hoy." · mini-fila de 4 pasos heredada de FirstDay (crear cuenta → cargar productos → abrir turno → cobrar) en una línea horizontal compacta · CTA "Empieza gratis" · fineprint de trial.
- **Visual principal:** banda de acento sobre fondo ink, con la mini-fila de pasos como elemento visual (números + 2 palabras por paso).
- **Qué debe sentir/entender:** "Empezar es corto y sin riesgo."
- **Qué evitar:** segundo CTA competido, formularios embebidos, urgencia falsa.

---

## 2. Component Specification

Convención: todos los componentes nuevos viven en `frontend/src/landing/` (p. ej. `frontend/src/landing/previews/`), consumen el data contract de la sección 3 como props (nunca fetch), y usan los tokens/labels del producto real. Los previews son **decorativos pero fieles**: interactividad mínima y controlada, sin estado de servidor.

### 2.1 HeroProductPreview

- **Responsabilidad:** mostrar el POS de Sweet Home above the fold como visual del hero. Es un wrapper de presentación (marco tipo ventana de app, sombra `--kova-shadow-hero`, glow sutil) alrededor de `SweetHomePOSPreview`.
- **Inputs:** `business`, `products`, `activeSale` del data contract; flag `interactive` (en hero: `true` limitado — solo permite agregar/quitar productos como el `DesktopPreview` actual).
- **Estado visual esperado:** venta de $186 ya cargada en el ticket, indicador "En línea" pulsando en verde `--kova-growth`, botón "Cobrar $186" en `--kova-blue` prominente.
- **Responsive:** desktop ~520px de ancho; ≤900px pasa arriba del copy (patrón actual `order: -1`); ≤640px ancho completo con grid de productos a 2 columnas y ticket colapsado a barra de total fija.
- **A11y:** `role="img"` + `aria-label` descriptivo si se rinde no-interactivo; si interactivo, botones reales con labels ("Agregar Latte Vainilla"); contraste AA sobre fondo ink.

### 2.2 SweetHomePOSPreview

- **Responsabilidad:** recreación en miniatura del POS real ([RegisterView.tsx](../../frontend/src/register/RegisterView.tsx)). Reutilizada por el hero y por el paso 1 de la historia.
- **Inputs:** `products` (con categoría e icono), `activeSale` (líneas, total, método de pago), `business.name`, `employees.active` (chip "Sofía" en header).
- **Estado visual esperado:** header con nombre del negocio + chip de empleada + badge "En línea"; tabs de categoría ("Todos", "Bebidas", "Repostería"); grid de tiles producto (icono + nombre + precio `formatMoney`); panel "Venta actual" con líneas, cantidades, total grande tabular-nums; grupo de botones de método (Efectivo activo / Transferencia / Tarjeta — labels reales de `orders/format.ts`); botón "Cobrar $186".
- **Responsive:** ≥900px grid 4×2 + ticket lateral; ≤640px grid 2 columnas y ticket como bottom-sheet compacto (solo líneas + total + Cobrar).
- **A11y:** estructura de lista para el ticket (`ul/li`), precios con texto completo ("58 pesos"), foco visible en tiles si interactivo.

### 2.3 GuidedProductStory

- **Responsabilidad:** orquestar la narrativa de 4 estados. Controla qué preview se muestra, dispara las microinteracciones de entrada de cada estado y gestiona auto-avance.
- **Inputs:** data contract completo; `steps` (array de 4: id, título, línea de soporte, callout, componente preview).
- **Estado visual esperado:** riel vertical de pasos a la izquierda (número, título, línea; paso activo con acento `--kova-blue` y barra de progreso del auto-avance), stage a la derecha con el preview activo y su callout flotante. Transición entre estados: crossfade + slide sutil (250 ms, `--kova-ease-entrance`).
- **Responsive:** ≤900px se desactiva el stage: los 4 estados se rinden como **cards verticales apiladas** (cada una = mini-preview + título + callout), sin tabs ni auto-avance, microinteracciones disparadas por `IntersectionObserver` al entrar en viewport (reusar `data-lp-reveal`).
- **A11y:** riel como `tablist`/`tab`/`tabpanel` con navegación por teclado; auto-avance se pausa con foco/hover y se elimina con `prefers-reduced-motion`; callouts como texto real, no imágenes.

### 2.4 InventoryStatePreview

- **Responsabilidad:** recreación del inventario real ([InventoryView.tsx](../../frontend/src/inventory/InventoryView.tsx)) mostrando el efecto de la venta en el stock.
- **Inputs:** `inventory.items` (nombre, stock antes/después, umbral, vendido en la venta).
- **Estado visual esperado:** header "Inventario" + badge de stock bajo; 3–4 cards de stock con número grande + "en stock", "Umbral: N" debajo; pills de movimiento "−1"/"−2" en los productos vendidos (rojo `text-destructive`, patrón del historial real); card de Cheesecake fresa terminando en alerta "Stock bajo" / "Riesgo de agotarse".
- **Responsive:** desktop 3 cards en fila + alerta; mobile 2 cards visibles + alerta, en columna.
- **A11y:** los cambios de número se anuncian como texto estático final ("5 en stock, bajó 1"), no depender del motion para comunicar el dato.

### 2.5 CashRegisterPreview

- **Responsabilidad:** recreación del turno activo real ([ShiftView.tsx](../../frontend/src/shifts/ShiftView.tsx)).
- **Inputs:** `cashRegister` (apertura, efectivo inicial, ventas en efectivo, salidas, efectivo esperado, movimientos, empleada).
- **Estado visual esperado:** card "Turno activo" + badge verde "Abierto" + "Sofía · desde 8:00 AM"; 4 tiles KPI (Efectivo inicial $500 · Ventas en efectivo $1,740 · Salidas −$200 · **Efectivo esperado $2,040** en tile acentuado `--kova-blue`); lista de movimientos con la fila nueva arriba: ↑ "Venta · Efectivo · +$186".
- **Responsive:** desktop tiles 4 en fila; ≤640px tiles 2×2 y lista de movimientos reducida a 2 filas.
- **A11y:** montos con `tabular-nums`; flechas de entrada/salida acompañadas de texto ("Entrada"), no solo color.

### 2.6 ReportsPreview

- **Responsabilidad:** recreación compacta de Reportes ([ReportsView.tsx](../../frontend/src/reports/ReportsView.tsx)) para el paso 4 de la historia (vista "Hoy").
- **Inputs:** `reports` (KPIs, mejores horas, breakdown de pago, producto top, delta vs ayer).
- **Estado visual esperado:** fila de 3 KPIs (Ventas netas $4,820 con badge "↑ 18% vs ayer" en `--kova-growth` · Órdenes 37 · Ticket promedio $130); mini bar chart "Tus mejores horas" con la barra 5–7 PM resaltada; barra apilada "Cómo te pagaron" (Efectivo 36% / Tarjeta 64%) con leyenda.
- **Responsive:** desktop 2 columnas (KPIs+horas / pagos+top); mobile todo apilado, chart de horas con 5 barras máx.
- **A11y:** charts con `aria-label` resumen ("Mejores horas: 5 a 7 PM"); deltas con signo y texto, no solo flecha.

### 2.7 OwnerDashboardPreview

- **Responsabilidad:** recreación del Panel real ([DashboardView.tsx](../../frontend/src/dashboard/DashboardView.tsx)) para la sección OwnerDashboard. Más amplia que `ReportsPreview` (es la vista "fin del día" del dueño).
- **Inputs:** `reports` + `business` + `employees`.
- **Estado visual esperado:** saludo "Buenas tardes" + período "Hoy"; 4 KPI cards estilo real (label uppercase tertiary, valor 2xl bold, delta badge); fila inferior con "Tus mejores horas", "Cómo te pagaron" y "Productos top" (1. Latte Vainilla — usar los mismos números del contrato).
- **Responsive:** desktop grid 4 KPIs + 3 paneles; ≤900px KPIs 2×2; ≤640px solo 3 KPIs + "Cómo te pagaron" (recortar para legibilidad, no encoger tipografía bajo 12px).
- **A11y:** misma pauta que ReportsPreview; orden de lectura lógico en DOM aunque el layout sea grid.

### 2.8 BentoModules

- **Responsabilidad:** grid bento de 6 capacidades con mini-viñetas de UI.
- **Inputs:** array estático de módulos (icono lucide, título, línea, mini-viñeta opcional que puede reusar fragmentos de los previews — p. ej. la pill de alerta de stock).
- **Estado visual esperado:** 2 celdas grandes (Cobros/offline) + 4 chicas; cards claras sobre `--kova-mist`, hover con `--kova-shadow-card-hover`.
- **Responsive:** desktop bento 3 columnas; ≤900px 2 columnas; ≤640px columna única (todas las celdas mismo tamaño).
- **A11y:** cada celda es un `li` de una lista de features; íconos `aria-hidden`.

### 2.9 ProductIconSet

- **Responsabilidad:** set de 8 íconos de producto para Sweet Home, consistente en todos los previews. **Sin fotos, sin emojis.**
- **Inputs:** `iconId` por producto (latte-vainilla, americano, chocolate, cheesecake, brownie, galleta, concha, panque).
- **Estado visual esperado:** íconos lineales estilo lucide (stroke 1.5, 20–24 px, monocromos `--kova-tertiary`), dentro de un chip redondeado con tinte de categoría (Bebidas: `--kova-blue` al 10%; Repostería: ámbar warning al 10%). Donde lucide tenga ícono directo usarlo (`Coffee`, `CakeSlice`, `Cookie`, `CupSoda`…); solo dibujar SVG propio si no existe equivalente (concha, panqué) siguiendo el mismo grid de 24px.
- **Responsive:** tamaño fijo; en tiles ≤640px el chip baja a 18–20 px.
- **A11y:** decorativos (`aria-hidden`); el nombre del producto siempre como texto.

---

## 3. Sweet Home Demo Data Contract

Única fuente de verdad. Implementar después como constantes TS en `frontend/src/landing/demo/sweetHome.ts`. Montos en pesos MXN (formatear con `formatMoney` de `orders/format.ts`).

### business

| Campo | Valor |
|---|---|
| name | Sweet Home |
| tagline | Cafetería & Repostería |
| timezone display | hora local del negocio (no mostrar TZ en landing) |

### products (8)

| id | Nombre | Precio | Categoría | iconId |
|---|---|---|---|---|
| latte-vainilla | Latte Vainilla | $58 | Bebidas | latte-vainilla |
| americano | Americano | $42 | Bebidas | americano |
| chocolate | Chocolate caliente | $55 | Bebidas | chocolate |
| cheesecake | Cheesecake fresa | $72 | Repostería | cheesecake |
| brownie | Brownie | $38 | Repostería | brownie |
| galleta-avena | Galleta de avena | $28 | Repostería | galleta |
| concha | Concha artesanal | $32 | Repostería | concha |
| panque | Panqué de plátano | $45 | Repostería | panque |

### activeSale (la venta que lo mueve todo)

| Campo | Valor |
|---|---|
| Líneas | Latte Vainilla ×1 ($58) · Cheesecake fresa ×1 ($72) · Galleta de avena ×2 ($56) |
| **Total** | **$186** (58 + 72 + 28×2 ✓) |
| Método de pago | **Efectivo** (fijo — Caja depende de esto) |
| Atendió | Sofía |
| Hora | 5:42 PM (dentro del "mejor horario") |

### inventory (solo productos con seguimiento — repostería)

| Producto | Stock antes | Vendido | Stock después | Umbral | Estado después |
|---|---|---|---|---|---|
| Cheesecake fresa | 6 | 1 | **5** | 5 | **Stock bajo** → alerta "Riesgo de agotarse" |
| Galleta de avena | 24 | 2 | **22** | 8 | Saludable |
| Brownie | 14 | 0 | 14 | 6 | Saludable |
| Concha artesanal | 10 | 0 | 10 | 6 | Saludable |

(Las bebidas no aparecen en el preview de inventario: el inventario real muestra "Productos con seguimiento".)

### cashRegister (turno activo)

| Campo | Antes de la venta | Después |
|---|---|---|
| Empleada / apertura | Sofía · 8:00 AM | igual |
| Efectivo inicial | $500 | $500 |
| Ventas en efectivo | $1,554 | **$1,740** (+$186 ✓) |
| Salidas | −$200 ("Compra de leche") | −$200 |
| **Efectivo esperado** | $1,854 | **$2,040** (500 + 1,740 − 200 ✓) |
| Movimiento nuevo | — | "Venta · Efectivo · +$186" (5:42 PM) |

### reports (vista "Hoy", después de la venta)

| Métrica | Valor | Verificación |
|---|---|---|
| Ventas netas | $4,820 | = Efectivo $1,740 + Tarjeta $3,080 ✓ |
| Efectivo / Tarjeta | $1,740 (36%) / $3,080 (64%) | 1,740/4,820 = 36.1% ✓ |
| Órdenes | 37 | la venta de $186 es la #37 |
| Ticket promedio | $130 | 4,820/37 = 130.27 → mostrar "$130" |
| vs ayer | ↑ 18% | badge verde `--kova-growth` |
| Producto top | Latte Vainilla | consistente con activeSale |
| Mejor horario | 5:00 PM – 7:00 PM | barra resaltada en "Tus mejores horas" |

### employees

| Nombre | Rol | Estado en demo |
|---|---|---|
| Sofía | Cajera | Activa (turno abierto, atiende la venta) |
| Mariana | Dueña | Persona implícita de OwnerDashboard (saludo del Panel) |

---

## 4. Visual State Specs (GuidedProductStory)

Los 4 estados comparten stage, escala y marco. Cada estado entra con su microinteracción **una sola vez** (no loop). Con `prefers-reduced-motion`: se muestra directamente el estado final, sin counts ni slides.

### Estado 1 — POS / Vendes

- **Layout:** `SweetHomePOSPreview` completo: grid de productos a la izquierda, ticket "Venta actual" a la derecha, botón "Cobrar $186" abajo.
- **Datos visibles:** las 3 líneas de `activeSale`, total $186, método Efectivo seleccionado, chip Sofía, badge "En línea".
- **Callout:** "Cobras en segundos."
- **Microinteracción:** la línea "Galleta de avena ×2" hace pop al entrar (patrón `lp-cart-pop` existente) y el total cuenta $130 → $186 (≈300 ms); el botón Cobrar pulsa una vez al final.
- **Cambio vs anterior:** estado inicial de la historia.

### Estado 2 — Inventario

- **Layout:** `InventoryStatePreview`: header "Inventario" + badge "1 en stock bajo"; 3 cards de stock en fila; debajo, card de alerta.
- **Datos visibles:** Cheesecake fresa **5** en stock (Umbral: 5, badge "Stock bajo"), Galleta de avena **22** (pill "−2"), Brownie 14; alerta "Cheesecake fresa · Riesgo de agotarse".
- **Callout:** "El stock se actualiza solo."
- **Microinteracción:** los números bajan con tick (6→5, 24→22, ≈250 ms); pills "−1"/"−2" aparecen en rojo; al final, fade-in del badge "Stock bajo" y de la alerta.
- **Cambio vs anterior:** los 2 productos vendidos en el POS son exactamente los que bajan aquí; la venta provoca una alerta accionable (no solo un número).

### Estado 3 — Caja

- **Layout:** `CashRegisterPreview`: card "Turno activo" con badge "Abierto", 4 tiles KPI en fila, lista de movimientos debajo.
- **Datos visibles:** Efectivo inicial $500 · Ventas en efectivo $1,740 · Salidas −$200 · **Efectivo esperado $2,040**; movimiento nuevo "Venta · Efectivo · +$186 · 5:42 PM" arriba de la lista.
- **Callout:** "Cada peso queda registrado."
- **Microinteracción:** la fila del movimiento entra con slide-in desde arriba; el tile "Efectivo esperado" cuenta $1,854 → $2,040 con un flash sutil de `--kova-growth`.
- **Cambio vs anterior:** el pago en **Efectivo** elegido en el POS es lo que mueve la caja; conecta método de pago → dinero físico esperado.

### Estado 4 — Reportes

- **Layout:** `ReportsPreview`: fila de 3 KPIs arriba; abajo a la izquierda "Tus mejores horas" (mini bars), a la derecha "Cómo te pagaron" (barra apilada) + "Productos top" (línea 1).
- **Datos visibles:** Ventas netas $4,820 con "↑ 18% vs ayer" · Órdenes 37 · Ticket promedio $130 · barra 5–7 PM resaltada · Efectivo 36% / Tarjeta 64% · "1. Latte Vainilla".
- **Callout:** "Y tú entiendes qué pasó."
- **Microinteracción:** KPIs cuentan hacia arriba (≈400 ms, escalonados 80 ms); la barra apilada se llena de izquierda a derecha; el badge "↑ 18%" aparece al final como cierre.
- **Cambio vs anterior:** zoom out — de la operación al entendimiento; la orden #37 de $186 ya forma parte de los totales del día. Cierre de la promesa.

---

## 5. Copy Pack (es-MX, final)

Regla: máximo 1 línea de soporte por sección. Sin claims inventados. Pricing siempre interpolado desde constantes.

| Ubicación | Copy |
|---|---|
| **Hero · H1** | Una venta lo mueve todo. |
| Hero · soporte | Cobra, y Kova actualiza inventario, caja y reportes al instante. |
| Hero · CTA 1 / CTA 2 | Empieza gratis · Ver cómo funciona |
| Hero · badge | {precio} · 7 días gratis. Sin tarjeta. |
| **Historia · kicker** | Mira lo que pasa con una sola venta |
| Paso 1 título / línea | Vendes · Tu mostrador, sin complicarte. |
| Paso 1 callout | Cobras en segundos. |
| Paso 2 título / línea | El stock baja · Sin capturar nada dos veces. |
| Paso 2 callout | El stock se actualiza solo. |
| Paso 3 título / línea | La caja cuadra · Efectivo claro, turno por turno. |
| Paso 3 callout | Cada peso queda registrado. |
| Paso 4 título / línea | Tú entiendes · Tu día, explicado. |
| Paso 4 callout | Y tú entiendes qué pasó. |
| **OwnerDashboard · kicker** | Al final del día |
| OwnerDashboard · título | Conoce exactamente qué pasa en tu negocio. |
| OwnerDashboard · línea | Sin perseguir tickets ni hojas de cálculo. |
| **Bento · kicker / título** | Todo en una sola app · Lo que Kova hace por ti todos los días. |
| Bento · celdas (título · línea) | Cobra como sea · Efectivo, transferencia, tarjeta y pagos divididos. / Sin internet, sin pausa · Sigue cobrando aunque se vaya la señal. / Caja cuadrada · Apertura, cierre y cuadre automáticos. / Inventario que avisa · Te dice qué se acaba antes de que se acabe. / Tu equipo, con roles · Cajero, gerente y dueño, cada quien lo suyo. / Reportes que cuentan · Qué se vende, cuándo y a qué hora. |
| **BuiltFor** | Conservar copy actual (`copy.landing.builtFor.*`). |
| **Pricing · línea-puente** | Todo lo que viste arriba, por |
| Pricing · resto | Conservar copy actual (plan, features, fineprint). |
| **FAQ** | Conservar los 8 items actuales. |
| **CTA final · título** | Tu primera venta en Kova puede ser hoy. |
| CTA final · pasos | 1 Crea tu cuenta · 2 Carga tus productos · 3 Abre tu turno · 4 Cobra |
| CTA final · botón / fineprint | Empieza gratis · 7 días gratis. Sin tarjeta para empezar. Cancela cuando quieras. |

Notas de tono: tutear siempre; verbos en presente; nada de "revoluciona/potencia/IA"; los números visibles en copy solo pueden ser los del data contract o los de constantes de billing.

---

## 6. Mobile Behavior

Breakpoints existentes: 900 px y 640 px (reusar los de `Home.tsx`).

| Sección | ≤900px | ≤640px |
|---|---|---|
| Hero | Preview arriba del copy (patrón `order:-1` actual) | Preview a ancho completo; grid de productos 2 col; ticket como barra de total + Cobrar |
| GuidedProductStory | **Cards verticales apiladas** (sin stage, sin tabs, sin auto-avance): cada estado = card con mini-preview + título + callout, reveladas con `data-lp-reveal` | Igual; previews recortados a su núcleo (POS: ticket+total; Inventario: 2 cards+alerta; Caja: 2 tiles+movimiento; Reportes: KPI principal+barra de pagos) |
| OwnerDashboard | KPIs 2×2 + 1 panel | 3 KPIs apilados + "Cómo te pagaron" |
| BentoModules | 2 columnas | 1 columna, celdas uniformes |
| BuiltFor / Pricing / FAQ / CTA | Patrones responsive actuales | Igual; pasos del CTA final en 2×2 |

Prohibido en mobile: scroll horizontal, previews con texto <12 px, contenido clave solo visible tras interacción. El producto debe verse y leerse en un viewport de 360 px.

**Excepción decidida por producto (2026-07-27): el HeroFilm.** El hero fusionado con la película del producto (`landing/film/HeroFilm.tsx`) SÍ es un rig sticky con scrub — es la única sección con esa licencia, en desktop y mobile. Condiciones que la mantienen dentro del espíritu del brief: static-first (el prerender/no-JS/reduced-motion ven un hero clásico completo; el modo cinemático es opt-in vía `data-pf-live` post-hidratación), el H1 y el CTA pintan del HTML prerenderizado (gate LCP CRO-1 intacto), en mobile los capítulos recortan al núcleo de cada pantalla, y `prefers-reduced-motion`/Save-Data nunca descargan la secuencia. Ninguna otra sección puede adoptar sticky/scrub sin decisión explícita del dueño.

---

## 7. Motion Guidelines

**Principio: el motion existe solo para mostrar causa-efecto de la venta.** Si una animación no explica "esto pasó por la venta", no va.

**Sí (lista cerrada):**
1. Total del ticket que cuenta $130 → $186 (POS).
2. Stock que baja con tick 6→5 y 24→22 + pills −1/−2 (Inventario).
3. Efectivo esperado que cuenta $1,854 → $2,040 + fila de movimiento con slide-in (Caja).
4. KPIs que cuentan hacia arriba + barra apilada que se llena + badge ↑18% (Reportes).
5. Pulso del indicador "En línea" (reusar `lp-live-pulse`).
6. Reveals de sección al hacer scroll (reusar `useLandingRevealMotion` / `data-lp-reveal`).
7. Crossfade entre estados del stage (250 ms) y barra de progreso del auto-avance.

**Sí, adicional (2026-07-27):**
8. El scrub del HeroFilm: cuadros WebP reales sobre canvas conducidos por scroll, con zonas lentas (dwell) por capítulo — ver la excepción documentada en §6.

**No:**
- Parallax, scroll-jacking fuera del HeroFilm, elementos que persiguen el cursor.
- Loops infinitos fuera del pulso "En línea".
- Animaciones de entrada >600 ms o counts >400 ms.
- Confetti, partículas, gradientes animados grandes (el `lp-preview-glow` actual puede conservarse solo si pasa reduced-motion y no distrae del dato).
- Animar texto letra por letra.

**Parámetros:** duraciones 200–600 ms; entrada con `--kova-ease-entrance`, énfasis con `--kova-ease-spring`; stagger máx. 80 ms entre elementos hermanos. **`prefers-reduced-motion`: estados finales directos, sin counts, sin slides, sin auto-avance** (extender el patrón ya implementado en `useLandingRevealMotion` e `IntroAnimation`).

---

## 8. Implementation Checklist for Claude Code

Orden sugerido (cada paso deja la landing funcional):

1. **Data contract** — crear `frontend/src/landing/demo/sweetHome.ts` con las constantes de la sección 3 (tipadas, `as const`). Verificar aritmética con un test unitario pequeño (total $186, efectivo esperado $2,040, netas = efectivo + tarjeta).
2. **ProductIconSet** — íconos + chips de categoría.
3. **SweetHomePOSPreview** — reemplaza al `DesktopPreview` actual; eliminar el catálogo viejo (Americano $38…) de `messages.ts` y migrar las keys a `copy.landing.sweetHome.*`.
4. **HeroProductPreview + nuevo Hero** — copy nuevo en `copy.landing.hero.*`; badge interpolando `STANDARD_PLAN_PRICE_LABEL` y `BILLING_TRIAL_LABEL`.
5. **InventoryStatePreview, CashRegisterPreview, ReportsPreview** — uno por uno, validando labels contra el producto real.
6. **GuidedProductStory** — stage desktop + cards apiladas mobile; retirar `HeroDemo` y `POSShowcase`.
7. **OwnerDashboardPreview + sección OwnerDashboard.**
8. **BentoModules** — retirar la sección Features.
9. **CTA final** — retirar FirstDay, plegar sus 4 pasos.
10. **Retoques** a BuiltFor/Pricing (línea-puente)/FAQ.
11. **Limpieza** — borrar keys de i18n huérfanas (`desktopPreview.*`, `firstDay.*` si ya no se usan) y estilos `lp-*` muertos.

Invariantes a verificar antes de cerrar (QA manual + `docs/claude/manual-qa-checklist.md`):

- [ ] Los $186 son rastreables en los 4 estados y el dato es idéntico en hero, historia y dashboard (una sola fuente: `sweetHome.ts`).
- [ ] POS visible above the fold en 1440 px, 768 px y 360 px.
- [ ] Sin scroll horizontal en ningún viewport ≥320 px.
- [ ] `prefers-reduced-motion` activado: la página comunica lo mismo sin animaciones.
- [ ] Navegación por teclado completa en GuidedProductStory (tabs) y FAQ.
- [ ] Precio y trial renderizados desde `standardPlan.ts`/`trial.ts` (buscar "299" hardcodeado en la landing: debe haber 0 resultados nuevos).
- [ ] Ningún dato demo importado fuera de `frontend/src/landing/`.
- [ ] Todos los labels de previews coinciden con los del producto real ("Venta actual", "Cobrar", "en stock", "Umbral", "Stock bajo", "Riesgo de agotarse", "Turno activo", "Abierto", "Efectivo esperado", "Caja cuadrada", "Ventas netas", "Órdenes", "Ticket promedio", "Tus mejores horas", "Cómo te pagaron", "Productos top", "vs ayer", "Efectivo", "Transferencia", "Tarjeta").
- [ ] Copy 100% es-MX, sin párrafos largos (máx. 1 línea de soporte por sección).
- [ ] Lighthouse/perf: sin libs de animación nuevas; CSS keyframes únicamente.
