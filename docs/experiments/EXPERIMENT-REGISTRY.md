# Registro de experimentos CRO activos

Última actualización: 2026-07-21.

Este registro evita solapar variantes sobre el mismo tramo del embudo. Antes de activar un
experimento se debe reservar una superficie, confirmar que no existe otro experimento activo en
ella y preregistrar hipótesis, muestra, métricas, guardrails y rollback.

| Experimento | Estado | Tramo | Superficie reservada | Segmento | Inicio | Cortes |
|---|---|---|---|---|---|---|
| `exp_01_cta_specificity` | activo | adquisición | landing · CTA primario del hero | visitante nuevo, mobile y no autenticado | 2026-07-20 | 7 días: 2026-07-28; 30 días: 2026-08-20 |

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
