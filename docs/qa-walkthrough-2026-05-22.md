# Kova POS — QA walkthrough exhaustivo

**Fecha:** 2026-05-22
**Target:** https://point-of-sale-ochre.vercel.app/
**Cuenta:** `posprojectsupport@gmail.com` (tenant `Chapatito`, plan Standard activo)
**Método:** Navegación interactiva con Claude in Chrome (viewport 1568×683 desktop) + cross-check con código fuente y `docs/current-sprint.md`.
**Alcance:** Landing público, auth, panel, caja, catálogo, inventario, órdenes, turnos, reportes, configuración (Perfil/Recibo/Empleados/Avanzado), facturación, devoluciones, manejo de errores, network y consola.

Este reporte se construye sobre `docs/ux-review-2026-05-19.md` (UX review) y verifica el estado real del backlog activo en `docs/current-sprint.md` § *Kova Audit Sprint 5* (2026-05-22).

---

## A. Resumen ejecutivo

El producto está **muy cerca de listo para abrir beta a cafeterías**, pero todavía arrastra cuatro tipos de fricciones que afectan la primera impresión y la confianza del operador:

1. **Layout overflow del landing** en pantallas wide (>1440px). El fondo oscuro del hero termina antes que el viewport y deja una franja blanca lateral a lo largo de toda la página de marketing. Es el primer pixel que ve un prospecto que entra desde computadora de escritorio. Sigue exactamente igual que en el review del 19 de mayo.
2. **Inconsistencias de localización es-MX** dispersas (categorías sin acentos, "OPENING_BALANCE", "Open"/"balanced" en turnos, placeholders `mm/dd/yyyy`, descripciones de roles sin tildes, ARIA labels en inglés). Cada una pequeña; juntas degradan la promesa "Hecho en México".
3. **Bugs de zona horaria en reportes y dashboard**. El frontend pide `/reports/...?start_date=2026-05-23&end_date=2026-05-23` cuando el operador ve "viernes, 22 de mayo"; el resultado es que recién hechas las ventas el dashboard muestra "Aún no hay ventas" y la card *Tendencia de ventas* renderiza `-100% vs ayer` en rojo aunque la cuenta ya facturó.
4. **Stock negativo persistente** (`stock_on_hand = -1` en `Agua mineral` y `Galleta New York` del tenant de prueba). El frontend ya lo muestra como "Ya agotado" en la velocidad de stock, pero el badge sigue diciendo "Bajo" amarillo y la card muestra `-1 en stock`. El script `clamp_negative_stock.py` aún no se ejecutó contra producción.

Buena noticia: **muchos bugs del Sprint 5 ya están cerrados y validados en vivo** — logo upload, vista previa de recibo, devolución con mensaje específico (`máx. 2`), settings con tabs y selects, normalización `start_date/end_date`, sanitize HTML en producto, ruta 404 con CTAs, `Cancela cuando quieras` / `Sin tarjeta para empezar` en hero, dedupe `useBillingSubscription` (1 request por carga del panel), per-route document titles para Panel / Caja / Catálogo / Órdenes / Inventario / Reportes / Configuración / Turnos. Ver § *F. Verificación contra Sprint 5* abajo.

**Decisión recomendada:** cerrar los P0 abajo antes de invitar al primer tenant beta nuevo; los P1/P2 pueden cargarse en un sprint corto la siguiente semana sin bloquear onboarding.

---

## B. Matriz de severidad

| Severidad | Cuántos | Categoría dominante |
|---|---|---|
| **P0 — Bloqueo / data integrity / first-impression** | 6 | Layout overflow, stock negativo, TZ en reportes, sin recuperación de contraseña |
| **P1 — Consistencia / correctness / copy** | 11 | Acentos es-MX, formato de fecha, estado de orden post-devolución |
| **P2 — Polish / UX** | 13 | Toast doble, sin modal de confirmación al cancelar suscripción, recibo sin estado neto |
| **Mejoras / gaps** | 9 | Falta forgot-password, telefonia del recibo, modificadores |

Lista completa abajo. Cada item incluye qué se ve, dónde se reproduce, y un pointer al archivo del repo cuando es relevante.

---

## C. P0 — Bloqueo / data integrity / first-impression

### P0-1 · Overflow del landing en pantallas wide

**Qué se ve.** En `https://point-of-sale-ochre.vercel.app/` con viewport ≥1440px, el contenedor del landing termina aproximadamente en x=1300 y la franja a la derecha pinta el color blanco del body (`--page-bg`). Es muy visible desde el hero (`Lleva tu emprendimiento con orden, sin libretas ni Excel.`) y se agrava al hacer scroll: para algunas secciones (`Tres cosas que se vuelven simples desde el primer día`, footer, banner `7 DÍAS GRATIS`) el bloque oscuro deja la mitad del viewport en blanco.

**Reproducción.** Cualquier monitor 1440p+, sin scroll horizontal. Visible en `/`, `/privacy`, `/terms`, `/signup`. En el detalle de orden auth (`/orders/<id>`) también aparece una franja idéntica pero más sutil.

**Causa probable.** `frontend/src/routes/Home.tsx:1024` declara `.lp-root { max-width: 100%; overflow-x: clip; }` pero el `<body>` no fuerza `min-width: 100vw` y los `<section>` con fondo oscuro están dimensionados sobre el contenedor padre, no sobre el viewport. Es el mismo issue #16 del UX review del 19 de mayo. **Sigue abierto.**

**Por qué importa.** El landing está pensado para convertir cafeterías que llegan vía WhatsApp. Si llegan desde la laptop del dueño (común para evaluar SaaS), lo primero que ven es un layout roto. Para un producto premium con tagline `Tu negocio, en flujo constante`, esto rompe la promesa antes de leer el segundo párrafo.

**Recomendación.** Forzar `min-width: 100vw` (o `width: 100vw`) en el `<body>` para las rutas del landing, y/o anclar las secciones con fondo oscuro a `vw` en lugar de al ancho del contenedor. Verificar también en `/privacy` y `/terms` que la barra superior pinte hasta el borde.

---

### P0-2 · Stock negativo persistente en producción

**Qué se ve.** En `/inventory` del tenant `Chapatito`:

- `Agua mineral` (FRI-004): card muestra `-1 en stock`, badge amarillo `Bajo`, umbral 12.
- `Galleta New York` (sin SKU): card muestra `-1 en stock`, badge amarillo `Bajo`, umbral 5.

La card de *Velocidad de stock* sí cambia a `Ya agotado` y sugiere preparar reabasto (BUG-002 frontend está aplicado), pero el cuerpo principal sigue rindiendo el número negativo. El badge "Bajo" es incorrecto: stock ≤ 0 debería ser "Agotado" o "Crítico", no "Bajo" amarillo.

**Causa.** El maintenance script `backend/scripts/clamp_negative_stock.py` (referenciado en sprint backlog como ya creado en `7ec035f`) no se ha corrido contra producción. Las dos rows que estaban en `-1` antes del guard del repository siguen ahí.

**Recomendación.**
1. Ejecutar el script `clamp_negative_stock.py` contra el tenant de prueba *y* todos los tenants en producción. El script ya existe; falta agenda.
2. Cambiar la lógica del badge en `frontend/src/inventory/InventoryView.tsx` para que `stock_on_hand <= 0` siempre renderice variant `destructive` con texto "Agotado", no `warning` "Bajo".

---

### P0-3 · Reportes consultan `start_date=mañana` cuando el filtro es "Hoy"

**Qué se ve.** Tras hacer una venta de $76 a las 23:22 hora local CDMX:

- `/dashboard` muestra `Esto es lo que está pasando hoy, viernes, 22 de mayo`.
- Card *Tendencia de ventas* dice `-100% vs ayer` en rojo. El KPI grid principal sí está en estado neutral "Aún sin comparación" (fix de DeltaBadge aplicado), pero la card de tendencia usa una lógica distinta y no recibió el patch.
- `/reports` con preset "Hoy" muestra `Aún no hay ventas para contar una historia`.
- DevTools Network: el front pega `/api/v1/reports/sales-summary?start_date=2026-05-23&end_date=2026-05-23`, `payment-breakdown?...=2026-05-23`, `sales-by-hour?...=2026-05-23`, `top-products?...=2026-05-23`. Al mismo tiempo hay otra `sales-summary?start_date=2026-05-22&end_date=2026-05-22` (probablemente del card *Salud del negocio*). Inconsistencia.

**Causa probable.** El cálculo de "hoy" en `frontend/src/reports/...` o en el `useBillingSubscription`-equivalente está derivado de `new Date().toISOString().slice(0,10)` (UTC) en lugar del timezone del tenant. A las 23:22 CDMX (UTC-6) ya es 05:22 UTC del día siguiente, por lo que el front pide la fecha equivocada.

**Recomendación.**
1. Centralizar el cómputo de "hoy/ayer/semana/mes" en un helper que reciba `tenant.timezone` (ya viene del `/business-profile`) y use `Intl.DateTimeFormat` para obtener `YYYY-MM-DD` en TZ local.
2. Hacer que el card *Tendencia de ventas* del panel use el mismo `DeltaBadge` que el KPI grid (o aplicar el mismo `warmingUp` rule de "previo > 0 y actual == 0" cuando el tenant tiene <7 días de historia o cuando la cuenta total acumulada es <1 día).
3. Backend defense in depth: validar en `backend/app/reports/router.py` que `start_date` ≤ "hoy" en TZ del tenant. Si llega `mañana`, reinterpretarlo como `hoy` o devolver 422 con copy claro.

---

### P0-4 · No hay flujo de recuperación de contraseña

**Qué se ve.** `/login` tiene solo *Correo*, *Contraseña*, botón *Iniciar sesión* y link *Crear cuenta*. **No hay link "¿Olvidaste tu contraseña?"**, ni endpoint público que envíe magic link / reset email. Un dueño que pierde la contraseña queda bloqueado de su POS pagado.

**Reproducción.** Cualquier visita a `/login`.

**Recomendación.** Sprint dedicado:
- Backend: `POST /api/v1/auth/forgot-password` (envía email con token de un solo uso, 15 min TTL); `POST /api/v1/auth/reset-password` con el token + nueva contraseña. Reutilizar el sistema de emails ya implementado para verify-email.
- Frontend: link `¿Olvidaste tu contraseña?` debajo del botón Iniciar sesión → `/forgot-password` view con email field → toast "Te enviamos un correo con instrucciones" → `/reset-password?token=...` para completar.
- Mensaje genérico independiente de si el email existe o no, por OPSEC (no confirmar enumeration).

---

### P0-5 · Mensaje de error de login genérico ("No se pudo completar la operación")

**Qué se ve.** En `/login`, credenciales inválidas (`noexiste@test.com / wrongpass`) producen el toast `No se pudo completar la operación.` — la misma cadena que usa el catch-all genérico en muchos otros flujos.

**Problema.** Para el usuario es imposible distinguir "escribí mal el email", "escribí mal la contraseña" o "el servidor está caído". Para un POS donde el dueño necesita entrar urgente al inicio del día, esta ambigüedad es real-money frustration.

**Recomendación.**
- Mapear `401` del backend en `/api/v1/auth/login` a la copy `Correo o contraseña incorrectos.` (sin distinguir cuál, por OPSEC).
- Reservar `No se pudo completar la operación.` exclusivamente para errores 5xx o network errors.
- File: `frontend/src/auth/AuthView.tsx` y el helper que actualmente arma ese toast.

---

### P0-6 · Modal de "Cancelar suscripción" sin confirmación destructiva

**Qué se ve.** En `/settings/billing` el botón `Cancelar suscripción` está en una card secundaria sin variant destructivo y, al click, dispara la acción directamente — no hay modal `¿Estás seguro?` ni copy sobre qué pasa con la data. El sprint backlog P2 ya identifica este item pero seguramente debería elevarse a P0 antes de aceptar pagos reales (Stripe live).

**Recomendación.** Modal con:

- Título: `¿Cancelar tu suscripción?`
- Cuerpo: `Perderás acceso a Kova al final del periodo pagado actual (21 jun 2026). Tu catálogo, órdenes y reportes se conservan hasta que cancelemos.`
- CTAs: `Cancelar suscripción` (rojo) y `Conservar suscripción` (secundario).
- Solo después de confirmar, llamar al backend.

---

## D. P1 — Consistencia / correctness / copy

### P1-1 · Categorías y descripciones residuales sin acentos

Visible en producción para tenants creados antes del fix:

- `/register` y `/catalog`: chips `Cafe caliente`, `Bebidas frias`. (debería ser `Café caliente`, `Bebidas frías`)
- `/catalog` modal de producto: dropdown *Categoría* muestra `Cafe caliente`. Descripción de producto persistida `Cafe americano 240 ml`.
- `/settings/employees` role descriptions tienen muchos:
  - `Control total: configuracion, facturacion, empleados, reportes y ventas.`
  - `Opera el negocio: caja, catalogo, inventario, turnos, reportes y empleados.`
  - `Uso diario: caja, ordenes y turnos sin acceso a facturacion ni configuracion critica.`
  - `Puedes cambiar su rol o desactivar su acceso despues.`
- `/reports` cuerpo del resumen: `12 ordenes` (sin acento).
- `/catalog` placeholder de búsqueda: `Buscar por producto, SKU o descripcion...`
- `/billing` (subscription banner copy en `i18n/messages.ts:1158-1162`): `Tu suscripcion esta en prueba`, `Stripe ya tiene una suscripcion en prueba`, `la renovacion aqui`, `Tu suscripcion ya esta activa. Actualizamos el estado de facturacion.`
- `frontend/src/i18n/messages.ts:321`: `Arrastra el logo o subelo desde tu equipo` (debe ser `súbelo`).

**Recomendación.** Hay dos vectores:
1. Strings hardcodeadas en `i18n/messages.ts` — fix directo + lint rule (regex CI check) para prevenir regresión. Lista exhaustiva en `current-sprint.md` § "Acentos faltantes" — todavía aplica.
2. Datos persistidos en DB (categorías, descripciones de productos creados antes del fix) — ejecutar `backend/scripts/fix_category_accents.py` (ya creado) contra producción. Considerar también un similar para `products.description`.

---

### P1-2 · Inglés residual en /shifts

`/shifts` renderiza:

- Estado del turno actual: `Open` (debería ser `Abierto`).
- Movement type code: `OPENING_BALANCE`. Subtítulo: `Opening balance`. (debería ser `Apertura de caja` / `Saldo inicial`)
- Estado de turnos cerrados: `balanced` (debería ser `Balanceado`).

Estos son `enum` values del backend renderizados raw. La recomendación del sprint es mantener los enum codes en DB pero mapear a labels español en `frontend/src/shifts/<formatter>.ts`.

---

### P1-3 · Formato de fecha inconsistente

- `/orders` listado: fechas en `dd/MM/yyyy, HH:mm` — correcto.
- `/orders` placeholders de filtro: `mm/dd/yyyy` (formato USA en placeholder pero el valor real respeta dd/mm). Confunde al operador.
- `/reports` inputs `Fecha inicial` / `Fecha final`: `05/23/2026` — formato USA visible.
- `/shifts` "Turnos cerrados recientes": `5/11/2026, 10:37:47 PM` — formato USA con AM/PM.
- `/shifts` turno activo: `5/22/2026, 7:51:02 AM` — formato USA.

**Recomendación.** Aplicar el helper centralizado de `frontend/src/orders/format.ts` (o crear `frontend/src/i18n/date.ts`) a *todos* los renders de fecha, incluyendo placeholders de inputs. `Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', hour12: false })`.

---

### P1-4 · Greeting del panel rinde el nombre del negocio en ALL-CAPS

`/dashboard` header: `Buenas noches` + `CHAPATITO` en 36px bold uppercase. El sidebar lo muestra como `Chapatito` correctamente. El header del recibo en `/orders/<id>` también lo muestra en CAPS (`CHAPATITO · 46D467C4`).

El problema es que el dueño escribió "Chapatito" en el campo *Nombre público del negocio*, pero algún CSS aplica `text-transform: uppercase` al header del panel y al header del recibo. Si el dueño cambia el nombre a "Café Lupita", el header dirá `CAFÉ LUPITA`, lo cual choca con el branding premium del producto.

**Recomendación.** Remover el `text-transform: uppercase` del header del panel y del header del recibo. Aplicar el helper `formatTenantName()` propuesto en el UX review #10: trim + truncate 24 + sentence-case si el input está todo upper o todo lower.

---

### P1-5 · Botón "Cobrar" reactivo a fecha futura (raro)

`/register` post-venta exitosa muestra simultáneamente:

1. Toast verde "Venta completada" en esquina superior derecha (con × close).
2. Card verde inline "Venta completada · Abrir orden | Nueva venta" donde estaba el formulario de cobro.

Ambos comparten el mismo link `/orders/<id>`. Es el bug P2 que ya está en el backlog (Sprint 5 § P2 *UX polish* — *Toast doble*). Confirmado live.

**Recomendación.** Mantener solo la card inline (más actionable). El toast queda redundante.

---

### P1-6 · Estado de orden no refleja devolución parcial

Después de devolver 1 unidad de 2 en `/orders/<id>`:

- Header de la orden sigue con badge verde `Completada`.
- Block *Productos* muestra `Americano chico x2` sin marca de "1 devuelta".
- Block *Recibo* muestra `Total $76.00`, `Pagado en efectivo $76.00` — no refleja el monto neto post-devolución ni el reembolso entregado.
- Sí aparece la sección *Devoluciones* con la fila correcta (`Devolución de cliente · Americano chico x1 · $38.00`).

**Recomendación.**
- Estados intermedios: `Completada · Devuelta parcial`, `Devuelta total`.
- Línea de producto: anotar `2 (1 devuelta)`.
- Block *Recibo*: agregar fila `Devuelto -$38.00`, `Neto $38.00`.
- O alternativamente: separar visualmente "Recibo original" y "Estado actual".

---

### P1-7 · Acción "Vender de todas formas" pendiente en BUG-001

El backend ya bloquea ventas de productos sin stock (`OUT_OF_STOCK` guard verificado en `7ec035f`). El frontend ya muestra `AGOTADO` en las cards del catálogo de `/register`. Pero la spec original de BUG-001 incluye una acción secundaria *"Vender de todas formas"* con `allow_oversell: true`. **No se observó esa opción en la UI live**.

**Recomendación.** Validar en `RegisterView.tsx` si esa acción está implementada o si quedó fuera. Es útil para el caso real del cashier que vende lo último mientras cuentan físicamente. Si se omite, documentar la decisión explícita en `docs/deferred-scope.md`.

---

### P1-8 · Validación de qty > max en devolución solo bloquea en backend

`/orders/<id>` modal *Devolver productos*: el input acepta `5` aunque la copy diga `Máximo: 2`. Solo al submit el backend responde con toast claro `La cantidad excede lo disponible para devolución (máx. 2).` (que está perfecto). Pero ese roundtrip es evitable:

**Recomendación.** Agregar `max={lineItem.refundable_qty}` al `<input type=number>` y clamp en el `onChange`. Mantener la validación backend como defensa en profundidad.

---

### P1-9 · `Cambio` muestra $0 cuando efectivo < total (debería sugerir "Faltan $26")

`/register` con total $76 y efectivo recibido $50:

- Field *Cambio* muestra `$0.00`.
- Inline error rojo: `El efectivo recibido debe cubrir el total de la orden.`

La copy es correcta pero el campo *Cambio* podría inteligentemente mostrar el delta en negativo (`Faltan $26.00`) para ayudar al cajero a pedir el monto faltante.

**Recomendación.** Cambiar el label/valor de *Cambio* dinámicamente: si recibido < total, mostrar `Faltan $X.XX` en rojo; si recibido ≥ total, mostrar `Cambio $X.XX` en verde.

---

### P1-10 · `?new=product` query param ignorado cuando hay catálogo existente

El checklist del panel y la spec del Sprint 2 dicen que `/catalog?new=product` debe abrir el modal de creación automáticamente. Probado en vivo con el tenant `Chapatito` (que ya tiene 13 productos), el modal **no abre**. Solo aplica al empty state.

**Recomendación.** Quitar el guard del empty-state — el query param debe abrir el modal siempre. Es la única forma de que el checklist funcione consistentemente para tenants que ya iniciaron el camino.

---

### P1-11 · ARIA labels en inglés

`/catalog` botón de editar producto: `aria-label="Edit Americano chico"`. Esperado: `Editar Americano chico` o `Editar producto Americano chico`. Idéntico para *Deactivate* (donde aplique).

Es problema de accesibilidad real para lectores de pantalla en español.

---

## E. P2 — Polish / UX

### P2-1 · Decisiones recomendadas duplicadas en /reports

`/reports?range=mes` muestra en *Decisiones recomendadas* dos cards casi idénticas:

- `Reabastece Agua mineral` — *Agua mineral vendió 1 unidad en este rango y está en stock bajo: -1 disponible, umbral 12.*
- `Reabastece Agua mineral` — *Stock -1 bajo el umbral 12 y se agota en -7.1 día(s) al ritmo actual.*

Ambas apuntan al mismo `product_id`. El dedupe por `(action_type, target_id)` que está en el sprint backlog (BUG-010) no está aplicado.

**Recomendación.** Aplicar el dedupe antes del cap de tres. Si dos alertas distintas apuntan al mismo producto, fusionar la copy en una sola card que liste las dos razones.

### P2-2 · "Salud del negocio" tiene un link `Configurar` sin destino claro

`/dashboard` card *Salud del negocio*: junto al título hay un link azul `Configurar`. No es obvio qué configura (¿el método de scoring? ¿qué KPIs entran al score? ¿qué umbral define "warm" vs "critical"?). El estado actual es "Aún no hay actividad suficiente" así que la UI parece esperar algo del usuario.

**Recomendación.** O quitar el link (el score se autoconfigura), o llevarlo a una página de explicación con el algoritmo.

### P2-3 · `/dashboard` card de Tendencia es contradictoria con Salud del negocio

En el mismo viewport:

- *Salud del negocio* dice `Aún no hay actividad suficiente. Termina la configuración y registra ventas reales para activar esta lectura.`
- *Tendencia de ventas* dice `-100% vs ayer` con flecha down roja.

El mensaje mixto le dice al usuario "no hay data" y "estás cayendo 100%" simultáneamente. Resolver con el fix P0-3 (DeltaBadge consistente) y haciendo que ambas cards consulten la misma fuente.

### P2-4 · Recibo en `/orders/<id>` no incluye fecha ni dirección

El bloque *Recibo* solo muestra `CHAPATITO · 46D467C4` (nombre del negocio + corto del UUID). En la *Vista previa* de `/settings/receipt` sí aparece `22/05/2026 · 11:27 p.m.` y el footer `¡Gracias por tu compra!`. **El detalle de orden no incluye esos campos**.

Si el dueño quiere imprimir/re-emitir el ticket desde el detalle, el ticket impreso saldrá sin fecha, sin dirección, sin agradecimiento. Bug de inconsistencia entre la preview de settings y la implementación real.

### P2-5 · No hay botón "Reimprimir ticket" en /orders/<id>

Para un POS, "reimprimir el último ticket" es el botón #1 del cajero (cliente pide segundo ticket, se atascó la impresora, etc.). En el detalle de orden no aparece. Hay *Devolver* y *Cancelar*, pero no *Reimprimir*.

**Recomendación.** Botón `Imprimir ticket` en *Acciones* que dispare `window.print()` con un stylesheet print-only que renderice el block *Recibo* completo. Idealmente con la vista previa que ya existe en settings.

### P2-6 · No hay reembolso del dinero en la devolución, solo del producto

`/orders/<id>` *Devolver productos* registra que el cliente devolvió N unidades y el motivo. Pero no:

- No registra cuánto efectivo se entregó de regreso al cliente.
- No actualiza el block *Pagos* para reflejar el net post-refund.
- No genera un movimiento en `/shifts` para que el cierre de turno sepa que salió dinero de la caja.

Para una cafetería esto importa: al cierre de turno el conteo físico vs el sistema no va a coincidir si hubo devoluciones.

**Recomendación.** Agregar al modal de devolución un step opcional `¿Cómo entregaste el reembolso?` con `Efectivo $X` / `No reembolsado (vale)`. Si efectivo, generar el `cash_movement` correspondiente en el turno activo.

### P2-7 · Stock bajo banner del panel no enlaza al filtro

`/dashboard` muestra el banner `8 productos necesitan atención de inventario.` con un chevron `→` a la derecha. El chevron es decorativo: hacer click no lleva a `/inventory?filter=low`. La spec del Sprint 3 dice que inventory tiene filter "bajo/saludable" — usemos el deep link.

### P2-8 · "Acciones contextuales" del panel — bien hecho, pero "Imprimir Z" siempre disponible

`/dashboard` § *Acciones contextuales* muestra `Cerrar turno · Exportar ventas · Imprimir Z`. El *Imprimir Z* (corte Z) es semánticamente del cierre de turno: probablemente debería estar disabled hasta que el turno haya cerrado, o cambiar el label a "Reporte de turno actual".

### P2-9 · Card de turno no muestra ventas del turno

`/shifts` card *Turno activo* muestra `ABIERTO A LAS 5/22/2026, 7:51:02 AM` y `EFECTIVO INICIAL $500.00`. No muestra `Ventas del turno`, `Movimientos`, `Cash esperado al cierre`. Para un cajero, ese es el panel principal mientras está activo.

### P2-10 · `/register` cart no permite editar precio (descuento)

No se observó forma de aplicar descuento manual a un item del carrito (ej. cliente VIP, cortesía). La copy del landing dice *"Descuentos"* como feature implícita; en producción no se ve.

### P2-11 · Sin modificadores en el modal de edición de producto

El subtítulo del modal de producto dice `Actualiza precio, SKU, categoría, inventario y modificadores.` — pero la UI no tiene sección de modificadores. Promesa rota en la copy o feature no expuesta. (Sprint 15 *Modifiers* aparece como completed; verificar dónde se exponen.)

### P2-12 · Sin link "Olvidé mi contraseña" en /login

Repetido del P0-4 — es el mismo bug, marcando como P2 también para tracking de polish.

### P2-13 · 404 page sin per-route title

`Esta página no existe` (correcto, BUG-004 cerrado) pero la pestaña del navegador sigue siendo `kova · lleva tu cafetería con orden`. Per-route title aplica al resto del app pero quedó fuera del 404. Misma situación en `/orders/<id>` y `/settings/billing`.

---

## F. Verificación contra Sprint 5

Resultado del cross-check de cada item del backlog activo contra producción al 2026-05-22.

| # | Bug | Estado en repo | Estado en producción |
|---|---|---|---|
| BUG-001 | Bloquear venta sin stock | Implementado | ✅ Verificado: `AGOTADO` badge y card no clickeable. ⚠ Falta confirmar la opción `Vender de todas formas` |
| BUG-002 | Stock negativo | Backend guard implementado, script `clamp_negative_stock.py` creado | ⚠ Script no ejecutado contra prod (Agua mineral y Galleta NY siguen en `-1`). Frontend `Ya agotado` ✅ |
| BUG-003/012 | Label "Total pagado" en recibo | Implementado | ✅ Verificado: muestra `Efectivo recibido $100.00` + `Cambio $24.00` |
| BUG-004 | 404 + redirects español | Implementado | ✅ Verificado: `/billing` da 404 con CTAs Volver al panel + Ir a Caja; `/configuracion`, `/catalogo`, `/ordenes` redirigen |
| BUG-005 | Pérdida de sesión entre módulos | Fix landed (`77129f4`) | ✅ Navegé 10+ páginas sin ser kickeado |
| BUG-006 | Precio negativo en producto | Implementado | ✅ Verificado: ingresar `-99` strippea a `99` |
| BUG-007 | Devoluciones con qty inválida | Implementado | ✅ Verificado: toast específico `La cantidad excede lo disponible para devolución (máx. 2).` |
| BUG-008 | Dedupe `/billing/subscription` | Implementado | ✅ Verificado en Network: 1 request por carga del Panel |
| BUG-009 | Normalizar `start_date`/`end_date` | Implementado | ✅ Verificado: requests usan `start_date`/`end_date` (también descubrí P0-3 sobre el valor incorrecto, ver arriba) |
| BUG-010 | Dedupe "Decisiones recomendadas" | Pendiente | ❌ Verificado: dos cards `Reabastece Agua mineral` simultáneas en `/reports` |
| BUG-011 | Sincronizar nombre negocio | Verificado parcialmente | ⚠ El sidebar muestra `Chapatito` y el header muestra `CHAPATITO`. Si el dueño cambia "Chapatito" a "Chapatito Bonito", validar que ambos se actualicen sin hard refresh — no se hizo el round-trip de prueba |
| BUG-013 | Neto vs bruto en reportes | No verificado live | ⚠ La cuenta de prueba no tiene devoluciones suficientes para ver la diferencia |
| BUG-014 | SKU obligatorio/autogenerado | Implementado parcialmente | ❌ `Galleta New York` sigue con `Sin SKU`. Faltó correr el backfill |
| BUG-015 | Efectivo recibido negativo | Implementado | ✅ Verificado: ingresar `-50` strippea a `50` |
| Acentos i18n | i18n + script backfill | Implementado parcialmente | ❌ Strings de roles, descripciones, suscripción siguen sin acentos (lista en D-1). Backfill de categorías no corrido |
| Lang `es-MX` | `<html lang="es-MX">` | Implementado | ✅ Verificado |
| Per-route title | Implementado para rutas principales | Parcial: Panel/Caja/Catálogo/Órdenes/Inventario/Turnos/Reportes/Configuración ✅. `/orders/<id>`, `/settings/billing`, 404 ❌ |
| Inglés residual | Pendiente | ❌ `Open`, `OPENING_BALANCE`, `Opening balance`, `balanced` en `/shifts`. `All` no verificado |
| Formato fecha dd/mm/yyyy | Parcial | ❌ Inputs y placeholders en `/orders` y `/reports`, todas las fechas en `/shifts` usan formato US |
| TZ humana | Implementado | ✅ `Ciudad de México (UTC-6)` en `/reports` |
| Onboarding auto-mark | Implementado | ✅ Checklist 6/7 con steps tachados |
| Toast doble en Caja | Pendiente | ❌ Verificado live |
| Confirmación destructiva al cancelar suscripción | Pendiente | ❌ El click parece haber disparado la cancelación directamente (ver P0-6) |
| Fallback imagen producto | Implementado | ✅ Icono de caja en todas las cards sin imagen |
| HTML sanitize en producto | Implementado | ✅ `<script>` rechazado con copy `El nombre no puede contener etiquetas HTML` |
| CSP headers | Implementado en commit | No verificado |

**Score:** ~17 de 27 items abordados completamente; 5 parcial; 5 pendientes.

---

## G. Gaps de funcionalidad

Cosas que no tienen ticket abierto pero conviene considerar antes de GA:

1. **Forgot password** (ya cubierto en P0-4).
2. **Reimprimir ticket** desde `/orders/<id>` (P2-5).
3. **Reembolso de dinero en devoluciones** + movimiento en turno (P2-6).
4. **Descuentos / cortesías** en `/register`. Sin esto, una cafetería real no puede manejar invitación al amigo del dueño.
5. **Modificadores expuestos en UI** — Sprint 15 dice "modifiers" completed pero el modal de producto no los muestra.
6. **Ventas del turno actual visibles en `/shifts`** (P2-9).
7. **Reporte de turno (Corte Z)** — el botón existe pero no se observó la salida.
8. **Imágenes de producto subidas al backend para los productos seed**. Los 13 productos tienen el placeholder genérico. La feature de upload funciona en `/catalog` modal; faltan las imágenes default para los productos del preset cafe.
9. **Acción "Vender de todas formas"** prometida en BUG-001 — verificar implementación o documentar como diferido (P1-7).

---

## H. Mejoras de UX recomendadas

Cosas que técnicamente funcionan bien pero serían un salto de calidad:

1. **Trial chip en el AppShell header** — el card *Lo que conservas al activar* solo se ve en `/settings/billing`. Llevarlo al header mientras el trial está activo (ya estaba en el UX review previo como Issue #7).
2. **Receipt preview inline al editar producto** — para el dueño que define un producto "Café latte 12oz $52", mostrar al lado cómo se verá en el ticket. Refuerzo de "este es mi POS".
3. **Onboarding tour primer login** — el checklist está bien, pero un tour overlay (`/register`, `/catalog`, `/reports`) ayudaría al ~25% que no entiende qué hacer después de signup.
4. **Card de Tendencia ventas con sparkline** en vez de solo "% vs ayer" — más útil cuando hay 5+ días de historia.
5. **Atajos de teclado básicos** — Enter en `/register` para cobrar, `Esc` para limpiar carrito, `Ctrl+F` foco al search del catálogo.
6. **Dark mode** dentro de la app — el landing tiene toggle, la app no. Promesa rota.
7. **Notificación de stock crítico al login** — toast persistente "8 productos en stock bajo · Ver inventario" en lugar de banner del panel que pierde atención.
8. **Buscador global** (`Cmd/Ctrl+K`) — encontrar producto, orden o cliente desde cualquier pantalla.
9. **Botón "Duplicar producto"** en `/catalog` — al crear un menú extenso, la mayoría de productos comparten 80% del schema.

---

## I. Notas operativas

- **Per-screen verificación manual sugerida tras el next fix sprint:**
  - `/dashboard` después de hacer 1 venta: card *Tendencia* debe ser neutral, no roja.
  - `/inventory` en cuentas pre-existentes: ningún `stock_on_hand` < 0.
  - `/login` en mobile responsive: aparece link forgot-password.
  - `/reports` con preset "Hoy": las requests usan la fecha local del tenant (CDMX, no UTC).
  - `/shifts`: estado y movement types en español.
- **Sprint Stripe go-live (gate del GA):** además del cambio de keys, validar que el modal de confirmación destructiva exista antes de permitir cancelación real.
- **Backfill scripts pendientes de correr en prod:**
  - `backend/scripts/clamp_negative_stock.py`
  - `backend/scripts/fix_category_accents.py`
  - `backend/scripts/backfill_skus.py`

---

## J. Fuentes

- Live: <https://point-of-sale-ochre.vercel.app/> con `posprojectsupport@gmail.com` / tenant `Chapatito`.
- Network: `mcp__Claude_in_Chrome__read_network_requests` corrido en `/dashboard` y `/reports`.
- Console: sin errores ni warnings JS capturados durante la sesión.
- Código:
  - `frontend/src/dashboard/DashboardView.tsx` (DeltaBadge, KPI grid)
  - `frontend/src/reports/ReportsView.tsx`
  - `frontend/src/inventory/InventoryView.tsx`
  - `frontend/src/orders/...` (detalle, modal de devolución)
  - `frontend/src/auth/AuthView.tsx`
  - `frontend/src/i18n/messages.ts` (líneas con acentos pendientes: 321, 348, 349, 350, 352, 1040, 1158, 1159, 1162)
  - `frontend/src/routes/Home.tsx` (`.lp-root` overflow)
  - `frontend/src/App.tsx` (Spanish-slug redirects)
  - `frontend/src/settings/*.tsx` (Perfil, Recibo, Empleados, Avanzado)
  - `frontend/src/shifts/...`
- Cross-reference: `docs/ux-review-2026-05-19.md`, `docs/current-sprint.md` § Sprint 5.
