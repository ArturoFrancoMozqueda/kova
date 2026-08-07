# Registro de experimentos CRO activos

Última actualización: 2026-08-07.

Este registro evita solapar variantes sobre el mismo tramo del embudo. Antes de activar un
experimento se debe reservar una superficie, confirmar que no existe otro experimento activo en
ella y preregistrar hipótesis, muestra, métricas, guardrails y rollback.

| Experimento | Estado | Tramo | Superficie reservada | Segmento | Inicio | Cortes |
|---|---|---|---|---|---|---|
| `exp_01_cta_specificity` | pausa aprobada; pendiente de despliegue | adquisición | landing · CTA primario del hero | visitante nuevo, mobile y no autenticado | 2026-07-20 | cierre: inconcluso por muestra insuficiente |

## Decisión de pausa del rediseño inmersivo

- Decisión: al desplegar la nueva landing se deja de asignar EXP-01 y se conserva `Empieza gratis`
  como CTA estable. El código local ya no genera exposiciones nuevas; producción conserva el
  experimento hasta ese despliegue.
- Responsable de la decisión: owner del producto, 2026-07-27.
- Evidencia observacional agregada desde 2026-07-20: 413 visitantes con `landing_viewed`, 131 que
  alcanzaron `producto`, 33 `problema`, 5 `precio` y 3 `cta-final`; 7 visitantes registraron clic
  de CTA. No se consultó ni documentó PII.
- Interpretación: la muestra está muy por debajo de los 5,518 clientes preregistrados y no permite
  declarar ganador. El rediseño cambia la superficie completa, por lo que continuar el A/B
  mezclaría dos experiencias y dejaría de producir evidencia comparable.
- Conservación: no se borran asignaciones, exposiciones ni eventos históricos. La nueva landing
  inicia una línea base observacional separada.

## Línea base observacional post-overhaul (2026-07-29)

- Cambio: overhaul de conversión + elevación visual de la landing del film (mismo orden de
  secciones): oferta completa en el hero (precio + `≈ $/día` derivado + trial), barra CTA fija de
  móvil (`landing_cta_clicked{cta:"sticky_mobile"}` — valor nuevo sobre evento existente, sin
  cambios de backend), strip de testimonios reales tras el hero (sin id de sección), compresión del
  tramo medio (#una-venta/#panel-dueno/#problema) y crescendo tipográfico hacia #precio.
- EXP-01 sigue en pausa; no se asignan variantes. Esta entrada declara la nueva línea base
  observacional; los datos previos al despliegue no son comparables sección a sección.
- Baseline de referencia (2026-07-20→27): 413 `landing_viewed`; alcance `producto` 31.7%,
  `problema` 8.0%, `precio` 1.2%, `cta-final` 0.7%; 7 clics de CTA (1.7%).
- Objetivos a 2 semanas comparables post-despliegue:
  - Alcance de `precio` / `landing_viewed` ≥ 4% (baseline 1.2%).
  - Clics de CTA / `landing_viewed` ≥ 3.5% (baseline 1.7%).
  - `cta-final` ≥ 2% (baseline 0.7%).
  - `sticky_mobile` ≥ 25% de los clics de CTA en móvil (valida el CTA ambiente).
- Guardrails: completación del film (`landing_film_chapter` = `analisis`) no cae más de 10%;
  la conversión `signup_started` → `signup_completed` no se deteriora (buscamos claridad de
  oferta, no clics de curiosidad). Sin PII, misma telemetría anónima allowlisted.
- Responsable: owner del producto. Evaluación con los mismos eventos existentes
  (`landing_viewed`, `landing_section_viewed`, `landing_film_chapter`, `landing_cta_clicked`,
  `signup_started`).

## Cierre de la línea base post-overhaul: invalidada (2026-08-04)

- Estado: la línea base declarada el 2026-07-29 no es evaluable. Se cierra sin lectura de
  resultado. La entrada anterior se conserva tal cual; esta la corrige.
- Motivo 1 — ventana contaminada al día siguiente. El overhaul se desplegó con el PR #81
  (2026-07-29) y el PR #82 (`codex/landing-conversion-redesign`, 2026-07-30) ya reescribió la
  composición de la landing; los PRs #84–88 (2026-08-02) y #89–91 (2026-08-04) siguieron
  cambiándola. La ventana de atribución limpia fue de un día: 2026-07-29, con 17 `landing_viewed`
  y 0 clics de CTA. Ninguna de las metas a 2 semanas puede adjudicarse al overhaul.
- Motivo 2 — dos señales preregistradas nunca emitieron. En `anonymous_telemetry_events` no existe
  ninguna fila con `landing_cta_clicked{cta:"sticky_mobile"}`, ni un solo evento
  `landing_film_chapter` en toda la historia de la tabla. Los componentes que los emitían
  (`landing/StickyCta.tsx`, `landing/film/HeroFilm.tsx`) dejaron de montarse en los rediseños
  posteriores y permanecieron en el árbol sin renderizarse; este PR elimina ese código muerto. El
  guardrail de completación del film era inmedible desde el registro de la línea base.
- Datos observados igualmente (2026-07-29→08-05 UTC, 244 `landing_viewed`): alcance de `precio`
  15.6%, clics de CTA 16.0%, `cta-final` 6.1%. Los tres superan los objetivos preregistrados
  (≥4%, ≥3.5%, ≥2%), pero no son atribuibles: los 39 clics de CTA aparecen a partir del
  2026-08-01 y todos llevan `cta:"hero"`, es decir caen en la ventana de los PRs #83–88.
- Baseline recalculado con la misma consulta (2026-07-20→27): 455 `landing_viewed`, `precio` 1.5%,
  clics de CTA 2.4%, `cta-final` 1.1%. Difiere de los 413 / 1.2% / 1.7% / 0.7% anotados el
  2026-07-29 (ventana o huso horario distinto al consultar). Se deja constancia de ambas lecturas
  en vez de reescribir la anterior.
- EXP-01 sigue en pausa; no se asignan variantes. Sin PII; misma telemetría anónima allowlisted.
- Siguiente paso: cualquier lectura de conversión exige congelar la landing y declarar una ventana
  nueva antes de medir. Si se quiere recuperar el CTA fijo de móvil hay que reconstruirlo — el
  original condicionaba su visibilidad a `pastHeroFilm()`, un hero-film que ya no se renderiza.

## Reglas operativas

1. Solo puede existir un experimento `activo` por superficie y tramo. EXP-01 reserva tanto el CTA
   primario del hero como su paso inmediato a signup; no se cambia ese copy o destino en paralelo.
2. La asignación es 50/50 determinística por el `client_id` pseudónimo y se conserva en
   `localStorage`. La exposición se registra una vez por sesión y variante en `sessionStorage`.
3. Un cliente con variantes contradictorias se excluye del análisis y se reporta como conflicto;
   nunca se reasigna para favorecer una muestra.
4. El resultado permanece `inconcluso` hasta alcanzar la muestra preregistrada y un intervalo de
   confianza favorable, sin deterioro mayor a 10% en guardrails.
5. Pausar o cerrar un experimento exige fecha, decisión, evidencia y responsable. La telemetría
   histórica no se borra.

## Próxima disponibilidad de superficie

Landing hero y signup permanecen reservados hasta el corte válido de EXP-01. No hay otro
experimento CRO activo en activación, caja o monetización; CRO-2, CRO-3 y CRO-4 fueron correcciones
directas, no variantes experimentales.
