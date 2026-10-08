# Asistente de Kova: operación y activación del piloto

Implementación integrada en `main` mediante PR #158 (`204f024`). Fecha: 2026-10-06.
El diseño completo y los escenarios de aceptación permanecen en
[PLAN-ASISTENTE-TENANT](plans/PLAN-ASISTENTE-TENANT.md). Esta guía describe el código entregado,
los requisitos de ejecución y la evidencia pendiente. No autoriza un despliegue.

## Preparación vigente — 2026-10-08

El operador autoriza publicación y gasto recurrente: hasta USD 10/mes de inferencia y
USD 35/mes para el host de archivos, sin compromiso anual. La autorización no sustituye
la evaluación ni la comprobación de archivos en producción. No hay automatización agendada.

GPT-OSS-120B se mantiene; los únicos destinos de consulta preparados son **Groq y Cerebras**
mediante OpenRouter, con Groq primero y fallback dentro de esa lista cerrada. Los sondeos nuevos
detectaron saturación/HTTP 429 y un timeout; la batería Cerebras histórica de abajo no aprueba
el perfil nuevo. DeepInfra es solo una alternativa de evaluación; no recibe datos en producción.

La aceptación explícita nombra **OpenRouter, Groq y Cerebras** y guarda `chat_recipients`.
Un consentimiento antiguo para Cerebras requiere renovación. La activación requiere además
`ASSISTANT_OPENROUTER_APPROVED_PROFILE`: SHA-256 del perfil/código evaluado. Cambiar el motor
invalida esa aprobación. El flag de calidad permanece falso mientras falten las verificaciones.
Las cuotas/pausas se comparten en PostgreSQL; `retry_at` distingue recuperación mensual o
temporal del reinicio diario. Resultados inciertos conservan su reserva.

Chat e ingesta usan capacidad separada (tres consultas y un archivo globales por defecto).
Los workers seleccionan exclusivamente su carga. El host de ingesta usa 5 GB/CPU compartida
en **iad**, daemon Docker privado, scanner actualizado cada día y parsers sin red ni secretos.
Una actualización fallida de firmas bloquea ingesta. Las citas numéricas se copian literalmente
del archivo; el modelo no redacta esas cifras. Las citas provenientes de OCR advierten que el
operador debe cotejarlas con el original.

La tarifa nominal publicada para iad es USD 30.69 por treinta días (USD 31.713 por treinta y uno),
antes de impuestos/transferencias; comprobar el total de la cuenta contra USD 35 antes de crear
**una** instancia. DFW excede ese límite con este tamaño y no se autoriza. La publicación de
app/chat no crea un host de ingesta. `scripts/assistant_host_release.py update --sha <SHA>` solo
actualiza uno existente del tamaño/región aprobados, reutilizando la imagen validada de app.
La recuperación pausa IA pagada y archivos, detiene ingesta y restaura app/chat sin crear recursos.

Validación local vigente: 263 pruebas de asistente/RLS, 31 de operaciones y 21 de publicación;
una prueba de Windows no aplica en macOS. CI, la batería real del perfil vigente y QA autenticada
de archivos siguen siendo gates de publicación/activación. No se considera producción lista
solo por disponer de saldo. La clave permanente debe tener límite USD 10 y reinicio mensual.

CI del commit `397e1dc` verificó parser/OCR/antivirus, build/interfaz/navegador, integración
del producto y reproducibilidad de la imagen. La reversibilidad detectó que el test de 0075
usaba `head` pero esperaba 0075: se fija el destino de esa prueba a su migración original,
sin cambiar su guardia ni expectativa. Una prueba adicional de 0076 verifica backfill,
rechazo de downgrade con ingesta activa y conservación de leases al drenar. Ambas pasan
localmente; el commit corregido debe volver a completar CI antes de publicación.

## Evidencia histórica de selección — 2026-10-07

Decisión vigente: [GPT-OSS-120B en Cerebras/OpenRouter, con evidencia controlada por Kova](research/ASSISTANT-DECISION-2026-10-07.md).
La integración está en PR #169; no habilita producción. El modelo escoge lecturas y pasajes
por identificador; Kova escribe reportes, límites y referencias. Las cifras se conservan en
las tarjetas existentes. ZDR, recolección denegada, modelo/ruta fijos y máximos de precio se
incluyen en cada solicitud; no hay fallback, plugins ni reintentos remotos.

Cierre real al 2026-10-08: 540 consultas de la arquitectura final, 539 contratos válidos,
mediana 2.1345 s y p95 4.179 s. Se conservan un timeout y una abstención innecesaria; no se
confunde contrato válido con calidad semántica ni se firma el gate de activación. La
[decisión](research/ASSISTANT-DECISION-2026-10-07.md#cierre-de-la-evaluación-real--2026-10-08)
registra denominadores, costo, versión, límites y pendientes. Validación local: 219 tests de
backend del asistente, 29 de interfaz; CI del código completo pasó, incluido parser/antivirus.

Configuración del despliegue aprobado, sin credenciales en comandos ni repositorio:

| Variable | Condición |
|---|---|
| `ASSISTANT_GENERATION_PROVIDER` | `openrouter` |
| `ASSISTANT_OPENROUTER_API_KEY` | Clave distinta a evaluación, provisionada en el almacén de secretos del host. |
| `ASSISTANT_PROVIDER_VERIFIED` | Capacidad, cuenta y política comprobadas. |
| `ASSISTANT_OPENROUTER_PRIVACY_VERIFIED` | ZDR/cuenta sin logging ni entrenamiento comprobados. |
| `ASSISTANT_OPENROUTER_QUALITY_VERIFIED` | Solo después de gates de la arquitectura final, no por el sondeo parcial. |
| `ASSISTANT_OPENROUTER_MONTHLY_USD` | Techo mensual autorizado de inferencia; predeterminado cero, bloquea llamadas pagadas. |
| `ASSISTANT_OPENROUTER_DAILY_TOKENS` | Tope aplicativo compartido diario; no describe una cuota del proveedor. |
| `ASSISTANT_OPENROUTER_TENANT_DAILY_TOKENS` | Tope aplicativo por negocio; comparte presupuesto global. |
| `ASSISTANT_GLOBAL_CONCURRENCY` / `ASSISTANT_TENANT_CONCURRENCY` | Predeterminados tres/dos; una ejecución por usuario. Aumentar después de carga comprobada. |
| `ASSISTANT_MUTATIONS_ENABLED` / `ASSISTANT_EMAIL_ENABLED` | `false` para este alcance. |
| `ASSISTANT_DOCUMENTS_ENABLED` | Solo después de host de ingesta aislado y QA autenticada de archivos. |

Conservar la cohorte y los demás gates de acceso. El consentimiento nombra **OpenRouter y
Cerebras** y se renueva al cambiar proveedor. Embeddings y objetos mantienen su consentimiento,
presupuesto y configuración Cloudflare/R2 independientes. Un resultado incierto conserva su
reserva; retirar documentos/consentimiento o cancelar impide la entrega. La consulta expira
pasados diez segundos desde que se crea, incluida la cola; no se garantiza recuperar cobros
remotos cuando se cancela.

La ingesta existente requiere Docker aislado con scanner/OCR; el worker actual de Fly no
lo proporciona. PDF/DOCX/TXT/MD alimentan conocimiento; CSV/XLSX usa vista previa y confirmación
del importador. No se activa el flag de archivos para aparentar que ese recorrido está listo.

Evaluación final de consulta, separada de la comparación histórica de prosa libre:

```bash
cd backend
python scripts/qualify_grounded_assistant.py --run --account-verified --limit 540
```

Cuenta/privacidad/saldo dedicados deben estar verificados. Solo carga `.env.evaluation.local`,
ignorado por Git/Docker. Reutiliza ledger/lock existentes, conserva la comisión USD 0.80 y
máximo total USD 10; no reintenta errores. Resultados/manifiesto:
`output/assistant-evaluation/grounded-final/`. Las 540 ejecuciones son los 180 casos de consulta
originales por tres repeticiones. Los cuarenta de mutación siguen en el corpus y requieren sus
pruebas antes de activar esa capacidad. Un cambio de código no reutiliza resultados como
aprobación. Los campos de revisión humana permanecen pendientes hasta revisión real.


## Integración de Groq y respuestas directas — 2026-10-07

Integración entregada en `main` mediante PR #167; activación pendiente. La configuración vigente es
`openai/gpt-oss-20b` en Groq Free, con razonamiento `low` y salida máxima de 1024 tokens;
no está aprobado por calidad. GPT-OSS-120B es ahora el comparador prioritario y se permite
únicamente en entorno local; no hay fallback de
pago ni cambio automático de modelo. Cloudflare conserva embeddings y su piloto actual
hasta completar los gates. No se amplían cohorte, documentos, mutaciones ni correo.

Se verificó en la cuenta creada por el operador: plan **Free**, Global Zero Data Retention
activado y límites de ambos GPT-OSS de 30 RPM, 1000 RPD, 8000 TPM y 200000 TPD. La clave
se capturó mediante `backend/scripts/setup_assistant_groq.py`, con entrada oculta y archivo
privado ignorado por Git y Docker. No se transfirió a Fly ni se activó Groq en producción.
Referencias: [límites](https://console.groq.com/docs/rate-limits),
[datos y ZDR](https://console.groq.com/docs/your-data),
[razonamiento](https://console.groq.com/docs/reasoning),
[JSON estricto](https://console.groq.com/docs/structured-outputs).

Cambios entregados:

- FAQ inequívocas y reportes directos de ventas, productos, inventario y sucursales usan
  las guías y servicios existentes, sin inferencia ni reserva de cuota de modelo.
  Ejemplos: «¿Qué producto es el que más se vende?», «¿Cuánto vendí ayer?» y
  «¿Cómo importar mi catálogo?». Los periodos usan la zona horaria real del negocio;
  una pregunta sin periodo usa hoy, explicado en la respuesta. Preguntas ambiguas,
  seguimientos y solicitudes de cambios pasan al modelo, conservando permisos.
- Adaptador Groq con destino fijo, herramientas de lectura y explicación final estricta
  en llamadas separadas. Kova sigue validando prosa, fuentes, campos, permisos y
  confirmación; el JSON del proveedor no autoriza cambios.
- Contadores de tokens/solicitudes de Groq separados de neuronas de Cloudflare en el
  esquema privado existente, con reservas atómicas y límites conservadores: 180000 TPD,
  900 RPD, 7200 TPM y 27 RPM. Ventanas móviles conservadoras de veinticuatro horas y
  un minuto; la interfaz muestra recuperación gradual y distingue pausa temporal,
  capacidad compartida y cuota del negocio. No se promete un reinicio UTC para Groq.
- Se contabiliza razonamiento dentro de `completion_tokens`, sin sumarlo dos veces.
  Totales ausentes/incoherentes mantienen la reserva; conciliación idempotente y
  cooldown de errores 429 compartido entre workers, sin reintentos del proveedor.
- Consentimiento ligado al destinatario: el consentimiento histórico es Cloudflare.
  Cambiar a Groq requiere una nueva aceptación explícita antes de enviar datos. El
  campo opcional `chat_provider` es aditivo y preserva clientes históricos Cloudflare.

Activación requiere `ASSISTANT_GENERATION_PROVIDER=groq`, una clave privada en el gestor
seguro del host, `ASSISTANT_GROQ_MODEL=openai/gpt-oss-20b` y verificación explícita de
`ASSISTANT_PROVIDER_VERIFIED`, `ASSISTANT_GROQ_FREE_VERIFIED`,
`ASSISTANT_GROQ_ZDR_VERIFIED` y `ASSISTANT_GROQ_QUALITY_VERIFIED`. Este último permanece
**false** mientras la batería no cumpla los requisitos. Mantener los flags y UUIDs actuales
del piloto; no poner credenciales ni identidades privadas en documentación o commits.

Evaluación reproducible desde `backend/`:

```sh
.venv/bin/python scripts/evaluate_assistant.py --manifest
.venv/bin/python scripts/evaluate_assistant.py --model groq-20b --limit 200 --account-verified
.venv/bin/python scripts/evaluate_assistant.py --model groq-120b --limit 200 --account-verified
.venv/bin/python scripts/evaluate_assistant.py --model qwen-cloudflare --limit 200 --account-verified
.venv/bin/python scripts/evaluate_assistant.py --model groq-20b --summary
```

El corpus conserva los 200 casos originales y añade veinte de archivos privados solicitados
para el lanzamiento: 220 casos y tres repeticiones por candidato. El runner reanuda lotes,
conserva un ledger local compartido entre modelos Groq y se detiene antes de superar
sus límites. `--capability` permite focalizar una categoría. Solo usa datos sintéticos;
Cloudflare requiere su propia credencial gratuita, no reutiliza la de Groq. Resultados y
revisiones viven en `output/assistant-evaluation/`, ignorado por Git. La revisión registra
resolución correcta/abstención justificada, citas pertinentes, español útil y comportamiento
seguro. Exigir 660 ejecuciones distintas del mismo código por candidato, resolución ≥95%,
citas ≥90% y ninguna acción no autorizada/filtración en la batería. Las pruebas de contrato
no sustituyen revisión semántica ni integración E2E.

Los primeros smoke reales comprobaron propuestas de configuración y consumo de razonamiento.
Se corrigieron instrucciones mezcladas en planificación y el esquema vacío rechazado por Groq.
La guía de configuración todavía obtuvo tres rechazos del contrato de prosa con GPT-OSS-20B
en el lote posterior; no se publicó ese contenido ni se declaró aprobado al modelo.
La conformidad JSON no equivale a calidad semántica ni a citas pertinentes. La batería completa, comparación de candidatos,
aceptación humana del español y activación/despliegue en la cohorte siguen pendientes.

Validación local: 109 pruebas específicas de backend, 42 de frontend y ocho escenarios de
Chromium (320, 390, 768 y 1440 px) correctos. Ruff, ESLint, contrato OpenAPI y build/SSR/prerender
correctos. La regresión integra una venta real en la base aislada de pruebas y comprueba
que el reporte directo conserva producto, unidades e importe del backend sin inferencia.
No se verificaron VoiceOver/NVDA ni la activación Groq con una sesión de producción.
La suite completa local registró 1037 pruebas correctas y una diferencia de zona horaria
en gastos ajena al cambio: el Postgres aislado heredaba la zona del equipo. Al fijar ese
Postgres a UTC, gastos y asistente pasaron juntos (112 pruebas), sin modificar gastos ni sus
expectativas. CI debe confirmar la suite completa con su Postgres en UTC.

### Corrección de formato y reserva completa — 2026-10-07

El operador solicitó completar la preparación de Groq. Se reprodujeron tres rechazos
`json_validate_failed` en la guía de configuración: GPT-OSS-20B copiaba medidas de papel
en `answer`, aunque el esquema remoto y el prompt prohibían dígitos. Se refuerza esa
instrucción junto a la evidencia de la llamada final y se mantiene el rechazo determinista
de prosa inválida. También se aclara que preparar una propuesta no equivale a aplicarla
y que una comparación sin referencia no permite calificar ventas como altas o bajas.

La reserva de producción y el evaluador ahora cuentan las mismas instrucciones finales
que recibe Groq. Antes, el adaptador añadía instrucciones después de medir el contexto.
Se compactaron esas instrucciones conservando campos, esquema y validación: las
solicitudes mínimas de los cuarenta escenarios de configuración caben individualmente
en el techo de un minuto. Esto no garantiza que un historial o resultado más extenso
quepa, ni elimina la espera entre consultas o la cuota compartida.

Validación local previa: 117 pruebas del asistente con Postgres/pgvector real en UTC, Ruff,
contrato OpenAPI y `git diff --check` correctos. Las regresiones nuevas verifican
rechazo antes de guardar prosa con dígitos ASCII/Unicode, enlaces o HTML; correspondencia
exacta entre reserva y mensajes/esquema enviados; y capacidad mínima de configuración.
Una primera versión de la corrección pasó las tres repeticiones live de la guía
con GPT-OSS-20B y citas recuperadas. La ampliación encontró un rechazo de validación
en configuración y una explicación de ventas que inventaba comparaciones y costos,
aunque esta última pasaba el contrato JSON. La instrucción de papel se limita ahora
a la guía recuperada de configuración; se aclara que faltan referencias para comparar
periodos y que utilidad no calculable no significa pérdidas. Dos regresiones adicionales
impiden incorporar instrucciones de impresión a una explicación de ventas. La nueva
versión requiere sus propios resultados; ninguna prueba anterior acredita los seiscientos
resultados revisados ni calidad general. El código se integró con `origin/main` de PR #168;
CI de esa versión pasó todos los checks requeridos en PR #169; publicación y QA
autenticada de producción permanecen pendientes.

La evaluación usa el ledger previo compartido sin reiniciar consumo. Las credenciales
permanecen en el archivo privado existente; no se incluyeron en este checkout ni se
transfirieron a Fly. La sesión local de Fly no pasó `auth whoami`. Las comprobaciones
públicas de API y DB respondieron HTTP 200, con release
`9275d4327e2c753318c14942d536fc30984ad209`; no verifican el proveedor activo ni una
conversación autenticada. La batería completa, revisión humana, comparación y release
protegido siguen siendo requisitos de activación. Ningún flag de producción se cambió.

### Alcance confirmado y selección de modelo — 2026-10-07

El operador confirmó guías de transición a Kova, archivos propios del negocio (catálogos y
manuales), preguntas sobre datos reales y recomendaciones, con equilibrio de precisión/rapidez
y escalabilidad desde el inicio. La configuración mediante propuestas no es necesaria para este
lanzamiento y conserva su gate separado. Un plan pagado debe justificar su diferencia; no hay
autorización de gasto operativo ni ampliación de infraestructura. El operador autorizó un máximo
total de **USD 10 exclusivamente para evaluación**; activar Developer y verificar sus límites
sigue pendiente. La investigación continúa en
este chat; la programación diaria fue eliminada por petición del operador.

Para lectura, el prompt ya no incluye el contrato de mutaciones. Se reproduce con Postgres real
una consulta fría de dos etapas y consumo observado: las reservas conservadoras ahora permiten
terminar esa consulta dentro del mismo minuto. No garantiza capacidad con historial extenso ni
concurrencia. Las consultas sin documentos recuperados exigen `source_ids` vacío también en el
esquema enviado a Groq; antes podía inventar un identificador rechazado posteriormente por Kova.
Se mantienen todos los controles de prosa, ACL, consentimiento y presupuesto.

Los veinte casos adicionales conservan los doscientos originales y sus oráculos: manual operativo,
catálogo sin costos, contradicción entre manual y ventas actuales, inyección en documento y archivo
no disponible. Simulan fragmentos autorizados; no acreditan carga, extracción, OCR o retrieval real.
La aceptación completa pasa a 660 ejecuciones por candidato del mismo corpus/código, con los
mismos umbrales de calidad, seguridad y revisión humana. No se modifican resultados fallidos.

La API de modelos de la cuenta expone GPT-OSS-20B y GPT-OSS-120B. Qwen3.8 está en preview y
Llama 3.3 70B requiere Enterprise según el catálogo vigente; este último no aparece en la cuenta.
Por disponibilidad, estabilidad y soporte de JSON estricto, se prioriza evaluar GPT-OSS-120B.
Referencias: [modelos](https://console.groq.com/docs/models),
[salidas estructuradas](https://console.groq.com/docs/structured-outputs).

El diagnóstico histórico de este checkout contiene once ejecuciones de 20B (cinco con contrato
válido) y seis de 120B (cinco válidas), con prompts de distintas versiones y sin revisión humana:
no es una comparación controlada ni una tasa de calidad. Las medianas observadas por llamada
fueron 0.46 s y 0.719 s, respectivamente, sin incluir espera de cuota. En 120B también hubo
comparaciones sin referencia y sugerencias de pantallas incorrectas. El último smoke de ventas
pasó el contrato después de cerrar las citas vacías, pero no prueba utilidad general.
Un diagnóstico adicional con manual privado e inyección recuperó la cita correcta y el horario,
pero inventó pantallas de horarios/auditoría. Pasar JSON y rechazar instrucciones maliciosas no
garantiza orientar correctamente sobre capacidades de Kova. El diagnóstico final-only no se
cuenta como ejecución completa del corpus.
**Ningún modelo está aprobado todavía.** La versión con corpus ampliado requiere sus propios
resultados. El ledger compartido agotó la capacidad suficiente para iniciar otro caso; se conservó
todo el consumo y no se cambió el plan gratuito.

Pagar el mismo modelo aporta capacidad según los límites contratados; no corrige alucinaciones.
Las tarifas publicadas de 120B son USD 0.15/0.60 por millón de tokens de entrada/salida; 20B cuesta
la mitad. Una consulta sintética observada de dos llamadas sumó 1599 tokens de entrada y 310
de salida (incluido razonamiento): aproximadamente USD 0.43 por mil consultas equivalentes con
120B, solo inferencia. No es una previsión de producción: historial, archivos, razonamiento y
errores cambian el consumo; embeddings, almacenamiento y parser se cobran aparte.
Referencia: [tarifas y capacidad](https://console.groq.com/docs/models).

Para escalar hay que verificar límites del plan, separar cola de chat e ingesta, conservar reservas
atómicas y equidad por negocio, medir carga/p95 y operar cortes de gasto. El runtime actual está
limitado deliberadamente a Free: contratar Developer sin revisar esos límites no amplía Kova.
La ingesta requiere su host aislado (parser/antivirus/OCR), bucket privado, embeddings, retirada
y QA autenticada de archivos/ACL; el worker de Fly actual no tiene daemon Docker. CSV/XLSX usa
la importación existente con vista previa y confirmación; un archivo no debe modificar el catálogo
automáticamente. PDF/DOCX/TXT/MD alimenta conocimiento privado. No se habilita documentación
privada con un flag antes de demostrar esa ruta completa.

El evaluador admite un presupuesto pagado explícito con `--paid-budget-usd 10` y
`--paid-account-verified`, únicamente tras verificar Developer, ZDR, tarifas y límites de la
cuenta. Exige TPM/RPM/TPD/RPD reales mediante `--paid-tpm`, `--paid-rpm`, `--paid-tpd` y
`--paid-rpd`; cero diario significa ausencia de techo verificada, nunca un valor supuesto.
No cambia los límites Free de producción. Antes de cada llamada reserva el costo máximo en
nanodólares, con tarifas sin descuentos y margen de entrada; el mismo ledger conserva el gasto
total entre modelos, días y cambios de prompt. Solo libera costo con usage completo verificado;
errores y resultados inciertos conservan la reserva. El corte local es independiente del contador
de Groq, cuyo dashboard tiene un retraso publicado de diez a quince minutos.
Referencias: [facturación](https://console.groq.com/docs/billing-faqs),
[límites de gasto](https://console.groq.com/docs/spend-limits).

Validación de esta ampliación: **123 tests backend del asistente**, Postgres/pgvector real,
Ruff, OpenAPI y `git diff --check`; manifiesto de 220 casos y cinco rechazos CLI de parámetros
pagados incompletos/incorrectos sin llamadas remotas. Los tests nuevos comprueban consulta
fría con consumo observado, citas vacías/recuperadas, cobertura privada aditiva, costo total
persistente entre candidatos/días, conservación del ledger Free y límites del plan verificado.
No se ejecutó inferencia pagada ni QA autenticada de documentos/producción en esta ampliación.

**Bloqueo comercial confirmado en la sesión del operador:** Billing → Plans muestra Free como
plan actual y el aviso de suspensión temporal de upgrades Developer por alta demanda, sin botón
para actualizar. No se habilitó pago y el presupuesto autorizado sigue sin consumirse. La FAQ
de facturación describe el upgrade, pero no acredita disponibilidad en esa cuenta. No eludir el
bloqueo de la interfaz. La suspensión impide verificar hoy la capacidad pagada de Groq directo.

El operador pidió investigar otros modelos abiertos. Shortlist de investigación: Mistral Small 4
(`mistral-small-2603`, GA, Apache 2.0, tools/JSON, USD 0.15/0.60 por millón); Qwen3.5-35B-A3B
(Apache 2.0), cuya calidad es-MX, proveedor, privacidad y tarifa por endpoint requieren evaluación;
y GPT-OSS-120B como referencia con Groq. El catálogo público de OpenRouter ofrece rutas Groq para
ambos GPT-OSS y una ruta `mistral/zdr` para Small 4, con tools y structured outputs. Esto acredita
oferta publicada, no uso autenticado, capacidad garantizada ni calidad de Kova. Usar intermediario
añade otro destinatario/facturación y requiere autorización; no se ha integrado ni enviado datos.
Referencias: [Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03),
[Qwen oficial](https://huggingface.co/Qwen/Qwen3.5-35B-A3B),
[rutas OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection),
[datos](https://openrouter.ai/docs/guides/privacy/data-collection).

### Comparación autorizada de modelos actuales — 2026-10-07

El operador autorizó comparar **GLM-5.3-Flash, Qwen3.8-27B y Mistral Small 4**. La investigación
añadió **DeepSeek V4.1 Flash** y perfiles de razonamiento/ruta para buscar el equilibrio de
precisión, rapidez y costo. GPT-OSS queda como evidencia histórica.
La comparación usa los mismos 220 casos y tres repeticiones por candidato (660 ejecuciones),
sin modificar oráculos ni reducir gates. Incluye la cobertura de configuración como regresión;
aprobar esa cobertura no habilita mutaciones ni amplía el lanzamiento solicitado.

`backend/scripts/compare_assistant.py` reutiliza el corpus, herramientas, prompts y contrato
cerrado del evaluador. Su transporte vive exclusivamente en `assistant_evaluation/openrouter.py`;
no integra OpenRouter al runtime de producción. Los candidatos se intercalan por caso/repetición
para no consumir primero todo el presupuesto con un solo modelo. También se intercalan
capacidades para probar archivos privados y seguridad desde el inicio. El límite común de salida
es 1024 tokens, incluyendo razonamiento. Cada perfil declara su modo y el catálogo debe admitirlo;
no se supone que todos acepten `low`. Truncamientos son fallos. Estos perfiles no demuestran el
mejor desempeño posible de cada modelo ni se mezclan entre versiones para aprobar calidad.

Verificación pública sin inferencia realizada el 2026-10-07:

| Alias | Modelo | Ruta exacta | Razonamiento | Techo USD/millón entrada/salida |
|---|---|---|---|---|
| `glm-flash` | `z-ai/glm-5.3-flash` | `fireworks` | `low` | 0.15 / 0.50 |
| `glm-deepinfra` | `z-ai/glm-5.3-flash` | `deepinfra/fp4` | `low` | 0.15 / 0.50 |
| `qwen-38` | `qwen/qwen3.8-27b` | `deepinfra/bf16` | `low` | 0.20 / 2.50 |
| `qwen-fast` | `qwen/qwen3.8-27b` | `deepinfra/bf16` | Desactivado | 0.20 / 2.50 |
| `qwen-coreweave-fast` | `qwen/qwen3.8-27b` | `coreweave/fp8` | Desactivado | 0.40 / 3.00 |
| `mistral-small` | `mistralai/mistral-small-2603` | `mistral/zdr` | Desactivado | 0.15 / 0.60 |
| `mistral-us` | `mistralai/mistral-small-2603` | `mistral/us` | Desactivado | 0.165 / 0.66 |
| `deepseek-flash` | `deepseek/deepseek-v4.1-flash` | `deepinfra/fp8` | `low` | 0.20 / 0.60 |
| `deepseek-fast` | `deepseek/deepseek-v4.1-flash` | `deepinfra/fp8` | Desactivado | 0.20 / 0.60 |

Las rutas aparecen activas en el catálogo, admiten herramientas y `structured_outputs`,
y están en la lista pública de endpoints ZDR. Qwen usa techos sin el descuento temporal
publicado; no se supone ahorro de caché. Cada ejecución vuelve a comprobar estos requisitos,
precios y ausencia de recargos/overrides. Cada POST exige la ruta exacta, ZDR, `data_collection=deny`,
soporte de parámetros, techo de precio y ausencia de fallbacks; no habilita plugins ni red del modelo.
Esto verifica oferta publicada, no SLA, capacidad sostenida de la cuenta ni calidad para Kova.
Los perfiles sin razonamiento exigen además `mandatory=false` en el catálogo y consumo reportado
de razonamiento exactamente cero en cada respuesta. Mistral publica esfuerzos `high`/`none`;
las pruebas históricas con `low` no representan este perfil corregido.

**Acceso verificado el 2026-10-07:** el operador creó la cuenta y una clave dedicada, con
techo total de USD 10, sin reset y vencimiento en siete días. Guardó la credencial en el archivo
local privado; `GET /key` confirmó autenticación y cuenta pagada. La consola muestra USD 10
de saldo, autorecarga apagada y logging de prompts/respuestas apagado. Se guardó ZDR para
estos modelos y se deshabilitó entrenamiento. La clave automática de bienvenida se desactivó
antes de cualquier uso porque el asistente expuso su valor al leer el ejemplo de código;
no se utiliza ni se conserva en archivos. El operador confirmó un cargo de USD 10.80:
USD 10 de créditos y USD 0.80 de comisión. El consumo de inferencia queda acotado a USD 9.20
menos cualquier cargo previo retenido. La key no puede exceder el máximo total autorizado;
el ledger reserva la comisión antes de cada POST y aplica el máximo a comisión más consumo.
No usar una management key.
`GET /key` comprueba techo y tipo de key; el saldo se verifica en consola porque `/credits`
requiere privilegios de gestión. Ante errores, incluido saldo insuficiente o rate limit, se detiene
todo el lote sin reintentos automáticos. La oferta pagada de Groq sigue bloqueada.

El máximo autorizado **USD 10 total** se conserva entre proveedores y días en el ledger existente.
Las comisiones reales acumuladas de recarga se indican con `--funding-fee-usd` y cuentan dentro
del corte; comprar créditos no autoriza otra recarga ni exceder USD 10 con comisiones. Verificar
el total final de checkout antes de pagar. Una recarga inicial de USD 5–8 puede dejar margen,
pero no se promete completar el corpus con un importe determinado.

Guardar la credencial únicamente en `backend/.env.evaluation.local` (permisos 0600), bajo
`OPENROUTER_EVALUATION_API_KEY`, o en esa variable del proceso. Git y Docker excluyen ese archivo;
no pegar la clave en chat ni comandos visibles. El evaluador nunca carga un `.env` de producción.

```bash
cd backend
python scripts/compare_assistant.py --preflight
python scripts/compare_assistant.py --summary
# Solo tras tener saldo, verificar privacidad/techo y sustituir la comisión por la real:
python scripts/compare_assistant.py --run --model mistral-small --limit 14 \
  --budget-usd 10 --funding-fee-usd 0.80 --account-verified
# Tras revisar el smoke, reanudar con el mismo presupuesto/ledger y comisión real:
python scripts/compare_assistant.py --run --model mistral-small --limit 660 \
  --budget-usd 10 --funding-fee-usd 0.80 --account-verified
```

`0.80` es la comisión confirmada por el operador para esta recarga. El smoke intercalado cubre
capacidades distintas, pero no sustituye el conjunto completo ni la revisión de contenido.
Resultados: `output/assistant-evaluation/comparison-results.json`; preflight público separado;
ledger y lock compartidos con Groq. Se conserva la reserva antes de enviar la solicitud, incluso
si ocurre un fallo/cancelación. Solo se reduce con tokens/costo completos verificados; razonamiento
no se suma dos veces. La escritura atómica preserva los symlinks del ledger compartido.
Resultados/versiones previos no se reutilizan como aprobación de un harness modificado. Los
errores guardan códigos y diagnósticos acotados, nunca cuerpos remotos completos. Una interrupción
del operador se registra y conserva la reserva; no se cuenta como un fallo semántico del modelo.
Las respuestas sintéticas se conservan para diagnosticar contratos y contenido rechazados.
Las solicitudes POST nuevas se espacian al menos dos segundos entre comienzos en este evaluador
serial. La prueba rápida inicial de Mistral respondió al planner con razonamiento cero y rechazó
la explicación con HTTP 429, sin cuota numérica verificable. El espaciado es un experimento
conservador, no una cuota atribuida al proveedor ni una prueba de capacidad concurrente; tampoco
reintenta solicitudes fallidas. Su espera cuenta dentro de la latencia por caso.

Validación local: **177 tests backend del asistente**; Ruff, OpenAPI y `git diff --check`.
Los tests comprueban
intercalado, persistencia antes de POST, privacidad/ruta/precios, costos inciertos y comisiones,
cuenta sin reset, consumo razonado, compatibilidad del modo y detención global ante error. Las
respuestas de esos tests son simuladas y nunca entran al archivo de evaluación real. Se mantiene
la prueba de consulta fría con Groq Free; no se aumentó la cuota para acomodar prompts más largos.

**Evidencia live parcial, no aprobación:** GLM/Fireworks quedó detenido por demora; GLM/DeepInfra
tuvo errores de configuración/contenido y un límite del proveedor. Qwen sin razonamiento completó
153 ejecuciones con el harness `df40e358…`: 151 contratos válidos, un rechazo de contrato y un
fallo de transporte. Entre respuestas válidas hubo confusión bruto/neto y costos, una atribución
inventada al manual y abstenciones por no consultar ventas o el archivo disponible. Sus latencias
entre contratos válidos fueron p50 4.458 s / p95 8.149 s; formato y rapidez no acreditan utilidad.
Un diagnóstico separado del agente registra casos concretos en
`output/assistant-evaluation/comparison-agent-review.json`; no rellena revisión humana.

Antes de la corrección más reciente del planner y de los modos, Mistral y DeepSeek completaron
14 casos cada uno con el mismo harness `76a4096d…` y contratos válidos. Mistral fue más rápido
(p50 6.212 s / p95 9.049 s), pero omitió buscar un catálogo privado y parte de su usage no concilió.
DeepSeek recuperó ambos tipos de archivo y tuvo usage verificable, con p50 13.813 s / p95 24.262 s.
Son resultados exploratorios pequeños, de versiones anteriores; no se extrapolan a toda la batería.

La revisión detectó una carencia de contexto: se explicita ahora la definición de Kova de venta
neta (ventas completadas menos reembolsos), se dirige esa consulta a ventas y se evita narrar
reglas internas en la respuesta. Se repite la cobertura afectada con los mismos oráculos. El contexto deja de exigir orientación
hacia pantallas para toda pregunta: un manual privado se resume como procedimiento del negocio,
sin atribuirle funciones de Kova. Se explicita el rango omitido conforme al backend (hoy).
Mistral volvió a responder HTTP 429 en la prueba espaciada, después de una configuración con
contrato válido; su capacidad sostenida no quedó acreditada. Se compara además DeepSeek con
razonamiento desactivado, verificando el modo consumido en cada respuesta: el smoke de catorce
casos tuvo trece contratos válidos, usage verificable y p50 5.735 s / p95 7.863 s, pero omitió
el catálogo privado y no resolvió el procedimiento del manual. Sigue sin aprobación; estos
resultados motivaron la corrección de contexto y se conservan como evidencia histórica.
El resumen de documentos se pide solo cuando la pregunta trata sobre ellos. Se amplía ahora
la comparación de perfiles rápidos con este contexto corregido. El operador fijó espera máxima
de **diez segundos por respuesta completa**. El resumen registra la latencia máxima observada y
no aprueba si algún caso supera ese límite, además de los gates previos; la medición sintética
no demuestra aún la espera total de cola/red/UI en producción. DeepSeek con razonamiento bajo
queda fuera como principal por demora. Se prueba Mistral/US por separado, con precio diez por
ciento mayor al endpoint ZDR global; no es un fallback automático ni prueba de capacidad sostenida.
El último `GET /key` antes de
ese lote reportó USD 0.160578681 de inferencia acumulada; las reservas inciertas y la comisión
permanecen en el ledger. El dato se consulta de nuevo antes de cerrar una evaluación.
**Ningún modelo está aprobado ni activado.** Revisión humana, ingesta/ACL/OCR real, carga y QA
autenticada de producción permanecen pendientes; no se cambió ningún flag ni se programó trabajo.

**Diagnóstico posterior de rutas y documentos:** Qwen sin razonamiento completó siete casos
por ruta en Wafer y CoreWeave con contratos y usage verificables; p50 3.991 / 4.344 s,
máximos 4.380 / 4.710 s. La revisión detectó respuestas que confundían productos destacados
con todos los vendidos y omisiones de archivos. En un lote separado de veinte casos privados
por ruta, Wafer omitió buscar el catálogo en sus cuatro variantes y CoreWeave en dos; hubo
12/16 y 14/16 citas presentes donde había una fuente disponible. Estas cuentas miden presencia,
no pertinencia ni calidad aprobada.

Se corrigió el runtime de lectura: una pregunta que menciona manuales, documentos, archivos o
catálogos añade `search_knowledge` si el planner la omite. Conserva las lecturas seleccionadas,
el máximo de ocho herramientas, consultas de hasta cuatrocientos caracteres y la búsqueda
existente con consentimiento/tenant/propiedad. Reautoriza la sesión y verifica cancelación
después del planner y antes de ejecutar lecturas. No habilita documentos ni prepara cambios.
El evaluador reutiliza esta misma corrección; conserva los casos/oráculos originales.

La repetición diagnóstica posterior en CoreWeave completó veinte casos privados: contratos
válidos, 16/16 citas presentes donde había fuente, usage verificado, p50 4.123 s / p95 4.687 s
y máximo 4.975 s. Es una única repetición con fragmentos sintéticos; no acredita el retrieval
real, los gastos en embeddings ni el tiempo de cola/red/UI. Wafer respondió HTTP 404 al iniciar
la repetición corregida, después de pasar preflight. Se retuvo su reserva y se detuvo ese lote;
el experimento nuevo en CoreWeave tuvo su propio manifiesto, sin fallback automático.

Los sondeos están separados en `output/assistant-evaluation/endpoint-probe`,
`private-file-probe` y `private-file-coreweave`; sus manifiestos declaran que no cuentan para
aprobar producción, identifican la versión y comparten ledger/lock. Se amplía ahora el perfil
CoreWeave en el comparador normal de 220 casos y tres repeticiones; no se importan los sondeos
como aprobación. Las nueve regresiones nuevas prueban búsqueda omitida, límites, no duplicación,
conservación de propuestas apagadas y bloqueo ante consentimiento retirado/cancelación;
se amplió también la verificación del modo rápido al nuevo perfil.

Fuentes: [rutas y precios](https://openrouter.ai/docs/guides/routing/provider-selection),
[ZDR](https://openrouter.ai/docs/guides/features/zdr),
[key de inferencia](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key),
[créditos y privilegios](https://openrouter.ai/docs/api/api-reference/credits/get-credits),
[GLM y pesos MIT](https://huggingface.co/zai-org/GLM-5.3-Flash),
[Qwen y pesos Apache 2.0](https://huggingface.co/Qwen/Qwen3.8-27B),
[modos de razonamiento](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
[Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03),
[DeepSeek V4.1 Flash y pesos MIT](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash).

## Mejora de interfaz y presentación — 2026-10-07

Cambio local de frontend: conversación con más espacio, historial plegable en móvil,
editor que ajusta su altura, Enter para consultar y Shift + Enter para otra línea.
La vista completa y el compañero flotante comparten respuestas con Markdown semántico,
copiado explícito, estados de consulta/cancelación y fuentes desplegables. Una respuesta
nueva abre su explicación; leer mensajes anteriores conserva la posición de desplazamiento.
Ventas, productos, sucursales e inventario usan exclusivamente los payloads existentes;
las métricas ausentes no se rellenan con ceros. Se conservan estados vacíos, estimaciones,
costos faltantes, consentimiento, scope, permisos, cuotas e idempotencia.

Referencias de diseño consultadas: [Intercom Copilot](https://www.intercom.com/help/en/articles/8587194-how-to-use-copilot)
para fuentes verificables y [Vercel, UI con v0](https://vercel.com/academy/ai-sdk/ui-with-v0)
para patrones de conversación. No se incorporó otro proveedor ni se cambió el contrato de IA.

Archivos: `frontend/src/assistant/{AssistantView,AssistantCompanion,EvidenceCards}.tsx`;
nuevos componentes `AssistantChat.tsx` y `AnswerContent.tsx`; pruebas
`AssistantChat.test.tsx`, `EvidenceCards.test.tsx` y `frontend/e2e/assistant.spec.ts`;
`frontend/package{,-lock}.json`, `frontend/vite.config.ts` y esta guía.
Las dos aserciones de inventario se adaptan a cantidades en negritas y prioridad como badge;
conservan los mismos valores, estados y requisitos de evidencia.

Validación local:

- `npm test -- --run src/assistant src/layout/AppShell.assistant.test.tsx`: 38 pruebas.
- `npm run lint`: correcto; revisión focalizada repetida después de los ajustes finales.
- `npm run build`: TypeScript, Vite, SSR y prerender correctos.
- `npm run test:e2e-dev -- e2e/assistant.spec.ts`: ocho escenarios correctos.
- `npm run test:e2e-preview -- e2e/assistant.spec.ts`: los mismos ocho escenarios
  correctos sobre el artefacto compilado, con APIs simuladas exclusivamente en pruebas.
- Capturas revisadas en Chromium a 320, 390, 768 y 1440 px; sin desbordamiento horizontal.
  Axe no detectó problemas serios/críticos en la vista completa; se verificaron teclado,
  consentimiento sin inferencia, cambio de ruta, continuidad y retorno de foco del compañero.
  El escenario de 390 px usa movimiento reducido.
- El grafo de imports inicial del build excluye `AnswerContent` y
  `vendor-assistant-markdown`; el parser se carga al mostrar una respuesta.

Vite sigue emitiendo una advertencia de dependencia circular entre `vendor` y
`vendor-react`; build y navegador compilado pasan. No se verificaron VoiceOver/NVDA,
teclado físico móvil ni nuevas respuestas con el proveedor real. No hubo cambios backend,
migraciones, activación de flags ni despliegue. Esta validación no cierra los gates live.

## Estado de activación — 2026-10-06

El código y Alembic `0075_assistant` ya llegaron a producción con los flags del asistente
apagados. El release de `204f024` pasó CI y las verificaciones públicas de frontend,
proxy y backend. En producción se verificaron pgvector 0.8.0 en `extensions`, FORCE RLS,
las ACL restrictivas y el rol `kova_app` sin superuser ni BYPASSRLS.

La autorización local de Wrangler está confirmada. Se creó `kova-assistant` en R2 y se
verificó que `r2.dev` está deshabilitado; no se cargaron documentos del piloto. La sesión
OAuth sirve para administrar estos recursos, pero la API rechazó la gestión de tokens
con HTTP 403. No reutilizar ese OAuth personal como credencial de producción.

Las pruebas live sintéticas confirmaron disponibilidad del modelo principal y del modelo
de ayuda, tool calls compatibles con `get_configuration` y embeddings de 1024 dimensiones.
Con el límite de producción de 1024 tokens, el principal completó una respuesta JSON que
pasó los controles de prosa y fuentes. El modelo de ayuda completó JSON, pero su prosa
incluyó dígitos y no pasó ese contrato. Reducir la salida a 256 tokens agotó el límite de
ambos modelos antes de obtener contenido final. Estos resultados explican por qué no se
habilitó `ASSISTANT_PROVIDER_VERIFIED`; no sustituyen los 200 casos del plan ni prueban
la calidad general, el consumo de razonamiento o la retención del proveedor.

La prueba posterior con las ocho herramientas reales encontró HTTP 400 por un mensaje
system después del usuario: Workers AI exige ese contexto al inicio. Se consolida el
sistema/configuración antes de la conversación y se filtra la configuración con el mismo
control de credenciales del resto del contexto, incluyendo Bearer. También se observó
numeración en prosa del principal; el prompt ahora prohíbe dígitos expresamente, incluyendo
listas y medidas, sin relajar el rechazo determinista de respuestas inválidas.

Con sesiones del operador en los dashboards se crearon un token exclusivo de Workers AI
(Read/Edit de la cuenta) y un token R2 de servicio (Account API token, Object Read & Write,
solo `kova-assistant`). El panel de R2 confirmó que ese token está activo y restringido al
bucket previsto. Los valores se transfirieron directamente a Fly, sin mostrarlos en chat,
archivos, commits o logs, y se limpiaron las copias temporales de memoria.

Fly guardó once variables `ASSISTANT_*`: credenciales, cuenta, bucket, cohorte explícita
y los cinco flags de habilitación/verificación en `false`. No se editaron los secretos
existentes de autenticación, base de datos, Stripe, correo o cifrado fiscal. El intento
de aplicación desde el dashboard (`2132183`) falló al iniciar el deployer, antes de
desplegar la aplicación. La incorporación al runtime usa el release protegido de CI,
con captura de rollback, verificación de salud y el mismo proceso HTTP existente;
no requiere crear el worker ni habilitar inferencia. Verificar después del release
que ya no aparecen como staged antes de declarar la configuración aplicada. Ese check
pasó con el release de `ff83b66`; frontend, API, proxy y DB se verificaron con SHA exacto.

Referencias: [token AI](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
[claves R2](https://developers.cloudflare.com/r2/api/tokens/).

La configuración de un proceso Fly separado para chat/retención se integró desde
`codex/assistant-runtime` ([PR #159](https://github.com/ArturoFrancoMozqueda/kova/pull/159)),
y se desplegó en `83850dc` (Fly release 326). CI y aceptación pasaron; el dashboard
confirmó una máquina assistant activa shared-cpu-1x@1024MB y un standby detenido,
conservando las dos máquinas web existentes. El operador autorizó mantener una
máquina activa para la cohorte de prueba.
La [calculadora de Fly](https://fly.io/calculator/) mostró
US$8.37 de cómputo mensual para una máquina shared, un CPU, 1024 MiB, 730 horas en `dfw`,
sin volumen ni reserva; la transferencia se presupuesta aparte. Fly crea por defecto
un standby detenido para procesos sin servicio; verificar una sola máquina activa
y el almacenamiento facturable de la reserva al desplegar. CPU/RAM se cobran por
tiempo encendido; apagar el worker requiere un mecanismo de arranque y retrasa sus tareas.
No es un techo de gasto impuesto por el proveedor. No hay host de ingesta desplegado: documentos,
mutaciones y correo siguen apagados. La cohorte del piloto está identificada, pero sus
UUIDs, contactos y credenciales se mantienen fuera de esta documentación pública.

### Piloto de lectura solicitado por el operador

El operador pidió habilitar la bolita con IA en la cohorte de prueba antes de la batería
general. El piloto de lectura selecciona `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
para consultas y ayuda, por su contrato de herramientas nativas y JSON Mode. Los Qwen
siguen como defaults históricos, pero no se activan en esta cohorte. Mantener documentos,
mutaciones y correo en false y consentimiento externo por usuario. Para reservar margen
por las pruebas externas, configurar presupuesto diario de 6000 neuronas y chat de 5000;
el release inicial limitaba cada persona a tres cuartos de la parte del negocio.
La orientación de configuración debe completar el chat sin crear propuestas cuando
mutaciones está apagado, aunque el modelo devuelva steps; no cambiar los guards de
preparación ni confirmación del ejecutor. Verificar contratos live con datos sintéticos
antes de encender los flags del piloto, después capacidades autenticadas y una respuesta
real a través del worker. Habilitar una sola cohorte no acredita calidad general:
la batería de 200 casos y revisión humana sigue pendiente antes de ampliar clientes
o capacidades. No afirmar que el piloto superó sus porcentajes de resolución/citas.

Se separa la planificación de lectura de la explicación final: Llama usa el endpoint
nativo con herramientas planas y luego el endpoint compatible con JSON Schema, sin
herramientas. No enviar un array vacío de tools: el proveedor lo rechaza. Ambas llamadas
conservan el modelo permitido, contexto autorizado, reservas y límites existentes. La
respuesta de planificación no se publica. El servidor sigue validando fuentes y prosa.
Los cuatro escenarios sintéticos live pasaron: orientación de ticket, ventas con lectura
real del contrato, guía con instrucción maliciosa y rechazo de infraestructura/otro negocio.
Esto comprueba la integración acotada, no la calidad general ni un chat autenticado real.

**Built with Llama.** Este piloto usa Llama 3.3 bajo la
[Llama 3.3 Community License](https://github.com/meta-llama/llama-models/blob/main/models/llama3_3/LICENSE)
y su política de uso aceptable. Cloudflare aloja la inferencia; no se distribuyen pesos
ni se instala el modelo con acceso al servidor de Kova.

La activación de flags se aplica junto con el release protegido de esta corrección.
Verificar después del release: credenciales ya aplicadas, worker activo, SHA público y
bolita visible con sesión autorizada. Hasta esas comprobaciones, no declarar el piloto
funcional. Los datos del negocio solo salen al proveedor tras aceptar el consentimiento
del producto.

## Mejora de capacidad gratuita para Sweet Home — 2026-10-06

El operador indicó que actualmente prueba con Sweet Home y pidió priorizar una prueba
sin gasto adicional de inferencia. La corrección local conserva los máximos gratuitos
de configuración: `ASSISTANT_DAILY_BUDGET=9000` y `ASSISTANT_CHAT_BUDGET=8000`.
Cloudflare publica diez mil neuronas gratuitas al día por cuenta, con renovación a
medianoche UTC; [tarifas verificadas](https://developers.cloudflare.com/workers-ai/platform/pricing/).
El worker de Fly y otros recursos conservan su costo propio. Estos contadores no pueden
garantizar la factura completa de una cuenta que también ejecuta otras aplicaciones.

Cambios de comportamiento:

- Se elimina el máximo independiente de treinta mensajes diarios. Se conservan tres
  consultas por minuto, concurrencia y el presupuesto compartido atómico.
- Cada persona puede utilizar hasta la parte completa de su negocio. El contador del
  negocio sigue compartido: dos personas no duplican su cuota. Se retira el descuento
  personal anterior de un cuarto, que impedía aprovechar capacidad todavía disponible.
- El chat de lectura realiza una planificación y una explicación final después de
  consultar sus herramientas; se elimina la planificación adicional redundante.
- Antes de cada llamada se persiste una reserva con identificador y día UTC. Solo el
  uso completo y coherente reportado por Llama permite liberar la parte no utilizada,
  conservando el margen de estimación del quince por ciento. El esquema del proveedor
  publica `prompt_tokens`, `completion_tokens` y `total_tokens` en
  [su contrato de salida](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/sync-output.json).
  Uso ausente, cero, incompleto, con campos adicionales o de modelos con razonamiento
  conserva la reserva completa. Un consumo superior al límite reservado detiene la
  consulta. La conciliación y su comprobante se confirman juntos; los reintentos
  concurrentes no pueden liberar la misma reserva dos veces ni descontar de otro día.
- Las guías publicadas cubren Caja, Turnos, reposición y significado de métricas, con
  búsqueda de plurales y acentos sin embeddings para las guías públicas. Las instrucciones
  piden explicar hallazgo, significado y siguiente acción sin inventar causas.
- Inventario envía hasta cinco alertas de las disponibles en el reporte, con tamaño de
  muestra explícito, fechas y valoración. El reporte base entrega hasta diez alertas;
  el conteo comunicado no representa todos los productos del negocio. Las tarjetas
  muestran existencias reales, duración estimada o historial insuficiente y costos
  faltantes. No se modifican las definiciones de ventas o inventario.

Para aplicar la capacidad máxima después del release aprobado, ajustar únicamente las
dos variables de presupuesto anteriores en el runtime. El piloto de lectura se activó
inicialmente con 6000/5000: los valores existentes pueden prevalecer sobre los defaults.
La cohorte fijada al comenzar el día se conserva hasta la siguiente renovación UTC.
Una ampliación de presupuesto para esa misma cohorte aplica sin borrar ni reducir el
consumo acumulado; cambiar sus negocios espera al siguiente día. Verificar antes
el consumo externo de esa cuenta y mantener margen para él. No hace falta contratar
inferencia de pago para esta corrección.

La prueba autenticada posterior al PR #162 detectó dos interrupciones de interfaz:
el shell desmontaba la bolita al renovar la misma identidad y la página completa
repetía su recuperación inicial al cambiar el enlace de continuación. La corrección
preserva el borrador y trabajo al refrescar la misma sesión, mantiene el borrado de
estado privado ante cambios de negocio, usuario o rol, y conserva el resultado nuevo
al actualizar la URL. Sus pruebas cubren el borrador, la revocación y las tarjetas
de un trabajo que termina después de cambiar el enlace. La ampliación de presupuesto
conserva el consumo ya registrado y mantiene la cohorte del día; no devuelve reservas
antiguas ni redistribuye capacidad a otros negocios.

Archivos afectados: `backend/app/assistant/{budget,generation,knowledge,provider,repository,tools}.py`,
`frontend/src/assistant/{AssistantCompanion,AssistantView,EvidenceCards}.tsx`, el DTO de tarjetas
en `frontend/src/assistant/api.ts`, `backend/app/tests/test_assistant.py`, el nuevo
`frontend/src/assistant/EvidenceCards.test.tsx` y esta guía. El test previo de etapas de
planificación pasa de tres llamadas a dos porque ese comportamiento cambió; conserva
las comprobaciones de evidencia y no publica la prosa de planificación.

Validación local: 64 tests backend del asistente con Postgres/pgvector real, incluida
conciliación concurrente, ACL/RLS y contexto retirado; 18 tests de sus componentes;
typecheck, lint, contratos, build/SSR/prerender y revisión de secretos del bundle. El navegador
comprueba apertura, privacidad del borrador
y continuidad a 320 y 1280 px con API simulada. No acredita respuesta live del modelo,
calidad general ni factura real. El operador aprobó la publicación para probar el piloto.
Los PR #162 y #163 se publicaron por el release protegido, con aceptación completa;
frontend y API confirmaron `712ccebf1ff0`, Fly release 329, dos máquinas web activas,
una assistant activa y su standby detenido. La cuota autenticada pasó de cinco mil
a ocho mil sin borrar el consumo del día. No se activó inferencia de pago.

La comprobación autenticada encontró ventas del periodo que coinciden con Análisis,
y un día sin ventas con tarjetas en cero y explicación guardada. La guía de cierre
de turno recuperó las fuentes públicas correctas. Una consulta conjunta falló en
el proveedor y otra de inventario fue rechazada por citar una fuente no recuperada;
estas pruebas no acreditan calidad general del análisis ni inventario live.

También se reprodujo un fallo adicional de entrega: publicar el run completado
limpiaba el efecto de polling antes de recuperar sus mensajes. La corrección
termina esa recuperación antes de publicar el estado final, conservando los guards
de cancelación y privacidad. Su regresión usa una lectura de conversación retardada
y verifica la explicación junto con las tarjetas, sin recargar la página.

Para mejorar la explicación de lectura, el paso final recibe el historial autorizado
y los resultados exactos en un bloque JSON de evidencia no confiable, sin reenviar
la estructura de llamadas ya ejecutadas. Este contexto completo y el esquema se
miden antes de reservar presupuesto. Las citas del esquema se restringen a las
fuentes realmente recuperadas (ninguna en consultas solo numéricas), además de
mantener la validación de fuentes/ACL antes de entregar. No se habilitan herramientas
nuevas ni mutaciones. La publicación y QA de esta última corrección están pendientes.

Para seguir probando sin inferencia de pago, el chat puede utilizar hasta las nueve
mil unidades del presupuesto total gratuito con
`ASSISTANT_CHAT_USES_TOTAL_BUDGET=true`, únicamente mientras documentos, correo y
mutaciones permanecen apagados. La variable y el default de chat conservan ocho mil:
las imágenes anteriores siguen siendo compatibles durante una reversión, porque no
leen el nuevo flag. Si se habilita otra capacidad, el chat vuelve al presupuesto normal
y conserva el consumo. No se duplica la reserva de tareas de fondo. Esta asignación
requiere configuración explícita. La cuenta conserva su techo de nueve mil y el margen frente a las diez mil
del proveedor. No se reinician contadores, no se devuelve consumo anterior ni se
elimina la renovación diaria. La estimación conservadora puede bloquear antes de
agotar la cuota real del proveedor; no usar su dashboard para borrar reservas.

## Comportamiento implementado

- `/assistant`: conversaciones privadas, configuración con vista previa y confirmación, archivos,
  memoria explícita, objetivos, seguimiento, consentimiento y exportación personal.
- Perfil, ticket, categorías/productos, sucursales e invitaciones pasan por los servicios existentes.
  CSV/XLSX usa la validación/importación existente, con hash del archivo y transacción atómica.
  Una propuesta corregida cancela la anterior y necesita una confirmación nueva.
- Solo owner/manager con sesión válida y acceso a todas las sucursales; las acciones conservan los permisos específicos y el acceso
  comercial vigente. No hay herramientas para shell, SQL, infraestructura, código, navegación,
  pagos, caja, ajustes de stock, fiscal, suscripciones o eliminación de cuentas.
- Las herramientas de consulta leen configuración, ventas, productos más vendidos, comparación de
  sucursales, inventario, guías publicadas, documentos autorizados y memoria explícita. Kova calcula
  las cifras y las muestra en tarjetas; el contrato de prosa rechaza dígitos y enlaces. Su exactitud
  narrativa requiere evaluación del modelo y no se declara garantizada por un regex.
- Documentos privados por defecto; compartir requiere acción del propietario. RAG aplica tenant y
  propietario/compartición **antes** de ranking semántico/FTS. Las guías públicas son contenido
  publicado expresamente en `knowledge.py`; no se indexa el repositorio de Kova.
- Una versión reemplazada se retira al terminar de indexar la nueva. Se vuelve a autorizar la fuente
  antes de otra llamada y antes de entregar la respuesta. Fuentes retiradas y recuerdos corregidos
  invalidan respuestas derivadas cuando se consultan de nuevo.
- Trabajos durables, cuotas compartidas, idempotencia, resultados parciales y outbox. Un resultado
  remoto incierto no se reintenta automáticamente. La aceptación de Resend no prueba llegada al inbox.
- Señales de onboarding/reposición/objetivos calculadas por Kova, sin inferencia automática adicional.
  El worker revisa cambios operativos con debounce de cinco minutos y respaldo horario. Correos con
  opt-in, cuenta verificada, horario del negocio y máximo un resumen diario por usuario. Los
  resúmenes de fechas anteriores se cancelan al recuperar el proveedor, sin acumular una ráfaga.
  Las invitaciones asistidas tienen techo de cinco/hora y diez/día por usuario, veinte/día por tenant.

## Requisitos y orden de despliegue

1. Respaldar y revisar los gates de release existentes. Este trabajo no cierra KOV-031 ni los gates
   de Stripe, restore, privacidad, entregabilidad o producción.
2. Postgres 16/17 con pgvector 0.8.x disponible (CI: 0.8.7; Supabase Production: 0.8.0 disponible). La extensión debe estar en `extensions`; la migración
   se detiene si ya está en otro esquema. Revisar ese caso expresamente, no mover extensiones a ciegas.
   Compose/CI usan `pgvector/pgvector:0.8.7-pg16-bookworm`.
3. Aplicar Alembic 0075 como el propietario, después de 0074. Reaprovisionar `kova_app` usando
   `backend/scripts/provision_app_role.sql`. El runtime conserva NOSUPERUSER/NOBYPASSRLS y FORCE RLS.
   Nuevas ACL restrictivas se verifican al arrancar. No conceder tablas a anon/authenticated/service_role.
4. Desplegar backend antes que frontend, manteniendo todos los flags del asistente en `false`.
5. Ejecutar **un worker separado** con `uv run python scripts/run_assistant_worker.py` desde `backend`.
   `--once` sirve para una iteración supervisada. El worker usa APP_DATABASE_URL con el mismo rol RLS;
   no necesita una conexión de propietario para procesar trabajos. No publicar puertos del worker.
6. Para documentos de conocimiento, el host de ingesta necesita Docker CLI/daemon y la imagen
   `kova-assistant-parser:1` construida desde `backend/assistant-parser`. El backend HTTP actual de Fly
   no instala ni inicia un daemon Docker: no basta con habilitar un flag en esa máquina.
   Usar un host de ingesta dedicado, sin montajes de repositorios, secretos o infraestructura de Kova
   en el contenedor analizador. El analizador necesita 4 GiB por proceso para cargar las firmas
   completas de ClamAV; con tres trabajos simultáneos, prever al menos 16 GiB en el host. Esta
   infraestructura tiene costo propio y no forma parte de la cuota gratuita de inferencia.
   No conectar su socket a una herramienta disponible para el modelo.
7. Crear bucket R2 **privado**, sin dominio público/r2.dev, con credenciales exclusivas de ese bucket.
   Originales y marcadores de borrado se guardan allí. No enviar credenciales al frontend ni al modelo.
8. Configurar una cuenta Workers AI dedicada: otras aplicaciones de la misma cuenta también consumen
   su cuota y no participan en este contador. El DNS de un dominio en Cloudflare no ejecuta inferencia.
   Usar token de Workers AI, nunca un token de administración de DNS/Fly/Vercel/Supabase.
9. Verificar los contratos del proveedor y la batería del plan. Solo entonces poner
   ASSISTANT_PROVIDER_VERIFIED=true y habilitar una cohorte explícita de UUIDs del servidor.
   La excepción de lectura de una cohorte se describe arriba; no habilita otras capacidades.
   Activar configuración, documentos y resúmenes con flags separados, gradualmente.

Las variables nuevas y sus defaults están en `.env.example`. Ninguna usa prefijo VITE_. El código
predeterminado mantiene modelos Qwen de pesos abiertos alojados en Workers AI:
`@cf/qwen/qwen3.8-27b` para consultas generales, `@cf/qwen/qwen3-30b-a3b-fp8` para ayuda inicial,
y `@cf/qwen/qwen3-embedding-0.6b` para vectores de 1024 dimensiones. No se instala un modelo con
acceso al host, herramientas integradas o credenciales de infraestructura.

## Presupuesto, equidad y carga

Workers AI ofrece 10,000 neuronas diarias por cuenta; no es una cuota por tenant. El código reserva
como máximo 9,000/día: 8,000 chat y el resto ingesta. El reset del contador es 00:00 UTC.

- La primera reserva congela la cohorte de ese día. Añadir o retirar negocios espera al
  siguiente día. Aumentar el presupuesto de la misma cohorte conserva todos los contadores;
  bajar un límite surte efecto inmediatamente. No redistribuir cuota a mitad del día.
- El pool se divide por tenant; una persona puede utilizar toda la porción compartida de su tenant.
  Nadie puede agotar la porción asignada a otro negocio. No hay préstamos de cuota en esta versión.
- Tres consultas/minuto por usuario, sin tope independiente de mensajes diarios; hasta cuatro
  llamadas al modelo para configuración y dos para lectura, con ocho herramientas por turno.
  Contexto acotado a 8,000 bytes reservados como tokens, salida a 1,024; sin fallback pagado.
- Tres trabajos/cargas simultáneos globales, dos por tenant y uno por usuario, con leases de 11 min.
  Indexación en lotes y pausa entre iteraciones para evitar monopolizar un slot.
- Archivos: 20 MiB para conocimiento, 2 MiB para CSV/XLSX; 100 documentos/100 MiB acumulados por
  tenant, incluyendo privados de otros administradores y cargas incompletas. El contador solo guarda
  UUIDs/tamaños. Cinco cargas/hora y 20/día por usuario; 50/día y 200 MiB recibidos/día por tenant.
- El OCR reserva CPU antes de intentar extracción: 1,800 segundos máximos por tenant/día. El parser
  corre sin red, read-only, nonroot, sin capabilities, con RAM/CPU/PIDs/tmp/timeout acotados.

Las reservas son conservadoras. Para Llama, una respuesta con uso completo y coherente libera
capacidad no utilizada de forma atómica; los demás modelos y resultados inciertos conservan
la reserva completa. El contador mantiene margen y no representa una factura exacta conciliada
con Cloudflare. Tarifas, tokens de razonamiento y facturación deben verificarse en
la cuenta dedicada antes de activar. Si cambian, apagar la inferencia y actualizar contratos/pruebas.
No se promete un número de clientes: medir consultas reales, latencia, reservas y cola por cohorte.
Aumentar tenants reduce su porción; un techo de gasto no prueba capacidad ni calidad.
El modelo Llama del piloto se reserva con las tarifas verificadas de 26,668 neuronas
por millón de tokens de entrada y 204,805 por millón de salida, con margen del 15%.
El límite inicial del piloto (6000 total/5000 chat) deja margen para el consumo externo
observado. Su ampliación gratuita a 9000/8000 está preparada, pendiente de release y revisión
del consumo de la cuenta; la cuota de Cloudflare conserva su alcance de cuenta y no es por negocio.

Referencias de operación: [tarifas Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[modelo principal](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/),
[modelo de ayuda](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/),
[pgvector](https://github.com/pgvector/pgvector),
[requisitos de memoria ClamAV](https://docs.clamav.net/manual/Installing/Docker.html),
[idempotencia Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Incidentes, privacidad y rollback

- ASSISTANT_ENABLED=false detiene nuevas consultas/configuración y proactividad. Los permisos de
  retirada, exportación personal y borrado siguen disponibles. Mantener el worker de retención activo
  y conservar la cohorte para limpiar datos incluso con usuarios inactivos o acceso comercial vencido.
- Una llamada remota cancelada puede consumir su reserva; no hay cancelación garantizada del proveedor.
  Un run interrumpido o un embedding con resultado incierto termina sin replay automático. Revisar
  el estado y crear una consulta nueva o retirar/reemplazar el archivo explícitamente.
- Metadatos de cuota/asignación se retienen 30 días. Conversaciones, runs, mensajes, tareas y mail
  se retienen 90 días; propuestas dependientes se borran
  con su conversación. Auditoría mínima de acciones y ledgers de idempotencia del dominio sobreviven.
  Memoria/objetivos/documentos se conservan hasta retirada o borrado de cuenta. Archivos fallidos en
  cuarentena/cargas incompletas caducan; el original se borra antes de eliminar el registro de DB.
- Las tareas pospuestas permanecen pospuestas hasta que los datos las resuelvan o el usuario las
  cambie; esta versión no incluye recordatorios con fecha elegida por el usuario.
- Un fallo de R2 conserva estado de borrado y metadatos para reintentar. La purga completa de cuenta
  elimina originales antes del grafo de Postgres; no declarar purga completa si falta almacenamiento.
  No quitar una cohorte del servidor antes de limpiar sus datos/cargas pendientes.
- Una restauración debe reejecutar el registro operativo externo de solicitudes de borrado **antes**
  de abrir tráfico o reactivar cohortes. HEAD de originales y marcadores R2 evita recuperar fuentes
  retiradas; no sustituye un procedimiento probado de restore ni borra backups históricos.
- En outbox, `sending`/`ambiguous` requiere reconciliación supervisada con Resend. Nunca editarlo a
  `queued` a ciegas: su ventana de idempotencia es 24 h. Para invitaciones, revisar/revocar desde el
  flujo existente y emitir una invitación nueva si corresponde. No registrar el token ni ciphertext.
- Rollback de aplicación: desactivar flags y conservar la migración aditiva. El downgrade de 0075
  solo admite tablas de contenido vacías y se niega a destruir datos existentes.

## Evidencia local y gates pendientes

Validaciones locales disponibles en la rama: pruebas del asistente con Postgres real y `kova_app`,
regresiones de autenticación/UI, suite frontend, build/SSR/prerender, verificaciones de contrato y
migraciones. La QA de navegador usa un negocio de prueba en una base aislada: no se agregan datos
ficticios a rutas de producción. Resultados: 768 tests backend en la suite completa y 37 específicos
del asistente tras el filtrado de documentos; 703 tests frontend y 29 focalizados finales (nueve de la bolita,
cinco de la vista completa y quince de identidad); siete de migraciones. Resultados y límites se
registran en el plan.

La bolita usa el isotipo de Kova y acompaña al owner/manager online dentro de la cohorte habilitada.
No inicia inferencia al abrir ni envía datos de la página. El panel conserva el borrador entre rutas,
pero limpia estado y aborta peticiones al cambiar identidad/sucursal. Abrir el asistente completo
permite revisar propuestas, archivos y preferencias. Los recorridos iniciales y diálogos de cobro
tienen prioridad visual; en caja la bolita evita el resumen de venta y la columna de pago.
La ingesta valida todas las páginas antes de guardar fragmentos y aplica filtros de secretos y
patrones comunes de código, además de la lista cerrada de formatos. No garantiza reconocer todo
código/credencial: no debe usarse como permiso para exponer el repositorio o infraestructura.

**Todavía pendientes antes de producción:** construir/verificar la imagen del parser y sus firmas de
ClamAV, malware/zip bombs/PDF/OCR adversarial, pruebas live de ambos modelos y embeddings, evaluación
es-MX de los 200 casos del plan, razonamiento/cuota/retención del proveedor, cuenta dedicada,
configuración R2/Resend, aislamiento de red del host de ingesta, carga/leases multiworker bajo fallos,
restore/borrado y entregabilidad real. Las respuestas simuladas en unit tests prueban el contrato y
los controles; no prueban la calidad de un modelo ni la seguridad completa de producción.

## Integración con main — 2026-10-06

Se integraron los cambios de POS/CFDI de `origin/main` (`489ae4c`). La migración del asistente
se renumeró a `0075_assistant`, después de `0074_cfdi_documents`, antes de su primer despliegue.
Se conserva cryptography 50.x exigido por main. Los campos configurables usan una lista cerrada: una
ampliación de schemas del dominio no autoriza campos nuevos al asistente. En particular no modifica
impuestos del ticket y conserva la tasa existente al cambiar pie/nombre. Administradores asignados
a una sola sucursal no usan este asistente de negocio; API, worker y reautorizaciones rechazan
esa condición, incluyendo cambios de permiso durante una consulta.

CI construye la imagen del parser y ejecuta `backend/scripts/check_assistant_parser.py` con ocho
casos sin datos de clientes. El gate bloquea migraciones/release ante scanner indisponible o
fallos de aceptación/rechazo. La batería PDF/OCR completa y un host de ingesta real siguen
siendo requisitos antes de activar documentos; no confundir el runner de CI con ese host.

Evidencia de integración local: 754 tests frontend, 14 de migraciones y 40 específicos del
asistente pasaron; build/SSR/prerender, lint, contratos OpenAPI, bundle y contratos operativos
pasaron. La suite backend integrada dio 968 aprobados y un fallo de gastos por el timezone
America/Mexico_City heredado por la base temporal nueva. Se ajustó solo esa base a UTC (como CI)
y pasaron los 43 casos focalizados de gastos/asistente y las 969 pruebas de la suite completa;
no se cambia código ni expectativas de gastos. CI ejecuta la suite completa en UTC antes del merge.

El primer CI del PR verificó la imagen del parser y los ocho casos reales, incluyendo EICAR;
esto cierra el smoke gate de construcción/scanner, no la batería PDF/OCR completa. Los recorridos
mockeados detectaron la nueva consulta de capacidades del shell: el fixture ahora declara ese
contrato exacto con todos los flags apagados por defecto, sin relajar el rechazo de otras llamadas.
Los recorridos nuevos cubren cohorte apagada y bolita a 1280/320 px: no hay inferencia al abrir,
la URL se conserva, el borrador sobrevive navegación, el menú tiene prioridad y el contenido
privado no se escribe en Web Storage.
