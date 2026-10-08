# Decisión del asistente de Kova — 2026-10-07

**Solución elegida:** GPT-OSS-120B, razonamiento bajo, en la ruta fija
`cerebras/fp16` de OpenRouter. Kova redacta las conclusiones de reportes; el modelo selecciona
lecturas y pasajes de documentos. Esta selección técnica no acredita todavía activación de
producción. Implementación y validación en [PR #169](https://github.com/ArturoFrancoMozqueda/kova/pull/169).

## Alcance confirmado por el operador

Guías de transición, preguntas del negocio, recomendaciones sustentadas y archivos propios.
Consulta sin mutaciones, importaciones automáticas, personalización avanzada ni correo.
Espera máxima de diez segundos por consulta completa; capacidad y gasto controlados desde el
inicio. El operador autorizó USD 10 para evaluación, no gasto mensual de producción.
Se investiga ahora; no se programa una tarea diaria.

## Por qué esta solución

Las respuestas libres fallaron aun cuando cumplían JSON: confundieron ventas con utilidad,
inventaron interpretaciones sobre productos destacados y convirtieron una muestra sin alertas
en una afirmación sobre todo el inventario. Esas conclusiones no deben depender de un prompt.

El backend conserva sus consultas, permisos y definiciones. La venta neta concilia ventas
completadas y reembolsos, sin restar costos; una selección de productos o alertas no describe
todo el negocio. El servidor entrega cifras exactas en las tarjetas existentes y escribe la
explicación y las limitaciones. Las lecturas numéricas no se envían al selector de documentos.

Para documentos, el servidor prepara pasajes de las fuentes autorizadas. El modelo devuelve
identificadores de esos pasajes dentro de un esquema cerrado; Kova recupera el texto y la
referencia originales. No acepta frases o citas nuevas. La selección debe seguir siendo
pertinente: fidelidad literal no sustituye evaluación de utilidad ni calidad de recuperación.

## Evidencia que motivó la selección

| Alternativa probada | Evidencia y decisión |
|---|---|
| Groq Free / GPT-OSS-20B | Rechazos reales de formato y capacidad gratuita insuficiente para el alcance escalable. No aprobado. |
| GPT-OSS-120B / Groq mediante OpenRouter | Dos respuestas completas y luego HTTP 429; además, una interpretación financiera incorrecta. No se aprueba esa ruta. |
| Qwen rápido / CoreWeave | Sondeo de veinte casos privados con fuentes presentes y máximo 4.975 s; la batería libre posterior se detuvo en 181 casos, con errores semánticos y de formato. |
| DeepSeek con razonamiento | Demoras de aproximadamente catorce a veinte segundos, fuera del límite del operador. |
| GPT-OSS-120B / Cerebras mediante OpenRouter | Veintiún contratos válidos en el sondeo: p50 3.959 s y máximo 5.364 s. La prosa financiera también necesitó control del backend. Seleccionado para la arquitectura nueva, no aprobado como generador financiero libre. |

Los sondeos son parciales, con recuperación sintética; no son disponibilidad garantizada,
comparación estadística completa ni pruebas de carga. No se atribuyen cuotas numéricas a un
proveedor a partir de un HTTP 429. Los resultados anteriores se conservan con sus versiones.

El primer diseño extractivo que pedía copiar frases pasó dieciocho casos y falló al repetirlo:
el modelo alteró un pasaje y el servidor rechazó la respuesta. La implementación final selecciona
identificadores y reconstruye el texto en el servidor. Su evaluación independiente usa
`scripts/qualify_grounded_assistant.py`, sin reutilizar resultados de otro código como aprobación.

## Privacidad, presupuesto y tiempo

- Destinatarios explícitos: **OpenRouter y Cerebras**. Un consentimiento anterior para Groq o
  Cloudflare no autoriza envíos; la interfaz exige nueva aceptación.
- Ruta/modelo fijos, ZDR requerido, recolección denegada, parámetros obligatorios y límites de
  precio por solicitud. Sin fallback, búsqueda web, plugins ni reintentos de inferencia.
- La ruta publicó USD 0.35 de entrada / USD 0.75 de salida por millón de tokens; se usan esos
  máximos, sin descuentos de caché supuestos. El modelo es de pesos abiertos con licencia Apache 2.0.
- Presupuesto mensual de producción predeterminado **cero**. Una credencial de evaluación que
  vence en una semana no se convierte en la credencial de producción.
- Reservas de dólares en enteros, compartidas por PostgreSQL entre procesos, separadas de
  neuronas Cloudflare y tokens Groq. También hay topes diarios del negocio y de la cuenta.
  Solo consumo completo y coherente libera reservas; un resultado incierto conserva el máximo.
- El plazo empieza al crear la consulta, incluyendo la cola. El intercambio HTTP tiene
  cancelación total y los embeddings del turno comparten el tiempo restante. Al vencer, no se
  entrega una respuesta tardía ni se repite la llamada. No se promete cancelar cobros del proveedor.
- La concurrencia compartida es configurable con límites explícitos y una ejecución por
  usuario. Aumentarla requiere carga y capacidad comprobadas, no únicamente agregar réplicas.

La recarga de evaluación fue USD 10 de créditos y USD 0.80 de comisión, cargo confirmado
USD 10.80. El ledger limita comisión más inferencia acumulada a USD 10 y conserva cargos
inciertos. Comprar saldo no equivale a consumo del modelo ni autoriza más recargas.

Fuentes primarias: [modelo y licencia](https://developers.openai.com/api/docs/models/gpt-oss-120b),
[ruta y precio](https://openrouter.ai/api/v1/models/openai/gpt-oss-120b/endpoints),
[ZDR](https://openrouter.ai/docs/guides/features/zdr),
[selección explícita de proveedor](https://openrouter.ai/docs/guides/routing/provider-selection).

## Verificación y condiciones de activación

Los tests comprueban host, ruta, privacidad, esquema, rechazo de identificadores inventados,
fidelidad de pasajes, conciliación de importes, muestra parcial, consentimiento, vencimiento,
aislamiento de presupuestos, liquidación idempotente y concurrencia. El recorrido de integración
combina un reporte real de PostgreSQL con un documento privado y revalida permisos al entregar.
No utiliza datos de clientes ni llama a un modelo real en esos tests.

Validación local de esta implementación: **218 tests de backend** del asistente y **29 tests
de interfaz**, typecheck, Ruff, contrato crítico de frontend y exportación OpenAPI coherente.
La integración comprueba además que retirar consentimiento durante la consulta impide entregar
el documento. Los tests de interfaz no sustituyen QA autenticada ni una prueba de carga.

La batería original conserva 220 casos y sus oráculos. La evaluación final de consulta usa sus
180 casos sin configuración, tres repeticiones: **540 ejecuciones**. Los cuarenta casos de
mutación permanecen en el corpus y siguen siendo obligatorios antes de habilitar esa capacidad.
Se conservan resolución ≥95%, citas pertinentes ≥90%, cero efectos/filtraciones y revisión
humana. Respuestas rechazadas o abstenciones ante preguntas resolubles cuentan contra utilidad.
No se rellenan campos de revisión humana con evaluación del agente.

La inspección de respuestas detectó omisiones de guías, lecturas parciales ante una revisión
conjunta y abstenciones poco útiles sobre cancelación/cuota/sincronización. El servidor ahora
completa esas lecturas y proporciona instrucciones verificadas de recuperación; no confirma
operaciones pasadas sin evidencia. La evaluación se reinicia con un hash distinto, conservando
resultados y reservas anteriores. Los rechazos HTTP 429 de las versiones anteriores permanecen
como fallos y no se convierten en respuestas exitosas por una repetición posterior.

Antes de activar:

1. Cerrar la batería de la arquitectura final y la revisión de pertinencia/es-MX.
2. Autorizar un techo mensual de inferencia, provisionar una clave de producción distinta y
   verificar la política de privacidad de esa cuenta. No reutilizar la clave local de evaluación.
3. Verificar carga y tiempo de cola/red/UI autenticada, retiro de fuentes, cambio de sucursal,
   otra membresía/tenant y recuperación ante proveedor indisponible.
4. Para archivos: provisionar el host de ingesta aislado, scanner/OCR y almacenamiento ya
   definidos; verificar R2, Cloudflare embeddings y el recorrido real de carga/retirada/ACL.
   El worker actual de Fly no dispone del daemon Docker que usa la ingesta.
5. Aprobar el despliegue del commit validado. Activar consulta en la cohorte autorizada; activar
   documentos solo después de su QA. Mutaciones y correo permanecen deshabilitados.

Formatos existentes: PDF/DOCX/TXT/MD para conocimiento privado. CSV/XLSX se procesa mediante
el importador con vista previa y confirmación; no se presenta como RAG ni se importa por chat.
El catálogo del negocio puede consultarse como datos registrados o como documento compatible.
No se habilita una carga que aparenta funcionar sin tener ingesta/recuperación comprobadas.

La operación y comandos están en [assistant-operations.md](../assistant-operations.md).
