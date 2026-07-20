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
