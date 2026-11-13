# ADR-034: Asistente anclado en Cloudflare con consumo verificable

## Estado

Aceptada para implementación y validación el 2026-11-12. Reemplaza la elección de proveedor de
[ADR-017](ADR-017-asistente-respuestas-ancladas.md), conservando sus principios de evidencia,
aislamiento, consentimiento y plazo. No aprueba activar inferencia en producción.

## Contexto

El dueño eligió Workers AI y pidió ampliar respuestas directas, reducir llamadas/tokens y
conciliar Qwen sin liberar reservas inciertas, con evaluación dentro de la cuota gratuita.
Las pruebas de prosa libre cumplían JSON, pero insinuaban disponibilidad futura de utilidad
sin evidencia. Además, Qwen conservaba siempre la reserva máxima y podía agotar capacidad
interna antes de consumirla realmente.

## Decisión

- El perfil de consulta Cloudflare usa `@cf/qwen/qwen3.8-27b`, sin razonamiento ni fallback.
  Ese perfil se aplica sólo con mutaciones apagadas y el modelo principal seleccionado.
  No usa el modelo auxiliar próximo a retiro. Las otras rutas conservan su implementación.
- Las preguntas completas reconocidas, incluidas variantes y fórmulas de cortesía acotadas,
  usan reportes/guías de Kova sin inferencia. No se buscan coincidencias dentro de instrucciones,
  negaciones, preguntas compuestas ni referencias a otro negocio.
- La selección de lecturas tiene hasta 256 tokens. Los reportes se redactan desde lecturas del
  servidor, sin llamada final. Para fuentes textuales, el selector devuelve hasta tres IDs de
  pasajes en un máximo de 128 tokens; Kova copia las citas y rechaza identificadores inventados.
  El selector no recibe historial, configuración ni lecturas financieras.
- Se conserva el plazo de diez segundos incluyendo cola, con transporte asíncrono acotado y el
  puente JSPI de Python Workers. Una respuesta incompleta no se reintenta con más tokens.
- Antes de enviar se reserva contexto y salida máxima bajo los locks existentes. Sólo una
  respuesta completa del perfil `qwen3.8-grounded-no-thinking-v1` puede conciliarse. Deben
  coincidir tokens de entrada/salida/total, caché y neuronas con los precios del perfil;
  los contadores deben caber en la reserva y no incluir razonamiento u otras modalidades.
- Se conserva el 115% del consumo verificable redondeado hacia arriba y se devuelve el resto
  atómicamente a los cuatro buckets del periodo original. El ID de reserva impide doble crédito.
  Un timeout, cancelación, vencimiento, recibo antiguo o telemetría ambigua conserva el máximo.
- La evaluación externa mantiene su propio ledger conservador y no descuenta reservas históricas.
  Workers Paid no impone este límite local: consumo compartido y analítica retrasada siguen
  siendo consideraciones para el control global de producción.

## Validación y límites

Las pruebas de Postgres verifican respuestas directas, un solo llamado en reportes, selección
anclada, conciliación de ambos llamados, idempotencia, caché y retención de incertidumbre. El
runtime Pyodide prueba el selector y su conciliación con transporte simulado. El ensayo de
navegador/carga local valida auth/RLS sin inferencia externa.

La selección real de la guía offline conservó sincronización, no duplicación y cita, con
23.15 neuronas frente a 79.97 de la explicación libre anterior de ese caso. Son mediciones
de la etapa final en un caso sintético; no acreditan ahorro global ni calidad del corpus entero.
La evidencia y pendientes están en el [runbook](../runbooks/assistant-acceptance.md).

Para activar siguen siendo necesarios corpus y revisión humana, credenciales de producción
por el mecanismo de secretos, consentimiento Cloudflare vigente y aceptación del recorrido
con proveedor/carga sobre el runtime alojado. Documentos, correo y mutaciones siguen fuera
de esta entrega. No se cambia producción, se publica ni se crea un gasto por esta decisión.

Fuentes verificadas: [perfil de Qwen](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
y [precios de Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).
