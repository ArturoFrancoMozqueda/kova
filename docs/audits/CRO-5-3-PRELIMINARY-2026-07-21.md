# Checkpoint preliminar CRO-5.3 — EXP-01

Estado: **inconcluso por ventana y muestra insuficientes; no es el corte formal de 7 días**.

## Cobertura

El snapshot se generó el 2026-07-21 a las 04:03:47 UTC, 3.81 horas después del rollout
completado a las 00:15 UTC. Se usó la exportación interna protegida y se filtraron únicamente
eventos posteriores al rollout. El CSV permaneció en memoria y no se conservaron ni imprimieron
`client_id`, tenants, usuarios, correos, importes o credenciales.

- Exportación: HTTP 200, 1,576 filas en la ventana móvil de 30 días.
- Filas posteriores al rollout: 91.
- Eventos posteriores al rollout: 46 `landing_viewed`, 30 `experiment_exposed`,
  11 `landing_section_viewed`, 1 `landing_cta_clicked`, 1 `signup_started` y
  2 `signup_completed`.
- Expuestos únicos válidos: 29; no hubo asignaciones contradictorias.
- El clic y los dos signups posteriores al rollout no pertenecieron a clientes expuestos, por lo
  que no se atribuyen a EXP-01.

## Resultado preliminar

| Variante | Expuestos | Hero CTA | IC 95% | Signup | CTA secundario | Error de validación |
|---|---:|---:|---:|---:|---:|---:|
| Control | 14 | 0% (0) | 0%–21.53% | 0% | 0% | 0% |
| Tratamiento | 15 | 0% (0) | 0%–20.39% | 0% | 0% | 0% |

- Diferencia absoluta tratamiento − control: 0 puntos porcentuales.
- IC 95% de la diferencia: −21.53 a +20.39 puntos porcentuales.
- Uplift relativo: no calculable porque la tasa de control es cero.
- Decisión: `inconclusive_insufficient_sample`.
- Avance contra la muestra preregistrada: 14/2,759 control y 15/2,759 tratamiento; 29/5,518 total.

Estos intervalos son deliberadamente amplios. No prueban igualdad entre variantes ni autorizan
cambiar el CTA, detener el experimento o publicar causalidad.

## Segmentos

EXP-01 solo asigna visitantes nuevos mobile, por lo que no se esperan exposiciones desktop.

### Dispositivo y viewport

| Segmento | Control | Tratamiento | Hero CTA atribuido | Signup atribuido |
|---|---:|---:|---:|---:|
| Mobile | 14 | 15 | 0 | 0 |
| `mobile_320` | 0 | 1 | 0 | 0 |
| `mobile_390` | 14 | 14 | 0 | 0 |

### Canal

| Canal | Control | Tratamiento | Hero CTA atribuido | Signup atribuido |
|---|---:|---:|---:|---:|
| `direct/none` | 1 | 3 | 0 | 0 |
| `fb/paid` | 11 | 12 | 0 | 0 |
| `ig/paid` | 2 | 0 | 0 | 0 |

### Campaña

| Campaña categórica | Control | Tratamiento | Hero CTA atribuido | Signup atribuido |
|---|---:|---:|---:|---:|
| `120250851072730431` | 13 | 12 | 0 | 0 |
| `not_set` | 1 | 3 | 0 | 0 |

La distribución temprana no se interpreta como desbalance causal. Con 29 clientes, cualquier
comparación por segmento es únicamente una comprobación de cobertura de instrumentación.

## ICE y decisión operativa

El ICE de CRO-1.4 permanece provisionalmente en **441**. No se modifica Impact ni Confidence con
3.81 horas y 0 conversiones atribuibles; hacerlo aparentaría precisión inexistente. Ease tampoco
cambia porque la implementación ya está desplegada. El recálculo formal se hará con cada corte
maduro usando muestra, efecto e intervalos observados.

Acción: mantener EXP-01 como único experimento del tramo y conservar las variantes actuales. Los
cortes formales permanecen en:

- 7 días: 2026-07-28 00:15 UTC.
- 30 días: 2026-08-20 00:15 UTC.

## Validación

- Export protegido y análisis ejecutados contra producción sin PII.
- El analizador deduplica por cliente, atribuye solo después de la primera exposición y excluye
  conflictos.
- Se añadió el segmento `campaign` que exige la preregistración de EXP-01.
- Pytest focal: 3/3.
- Ruff focal y `git diff --check`: aprobados.
