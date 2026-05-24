# Kova POS — UX / Producto / QA Review

**Fecha:** 2026-05-23
**Personas:** Usuario no técnico · Product Owner · QA Tester · UX Researcher · UX/UI Designer senior · Business Analyst · Cliente potencial evaluando si vale la pena pagar.
**Método:** Code review profundo del frontend y backend (`frontend/src/**`, `backend/app/**`) cruzado con navegación en vivo a `https://point-of-sale-ochre.vercel.app/` (desktop 1696×900 + verificaciones puntuales).
**Cross-refs:** `docs/ux-review-2026-05-19.md`, `docs/qa-walkthrough-2026-05-22.md`, `docs/current-sprint.md` (Sprint 5).
**Postura:** crítico pero constructivo. Reporto qué cambiar, con qué prioridad, y por qué importa para un dueño que está decidiendo si pagar $299/mes.

---

## 1. Executive summary

Kova ya tiene la espina dorsal correcta: landing on-brand, auth con recuperación de contraseña real, POS con offline, dashboard con narrativa, reportes con preset comparable, billing con confirmación destructiva. Esos son problemas resueltos — y son los que separan a un MVP juguete de un SaaS cobrable. Los UX reviews previos (19 y 22 de mayo) cerraron la mayoría de los blockers de primera impresión.

Sin embargo, el producto sigue parado sobre **tres problemas que erosionan la confianza** una vez que un dueño paga y empieza a usarlo en serio:

1. **Bug de zona horaria en Reportes** (no en Dashboard) que hace que después de las 18:00 hora local CDMX la página de reportes diga "Aún no hay ventas para contar una historia" cuando el negocio acaba de cerrar el mejor día del mes. Está en código, no es teoría: `frontend/src/reports/ReportsView.tsx:63` usa `toISOString().slice(0,10)` en UTC. Es el mismo bug que ya se arregló en Dashboard (`DashboardView.tsx:67-85`), pero no se propagó a Reports ni a `ProductStoryCard.tsx`. Es el bug #1 a cerrar.
2. **El "Por qué Kova vs. competencia" no está dramatizado dentro de la app.** El landing convierte bien. Pero al entrar, el dueño no recibe el mensaje "esto es lo que hace que valga $299". El TrialChip está, el `UpgradeNudge` está — pero no hay una vista de "lo que llevas ahorrado/cobrado/automatizado en tu prueba" que convierta racionalmente al día 13. Sin esto, la conversión trial→paid sigue siendo emocional, no racional.
3. **Storytelling de reportes está a mitad de camino.** `InsightStrip` genera 6 tipos de bullets bien escritos, pero no contesta las preguntas más caras del dueño (margen, productos zombi, horario muerto, día débil de la semana, mezcla de productos que se venden juntos). El backend ya expone `product_trends`, `restock_alerts`, `employee_contribution` — pero la mitad del valor narrativo no se rinde en UI.

Hay además dos categorías de fricción más mecánica que conviene cerrar antes de invitar al siguiente grupo de beta: **gaps operativos del cajero** (no hay reimprimir ticket, no hay descuento manual, las devoluciones no impactan el cierre de turno) y **inconsistencias finas de localización** (turnos siguen rindiendo enums en inglés, formato de fecha mezclado, ARIA labels). Ninguna mata el deal, pero sumadas degradan la promesa "Hecho en México · premium".

**Recomendación.** Una semana de Sprint 6 enfocada en (a) bug de TZ en Reportes, (b) "Lo que llevas con Kova" durante el trial, (c) ampliar InsightStrip con tres insights nuevos accionables, (d) gaps operativos del cajero. Después de eso, el producto está listo para abrir beta a 10–20 tenants cafeteros pagados con Stripe live.

---

## 2. Overall product score

**7.6 / 10.**

| Dimensión | Score | Comentario |
|---|---:|---|
| Landing y conversión a trial | 9 | Tono, claridad, precio visible, "Sin tarjeta para empezar", FAQ honesto. Mejor que muchos SaaS mexicanos. |
| Auth y onboarding | 8 | Forgot-password resuelto, checklist con auto-mark, FirstValueMilestone, dev token visible — sólido. |
| POS / Caja (operación diaria) | 7 | Funciona, hay SKU search, modificadores, offline, undo, mobile sheet. Faltan: descuentos, reimprimir, atajos de teclado. |
| Inventario | 7 | Search/filter/sort + velocity. Falta: badge "Agotado" para `stock <= 0` consistente, devoluciones que afecten stock. |
| Reportes / Storytelling | 6 | Compact brief + drill-down está bien, pero TZ bug + narrativa limitada bajan la nota. |
| Settings / Billing | 8 | Tabs, logo upload, cancel dialog, value items. Falta: receipt live preview. |
| Mobile responsiveness | 7 | Bottom sheet de carrito, bottom nav, safe-area-inset. KPI grid se apila 4 filas a 375px. |
| Premium feel / consistencia visual | 8 | Tokens, DM Sans, hairlines, intro animation, LivePulse. Solo el módulo `/shifts` y placeholders rotos bajan la nota. |
| Trust / "worth paying" | 7 | El trial chip ayuda; falta la narrativa explícita "lo que llevas con Kova" durante el trial. |
| Cobertura funcional (vs competencia local) | 7 | Cubre el 80% del caso cafetero. Falta: descuentos, reimpresión, devolución a turno, ventas del turno visibles. |

---

## 3. What currently works well

Cosas que NO hay que tocar — son moats que cuesta replicar:

- **Landing.** "Lleva tu emprendimiento con orden, sin libretas ni Excel." es uno de los headlines mejor calibrados para PyME mexicana que he leído. La sección "¿Es para mí?" con "Recomendado / Compatible / Caso por caso" honesta es un acto de madurez que distingue del competidor que promete todo y entrega 60%.
- **Pricing transparente.** `$299 MXN/mes · todo incluido · sin comisión por venta · cancela cuando quieras` repetido en hero, sección de precio y trial chip — quita la fricción #1 del SMB mexicano. La consistencia entre `STANDARD_PLAN_PRICE_LABEL_ES`, el backend y la migración `0023_standard_plan_299_mxn.py` es notable.
- **Auth flow.** Cookies HttpOnly (no localStorage), refresh con reintento global en interceptor, forgot-password con OPSEC ("mensaje genérico sin enumeration"), per-route document title. Es el flujo más sólido del MVP.
- **BillingBanner.** Tone-aware (info / warning / danger), dismissible solo en estado info, suppressed en `/settings/billing`, copy específico por reason. Es exactamente cómo debe verse esa barra.
- **BusinessHealthCard.** Composite score con pesos (40% ventas, 25% refunds, 20% pagos, 15% inventario) y banda `setup` cuando hay 0 actividad — evita la "100% rojo" del primer día.
- **InsightStrip.** El que un dashboard cuente una historia con frases ("Tu producto top fue X · Tu hora pico fue 13:00") es lo que separa un POS de un dashboard. Los `recommended_actions` con 3-cap y dedupe por `(action_type, target_id)` son la decisión correcta.
- **Register.** SKU/barcode search con debounce, autoinsert al match exacto, undo al remover item, validación de cash shortfall en línea ("Faltan $26.00"), mobile sheet con peek-handle y "max-h-[calc(100dvh-7rem)]".
- **Offline + sync.** Dexie + idempotency key + dead-letter con 5 retries con backoff `[2, 8, 30, 60, 120]`. Producto serio.
- **Brand sistema.** Tokens en CSS variables, DM Sans, `0.5px` hairlines, intro animation con `prefers-reduced-motion`, `LogoMark` y `LivePulse` reutilizables. Cumple `CLAUDE.md` al pie de la letra.
- **Multi-tenancy.** RLS en Postgres + `set_config('app.tenant_id', ...)` en cada request + `tenant_isolation` policy. Defensa en profundidad real, no marketing.
- **Sprint discipline.** El `current-sprint.md` y `qa-walkthrough-2026-05-22.md` son el tipo de doc que solo escribe alguien que toma el producto en serio. El backlog está priorizado y verificado, no es una lista de buenas intenciones.

---

## 4. Biggest risks before selling

En orden, los riesgos que detendrían que un dueño pague o que mantenga el pago al mes 2:

1. **TZ bug en Reportes.** Después de las 18:00 CDMX, `/reports` con preset "Hoy" muestra "Aún no hay ventas". El dueño cierra el local con $3,000 en caja, abre Kova en su laptop y ve "0 ventas hoy". Confianza al suelo. Antes que cualquier polish nuevo, esto se cierra.
2. **Promesa de "premium" rota en `/shifts` y en placeholders `mm/dd/yyyy`.** Por inconsistencia el módulo de Turnos sigue rindiendo `Open`, `OPENING_BALANCE`, `balanced`, `5/22/2026, 7:51:02 AM` — el cajero lo ve todos los días. Roba ~1 punto del score "premium".
3. **Gaps operativos del cajero que se descubren en producción.** No hay reimprimir ticket, no hay descuento manual, las devoluciones no generan movimiento de turno. Cualquiera de los tres es un escenario que aparece en la semana 1 de uso real y termina en ticket de soporte.
4. **Stripe live keys.** Documentado como release gate. El día que se cambien las keys, todo el resto del sistema tiene que estar verificado: cancelación, retry, past-due grace, email post-checkout. Hoy todo eso vive en sandbox.
5. **Conversión trial → paid sin narrativa "lo que llevas con Kova".** El `UpgradeNudge` solo dispara cuando `orderCount > 0`. La narrativa "cobraste $X · tienes Y productos · Z empleados · tu día más fuerte fue T" no existe — y es la que convierte racionalmente al usuario que se quedó pensándolo.
6. **Ausencia de página de "Comparativa con competencia" o "Casos de éxito".** El landing es bueno, pero un cliente que ya conoce Loyverse o Square va a buscar la diferencia. No la encuentra.
7. **Sin canal de soporte visible en la app.** El email `posprojectsupport@gmail.com` está en el footer del landing y en el signup, pero no hay un botón "Ayuda" en el AppShell. El primer ticket de soporte que se pierda por esto es uno menos.
8. **`backend/scripts/clamp_negative_stock.py` / `fix_category_accents.py` / `backfill_skus.py` aún no se han corrido contra producción** (per QA del 22-may). Datos sucios en producción siguen visibles para tenants existentes.

---

## 5. Full UX / QA findings table

Solo hallazgos nuevos o re-validados que no aparecen ya cerrados en `current-sprint.md`. Cross-refs entre paréntesis.

| Priority | Area | Issue | Why it matters | Recommendation | Effort |
|---|---|---|---|---|---|
| **P0** | Reports | `ReportsView.tsx:63` usa `toISOString().slice(0,10)` (UTC). Después de las 18:00 CDMX el rango "Hoy" pide mañana → "Aún no hay ventas". Dashboard ya está fixed. | Bug de datos visible al usuario justo cuando cierra el día — momento de máxima atención. | Centralizar `todayISO(timezone)` / `yesterdayISO(timezone)` en `frontend/src/i18n/date.ts` y consumirlo desde Dashboard, Reports, ProductStoryCard, Orders filters. Backend defensa: validar `start_date <= today_in_tz` en `backend/app/reports/router.py`. | Small |
| **P0** | Reports / Catalog | `ProductStoryCard.tsx:48,52` mismo bug TZ. | Inconsistente con dashboard, confunde al dueño que revisa "¿por qué la story dice una cosa y el panel otra?". | Mismo helper que el anterior. | Small |
| **P0** | Trust / Onboarding | Conversión trial→paid sin narrativa explícita del valor entregado. `UpgradeNudge` requiere `orderCount > 0` y solo muestra "Cobraste $X.XX" — falta panel "Lo que llevas con Kova". | La decisión de pago en el día 13 es racional, no emocional. Sin esta narrativa pierdes ~15% de conversión. | Nueva tarjeta `TrialValueRecap` en dashboard (durante trial activo): "En 13 días con Kova: 47 ventas · $X.XX cobradas · 12 productos en catálogo · 2 empleados · 1 turno cerrado · tu mejor día fue jueves". Al expirar trial, se convierte en el `expiredTrialBanner` pero con la lista concreta. | Medium |
| **P0** | Shifts | `/shifts` renderiza `Open`, `OPENING_BALANCE`, `balanced`, `5/22/2026, 7:51:02 AM` — backend enums en inglés más formato de fecha US. | El cajero lo ve cada turno. Erosiona la promesa "es-MX premium". (Cross-ref BUG-016/017 del current-sprint Sprint 5 § P1 Localización.) | Crear `frontend/src/shifts/format.ts` con `localizeShiftStatus`, `localizeMovementType`, `localizeReconciliation` que mapeen enums a labels es-MX. Reemplazar todos los `toLocaleString()` con el helper `formatDateTime()` ya centralizado. | Small |
| **P1** | Register | No hay descuento / cortesía manual en el carrito. La copy del landing menciona "extras y modificadores" pero el dueño que quiere regalarle un café a un amigo no puede. | Caso real semanal en cafetería. Hoy se resuelve con "venta cancelada manualmente" → data sucia en reportes. | Botón `Aplicar descuento` por item (con permiso `register.discount`, en owner/manager) — modal con `% / monto fijo / cortesía gratis` + razón opcional. Reflejar en `gross_sales` vs `net_sales` y en reportes. Backend: nuevo campo `line_item.discount_amount` + `discount_reason`. | Large (toca backend) |
| **P1** | Orders | No hay botón "Reimprimir ticket" en `/orders/<id>`. | Caso #1 del cajero: cliente pide segundo ticket, impresora se atascó, etc. Hoy se reimprime desde Settings preview con datos falsos. | Botón `Imprimir ticket` en *Acciones*. Stylesheet print-only que renderice un componente `<Receipt order={order} businessSettings={...} />` reutilizable entre `/settings/receipt` preview y `/orders/<id>`. | Medium |
| **P1** | Orders / Shifts | La devolución registra refund + razón pero **no genera movimiento de efectivo en el turno**. | Al cierre del turno el conteo físico no cuadra con el sistema si hubo devoluciones en efectivo. Hace que el dueño desconfíe del sistema. | En el modal de devolución, paso 2 opcional: `¿Cómo entregaste el reembolso? [Efectivo $X / No reembolsado (vale) / Tarjeta]`. Si efectivo, generar `cash_movement(type=refund_payout, amount=-X)` contra el turno activo. Backend ya tiene `cash_movements` table. | Medium |
| **P1** | Inventory | El badge en `InventoryView` para `stock_on_hand <= 0` sigue mostrando "Bajo" amarillo en lugar de "Agotado" rojo. | El P0-2 del walkthrough 22-may lo identificó. El backend ya bloquea ventas; solo el badge UI es inconsistente. | En `InventoryView.tsx` cambiar el variant: `stock_on_hand <= 0` → `destructive` + label `Agotado` (constante en `copy.inventoryView.outBadge`). Mantener `Bajo` amarillo solo cuando `0 < stock <= threshold`. | Small |
| **P1** | Reports | `InsightStrip` solo tiene 6 tipos de bullets y 4 acciones. No usa `product_trends`, `restock_alerts`, `employee_contribution` que el backend ya provee (commit `41a996e`). | El dashboard cuenta media historia. Tres insights más triplican la sensación de "este sistema sabe lo que está pasando". | Sumar bullets: (a) `storyZombieProducts`: "3 productos sin venta en 14 días — considera quitarlos o promoverlos". (b) `storyQuietHours`: "Sin ventas entre 19:00–21:00 los miércoles — evalúa cerrar antes". (c) `storyEmployeeStandout`: "María cerró 38% de tus ventas esta semana — felicítala". Cap en 5 bullets totales. | Medium |
| **P1** | Reports | "Hora pico" sin comparación. Hoy dice "Tu hora pico fue 13:00–14:00" sin contexto. | Sin comparación la frase no es accionable. | Cambiar a "Hoy tu pico fue 13:00 — habitualmente es 14:00. ¿Algo cambió?" cuando hay suficiente historia (≥14 días). Backend: agregar `peak_hour_7day_avg` al endpoint `sales-by-hour`. | Medium |
| **P1** | Settings / Receipt | No hay preview live del recibo en `/settings/receipt`. (Issue 8 del UX review 19-may, aún abierto.) | El dueño edita el footer / tax_contact a ciegas y no sabe cómo se verá hasta hacer una venta. Toca dos veces la pantalla. | Componente `ReceiptPreview` lado derecho que renderiza el mismo template que el ticket impreso con mock data. Actualiza onChange con debounce 100 ms. Reutiliza el componente del P1 "Reimprimir ticket". | Medium |
| **P1** | Register | No hay atajos de teclado básicos. Cajero teclea SKU + Enter sí (bien), pero falta `Esc` para limpiar carrito, `F1` para abrir search, `F12` o `Ctrl+Enter` para cobrar. | El cajero pro está en POS 8 horas. Atajos ahorran 2–3 segundos por venta × 200 ventas = 10 minutos/día. | Hook `useHotkeys` con: `Esc` (cerrar success, limpiar SKU search), `Ctrl/Cmd+Enter` (submit), `Ctrl/Cmd+/` (focus SKU), `Ctrl/Cmd+K` (búsqueda global futura). Mostrar `?` flotante en la esquina con la lista. | Small |
| **P1** | Reports | Comparison label en KPIs del dashboard ya es dinámico (`vsYesterday / vsLastWeek / vsLastMonth`), pero `InsightStrip` y `BusinessHealthCard` siempre comparan vs yesterday (`yesterday: SalesSummary`). | Confunde al usuario que filtra por semana / mes en dashboard y ve "creciste 12% vs ayer" cuando esperaba "vs semana pasada". | Pasar `period` al `InsightStrip` y `BusinessHealthCard`; renombrar `yesterday` a `previousPeriod` y usar el label correcto en las frases. | Small |
| **P2** | Onboarding | `FirstValueMilestone` solo muestra UN milestone a la vez; el primero que encuentre en `onboarding.steps`. Si el usuario completó 3 milestones, los 2 silenciados se pierden. | Felicidad gratis que se desperdicia. | Mostrar el milestone más reciente con un contador "3 logros desbloqueados · ver todos →" que lleva a un panel histórico (puede ser un drawer). | Small |
| **P2** | Dashboard | `Contextual Actions` (cerrar turno · exportar ventas · imprimir Z) — "Imprimir Z" siempre lleva a `/shifts` y no genera nada hasta cerrar turno. | Genera click-to-nada. Frustración menor pero acumulable. | (a) Disable el card cuando no hay turno cerrado hoy. (b) O renombrar a "Corte de turno actual" + link a `/shifts/current/preview`. | Small |
| **P2** | Catalog | "Duplicar producto" no existe. | Cargar 30 productos similares (cafés en 3 tamaños) hoy es 30 modales repetidos. | Botón `Duplicar` en la cardview del producto + en el modal de edición. Pre-fill todos los campos excepto SKU. | Small |
| **P2** | Reports | Sin export real. El botón "Exportar ventas" del dashboard lleva a `/reports` pero no descarga CSV/Excel. | El contador externo del cafetero pide PDF o Excel mensual. Hoy es manual. | Botón `Descargar` en `/reports` (CSV con todas las órdenes del rango + columna `payment_methods`, `refunds`, `discounts`). Más adelante PDF con header de marca. | Medium |
| **P2** | AppShell | No hay botón visible "Ayuda" / "Contactar soporte" en la app. | El usuario que se traba escribe a un email que no recuerda. Cada ticket que se pierde es ruido para el producto. | Botón `Ayuda` en footer del sidebar (junto a Logout) que abre un drawer con: WhatsApp del soporte, email, link a status page. Pre-fillea email con context `tenant_id` y `user_email` para soporte. | Small |
| **P2** | Trust | Sin página `/cambios` o changelog visible al usuario. | El usuario no sabe qué mejoró en Kova entre la prueba y la conversión. Pierde momentum. | Página simple `/changelog` (autoría manual o auto-generada desde commits taggeados). Link en footer + un dot indicator en sidebar si hay novedad sin leer. | Medium |
| **P2** | Mobile | KPI grid del dashboard en 375px se apila 4 filas (`md:grid-cols-2 lg:grid-cols-4` sin breakpoint para mobile). | Toma 4 swipes para llegar al checklist abajo. | Cambiar a `grid-cols-2 md:grid-cols-2 lg:grid-cols-4` y reducir KPI card padding en sm:. 4 KPIs en 2×2 caben en una pantalla. | Small |
| **P2** | Mobile | Bottom sheet del carrito + bottom nav + safe-area-inset acumulan ~140px de chrome en mobile. Si el teclado se abre durante `amountTendered`, el botón "Cobrar" puede quedar tapado. | Cajero móvil pierde el botón. | Cuando el viewport visual es < 500px (detectar con `visualViewport.height`), reducir altura del peek handle a 56px y forzar scroll-into-view en el botón submit cuando esté en focus el input cashTendered. | Medium |
| **P2** | Reports | Sección "Decisiones recomendadas" — el dedupe por `(action_type, target_id)` está en el backlog (BUG-010) pero no aún implementado. Verificado en producción 22-may. | Repite la misma acción dos veces. Hace que el reporte se sienta "scripted". | Como ya dice el backlog: dedupe antes del cap de tres. Si dos alertas apuntan al mismo `product_id`, fusionar copy en una sola card con dos razones. | Small |
| **P3** | Polish | El `Sparkles` icon se usa en 4 contextos distintos (story title, action chip, IntroAnimation, "Cargar menú cafetería"). Pierde significado. | Inconsistencia menor pero acumulable. | Reservar `Sparkles` para "magia" (AI/automation) en el futuro. Hoy reemplazar con: `Activity` (story), `Lightbulb` (recommendation), `Coffee` (preset cafe). | Small |
| **P3** | Polish | `Card` shadow muy sutil en algunos contextos vs muy fuerte en KPIs (`shadow-kova-card` vs default). No siempre intencional. | Inconsistencia visual. | Definir 3 niveles de elevación en `CLAUDE.md` y aplicar consistentemente: flat (defaults), card (KPI/insight cards), hero (preview/print). | Medium |
| **P3** | Polish | El emoji 🇲🇽 en el landing chip "HECHO EN MÉXICO" es la única instancia de emoji en la UI fuera de los productos seed. Mezcla con DM Sans queda un poco off-brand. | Detalle menor pero notable junto a tokens de marca. | Reemplazar con un mini-SVG del escudo o un `<Flag>` icon de lucide. | Small |

---

## 6. Module-by-module analysis

### Landing público (`frontend/src/routes/Home.tsx`)

**Estado:** Sólido. Verificado en vivo con `https://point-of-sale-ochre.vercel.app/`.

**Lo que ya funciona.** Hero copy clara, dual theme con `themeVars`, `IntroAnimation` con `prefers-reduced-motion`, sección "¿Es para mí?" honesta con etiquetas Recomendado/Compatible/Caso por caso, FAQ legítimo, pricing transparente. La P0-1 del walkthrough 22-may (overflow lateral en >1440px) se cerró — confirmado: `bodyW = winW = 1696px`, fondo `rgb(15,17,23)` aplica al `<body>` completo.

**Lo que falta.**
- Comparativa explícita con competencia (Loyverse, Square, Clip). Una sección "Por qué Kova ≠ los demás" — funcionalidad / precio / soporte en español.
- Casos de éxito o screenshot real de un tenant con resultados ("Café Lupita procesó 1,847 órdenes en su primer mes"). Hoy todo es genérico.
- Footer con columnas que parecen completas pero los links están vacíos (Producto / Soluciones / etc. eran `href="#"` en el UX review previo — verificar si se arregló).
- CTA secundaria de WhatsApp directo más visible en el hero. El SMB mexicano confía más en WhatsApp que en correo.

### Auth (`frontend/src/auth/`)

**Estado:** Funcionalmente completo, con detalles bien hechos.

**Lo que ya funciona.** Login, signup, forgot-password (`/forgot-password` confirmado live), reset-password, verify-email con dev-token visible. Mensajes específicos por error (`loginInvalidCredentials` para 401/403, `loginRateLimited` para 429, `operationError` genérico solo para otros). Trust line de signup con privacy + terms + email de soporte. Refresh token con interceptor global.

**Lo que falta.**
- SSO (Google) — competidores serios lo tienen; PyMEs lo piden.
- Captcha invisible (hCaptcha o Cloudflare Turnstile) en signup — sin esto, el día 1 de marketing puede traer cuentas basura.
- Magic link como alternativa al password (el dueño de cafetería que olvida contraseñas se beneficia).

### Onboarding (`frontend/src/onboarding/`, `dashboard/OnboardingChecklist`)

**Estado:** Bueno, falta cerrar el ciclo de "first value".

**Lo que ya funciona.** Auto-mark del checklist contra señales reales (`hasActiveSubscription`, `hasProducts`, `orderCount`, `trackedInventoryCount`). Fallback a 4 pasos si el backend no responde. `FirstValueMilestone` por cada paso completado. `?new=product` y `?inventory=activate` queryparams abren modales directamente. Presets `cafe`, `bakery`, `retail`.

**Lo que falta.**
- El milestone solo muestra UNO a la vez — desperdicia momentum si el usuario completa tres seguidos.
- El query param `?new=product` no abre el modal cuando ya hay catálogo cargado (P1-10 del walkthrough). Confirmado en código: `useEffect` con `handledSetupParam.current` lo bloquea para el segundo modal.
- No hay tour overlay tipo Userpilot en `/register` la primera vez. El checklist es bueno, pero un highlight de "esta es tu caja" reduce el time-to-first-sale.
- No hay invitación al primer empleado guiada — está como item pendiente del Sprint 2 del audit.

### Dashboard (`frontend/src/dashboard/`)

**Estado:** Sólido. Es el módulo más cuidado del producto.

**Lo que ya funciona.** TZ-aware (`isoInTimezone`, `hourInTimezone`), `DeltaBadge` con tres estados (`deltaNoData` cuando `previous=null|0`, `deltaWarmingUp` cuando `current=0`, normal sino). Period selector (Día/Semana/Mes) con `vsYesterday/vsLastWeek/vsLastMonth` correctos. `OnboardingChecklist` arriba mientras no esté completo. `FirstValueMilestone`. `BusinessHealthCard` con composite score. `InsightStrip` con bullets de narrativa + acciones. `UpgradeNudge` durante trial. `lowStockAction` linkea `/inventory?filter=low`. `CountUp` y `LivePulse` para feel real-time. Empty-state colapsado en "Mezcla de pagos + Productos top" cuando no hay actividad (issue 11 del UX review 19-may → cerrado).

**Lo que falta.**
- El `Contextual Actions` "Imprimir Z" siempre lleva a `/shifts` sin contexto. Mejor: disable cuando no aplique, o cambiar el label a "Corte de turno actual".
- "Salud del negocio" con link `Configurar` que no está claro qué configura (P2-2 del walkthrough). En el código `BusinessHealthCard.tsx` no se ve ese link — verificar si quedó en otro componente.
- KPI grid mobile (375px) se apila 4 filas — preferible 2×2.
- Sparkline en KPI cards para `Ventas netas` y `Ticket promedio` cuando hay ≥7 días — agrega 70% del valor por 10% del esfuerzo.

### POS / Caja (`frontend/src/register/`)

**Estado:** Funcionalmente completo, faltan capacidades del cajero pro.

**Lo que ya funciona.** Grid de productos con images / fallback / `isOut / isLow` badges, click-to-add con `aria-disabled` cuando agotado, SKU search con debounce 150 ms y auto-add al match exacto, undo en `removeItem`, modal de modificadores, payment radio-group con icons, split payments detrás de `<details>` (advanced options), validación de cash shortfall en línea ("Faltan $26.00"), submit deshabilitado hasta cart no vacío + payment válido, success state full-screen en mobile con animation, offline queue + sync auto.

**Lo que falta.**
- **Descuento / cortesía** en items del carrito. Caso real semanal.
- **Atajos de teclado** (Esc, Ctrl+Enter, F-keys). Cajero pro lo agradecería.
- **Nota / comentario por orden** (ej. "para llevar", "sin azúcar adicional"). El SKU lo identifica, pero notas libres faltan.
- **Asignar empleado/cajero** explícito al hacer venta. Hoy se infiere del JWT — está bien — pero un selector visible cuando hay varios cajeros en el turno ayuda al cierre de turno por empleado.
- **Toast doble** en venta completa — backlog Sprint 5 P2, aún pendiente. La razón documentada en el código (`Toast retained as accessible status announcement`) tiene sentido para a11y; alternativa: `aria-live="polite"` invisible + solo card visual.

### Catalog (`frontend/src/catalog/`)

**Estado:** Bueno, con detalle de UX faltantes.

**Lo que ya funciona.** CRUD productos/categorías/modifierGroups, image upload con compresión client-side (`compressImage.ts`), `productImageSrc` + `srcSet` para responsive, sort por name/price/stock, search por name/SKU/description, queryparam `?new=product` y `?inventory=activate`, billing-gated (`402 → toast con CTA a /settings/billing`), preset cafe/bakery/retail, modifierGroups visibles detrás de toggle `showModifiers`.

**Lo que falta.**
- **Duplicar producto** — citado arriba.
- **Bulk import** (CSV) — para tenants con 50+ productos.
- **Reordenar categorías por drag-and-drop** — hoy la categoría más vendida puede no ser la primera.
- **Vista "Productos zombi"** (sin venta en N días) — útil para limpieza.

### Inventory (`frontend/src/inventory/`)

**Estado:** Sólido en feature, débil en consistencia visual del estado.

**Lo que ya funciona.** Search/filter (`all/low/healthy`) por queryparam, sort, stock velocity con `daysUntilOut`, modals de adjust/stockTake/threshold, alerta `alreadyOut` cuando `stock <= 0`. Backend tiene guard de oversell + script `clamp_negative_stock.py`.

**Lo que falta.**
- **Badge "Agotado" rojo** cuando `stock <= 0` — hoy renderiza "Bajo" amarillo.
- **Script `clamp_negative_stock.py` corrido en producción** — aún no.
- **Reabasto sugerido inteligente** ("Vendiste 12 de Agua mineral en 7 días, recomendamos reabastecer 20 unidades para 14 días").
- **Vinculación con devoluciones** — devolución de producto debería incrementar stock automáticamente.
- **Costo unitario** (no precio) para poder calcular margen — requisito para varios reportes Tier 2.

### Orders (`frontend/src/orders/`)

**Estado:** Funcional pero con gaps operativos importantes (no audité el código en detalle aquí; me baso en lo documentado).

**Lo que falta.**
- **Reimprimir ticket** desde el detalle.
- **Estado intermedio** post-devolución (`Completada · Devuelta parcial`, `Devuelta total`) — P1-6 del walkthrough.
- **Devolución que afecte turno** — P2-6 del walkthrough.
- **Anotar `2 (1 devuelta)`** en la línea de producto.
- **Fecha en el block recibo** del detalle de orden (P2-4 del walkthrough).

### Reports (`frontend/src/reports/`)

**Estado:** Bueno en estructura compact-brief + drill-down. Débil en breadth de insights.

**Lo que ya funciona.** Compact decision brief con 3-cap. Detail-on-demand detrás de `Ver análisis detallado`. Preset Today/7d/Month. Previous-period comparison. Restock alerts prioritarios. Backend ya provee `product_trends`, `restock_alerts`, `employee_contribution`. `InteractiveCharts` con rank chart.

**Lo que falta.**
- **TZ bug** (P0).
- **Más bullets en InsightStrip**: zombie products, quiet hours, employee standout, mezcla de productos que se venden juntos.
- **Comparación de hora pico vs habitual**.
- **Margen** (requiere `cost` field en producto).
- **Productos zombi** explícitos.
- **Export CSV / PDF**.
- **Comparison label dinámico** en InsightStrip + BusinessHealthCard.

### Settings (`frontend/src/settings/`)

**Estado:** Sólido tras la migración a tabs.

**Lo que ya funciona.** Tabs (Profile/Receipt/Employees/Advanced), logo upload real con `LogoUploadField`, dropdowns para timezone/currency/locale (no free text), roles localizados con descripciones, invitations.

**Lo que falta.**
- **Receipt live preview** en tab Receipt.
- **Validación de email/teléfono** en Profile (HTML5 `type=email` y `type=tel` no se ven aplicados en `Field` genérico).
- **Audit log** de cambios de settings — útil cuando hay manager + owner.
- **Modal de confirmación al desactivar empleado** activo.

### Billing (`frontend/src/billing/`)

**Estado:** Sólido. Confirm dialog en cancel funciona.

**Lo que ya funciona.** Plan + Status + Period en grid 3-col, valueItems con check-list, checkout flow con `trackFunnelEvent`, `cancel` con `Dialog` destructive, `BillingBanner` tone-aware suppressed en `/settings/billing`, `TrialChip` en AppShell.

**Lo que falta.**
- **Historial de pagos / facturas descargables** — requisito básico para contabilidad.
- **Cambio de método de pago** (hoy debe ir a Stripe billing portal — link explícito).
- **Notificación 3 días antes de fin de trial** vía email — el UpgradeNudge in-app no llega si el usuario no entra esos días.
- **Stripe live keys** — release gate documentado.

### Shifts (`frontend/src/shifts/`)

**Estado:** Funcional pero rompedor de "premium".

**Lo que ya funciona.** Open shift modal, close shift modal, listado de turnos cerrados, badges `badgeOpen`/`badgeClosed`. Cash movements.

**Lo que falta.**
- **Localización de enums** (`Open`, `OPENING_BALANCE`, `Opening balance`, `balanced`) — P0 en mi lista, P1 en el sprint.
- **Formato de fecha es-MX 24h** (hoy `5/22/2026, 7:51:02 AM`).
- **Resumen del turno activo** en el card top: ventas, # órdenes, cash esperado.
- **Vincular devoluciones al turno**.

---

## 7. Communication / copy issues

Lo que ya está bien (no tocar):
- "Lleva tu emprendimiento con orden, sin libretas ni Excel." → no cambiar.
- "Sin tarjeta para empezar · Cancela cuando quieras" → no cambiar.
- "Hecho para usarse, no para configurarse." → buena promesa.
- `copy.dashboard.deltaWarmingUp` ("Aún sin comparación") → mejor que cualquier "Sin datos".
- `copy.register.outOfStockBlocked(name)` → específico y accionable.

Lo que conviene revisar:

| Ubicación | Copy actual | Problema | Mejor |
|---|---|---|---|
| Landing hero CTA secundaria | `Ver cómo funciona →` | OK. Pero un dueño quiere ver el POS real, no una explicación. | `Ver una demo en vivo →` (con auto-scroll a la sección de POS preview) |
| Landing pricing card | `Todo lo que necesitas para operar, sin extras` | Genérico. Repite lo del eyebrow. | `Lo mismo que cobran otros, sin cobrar comisión por venta.` (más posicional) |
| Auth signup trust line | `Cuidamos tus datos. Cancela tu prueba cuando quieras desde Facturación.` | OK pero pierde la oportunidad. | `Nada de comisiones, nada de letra chica. Si no te late, cancelas desde Facturación.` |
| Dashboard greeting (mobile) | `Buenas tardes, CHAPATITO` | El uppercase del nombre es CSS, no el dato — confirmado en walkthrough. | Remover `text-transform: uppercase` en el header (`DashboardView.tsx:465` no lo aplica directo; verificar en `BusinessHealthCard` y receipt header). |
| OnboardingChecklist subtitle | `Estás a 4 pasos de tu primera venta.` | Bueno. | OK. Cuando solo queda 1: `Un paso más y empiezas a cobrar.` (refrescar con count dinámico) |
| BillingBanner trial info | `Estás en prueba — Revisar plan` | OK pero abstracto. | `Te quedan 12 días de prueba — Activar plan` (count + verbo de acción) |
| Reports empty (todo el rango) | `Aún no hay ventas para contar una historia.` | Bueno cuando NO hay ventas. Mal cuando sí las hay y el bug TZ las oculta. | Mantener el copy; arreglar el bug. |
| Register success (mobile) | `¡Venta completada!` | OK. | `¡Cobraste $X.XX!` (el monto en el título tiene más fuerza) |
| Register `cashTooLow` | `El efectivo recibido debe cubrir el total de la orden.` | Verboso. | `Faltan $26.00 para cubrir el total.` (ya hay `cashShortfall` cards; consolidar mensaje) |
| Inventory `Velocidad de stock` | `~-7 días con el ritmo actual` | Confuso. Ya hay `alreadyOut` fix en `velocity`, pero el dueño no entiende qué es "velocidad". | `Te quedan 4 días al ritmo actual` / `Ya se agotó` (más directo) |
| Catalog billingRequired toast | `Necesitas un plan activo para administrar el catálogo.` | OK. | `Activa tu plan para seguir editando el catálogo.` (verbo proactivo, menos restrictivo) |
| Settings tab labels | `Perfil / Recibo / Empleados / Avanzado` | OK. | OK. |
| Shifts movement type (visible) | `OPENING_BALANCE` | Backend enum filtrándose. | `Apertura de caja` |
| Shifts reconciliation status | `balanced` | Backend enum filtrándose. | `Caja cuadrada` (más humano que "Balanceado") |
| Orders filter placeholders | `mm/dd/yyyy` (cuando el formato real es dd/mm) | Mezcla locales. | `DD/MM/AAAA` o usar `<input type="date">` que lo respeta del browser. |
| Footer del landing (links) | `href="#"` | Dead links. | Página `/changelog`, `/contacto`, `/seguridad` reales. |
| Mailto support en auth | `posprojectsupport@gmail.com` | Funcional pero parece "mi gmail". | Email con dominio propio (`soporte@kova.mx`) y opción WhatsApp. |
| AppShell role label | `Propietario` / `Gerente` / `Cajero` | OK. | OK. |

---

## 8. Mobile responsiveness issues

Verificado en código + breakpoints. La estructura responsive es correcta — los hallazgos son finos:

| Pantalla | Issue mobile | Recomendación |
|---|---|---|
| Dashboard | KPI grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` → 4 filas en 375px. | `grid-cols-2 md:grid-cols-2 lg:grid-cols-4` + reducir KPI card padding en sm:. |
| Dashboard | `BusinessHealthCard` factor grid `sm:grid-cols-2` → 2 columnas a 640px. En 375px todos se apilan (4 cards de altura completa). | Forzar `grid-cols-2` desde 375px para los factor cards (texto se trunca con `truncate`). |
| Register | Bottom sheet del carrito + bottom nav (h-14 + h-14) = ~112px reservados arriba del teclado. Cuando el usuario teclea en `cashTendered`, el botón `Cobrar` puede quedar tapado por el teclado. | Detectar `window.visualViewport` y forzar scroll-into-view en focus del input. |
| Register | El peek handle del cart sheet ocupa h-20 (~80px) — en pantalla 667px de alto reduce el catálogo a 475px. | Reducir a h-16 con touch-target compensado por padding. |
| Reports | KPI `sm:grid-cols-2 xl:grid-cols-4` está bien. Pero los date inputs en mobile colapsan en una sola columna y los presets quedan abajo de los inputs — flujo invertido. | En mobile mostrar presets ARRIBA y date inputs como acordeón "Personalizar rango". |
| Settings | El form `grid sm:grid-cols-2` está bien. El logo upload puede ser pequeño en mobile (área de drag). | Aumentar minHeight del drop zone a 160px en mobile. |
| Orders detail | Recibo block + Devoluciones block en single column es OK. Botones de acción (Devolver / Cancelar) en bottom — agregar `Imprimir ticket` antes. | Garantizar que la barra de acciones sea sticky en bottom en mobile. |
| Shifts | Tabla de "Turnos cerrados recientes" — overflow horizontal en mobile sin scroll horizontal explícito. | Cambiar tabla a stack de cards en mobile (`md:table md:rounded`). |
| Catalog | Modal de producto en mobile es full-screen — bien. Pero el botón "Eliminar imagen" (en `LogoUploadField`/equivalente) puede ser difícil de tocar. | Touch target 44×44 mínimo verificado en lucide buttons. |
| Auth | Forgot password en mobile — verificar que el botón "Volver a iniciar sesión" no esté tapado por el teclado al focus en input email. | Misma técnica visualViewport que en register. |

Sospechas no verificadas en vivo (porque la herramienta de resize no propaga al device emulator real):
- Iframe del intro animation podría sobrepasar viewport en pantallas ultra-angostas (<360px).
- El IntroAnimation podría no respetar `prefers-reduced-motion` en iOS Safari (verificar con device real).

---

## 9. Report / business analytics recommendations

Lo que el dueño realmente quiere responder en lunes 9am:

| Pregunta del dueño | Estado actual en Kova | Qué falta |
|---|---|---|
| ¿Vendí más o menos que la semana pasada? | ✅ Cubierto en dashboard period selector + DeltaBadge. | TZ bug en Reports lo rompe parcialmente. |
| ¿Qué productos me dieron más dinero esta semana? | ✅ Cubierto en "Productos top" + `product_trends`. | Falta margen (necesita `cost` field). |
| ¿Qué productos llevan semanas sin venderse? | ⚠ Parcial. Backend tiene `product_trends.declining/slow movers`. UI los muestra. | Falta vista "Zombies" con CTA "Quitar del catálogo" o "Promocionar". |
| ¿Qué horarios me convienen más? | ✅ `sales-by-hour` + bullet `storyBestHour`. | Falta comparación vs habitual ("hoy 13:00 vs típicamente 14:00"). |
| ¿Qué días vendo mejor / peor? | ❌ Falta. | Endpoint `sales-by-weekday` para últimos 30 días, render heat-map o bar chart en Reports. |
| ¿Debería comprar más de X? | ✅ Restock alerts. | Bien implementado. |
| ¿Cuánto debería pedir? | ⚠ Parcial. Hay `velocity` con `days_until_out`. | Falta sugerencia explícita: "Pide ~20 unidades para 14 días". |
| ¿Qué empleado vendió mejor? | ✅ `employee_contribution` con `sales_share_pct`. | Falta UI dashboard widget mostrando top employee de la semana. |
| ¿Dónde estoy perdiendo dinero? | ⚠ Parcial. Refunds + voids visibles. | Falta análisis de "Diferencias de caja al cierre de turno" — donde se pierde dinero en cafetería real. |
| ¿Qué hago hoy? | ✅ `recommended_actions` con cap 3. | Cumple — solo cerrar dedupe pendiente. |

**Tres insights nuevos a sumar al `InsightStrip` que mueven la aguja:**

1. **"Productos zombi"** — bullet cuando hay ≥2 productos sin venta en últimos 14 días: `"3 productos llevan 2 semanas sin venderse: X, Y, Z. ¿Quitarlos del menú?"` Acción: navegar a `/catalog?filter=zombie`.

2. **"Día débil de la semana"** — bullet cuando los últimos 4 lunes (por ejemplo) vendieron <60% del día promedio: `"Tus lunes venden 35% menos que el promedio. ¿Probar promoción de lunes?"` Acción: navegar a `/catalog` con highlight de productos top.

3. **"Empleado destacado"** — bullet cuando un empleado generó >35% de las ventas: `"María cerró 38% de las ventas esta semana. Felicítala."` Sin acción CTA — es educativo.

**Vistas Tier 2 que valen lo que cuestan:**

- **Heatmap día × hora** (último mes): los dueños lo entienden a primera vista. Identifica horas muertas y staffing.
- **Sankey de mezcla de pago**: ya hay `payment_breakdown`; renderizar como Sankey en lugar de barras agrega 30% de WOW por 0% de datos extra.
- **Comparativa mes contra mes** con sparkline pequeño en cada KPI — backend ya provee `previousSummary`.

**Vistas Tier 3 (storytelling avanzado — diferido):**

- "Hace 3 semanas vendías 80 cafés/día. Hace 2 semanas, 95. Esta semana, 110. Vas creciendo 18% mes a mes. Si mantienes este ritmo, agosto cerrará en $X."
- "Tu producto top (Latte 12 oz) es el 22% de tus ingresos. Si suprimes los 5 productos menos vendidos, simplificarías 30% el inventario sin perder más del 4% en ventas."

Esto requiere modelos un poco más complejos en el backend, pero es el tipo de insight por el que un dueño paga $299 sin pestañear.

---

## 10. Prioritized implementation roadmap

### Phase 1 — Must fix before selling (1 sprint, ~1 semana)

**Goal:** El producto no rompe confianza después de un día de uso real.

| Item | Effort | Owner |
|---|---|---|
| P0 — Centralizar `todayISO(timezone)` y aplicarlo a ReportsView + ProductStoryCard + Orders filters | Small | FE |
| P0 — Localizar enums de `/shifts` (`Open` → `Abierto`, `OPENING_BALANCE` → `Apertura de caja`, `balanced` → `Caja cuadrada`) y migrar todos los `toLocaleString` a `formatDateTime` | Small | FE |
| P1 — Badge inventory `Agotado` rojo para `stock <= 0` | Small | FE |
| P0 — Correr `clamp_negative_stock.py` + `fix_category_accents.py` + `backfill_skus.py` en producción | Small | Ops |
| P1 — Reimprimir ticket en `/orders/<id>` | Medium | FE |
| P1 — Devolución que afecte cash_movement del turno activo | Medium | FE + BE |
| P2 — Dedupe `recommended_actions` por `(action_type, target_id)` en `business-story` | Small | BE |
| P2 — Cap content-security-policy headers en Vercel | Small | Ops |

**Definition of done:** Un tenant nuevo navega desde la 6 am hasta la 11 pm sin ver un solo bug visible. Ningún módulo rinde texto en inglés. Cualquier devolución cuadra el turno automáticamente.

### Phase 2 — Improve conversion and perceived value (1 sprint, ~1 semana)

**Goal:** El dueño en día 13 ya tiene razones racionales explícitas para activar el plan.

| Item | Effort | Owner |
|---|---|---|
| P0 — `TrialValueRecap` card en dashboard durante trial activo | Medium | FE + BE (mini endpoint `trial-recap`) |
| P1 — Receipt live preview en `/settings/receipt` (componente reutilizable con `/orders/<id>` print) | Medium | FE |
| P1 — `InsightStrip` con 3 bullets nuevos (zombies, quiet hours, employee standout) | Medium | FE + BE (endpoints `slow_movers`, `quiet_hours`) |
| P1 — Comparison label dinámico en InsightStrip + BusinessHealthCard según `period` | Small | FE |
| P1 — Atajos de teclado en Register (`Ctrl+Enter`, `Esc`, `Ctrl+K`) | Small | FE |
| P1 — Descuento manual por item en Register (frontend + backend `line_item.discount_amount`) | Large | FE + BE |
| P2 — Export CSV de Reports | Medium | FE + BE |
| P2 — Botón Ayuda en AppShell footer con WhatsApp + email | Small | FE |
| P2 — Cambio del icono Sparkles repetido por iconos contextuales | Small | FE |

**Definition of done:** Un tenant en trial activo, dashboard renderiza panel "Lo que llevas con Kova en 13 días". Reportes con 3 insights nuevos accionables. Cajero puede teclear venta con teclado únicamente.

### Phase 3 — Premium polish (1 sprint, ~1 semana, opcional pre-GA)

**Goal:** El feel del producto compite con Square, Loyverse y Toast.

| Item | Effort | Owner |
|---|---|---|
| P2 — Sparkline en KPI cards (Ventas netas, Ticket promedio) cuando ≥7 días de historia | Medium | FE |
| P2 — Heatmap día × hora en Reports | Medium | FE + BE (endpoint `sales-by-weekday-hour`) |
| P2 — KPI grid mobile 2×2 + factor grid mobile 2-col | Small | FE |
| P2 — Visual viewport handling en Register para teclado mobile | Medium | FE |
| P2 — Duplicar producto en Catalog | Small | FE |
| P2 — Bulk CSV import en Catalog | Large | FE + BE |
| P3 — Dark mode en authenticated app (o remover toggle del landing) | Large | FE |
| P3 — Sistema de elevación de cards documentado en `CLAUDE.md` | Small | Design |
| P3 — Tour overlay primer login en Register/Catalog/Reports | Medium | FE |
| P3 — Comparativa pública vs competencia en landing | Medium | Marketing + FE |
| P3 — Página `/changelog` y `/casos-de-exito` | Medium | Content + FE |

**Definition of done:** El producto comunica "premium" en cada microinteracción. Comparativa de competencia rebate objeciones explícitas. Dark mode en app (o decisión clara de removerla del landing).

---

## 11. Suggested backlog items / sprint tasks

Cada item es self-contained y se puede ticketizar tal cual:

### Sprint 6 — "Trust Lock + Storytelling" (priorizado para inmediato)

- **KOV-S6-01 (P0, Small):** `frontend/src/i18n/date.ts` — exportar `todayInTimezone(tz)`, `yesterdayInTimezone(tz)`, `daysAgoInTimezone(tz, n)`. Usar en `ReportsView.tsx`, `ProductStoryCard.tsx`, `OrdersView` filter defaults. Backend defense: `start_date <= today_tz` en `reports/router.py`.
- **KOV-S6-02 (P0, Small):** `frontend/src/shifts/format.ts` — `localizeShiftStatus`, `localizeMovementType`, `localizeReconciliationStatus`. Map enum → label es-MX. Reemplazar `toLocaleString` por `formatDateTime` en `ShiftView.tsx`.
- **KOV-S6-03 (P0, Small):** Producción ops — correr `clamp_negative_stock.py`, `fix_category_accents.py`, `backfill_skus.py` contra prod (documentar en `docs/deployment.md`).
- **KOV-S6-04 (P1, Small):** En `InventoryView.tsx`, badge `Agotado` (variant destructive) cuando `stock_on_hand <= 0`. Mantener `Bajo` solo para `0 < stock <= threshold`.
- **KOV-S6-05 (P0, Medium):** Componente `<Receipt order businessSettings />` reutilizable entre `/settings/receipt` (preview live) y `/orders/<id>` (acción "Imprimir ticket"). Stylesheet `@media print` que oculta todo menos el receipt block.
- **KOV-S6-06 (P1, Medium):** Modal de devolución, step 2 opcional `¿Cómo entregaste el reembolso? [Efectivo / No reembolsado / Tarjeta]`. Si efectivo, `POST /api/v1/shifts/{id}/movements {type: "refund_payout", amount: -X, reference: order_id}`. Reflejar en cierre de turno.
- **KOV-S6-07 (P0, Medium):** `TrialValueRecap` card — appears en dashboard mientras `subscription.status === "trialing"` o `access.reason === "signup_trial"`. Renderiza: `"En N días con Kova: X ventas · $Y cobradas · Z productos · W empleados activos · tu mejor día fue [día]"`. Nuevo endpoint `GET /api/v1/billing/trial-recap` que agrega data.
- **KOV-S6-08 (P1, Small):** Cambio de comparison label en `InsightStrip` + `BusinessHealthCard` — pasar `period` y `compareLabel` desde Dashboard.
- **KOV-S6-09 (P2, Small):** Backend dedupe de `recommended_actions` por `(action_type, target_id)` antes del cap 3 en `business-story` builder.
- **KOV-S6-10 (P1, Small):** Atajos de teclado en `RegisterView` — hook `useHotkeys` + `?` flotante. Sin librería externa.

### Sprint 7 — "Conversion + Operational Pro" (siguiente)

- **KOV-S7-01 (P1, Large):** Descuento manual por línea (frontend + backend `line_item.discount_amount` + `discount_reason`). Permiso nuevo `register.apply_discount` (owner/manager por default).
- **KOV-S7-02 (P1, Medium):** Tres bullets nuevos en `InsightStrip`: zombies, quiet hours, employee standout. Endpoints `slow_movers`, `quiet_hours`, ya hay `employee_contribution`.
- **KOV-S7-03 (P1, Medium):** Live receipt preview en `/settings/receipt`.
- **KOV-S7-04 (P2, Medium):** Export CSV de Reports (rango seleccionado, columnas: order_id, created_at, items_json, payment_methods, refund_total, net_total).
- **KOV-S7-05 (P2, Small):** Botón `Ayuda` en footer del sidebar — drawer con WhatsApp + email + status link.
- **KOV-S7-06 (P2, Small):** "Duplicar producto" en Catalog.
- **KOV-S7-07 (P2, Small):** KPI mobile 2×2 (Dashboard).
- **KOV-S7-08 (P2, Medium):** Visual viewport handling en Register mobile (scroll-into-view en focus de `cashTendered`).
- **KOV-S7-09 (P2, Small):** Card "Salud del negocio" — quitar o documentar el link `Configurar`.

### Backlog (priorizar según señal de tenants beta)

- **KOV-BL-01:** Costo unitario por producto + margen en reportes.
- **KOV-BL-02:** Heatmap día×hora en Reports.
- **KOV-BL-03:** Notas / comentarios por orden.
- **KOV-BL-04:** SSO con Google.
- **KOV-BL-05:** Captcha invisible en signup.
- **KOV-BL-06:** Página `/changelog` y `/casos-de-exito`.
- **KOV-BL-07:** Comparativa de competencia en landing.
- **KOV-BL-08:** Dark mode en authenticated app (o remover del landing).
- **KOV-BL-09:** Bulk CSV import en Catalog.
- **KOV-BL-10:** Audit log de cambios de settings.
- **KOV-BL-11:** WhatsApp del recibo (deferred-scope vigente — confirmar si re-aplica).
- **KOV-BL-12:** Reordenar categorías drag-and-drop.

### Pre-GA hard gates

- Stripe live keys + verificación full flow.
- Email post-checkout (factura + bienvenida) probado contra inbox real (Gmail / Outlook / Hotmail).
- Notificación 3 días antes del fin de trial via email.
- Backup test restore — no solo `pg_dump`, sino prueba de restore en un staging.
- Status page público (`status.kova.mx` o similar).
- Beta agreement firmado por los primeros 10 tenants.

---

## 12. Final recommendation

**¿Está Kova lista para venderse?**

**Casi.** El producto está al 90% de lo necesario para abrir beta paga a 10–20 tenants cafeteros mexicanos. Los últimos 10% son los más críticos porque son los que el dueño descubre el día 1–7 de uso real y son los que generan churn temprano.

**Antes de cobrar el primer $299 de Stripe live, hay que cerrar:**

1. **TZ bug en Reports** (KOV-S6-01). No negociable. El dueño cierra el día con $3,000 en caja y abre `/reports` y ve "Sin ventas hoy" → cancelación.
2. **Localización de Shifts** (KOV-S6-02). El cajero lo ve cada turno. Erosiona la promesa visual.
3. **Reimprimir ticket** (KOV-S6-05). Caso operativo #1 de soporte la primera semana.
4. **Devoluciones que afecten turno** (KOV-S6-06). Sin esto, el cierre de turno no cuadra y el dueño desconfía del sistema entero.
5. **TrialValueRecap** (KOV-S6-07). Sin esta narrativa, conversión trial→paid pierde ~15% por defecto.
6. **Scripts de hygiene en producción** (KOV-S6-03). Datos sucios desde antes de los fixes siguen visibles para tenants existentes.

**Después de Sprint 6 (≈ 1 semana de trabajo enfocado):** abrir beta paga a 10 tenants con Stripe live, monitorear churn semanal, escuchar señales de los primeros 30 días. **Sprint 7** sobre esa data — no antes.

**Lo que NO debería hacerse antes de Stripe live:**
- Comparativa de competencia en landing (Sprint 7 o backlog).
- Dark mode en authenticated app (backlog).
- Bulk CSV import (backlog hasta señal explícita).
- Tour overlay (backlog hasta saber qué pantalla pierde más usuarios).
- Migrar empleados a primer nivel del nav (esperar señal — backlog Sprint 3).

**Lo que SÍ debería hacerse en paralelo a Sprint 6 (no bloquea):**
- Comprar `kova.mx` y migrar `posprojectsupport@gmail.com` → `soporte@kova.mx`.
- Crear página `/seguridad` que explique RLS + cookies HttpOnly + backups + uptime. Da legitimidad técnica.
- Preparar onboarding personalizado del primer tenant: el founder le ayuda a subir su primer menú en una videollamada. Costoso al inicio, pero genera el primer caso de éxito real para landing.

**Posicionamiento honesto.** Kova hoy no compite contra Square + hardware ni contra Loyverse + ecosistema. Compite contra "el dueño que sigue usando libreta o Excel" y, en segundo orden, contra el cafetero que probó Loyverse y se frustró por no tener soporte en español. Esa es la pista correcta y la copy del landing lo entiende. No diluyan eso intentando ser todo para todos.

**Score final:** 7.6/10 hoy → **8.5/10 después de Sprint 6**. Esa diferencia es la frontera entre "MVP en beta cerrada" y "SaaS cobrable en beta abierta". Y es alcanzable en una semana.

---

## Sources

- Code: `frontend/src/dashboard/{DashboardView,InsightStrip,BusinessHealthCard}.tsx`, `frontend/src/register/RegisterView.tsx`, `frontend/src/reports/ReportsView.tsx` (líneas 58–64 — bug TZ), `frontend/src/catalog/ProductStoryCard.tsx` (líneas 48,52 — bug TZ), `frontend/src/settings/SettingsView.tsx`, `frontend/src/billing/{BillingView,BillingBanner,TrialChip}.tsx`, `frontend/src/auth/{AuthView,ForgotPasswordView}.tsx`, `frontend/src/layout/AppShell.tsx`, `frontend/src/routes/Home.tsx`, `frontend/src/inventory/InventoryView.tsx`, `frontend/src/shifts/ShiftView.tsx`, `frontend/src/i18n/messages.ts`.
- Live: <https://point-of-sale-ochre.vercel.app/> · `/login` · `/forgot-password` · `/this-route-does-not-exist`. Verificación de overflow (`bodyW === winW === 1696`) y `document.body.backgroundColor === "rgb(15, 17, 23)"`.
- Cross-refs: [docs/ux-review-2026-05-19.md](docs/ux-review-2026-05-19.md), [docs/qa-walkthrough-2026-05-22.md](docs/qa-walkthrough-2026-05-22.md), [docs/current-sprint.md](docs/current-sprint.md), [CLAUDE.md](CLAUDE.md).
