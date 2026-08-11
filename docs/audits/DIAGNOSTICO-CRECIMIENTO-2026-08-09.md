# Diagnóstico de crecimiento — Kova · 2026-08-09

Pregunta original: *"El producto se siente completo pero sólo tengo un cliente. ¿El error viene del SaaS?"*

**Respuesta corta: no, el producto no es tu cuello de botella. Tus números de conversión lo son —
y son falsos. Llevas ~3 semanas optimizando un embudo contra datos que no corresponden a personas
reales.**

Este documento separa tres cosas que hoy están mezcladas: lo que el producto **sí** hace bien, lo que
**realmente** está roto, y lo que está **ausente** para el mercado mexicano.

---

## 0. Cómo se levantó esta evidencia

- Recorrido real de `kovasuite.com` (landing pública) en navegador.
- Sesión autenticada en producción con el tenant de prueba `Cafetería Sweet Home`
  (Panel, Caja, Turnos, Inventario, Análisis, Configuración, Suscripción) incluyendo **una venta
  real completada** ($70.00, efectivo exacto, 2 artículos).
- Consultas agregadas a la base de producción (Supabase `PoS Project`) sobre `tenants`,
  `subscriptions`, `public.users` y `anonymous_telemetry_events`. No se leyeron correos, nombres ni
  importes de clientes.
- Lectura de `frontend/src/auth/AuthView.tsx`, `backend/app/auth/router.py`,
  `backend/app/telemetry/router.py`, ADRs 003/008, `docs/deferred-scope.md`,
  `docs/audits/CRO-BASELINE-2026-07-20.md` y `docs/email-deliverability.md`.
- Vercel: proyecto `point-of-sale`, deployment de producción `READY`.

---

## 1. El hallazgo que cambia todo: tu embudo mide fantasmas

### Los dos números que no pueden ser ciertos a la vez

Ventana: **10 jul – 9 ago 2026 (30 días)**.

| Fuente | Métrica | Valor |
|---|---|---:|
| `anonymous_telemetry_events` | `landing_viewed` | 1,971 (1,417 `client_id` distintos) |
| `anonymous_telemetry_events` | `landing_cta_clicked` | 95 (58 clients) |
| `anonymous_telemetry_events` | `signup_started` | 57 (55 clients) |
| `anonymous_telemetry_events` | **`signup_completed`** | **48 (48 clients)** |
| `public.users` | **usuarios realmente creados** | **2** (10 jul y 5 ago) |
| `tenants` | **negocios realmente creados** | **2** |

> Nota de precisión: en ventana móvil exacta (`now() - 30 days`) el conteo es **1 usuario**, porque
> el registro del 10 jul cae unas horas fuera. Se usa la ventana de calendario 10 jul – 9 ago para
> ser generoso con el número.

48 signups "completados" produjeron 2 filas de usuario.

### Por qué esto no puede explicarse como un bug de producto

`frontend/src/auth/AuthView.tsx:237` emite `signup_completed` **sólo después** de que
`POST /auth/signup` responde sin excepción y con `reason != email_in_use | verification_resent`.
En `backend/app/auth/router.py:57-105` esa respuesta corresponde a `ACCOUNT_CREATED`, que sí persiste
usuario + tenant + membresía. Es decir: **si el evento fuera legítimo, existirían 48 usuarios.**

Sólo hay **12 usuarios en total desde el 2026-04-28** y **10 tenants** en toda la vida del proyecto.

### La explicación más probable

`POST /telemetry/anonymous` es deliberadamente público, sin sesión, sin CSRF y sin verificación de
origen (`backend/app/telemetry/router.py:67-81`). Su única defensa es `rate_limit(30/min)` **por IP**.
Cualquiera —o cualquier crawler/scanner— puede inyectar eventos arbitrarios del enum permitido.

La huella lo respalda: **el 100% de los 48 `signup_completed` traen
`device_class=desktop`, `source=direct`, `campaign=not_set`, `path=/signup`**, cada uno con un
`client_id` distinto. Cero variación. Para un producto cuyo público objetivo son dueños de changarros
mexicanos —que en `landing_viewed` sí aparecen como **mobile 501 vs desktop 351**— un embudo de
conversión 100% desktop y 100% directo no describe a tus clientes.

### Consecuencias

1. **El baseline de `CRO-BASELINE-2026-07-20.md` y todo el trabajo CRO-1 a CRO-5 está construido
   sobre datos contaminados.** El análisis de 30 días agendado para el 2026-08-20 va a producir un
   resultado bonito y falso.
2. **1,171 de tus 2,033 `landing_viewed` históricos (10–22 jul) no tienen contexto de dispositivo ni
   canal** — son previos al despliegue de CRO-0. Tu ventana realmente comparable empieza el 20 jul.
3. **Vercel Web Analytics no está habilitado** en el proyecto (la API responde `not_found`), así que
   no tienes una segunda fuente independiente para cruzar.

### Tu conversión real, con los únicos números confiables

Personas reales que crearon cuenta en 30 días: **2**. De ellas, la más reciente (5 ago)
**nunca verificó su correo** y por lo tanto nunca entró al producto. En total, **4 de 12 usuarios
históricos quedaron sin verificar (33%)**.

> Tu problema no es que el embudo convierta mal. Es que **casi nadie real llega al embudo**, y de
> los poquísimos que llegan, una parte se pierde en el correo de verificación.

---

## 2. Lo que sí está bien (no lo vuelvas a tocar)

Recorrí el producto completo con el tenant de prueba. Esto no es un producto a medias:

- **La caja funciona y se siente rápida.** Catálogo con fotos, búsqueda por SKU, categorías,
  carrito, métodos de pago, montos rápidos de efectivo, botón "Exacto". Completé una venta real de
  $70.00 sin fricción y sin errores.
- **Análisis es tu verdadero diferenciador.** Ventas netas con comparación contra periodo anterior,
  productos top, horas pico, mezcla de pagos, bloques del día, días restantes de inventario por
  producto y una sección de "prioridades" que le dice al dueño qué hacer hoy. Ningún POS barato
  mexicano da esto. **Es tu producto, no la caja.**
- **Turnos y cuadre de caja** con histórico, variaciones (`Faltante` / `Caja cuadrada`) e impresión
  de corte.
- **Inventario** con umbrales, alertas de stock bajo, ajustes e historial.
- **La landing es buena.** Narrativa clara (una venta se captura 3 veces vs. Kova), precio visible
  arriba, 7 días gratis sin tarjeta, FAQ que responde las objeciones reales, WhatsApp para dudas.
  Lighthouse mobile 93.

Dedicaste los últimos ~15 commits a pulir landing y UI. Ese trabajo ya rinde poco margen adicional.

---

## 3. Fallas reales encontradas (por severidad)

### 🔴 P0 — Rompen el negocio

| # | Hallazgo | Evidencia | Efecto |
|---|---|---|---|
| 1 | Telemetría anónima aceptando eventos falsos | 48 `signup_completed` vs 2 usuarios | Todas tus decisiones de CRO están mal informadas |
| 2 | Verificación de correo como muro de activación | 4/12 usuarios sin verificar (33%); el signup más reciente (5 ago) nunca verificó | Cada registro perdido ahí es un cliente perdido, y ni te enteras |
| 3 | `docs/email-deliverability.md` está **100% sin marcar** y apunta a `kova.mx` mientras el dominio en producción es `kovasuite.com` | checklist completo sin `[x]` | Si SPF/DKIM/DMARC no están alineados para el dominio real, tus correos de verificación caen en spam — que es exactamente el síntoma del punto 2 |

### 🟠 P1 — Rompen la confianza en el momento de pagar

| # | Hallazgo | Evidencia |
|---|---|---|
| 4 | La pantalla de Suscripción muestra *"Estamos verificando tu próxima fecha de renovación"* | `/settings/billing` en producción |
| 5 | Estados de suscripción inconsistentes en base | Un tenant con `status=active` y `current_period_end=2026-06-21` (vencido hace 7 semanas); 1 `past_due`; 6 de 10 tenants sin fila de suscripción |
| 6 | CRO-4.6 (validación de Checkout hosted en Stripe test) sigue abierto | `docs/current-sprint.md` |

Nadie que dude va a meter su tarjeta en una pantalla que dice que estás "verificando" algo.

### 🟡 P2 — Fricción y pulido

| # | Hallazgo |
|---|---|
| 7 | Hay un **viewport completo en blanco** al hacer scroll en la landing, entre "Respuestas, no ruido" y "Clientes reales" (sección sticky que no alcanza a renderizar). En una laptop lenta o un celular de gama media, un visitante ve una pantalla negra vacía y se va. |
| 8 | LCP móvil 2.5 s contra tu propio objetivo de 2.2 s (`CRO-BASELINE`). |
| 9 | El turno de prueba lleva **19 días abierto** (21/07 → hoy). No hay recordatorio ni cierre automático; en un negocio real eso invalida el corte. |
| 10 | RLS habilitado sin políticas en `alembic_version`, `permissions`, `role_permissions`, `roles`, `verification_tokens` (nivel INFO — cubierto por el diseño backend-only de ADR-009, pero vale documentarlo). |

---

## 4. Lo que le falta al producto para el mercado mexicano

Esto no explica por qué tienes 1 cliente (no llega suficiente gente para que la falta de features
sea el filtro), pero **sí explica por qué costará cerrar los que sí lleguen**, y es lo que un dueño
pregunta en los primeros 5 minutos de una demo:

| Falta | Por qué importa en México | Estado |
|---|---|---|
| **CFDI / facturación electrónica (PAC)** | *"¿Puedo facturar desde aquí?"* es la primera pregunta de cualquier negocio formal. Hoy la respuesta es no. | Aprobado en roadmap, no implementado |
| **Cobro de tarjeta integrado** | La landing dice "tarjeta" pero el producto sólo registra **"tarjeta manual"**. El dueño ya paga Clip/Mercado Pago; tú le pides capturar la venta otra vez — justo el dolor que tu propia landing promete eliminar. | Deferido (ADR-008) |
| **Descuentos e impuestos configurables** | Operación diaria básica de cualquier changarro. | Deferido |
| **Clientes / fiado / apartados** | El crédito informal es estándar en el SMB mexicano. | Deferido |
| **Multi-sucursal** | Bloquea al segmento que más puede pagar $299/mes. | Gate de 10 negocios activos |

**Tensión honesta que vale la pena que resuelvas:** tu `deferred-scope.md` es disciplina de producto
correcta para una beta cerrada — pero fue escrito asumiendo que ibas a validar con **10 negocios
piloto**. Con 1 cliente, esa disciplina dejó de proteger foco y empezó a proteger la ausencia de
conversaciones con clientes.

---

## 5. Veredicto: ¿producto o distribución?

**Distribución, por un margen enorme.** El desglose:

| Etapa | ¿Está roto? | Evidencia |
|---|---|---|
| Tráfico | **Sí, es el cuello** | ~1,400 visitantes únicos en 30 días, de los cuales una fracción desconocida son bots. En `landing_viewed`: sólo **121 de fb** y **16 de ig**. Tus ads no están moviendo volumen real. |
| Landing → interés | Probablemente bien | La narrativa, el precio y el FAQ están bien resueltos |
| Registro → cuenta creada | **Sí, roto** | 33% de usuarios históricos nunca verificaron el correo |
| Cuenta → primera venta | Sin datos suficientes | Sólo 2 casos reales en 30 días |
| Uso → pago | Funciona | Hay suscripciones activas, el checkout existe |
| Producto | **No está roto** | Recorrí todo y opera correctamente |

Dicho de otro modo: llevas ~4 meses (desde el 28 abr, primer usuario) y **12 usuarios totales**.
Eso no es un problema de conversión. Es que **no has hecho suficiente prospección directa**. Tus
respuestas indican que hoy dependes de boca a boca y algo de ads — y los ads están entregando
137 visitas en 30 días.

Con $299 MXN/mes, la aritmética no perdona: ningún canal pagado va a funcionar hasta que tengas
retención probada. Tu canal en esta etapa es **caminar y tocar puertas**, no optimizar el hero.

---

## 6. Plan de acción, ordenado por impacto ÷ esfuerzo

### Semana 1 — Deja de mentirte con los datos (esfuerzo bajo, impacto alto)

1. **Blinda `/telemetry/anonymous`**: valida `Origin`/`Referer` contra `kovasuite.com`, exige que
   `signup_completed` sólo pueda emitirse desde el backend (mueve la emisión al handler de
   `ACCOUNT_CREATED` en `auth/router.py`), y agrega un token efímero de sesión anónima.
2. **Reconcilia el histórico**: marca todos los eventos previos a la corrección como
   `unreliable=true` y **no uses el análisis del 2026-08-20** para decidir nada.
3. **Habilita Vercel Web Analytics** como segunda fuente independiente.
4. **Instrumenta la verdad**: un dashboard interno mínimo con `usuarios creados`,
   `usuarios verificados`, `tenants con ≥1 venta`, `tenants pagando`. Cuatro números, de la base,
   no de telemetría.

### Semana 1-2 — Tapa la fuga de activación (esfuerzo bajo, impacto alto)

5. **Verifica SPF/DKIM/DMARC en `kovasuite.com`** y cierra `docs/email-deliverability.md`. Manda los
   5 correos a Gmail, Outlook y Hotmail reales y confirma bandeja de entrada.
6. **Quita la verificación de correo como muro.** Deja entrar al producto de inmediato y pide
   verificar antes de cobrar. Cada punto de fricción antes del primer "wow" te cuesta el cliente.
7. **Arregla el copy de Suscripción**: nunca muestres "estamos verificando" a alguien a punto de
   pagar. Resuelve el sync de periodo con Stripe o muestra sólo lo que sabes con certeza.
8. **Arregla la sección en blanco de la landing** y baja el LCP a <2.2 s.

### Semana 2-6 — Consigue 10 negocios, a mano (esfuerzo alto, impacto altísimo)

9. **Meta concreta: 10 negocios piloto en 6 semanas.** No con ads. Caminando: 20 cafeterías y
   panaderías por semana en tu ciudad, demo de 10 minutos en su mostrador, instalación asistida en
   el momento. Es el único canal con economía viable a $299/mes en etapa cero.
10. **Vende el análisis, no el POS.** Compites contra POS gratis. Tu ventaja es la pregunta
    *"¿sabes a qué hora vendes más y qué se te está acabando?"*. Tu hero actual lidera con
    "más que un POS"; en la calle, lidera con la respuesta que ningún competidor da.
11. **Ten una respuesta lista para "¿y la factura?" y "¿y la tarjeta?"**. Hoy no la tienes, y son
    las dos primeras objeciones. Aunque la respuesta sea "próximo trimestre", tenla escrita.
12. **Habla con los tenants que se registraron y no se quedaron.** Descontando tus tenants de
    prueba, hay negocios reales en la base (`Micelio Ecosistema Emprendedor`, `TELCEL S.J`, `jose`,
    `Material didáctico`) que crearon cuenta y no llegaron a suscripción activa. Ellos ya te dijeron
    el problema; sólo falta preguntárselo.

### Trimestre — Sólo después de 10 pilotos activos

13. **CFDI vía PAC verificado.** Es el desbloqueo comercial más grande de tu roadmap.
14. **Cobro de tarjeta integrado** (Stripe Terminal o alianza con Clip/Mercado Pago). Elimina la
    doble captura que tu propia landing promete eliminar.
15. **Descuentos y clientes/fiado.**

---

## 7. Lo que NO deberías hacer ahora

- **No sigas puliendo la landing.** Está en el punto de rendimientos decrecientes y las métricas que
  te dicen lo contrario están contaminadas.
- **No corras el análisis CRO de 30 días del 2026-08-20** como si fuera válido.
- **No inviertas más en ads** hasta tener 10 negocios activos y saber tu retención a 60 días.
- **No abras más features** antes de hablar con 20 dueños de negocio. Tu `deferred-scope.md` te ha
  protegido bien; que no se convierta ahora en una excusa para no salir a la calle.

---

## 8. Una nota final

Construiste un producto que funciona. Lo recorrí completo y no encontré nada roto en la operación
diaria — la caja cobra, el inventario se descuenta, el corte cuadra, y el módulo de análisis es
mejor que el de varios competidores que sí tienen miles de clientes.

Tu sensación de que "ya está completo" es correcta. El error fue asumir que "completo" y
"vendible" son la misma etapa, y luego medir el resultado con un instrumento roto que te decía que
48 personas se registraban cada mes.

El producto no es el problema. El silencio sí.
