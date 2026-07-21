# Exportación CRO de telemetría

## Propósito

Descargar una ventana móvil de 30 días para medir adquisición, activación y monetización por
`client_id` sin crear una ruta pública ni incluir PII o datos financieros.

## Autorización

La ruta `GET /api/v1/telemetry/internal/cro-export`:

- no aparece en OpenAPI;
- exige `X-Internal-Key` y compara la llave en tiempo constante;
- usa la conexión privilegiada únicamente porque une telemetría anónima y autenticada entre tenants;
- devuelve solo dimensiones CRO acotadas, nunca `tenant_id`, `user_id`, correo, nombre o importe.

No copies la llave a scripts, historiales, tickets o documentación. Inyéctala desde el gestor de
secretos del entorno operativo.

## Ejecución

```bash
curl --fail --silent --show-error \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  https://api.kovasuite.com/api/v1/telemetry/internal/cro-export \
  --output "kova-cro-30d-$(date +%F).csv"
```

Comprueba que el archivo contiene estas columnas:

`date,event,client_id,device_class,viewport_bucket,source,medium,campaign,cta,section,experiment_id,variant,conversion_state`

## Manejo seguro

- Trata `client_id` como identificador pseudónimo y limita el archivo al equipo que analiza CRO.
- No lo unas con correos, nombres, teléfonos, tenants ni exportaciones financieras.
- Conserva solo el tiempo necesario para los cortes de 7 y 30 días.
- Elimina el archivo local al terminar el análisis conforme a la política operativa vigente.
- Si una fila carece de contexto, clasifícala como `unknown`; no infieras el segmento.

## Verificación posterior al despliegue

1. Confirma que un evento landing nuevo trae dispositivo y first-touch.
2. Completa un signup controlado y confirma `signup_completed` con el mismo `client_id`.
3. Verifica que `signup_validation_failed` solo contiene `field` y `reason_code` categóricos.
4. Genera el CSV y comprueba que el estado de conversión avanza por prioridad:
   landing → CTA → signup iniciado → signup completado → activado → pagado.
5. Si falta volumen, registra el resultado como inconcluso; no declares uplift ni causalidad.

## Análisis reproducible de 7 y 30 días

El analizador opera únicamente sobre este CSV acotado y nunca imprime `client_id`. Deduplica
exposiciones por cliente, descarta asignaciones contradictorias y solo atribuye acciones ocurridas
después de la primera exposición de la ventana.

```bash
cd backend
uv run python scripts/analyze_cro_export.py ../kova-cro-30d-AAAA-MM-DD.csv \
  --days 7 --as-of AAAA-MM-DDT00:15:00Z \
  > ../cro-exp-01-7d-AAAA-MM-DD.md

uv run python scripts/analyze_cro_export.py ../kova-cro-30d-AAAA-MM-DD.csv \
  --days 30 --as-of AAAA-MM-DDT00:15:00Z \
  > ../cro-exp-01-30d-AAAA-MM-DD.md
```

El reporte incluye por variante:

- clientes expuestos y tasas de CTA hero, signup, CTA secundario y error de validación;
- intervalo Wilson de 95% para cada tasa;
- uplift relativo y diferencia absoluta tratamiento − control con intervalo Newcombe-Wilson;
- cortes por `device_class`, `viewport_bucket`, canal `source/medium` y campaña;
- decisión automática `winner`, `loser` o `inconclusive*` con la muestra preregistrada de 2,759
  clientes por variante.

La decisión automática es un gate, no una autorización para publicar causalidad. Revisa tráfico
interno/bots, calidad de segmentos, guardrails y el registro del experimento antes de cambiar copy.
Después de cada corte, adjunta el Markdown generado a `docs/audits/` y recalcula ICE con la muestra
y el efecto observados. Si la ventana todavía no ha transcurrido, registra el checkpoint como
pendiente; no adelantes el `--as-of` ni mezcles días pre-rollout.
