# Plan CRO task-driven de Kova

## Resumen

Este documento organiza las mejoras de conversión de Kova como un backlog CRO independiente y ejecutable. Debe enlazarse desde `docs/current-sprint.md` cuando el equipo decida incorporarlo al sprint activo, sin duplicar tareas ya presentes en `PLAN-DESIGN.md`.

### Objetivos primarios

- **Adquisición:** `signup_completed / landing_viewed`.
- **Activación:** `first_sale_completed / signup_completed`.
- **Monetización:** `trial_to_paid / signup_completed`.
- **Segmentación obligatoria:** mobile/desktop, canal y nuevos/recurrentes.
- **Ponderación ICE:** 80% mobile.

### Reglas de ejecución

- Corregir directamente los defectos de claridad, validación y facturación.
- Probar como experimento únicamente alternativas de copy o persuasión cuya superioridad no sea evidente.
- No agregar claims, testimonios, prueba social, precios ni beneficios fuera de las fuentes actuales.
- Usar tamaños `S ≤ 1 día`, `M = 2–3 días` y `L = 4–5 días`.
- No declarar causalidad ni ganadores cuando la muestra no alcance el criterio estadístico definido.

## Orden recomendado

1. Instrumentación mínima y baseline.
2. Primer lote: hero mobile, signup y validación de efectivo.
3. Confianza de billing y checkout.
4. Consistencia del CTA para usuarios autenticados.
5. Experimentos controlados y revisión de ICE.

## Estado de ejecución

- [x] **Epic CRO-0 — Medición y baseline** (2026-07-20). Contexto común y eventos
  categóricos implementados; exportación interna documentada en
  [`docs/runbooks/cro-telemetry-export.md`](../runbooks/cro-telemetry-export.md); baseline de
  producción y tres corridas Lighthouse en
  [`docs/audits/CRO-BASELINE-2026-07-20.md`](../audits/CRO-BASELINE-2026-07-20.md).
- [x] **Epic CRO-1 — Home y demostración mobile** (2026-07-20). Hero y CTA priorizados en mobile,
  showcase consistente, EXP-01 preregistrado y gate Lighthouse aprobado con LCP mediano 1.773 s;
  evidencia en [`docs/audits/CRO-1-HOME-2026-07-20.md`](../audits/CRO-1-HOME-2026-07-20.md).
- [x] **Epic CRO-2 — Signup claro y recuperable** (2026-07-20). Reglas de contraseña alineadas con
  backend, errores 422 por campo con foco accesible, confianza junto al CTA y telemetría sin PII;
  evidencia en [`docs/audits/CRO-2-SIGNUP-2026-07-20.md`](../audits/CRO-2-SIGNUP-2026-07-20.md).
- [x] **Epic CRO-3 — Carrito POS sin ansiedad prematura** (2026-07-20). El efectivo inicia con
  ayuda neutral, conserva las guardas de cobro, reinicia la interacción entre ventas y registra
  bloqueos únicamente después de interacción; evidencia en
  [`docs/audits/CRO-3-POS-CASH-2026-07-20.md`](../audits/CRO-3-POS-CASH-2026-07-20.md).
- [ ] **Epic CRO-4 — Billing y checkout confiables**. CRO-4.1–4.5 completados; CRO-4.6 requiere
  un entorno Stripe test mode separado y permanece como gate operativo. Evidencia en
  [`docs/audits/CRO-4-BILLING-2026-07-20.md`](../audits/CRO-4-BILLING-2026-07-20.md).
- [ ] **Epic CRO-5 — Rollout y aprendizaje**. CRO-5.1/5.2 completados; analizador de CRO-5.3 listo.
  Los cortes reales de 7 y 30 días quedan pendientes hasta 2026-07-28 y 2026-08-20; evidencia en
  [`docs/audits/CRO-5-ROLLOUT-2026-07-21.md`](../audits/CRO-5-ROLLOUT-2026-07-21.md).

---

## Epic CRO-0 — Medición y baseline

**Resultado esperado:** poder atribuir cada mejora al tramo correcto del embudo sin exponer PII.

| ID | Tarea | Prioridad / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-0.1 | Ampliar el contexto común de telemetría | P0 / M | MECLABS: separar motivación, valor y fricción mediante conducta observable | Todos los eventos incorporan `device_class`, `viewport_bucket`, first-touch `source/medium/campaign`, `client_id`, CTA/sección y experimento cuando aplique. No se envían correos, nombres, importes ni query strings completos. |
| CRO-0.2 | Completar eventos de diagnóstico | P0 / S | Fogg: identificar si la caída proviene de motivación, capacidad o prompt | Añadir `signup_validation_failed`, `sale_validation_blocked`, `checkout_state_viewed` y `experiment_exposed`. Las propiedades aceptan únicamente categorías predefinidas, nunca valores ingresados por el usuario. |
| CRO-0.3 | Crear exportación CRO de 30 días | P0 / M | Disciplina experimental: medir antes de atribuir causalidad | Exportación autorizada, sin nuevo endpoint público, con fecha, evento, `client_id`, dispositivo, fuente/campaña, CTA/sección, variante y estado de conversión. Une anónimo y autenticado por `client_id`. |
| CRO-0.4 | Registrar baseline de conversión y performance | P0 / S | LIFT: cuantificar fricción y distracción | Reportar tasas por segmento y tres corridas Lighthouse mobile. Registrar mediana de Performance, FCP, LCP, TBT, CLS y Speed Index. En producto autenticado medir carga fría/caliente, skeleton y tiempo hasta actuar. |

**Dependencia:** CRO-0.1 debe estar desplegado antes de iniciar experimentos, pero no bloquea correcciones evidentes.

---

## Epic CRO-1 — Home y demostración mobile

**Resultado esperado:** la propuesta de valor y el CTA aparecen antes que la animación de marca.

| ID | Tarea | Prioridad / ICE / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-1.1 | Priorizar el contenido del hero en mobile | P0 / 720 / M | LIFT: propuesta de valor, relevancia y distracción. MECLABS: `4m + 3v`. | En 320×844 y 390×844 aparecen primero H1, soporte y CTA. El logo pasa después del contenido y no desplaza la promesa fuera del primer viewport. |
| CRO-1.2 | Eliminar el retraso artificial del LCP | P0 / incluido / S | Fogg Ability: reducir espera. MECLABS: reducir fricción. | `.lp-hero-copy` no inicia oculta, desenfocada ni depende del reveal. La animación visual comienza después del contenido y respeta `prefers-reduced-motion`. Mediana LCP mobile ≤2.2 s y nunca >2.5 s en las tres corridas. |
| CRO-1.3 | Unificar el destino de todos los CTA | P1 / 270 / S | Cialdini — consistencia; Fogg — prompt inequívoco | El showcase embebido recibe el mismo destino que Home: `/signup` para visitantes y `/dashboard` para autenticados. El export standalone conserva `/signup`. Todos los clics reportan su ubicación. |
| CRO-1.4 | Probar mayor especificidad del CTA | P1 / 441 / M | MECLABS: aumentar valor y reducir ansiedad. Fogg: prompt específico. | Ejecutar EXP-01 únicamente después de CRO-0. Los textos provienen de constantes verificadas de trial. |

### EXP-01 — Especificidad del CTA

- **Control:** `Empieza gratis`.
- **Tratamiento:** `Prueba Kova 7 días gratis`.
- **Segmento:** visitantes nuevos mobile no autenticados.
- **Exposición:** al renderizar el CTA primario.
- **Métrica primaria:** `landing_cta_clicked / landing_viewed`.
- **Métrica secundaria:** `signup_completed / landing_viewed`.
- **Guardrails:** clic en CTA secundario, errores de signup y LCP.
- **Decisión:** preregistrar el tamaño muestral desde el baseline; declarar ganador solo con un intervalo de confianza de 95% favorable y sin deterioro mayor a 10% en guardrails. Sin muestra suficiente, el resultado es inconcluso.

---

## Epic CRO-2 — Signup claro y recuperable

**Resultado esperado:** el usuario conoce las reglas antes de enviar y cada error señala el campo correcto.

| ID | Tarea | Prioridad / ICE / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-2.1 | Mostrar requisitos de contraseña antes del envío | P0 / 648 / S | Fogg Ability; MECLABS: reducir fricción | Debajo del campo se muestra “8 caracteres, al menos una letra y un número”. La validación frontend replica exactamente el contrato backend de 8–128 caracteres. |
| CRO-2.2 | Mapear correctamente los errores 422 | P0 / 648 / M | LIFT: claridad. Fogg: aumentar capacidad de recuperación | Interpretar `detail[].loc` de FastAPI y asociar errores a negocio, correo o contraseña. No volver a convertir todos los 422 en “correo inválido”. Llevar el foco al primer campo inválido y asociar el mensaje mediante `aria-describedby`. |
| CRO-2.3 | Añadir confianza junto al submit | P1 / 336 / S | MECLABS: reducir ansiedad; Cialdini — compromiso gradual | Mostrar junto al CTA: “7 días gratis. Sin tarjeta para empezar.” Mantener aceptación legal y enlaces existentes. No agregar garantías nuevas. |
| CRO-2.4 | Medir errores sin capturar datos | P1 / habilitador / S | Diagnóstico Fogg MAP | `signup_validation_failed` registra únicamente `field` y `reason_code`. Nunca contraseña, correo ni nombre del negocio. |

**Integración:** estas tareas amplían `PLAN-DESIGN T3.4`; no debe mantenerse la instrucción previa de mapear genéricamente cualquier 422 como correo inválido.

---

## Epic CRO-3 — Carrito POS sin ansiedad prematura

**Resultado esperado:** la caja guía antes de marcar un error y mantiene intactas las reglas de cobro.

| ID | Tarea | Prioridad / ICE / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-3.1 | Introducir estado de interacción del efectivo | P0 / 648 / M | MECLABS: reducir ansiedad y fricción. Fogg: feedback después de la acción. | Con carrito lleno y efectivo sin tocar se muestra ayuda neutral, no error rojo. El error aparece al ingresar un monto insuficiente, abandonar el campo o intentar cobrar. |
| CRO-3.2 | Conservar guardas financieras y reiniciar estado correctamente | P0 / incluido / S | Confianza y prevención de error | El CTA continúa bloqueado cuando el efectivo no cubre el total. Cambiar método, vaciar carrito o completar venta limpia el estado `touched/attempted`. Un importe suficiente muestra el cambio a entregar. |
| CRO-3.3 | Verificar el flujo mobile | P1 / incluido / S | Fogg Ability | En 320×844 y 390×844 el resumen, selector de pago, mensaje y CTA permanecen visibles y operables con teclado abierto. Registrar `sale_validation_blocked` solo después de interacción. |

**Integración:** implementar junto con `PLAN-DESIGN T2.2` si está activo; CRO-3.1 no debe quedar bloqueado por el rediseño completo de densidad.

---

## Epic CRO-4 — Billing y checkout confiables

**Resultado esperado:** precio, periodo y estado de pago nunca presentan información ambigua o prematura.

| ID | Tarea | Prioridad / ICE / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-4.1 | Mostrar precio con moneda y cadencia | P0 / 540 / S | MECLABS: reducir ansiedad; Cialdini — consistencia | Billing muestra el formato canónico `$299 MXN/mes`, utilizando `plan.amount_minor_units`, `currency` e `interval`; sin precio hardcodeado. |
| CRO-4.2 | Exponer frescura del periodo de Stripe | P0 crítico / 360 / M | Confianza y autoridad de la fuente | Añadir `period_freshness: "verified" \| "stale" \| "unavailable"` a la respuesta de suscripción. `verified` exige fecha futura y sincronización Stripe ≤24 h; `stale` conserva una fecha no verificable; `unavailable` no tiene fecha. |
| CRO-4.3 | Evitar fechas de renovación imposibles | P0 crítico / incluido / M | LIFT: ansiedad y claridad | Solo `verified` muestra “Próxima renovación”. Para `stale/unavailable`: “Estamos verificando tu próxima fecha de renovación. Tu acceso actual no cambia.” Nunca mostrar como vigente una fecha pasada. |
| CRO-4.4 | Separar retorno de Stripe de activación confirmada | P0 / 336 / M | MECLABS: reducir ansiedad; consistencia del sistema | Al volver de Stripe: “Estamos confirmando tu suscripción”. Mostrar “Suscripción activa” únicamente cuando backend confirme `active`. Si vence el retry, indicar que no repita el pago y ofrecer recuperación o soporte. |
| CRO-4.5 | Diagnosticar la suscripción activa con periodo vencido | P0 operativo / M | Autoridad: Stripe como fuente de verdad | Verificar modo test/live, webhooks, logs y respuesta de Stripe antes de reconciliar. No editar manualmente fechas ni IDs. Documentar causa, tenants afectados y procedimiento seguro de recuperación. |
| CRO-4.6 | Validar Stripe alojado en test mode | P0 gate / S | Reducción de ansiedad cerca de la conversión | Revisar resumen, moneda, cadencia, campos, errores, cancelación y regreso. No usar tarjeta real ni completar un cargo live. |

### Integración con el backlog existente

- CRO-4.1 y CRO-4.3 se coordinan con `PLAN-DESIGN T2.5`.
- CRO-4.5 y CRO-4.6 forman parte del gate Stripe de Epic 6.
- No se modifican precio, trial, impuestos, cancelación ni reglas de acceso.

---

## Epic CRO-5 — Rollout y aprendizaje

**Resultado esperado:** cada cambio queda medido y el backlog se reprioriza con evidencia.

| ID | Tarea | Prioridad / tamaño | Principio | Criterios de aceptación |
|---|---|---:|---|---|
| CRO-5.1 | Desplegar correcciones directas en lotes pequeños | P0 / S | Reducción de riesgo experimental | Lote 1: CRO-1.1/1.2, CRO-2.1/2.2 y CRO-3.1. Lote 2: billing/checkout. Cada lote incluye rollback y comparación pre/post. |
| CRO-5.2 | Ejecutar un solo experimento simultáneo por tramo | P1 / S | Aislamiento causal | No solapar variantes sobre el mismo CTA o signup. La asignación es estable por `client_id`, con una exposición por sesión y variante. |
| CRO-5.3 | Revisar resultados a 7 y 30 días | P1 / S | Mejora continua basada en evidencia | Reportar muestra, uplift, intervalo, mobile/desktop y canales. Recalcular ICE; no declarar causalidad con volumen insuficiente. |

## Cambios de interfaces previstos

- `SubscriptionResponse.subscription.period_freshness`: campo aditivo con valores `verified`, `stale` o `unavailable`.
- `KovaShowcaseProps`: incorporar `ctaTarget?: string` y callback opcional de tracking; `/signup` continúa como valor por defecto.
- Telemetría: nuevas propiedades acotadas y nuevos nombres de evento permitidos.
- No se espera migración de base de datos: telemetría ya usa JSON y `stripe_period_synced_at` ya existe.
- No cambia ningún contrato de precio, Stripe, autenticación, RLS o aislamiento por tenant.

## Pruebas y aceptación global

### Pruebas automatizadas

- Componentes: Home, KovaShowcase, AuthView, RegisterView y BillingView.
- Backend: los tres estados de `period_freshness`, fallo de Stripe, fecha pasada, sincronización reciente y ausencia de periodo.
- E2E mobile 320×844 y 390×844:
  - home → signup;
  - errores de cada campo;
  - carrito vacío/lleno y efectivo insuficiente/suficiente;
  - billing trial/active/stale;
  - retorno Stripe success/cancel sin cargo.
- Desktop 1440×900 como guardrail.

### Validación manual y performance

- Ejecutar tres corridas Lighthouse mobile y comparar medianas.
- Verificar carga fría/caliente del producto autenticado.
- Confirmar cada evento y propiedad sin PII.
- Adjuntar evidencia visual antes/después de los cambios de interfaz.

### Definition of Done por tarea

- Implementación limitada al alcance de la tarea.
- Tests automatizados relevantes en verde.
- QA manual en desktop y mobile.
- Instrumentación verificada cuando aplique.
- Sin regresiones de autenticación, tenant isolation, offline sync o billing gates.
- Estado actualizado con evidencia; nunca marcar completado por intención.

## Supuestos

- Mobile representa 80% del impacto.
- El trial canónico es de 7 días, sin tarjeta para comenzar, y el precio proviene de las constantes actuales.
- Las correcciones evidentes no se someten a A/B; se validan pre/post.
- Al no existir todavía el CSV de 30 días, la confianza ICE inicial conserva la auditoría heurística y se recalcula después de CRO-0.
- No se crean testimonios, cifras, urgencia artificial ni prueba social.
- Kova continúa en beta pagada controlada; este plan no elimina los gates operativos de lanzamiento.
