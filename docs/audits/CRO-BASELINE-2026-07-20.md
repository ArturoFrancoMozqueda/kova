# Baseline CRO — 2026-07-20

Baseline previo al despliegue de CRO-0.1/CRO-0.2. No se usa para declarar causalidad ni
ganadores; documenta el estado observable y los huecos de medición que corrige la epic.

## Conversión — producción, ventana móvil de 30 días

Medido a las `2026-07-20 18:24:56 UTC` con consultas agregadas sobre
`anonymous_telemetry_events` y `telemetry_events`. No se consultaron correos, nombres, importes,
usuarios ni tenants.

| Segmento disponible antes de CRO-0 | Landing | Signup iniciado | Signup completado | Primera venta | Pagado |
|---|---:|---:|---:|---:|---:|
| Nuevo · dispositivo/canal desconocido | 817 | 4 | 0 | 3 | 9 |
| Recurrente · dispositivo/canal desconocido | 5 | 1 | 0 | 2 | 0 |
| **Total** | **822** | **5** | **0** | **5** | **9** |

- Adquisición observable: `0 / 822 = 0%`, pero **no representa la conversión real**. El frontend
  anterior encolaba `signup_completed` hasta una futura sesión autenticada y producción no tiene
  ningún evento de ese tipo en la ventana.
- Activación y monetización: no calculables porque el denominador `signup_completed` está ausente.
- Mobile/desktop, canal y campaña: no calculables porque el contexto común anterior no los enviaba.
- Nuevo/recurrente: `nuevo` significa que el primer evento conocido de ese `client_id` cae dentro de
  la ventana; no implica que sea una persona nueva ni elimina tráfico automatizado.
- Los eventos posteriores sin signup observable no deben interpretarse como una secuencia causal.

El baseline post-despliegue debe esperar una ventana suficiente y usar la exportación CRO de 30
días. Hasta entonces, cualquier uplift es inconcluso.

## Lighthouse mobile — landing de producción

Tres corridas contra `https://kovasuite.com/` con Lighthouse CLI 13.4.0, perfil mobile y throttling
simulado.

| Corrida | Performance | FCP | LCP | TBT | CLS | Speed Index |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 93 | 2.065 s | 2.515 s | 0 ms | 0 | 4.204 s |
| 2 | 93 | 2.059 s | 2.509 s | 0 ms | 0 | 4.129 s |
| 3 | 93 | 2.057 s | 2.507 s | 4 ms | 0 | 4.193 s |
| **Mediana** | **93** | **2.059 s** | **2.509 s** | **0 ms** | **0** | **4.193 s** |

El LCP queda apenas por encima de 2.5 s en las tres corridas y supera el objetivo de 2.2 s definido
para CRO-1.2. La limpieza del perfil temporal de Chrome reportó un `EPERM` después de generar los
tres JSON; los reportes no contienen `runtimeError` y sus métricas son válidas.

## Producto autenticado — entorno local

Tenant demo local, Chromium, `/dashboard`, CTA principal del contenido como condición accionable.

| Condición | Navegación | Tiempo hasta acción |
|---|---:|---:|
| Caché de navegador limpia | 149 ms | 1,003 ms |
| Caché caliente, corrida 1 | 91 ms | 974 ms |
| Caché caliente, corrida 2 | 83 ms | 944 ms |

Con emulación de 500 ms de latencia y 50 KiB/s se confirmaron 38 placeholders de skeleton antes de
mostrar datos. Esta comprobación valida que la espera tiene feedback; no se mezcla con las métricas
sin throttling de la tabla.

QA local observado fuera del alcance: `/api/v1/employees` devolvió 500 dos veces para el tenant demo
durante la carga del dashboard. No bloqueó el contenido ni la medición CRO, pero requiere diagnóstico
separado si se prioriza ese endpoint.
