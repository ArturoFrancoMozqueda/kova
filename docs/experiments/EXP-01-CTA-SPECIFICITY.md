# EXP-01 — Especificidad del CTA

Estado: **preregistrado; se activa al desplegar CRO-1 en producción**.

## Hipótesis y segmento

Para visitantes nuevos, mobile y no autenticados, explicar el valor concreto del trial en el CTA
principal aumentará el clic hacia signup sin empeorar el uso del CTA secundario, los errores de
signup ni el LCP.

- Control: `Empieza gratis`.
- Tratamiento: `Prueba Kova 7 días gratis`.
- Fuente del tratamiento: `BILLING_TRIAL_CTA_LABEL_ES`, derivada de la constante canónica de 7 días.
- Asignación: 50/50 determinística por `client_id`; un cliente conserva su variante.
- Elegibilidad inicial: viewport menor a 768 px, sesión no autenticada y sin `client_id` previo.
- Exposición: `experiment_exposed` al renderizar el CTA del hero, una vez por carga.
- Atribución: los clics del hero y `signup_started` incluyen `experiment_id` y `variant`.

## Métricas y guardrails

- Primaria: clientes expuestos con `landing_cta_clicked` en `cta=hero` / clientes expuestos.
  Es el análisis por cliente del cociente `landing_cta_clicked / landing_viewed`, unido por
  `client_id` para evitar contar clics repetidos como observaciones independientes.
- Secundaria: `signup_completed / landing_viewed` para los clientes expuestos.
- Guardrails: clic en `cta=hero_secondary`, `signup_validation_failed` y LCP mobile.
- Cortes obligatorios: variante, viewport 320/390, source/medium y campaña.

## Tamaño muestral preregistrado

Consulta agregada de los 30 días anteriores al 2026-07-20: 7 clientes con CTA entre 831 clientes
con landing (`0.842%`). No se consultó PII.

Se preregistra un MDE de 100% relativo (`0.842% → 1.685%`), prueba bilateral con α=0.05 y potencia
de 80%. El mínimo es **2,759 clientes expuestos por variante; 5,518 en total**. El corte de 7 o 30
días no reemplaza este mínimo.

## Regla de decisión

- Ganador: intervalo de confianza de 95% favorable, muestra mínima alcanzada y ningún guardrail
  deteriorado más de 10%.
- Perdedor: intervalo de confianza de 95% desfavorable o guardrail deteriorado más de 10%.
- En cualquier otro caso: **inconcluso**. No se detiene por una diferencia temprana favorable.
- Solo EXP-01 puede modificar este CTA mientras esté activo.

## Rollback

Desactivar la asignación de EXP-01 y volver a `copy.landing.hero.ctaPrimary`. La telemetría histórica
se conserva; no requiere migración ni limpieza de datos. El destino `/signup` o `/dashboard` no se
modifica durante el rollback.
