# ADR-017: Asistente con cifras del backend y pasajes anclados

## Estado

Aceptada el 2026-10-08. Reemplaza a `docs/research/ASSISTANT-DECISION-2026-10-07.md` (retirado del
árbol el 2026-10-27; la evaluación completa, con mediciones y costos, está en el historial git).

La activación en producción **no** está aprobada: `ASSISTANT_OPENROUTER_QUALITY_VERIFIED` sigue en
`false` por defecto, y la ingesta de documentos está desactivada (ver
[arquitectura](../arquitectura.md)).

## Contexto

El asistente responde preguntas del negocio y consulta archivos propios del tenant. En la
evaluación, las respuestas libres de los modelos fallaban aunque cumplieran el formato JSON:
confundían ventas con utilidad, inventaban interpretaciones y convertían una muestra parcial en
afirmaciones sobre todo el negocio. El operador exigió como máximo 10 s por consulta completa y un
gasto controlado.

## Decisión

1. **Las cifras y conclusiones de reportes las escribe Kova, no el modelo.** El backend usa sus
   consultas, permisos y definiciones de métricas existentes, y redacta la explicación y sus
   limitaciones. Las lecturas numéricas no se envían al modelo.
2. **Para documentos, el modelo solo elige pasajes.** El servidor prepara pasajes de fuentes
   autorizadas, el modelo devuelve sus identificadores dentro de un esquema cerrado y Kova
   reconstruye el texto y la cita original. Se rechazan frases o citas nuevas.
3. **El proveedor y la ruta son fijos.** Ruta vigente: OpenRouter → Mistral Small 4
   (`mistralai/mistral-small-2603`, `mistral/us`), sin razonamiento, sin fallback, con ZDR y
   recolección de datos denegada. El consentimiento del usuario nombra a OpenRouter y a Mistral;
   un consentimiento para otro destinatario no autoriza esta ruta.
4. **El gasto se controla en Postgres.** Hay reservas compartidas entre procesos, topes diarios por
   negocio y por cuenta, y un presupuesto mensual de producción en cero por defecto. Un resultado
   incierto conserva la reserva máxima.
5. **El plazo cuenta desde que se crea la consulta**, cola incluida. Al vencer no se entrega una
   respuesta tardía ni se reintenta.
6. **El asistente no hace mutaciones ni envía correos**, y CSV/XLSX se procesan por el importador
   con vista previa, no por chat.

## Alternativas descartadas

- Groq Free / GPT-OSS-20B: errores de formato y capacidad insuficiente.
- GPT-OSS-120B por Groq: HTTP 429 e interpretación financiera incorrecta.
- Qwen en CoreWeave: errores semánticos y de formato en la batería completa.
- DeepSeek con razonamiento: 14–20 s, fuera del límite.
- GPT-OSS-120B por Cerebras: fue la primera selección, pero se reemplazó por Mistral el
  2026-10-08.

## Consecuencias

- Cambiar de modelo o de ruta exige una evaluación nueva ligada al hash de código y perfil
  (`ASSISTANT_OPENROUTER_APPROVED_PROFILE`) y un consentimiento nuevo de los usuarios.
- Antes de activar faltan: revisión humana de pertinencia y es-MX, una clave de producción
  propia, prueba de carga con cola, red e interfaz autenticada y, para archivos, la ingesta
  aislada con antivirus y OCR más QA real de carga, retiro y permisos.
