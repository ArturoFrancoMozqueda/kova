# Evidencia CRO-5 — Rollout y aprendizaje

Estado: **CRO-5.1 y CRO-5.2 aprobados; infraestructura de CRO-5.3 lista, cortes de 7 y 30 días
pendientes por tiempo calendario**.

## Rollout en lotes pequeños

| Lote | Alcance | Merge en `main` | Estado de despliegue | Rollback |
|---|---|---|---|---|
| 1A | Home mobile y EXP-01 | `9ca253e` / PR #63 | CI, Vercel y release verificados | Revertir `9ca253e` |
| 1B | Signup recuperable | `5281359` / PR #64 | CI, Vercel y release verificados | Revertir `5281359` |
| 1C | Validación de efectivo POS | `0cd2400` / PR #65 | CI, Vercel y release verificados | Revertir `0cd2400` |
| 2 | Billing y retorno de Checkout | `90d3ca5` / PR #66 | CI y Vercel aprobados; Fly release 235 sana tras reintento de un timeout 408 | Revertir `90d3ca5` |

Los cambios se publicaron en PR separados para aislar rollback y diagnóstico. El timeout de Fly en
el lote 2 ocurrió antes de reemplazar máquinas; el reintento del mismo run completó release command,
dejó ambas máquinas en versión 235 y confirmó `/health` y `/health/db` con HTTP 200.

## Comparación pre/post disponible

- Home sí tiene comparación de performance: baseline mobile LCP mediano 2.509 s y validación
  post-CRO-1 de 1.773 s. Es evidencia de performance, no de uplift de conversión.
- Signup, efectivo y billing tienen comparaciones conductuales automatizadas antes/después en sus
  auditorías; no existe aún una ventana post-rollout suficiente para atribuir cambios de tasa.
- El baseline previo carecía de `signup_completed` confiable y de dimensiones de dispositivo/canal.
  Por ello no se fabricará una comparación histórica incompatible. Los cortes instrumentados
  comienzan después de completar el rollout.

## Aislamiento experimental

- [`docs/experiments/EXPERIMENT-REGISTRY.md`](../experiments/EXPERIMENT-REGISTRY.md) declara EXP-01
  como único experimento activo y reserva landing hero/signup.
- La variante permanece estable por `client_id` en `localStorage`.
- `experiment_exposed` ahora se deduplica una vez por sesión y variante mediante `sessionStorage`;
  navegadores sin storage conservan el fallback una vez por carga.
- El analizador excluye clientes con asignaciones contradictorias y no imprime identificadores.

## Cortes pendientes

El rollout terminó el 2026-07-21 alrededor de las 00:15 UTC. Los primeros checkpoints comparables
son:

- 7 días: 2026-07-28 00:15 UTC.
- 30 días: 2026-08-20 00:15 UTC.

`backend/scripts/analyze_cro_export.py` genera el reporte preregistrado desde el CSV protegido:
muestra, tasas, intervalos de 95%, uplift, mobile/desktop, viewport y canales. La decisión seguirá
siendo inconclusa si no alcanza 2,759 clientes por variante. ICE se recalculará únicamente al
adjuntar cada resultado real; no se declara ganador en esta entrega.

## Validación y seguridad

- Vitest focal de Home/funnel: 17/17; suite frontend completa: 288/288.
- ESLint, typecheck focal y build Vite/SSR con prerender: aprobados.
- Pytest focal del analizador: 3/3; cubre deduplicación, orden temporal, conflictos, segmentos,
  intervalos y decisión por muestra. Ruff focal: aprobado.
- El analizador es local y de solo lectura. No añade endpoint, migración ni dependencia.
- No se consultan ni exponen correos, nombres, tenants, importes o credenciales. `client_id` se usa
  solo en memoria para deduplicar y nunca aparece en el reporte.

No cambian autenticación, sesiones, RLS, tenant isolation, billing, Stripe, precio, trial, reglas
de acceso ni offline sync.
