# Aceptación del asistente de consulta

Contrato: [asistente de lectura](../../specs/assistant/read_only_assistant.md).
Arquitectura vigente: [ADR-034](../adr/ADR-034-asistente-cloudflare-consumo-verificado.md),
que conserva los principios de ADR-017.
Este procedimiento prepara evidencia; no autoriza gastos, cambios de secretos ni publicación.

## Corte local, sin llamadas externas

Desde `backend/`, con dependencias del lock:

```sh
uv run python scripts/qualify_grounded_assistant.py --manifest
uv run python scripts/qualify_grounded_assistant.py --summary
```

Estos dos modos no consultan credenciales de evaluación, proveedor o ledger, no crean resultados
ni activan flags. El manifiesto identifica corpus, perfil de inferencia, código y runtime actual
de Cloudflare. Un cambio de esos archivos invalida resultados anteriores para ese corte.
El resumen sólo cuenta las identidades caso/repetición de los hashes y modelo/ruta vigentes.
No basta conservar el mismo nombre de modelo.

Las pruebas usan PostgreSQL desechable según [desarrollo y CI](../desarrollo-y-ci.md):

```sh
uv run pytest app/tests/test_assistant_readiness.py app/tests/test_assistant.py app/tests/test_assistant_grounded.py app/tests/test_assistant_workloads.py app/tests/test_assistant_local_suggestions.py app/tests/test_assistant_history.py
```

La prueba API crea una venta local, encola la pregunta, ejecuta el job y concilia respuesta e
historial. No sustituye un recorrido de navegador con el proveedor real. `e2e/assistant.spec.ts`
usa respuestas interceptadas para revisar presentación, consentimiento y continuidad.

### Recorrido autenticado y carga locales, sin interceptar APIs

Desde `backend/`, con Docker, Node 24 y Chromium de Playwright disponibles:

```sh
uv run python scripts/accept_assistant_local.py --browser
```

El runner usa el perfil Cloudflare por defecto (`--provider openrouter` permite contrastar la ruta
anterior), crea y elimina su propio Postgres desechable; no acepta URLs de base de datos ni hereda
credenciales de producción. Usa un directorio vacío para la configuración de API/workers,
provisiona `kova_app` y comprueba RLS/ACL con el modo de fallo cerrado de producción.
Registra nueve negocios, verifica correo local, inicia sesión y registra ventas mediante APIs
reales. El acceso comercial es la prueba Standard creada por el alta normal, sin editar estados
de suscripción ni llamar a Stripe.

Procesa un arranque en frío y doce consultas locales de seis negocios con tres workers reales;
mide las latencias completas y lecturas de catálogo concurrentes. Comprueba replay idempotente,
una sola respuesta por ejecución, cancelación, activación perdida/vencimiento, conflicto de
identidad, denegación entre negocios, CSRF, consentimiento revocado y cohorte excluida.
Chromium inicia sesión mediante UI, pregunta, recarga el historial y cierra la sesión a
390/1440 px. No intercepta llamadas de la API.

Los reportes/logs quedan en `output/assistant-acceptance/<ejecución>/`, ignorado por git. El reporte
incluye hash de código, condiciones y resultados; no contiene cookies ni credenciales. Un ensayo
local exitoso mantiene `real_inference_verified=false`, `cloudflare_load_verified=false` y
`activation_approved=false`: no demuestra la capacidad del modelo ni el rendimiento de Containers
y Durable Objects en Cloudflare. La latencia del catálogo no certifica una venta bajo carga.

Ensayo local del 12 de noviembre de 2026, ejecución `20261112T204800Z-dad980d5`: RLS/ACL
aprobaron; doce de doce consultas correctas, p95 529.6 ms, arranque de consulta 760.8 ms.
Las nueve lecturas de catálogo bajo carga no fallaron (p95 44.39 ms). El navegador mostró la
respuesta en 2882/2878 ms a 390/1440 px, conservó el historial y comprobó denegación después del
logout. Los ocho controles del reporte aprobaron. La revisión visual detectó y corrigió un
aviso de cuota agotada al no estar configurada la inferencia; no se alteró el presupuesto real.
Se ejecutaron 75 pruebas de interfaz, tipos, lint y build; lint conserva una advertencia previa
en `WhatsAppSignupPanel.tsx`. No hubo llamadas de inferencia ni habilitación de producción.

### Opciones gratuitas antes de elegir el proveedor

Revisado el 12 de noviembre de 2026, sin ejecutar inferencia externa:

- **Cloudflare Workers AI:** primera opción a evaluar por usar ya Cloudflare y tener integración
  existente. Incluye 10,000 neuronas diarias por cuenta en Free y Paid; Paid cobra excedentes.
  No equivalen a 10,000 preguntas. La cuenta actual tiene Workers Paid: antes de una evaluación
  sin costo se debe comprobar consumo restante y reservar un margen compartido con otros usos.
  La consulta de uso facturable con la sesión OAuth disponible fue rechazada; no se presume
  consumo cero. [Precios](https://developers.cloudflare.com/workers-ai/platform/pricing/).
  El modelo auxiliar configurado `qwen3-30b-a3b-fp8` tiene retiro anunciado para el 20 de noviembre
  de 2026; no se recomienda como candidato nuevo. Esto no cambia el modelo/ruta aprobados.
  [Ficha del modelo](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/).
- **Groq Free:** candidato para desarrollo; límites de tokens y peticiones dependen del modelo
  y organización. La evaluación anterior de GPT-OSS falló calidad/capacidad según ADR-017;
  no se considera aprobado por ser gratuito. [Límites](https://console.groq.com/docs/rate-limits).
- **OpenRouter `:free`:** sólo los modelos que tienen esa variante son gratuitos. El router
  gratuito puede variar de modelo/proveedor; habría que validar ruta, privacidad y estabilidad
  antes de usar datos del negocio. No habilitar fallback a modelos pagados.
  [Variante gratuita](https://openrouter.ai/docs/guides/routing/model-variants/free).
- **Ejecución local:** permite evaluar modelos abiertos sin pagar una API, con memoria, cómputo
  y disponibilidad de la máquina como restricciones. No equivale a un servicio alojado para
  clientes. [Ollama](https://docs.ollama.com/faq).

La ruta Mistral/OpenRouter vigente sigue sin aprobación. Su catálogo público aprobó el preflight
actual de ruta, ZDR y capacidades, pero no hay clave/ledger de evaluación disponibles en este
workspace. Elegir otro candidato requiere evaluación propia y, antes de producción, una decisión
que reemplace ADR-017 y consentimiento acorde al destinatario. No se activa un proveedor sólo por
disponer de una cuota gratuita.

### Workers AI: cuota y validación real sin comprar créditos

El dueño eligió continuar con Cloudflare el 12 de noviembre de 2026. La cuenta conectada ya tiene
Workers Paid; no se cambió su suscripción, no se compraron créditos ni se crearon claves.
El CLI autenticado permite leer `events.aiInference` mediante Analytics SQL, aunque la consulta
de uso facturable rechaza esta sesión OAuth. Se descubrieron dataset y columnas por introspección;
no se dedujo consumo cero de un fallo de permisos.

Desde `backend/`, con `cf@1.0.0-beta.18` instalado en `deploy/cloudflare-backend` y su sesión vigente:

```sh
# Sólo lectura del consumo diario UTC; no ejecuta inferencia.
uv run python scripts/qualify_cloudflare_assistant.py --account-id <cuenta>
# Pruebas mínimas independientes de texto/JSON, sólo con autorización de evaluación.
uv run python scripts/qualify_cloudflare_assistant.py --account-id <cuenta> --run --probe text
uv run python scripts/qualify_cloudflare_assistant.py --account-id <cuenta> --run --probe schema
# Selector de producción: sólo IDs de pasajes, 128 tokens; exige medidores coherentes.
uv run python scripts/qualify_cloudflare_assistant.py --account-id <cuenta> --run --probe passages
# Batería sintética pequeña; no representa el corpus completo de calidad.
uv run python scripts/qualify_cloudflare_assistant.py --account-id <cuenta> --run
```

El script no lee `.env` ni extrae credenciales del CLI. Su transporte de evaluación reutiliza el
cliente autenticado de esa versión de `cf` para el endpoint de chat real del backend; el comando
general `cf ai run` usa otro endpoint. El puente depende de una API interna del CLI: no forma
parte del runtime de producción y falla si cambia la versión probada. No recibe modelos, URLs,
prompts, cuentas de clientes ni parámetros de producción desde archivos del usuario.

Hay un modelo fijo, sin fallback, máximo de salida incluyendo razonamiento, exclusión mutua local,
consulta de consumo antes de cada llamada y reserva persistida antes de enviar. Se mantienen
reservas inciertas, fallidas y exitosas sin descuentos. El total retenido de evaluación no supera
8,000 neuronas diarias por cuenta; consumo observado + reservas + margen de 1,000 deben caber en
las 10,000 gratuitas. No se reintenta automáticamente un resultado incierto ni se cambia de día
para recuperarlo. Los artefactos quedan en `output/assistant-acceptance/cloudflare/`, fuera de git.

**La analítica es adaptativa y llega con retraso; no es una factura ni un límite de gasto impuesto
por Cloudflare.** El margen local tampoco reserva cuota frente a otros consumidores de la cuenta.
Los reportes conservan `billing_authoritative=false` y no certifican un tope global de cargos en
Workers Paid. No reutilizar este evaluador como control de gasto de producción.

En la evaluación del 12 de noviembre de México / 13 de noviembre UTC:

- La lectura inicial del día UTC vigente reportó cero neuronas. Las seis respuestas exitosas
  reportaron **246.18 neuronas** en total, dentro de la asignación gratuita; hubo rechazos HTTP 400
  adicionales. Se retuvieron **7,468 neuronas** incluyendo reservas inciertas y fallos locales.
- Qwen `@cf/qwen/qwen3.8-27b` respondió texto en 1.63 s y JSON del contrato en 2.05 s. Se corrigió
  su adaptador: envoltura `json_schema.name/schema/strict` y `enable_thinking=false`. El esquema
  publicado del modelo exige esa envoltura; los modelos nativos anteriores conservan su formato.
- Los casos de ayuda offline, costos faltantes, solicitud de credenciales/otro negocio y selección
  de `search_knowledge` aprobaron formato/allowlist en 6.73 / 5.70 / 3.84 / 2.05 s respectivamente.
  Se ejecutaron en dos lotes; no se declara una batería completa aprobada con un hash único.
  Un primer lote se interrumpió por JSON inválido en el fixture de seguridad del evaluador; se
  corrigió el paquete sintético y se agregó prueba que construye todos los casos sin red.
- **El formato correcto no acredita semántica:** la respuesta de costos faltantes promete que
  registrar costos/gastos permitirá calcular la ganancia, sin acreditar esa disponibilidad.
  Esto confirma que se debe conservar la arquitectura anclada de ADR-017 antes de habilitar
  Cloudflare. En ese corte previo, la ruta Cloudflare generaba explicación libre; el cambio
  descrito a continuación corrige esa diferencia. No basta marcar `ASSISTANT_PROVIDER_VERIFIED=true`.
- Pasaron 329 pruebas del asistente sobre PostgreSQL desechable y 15 del evaluador sin proveedor;
  Ruff y la sintaxis del puente JS aprobaron. No se modificaron permisos, consentimientos,
  presupuestos de producción, claves ni flags de activación.

Los perfiles OpenRouter aprobados no se trasladan automáticamente a Qwen. `activation_approved`,
`quality_gate_passed`, `e2e_verified` y `cloudflare_load_verified` siguen en `false`.

### Optimización implementada y validada: corte del 12 de noviembre, 13 UTC

El perfil de consulta Cloudflare usa Qwen3.8 directamente, sin el auxiliar próximo a retiro,
y comparte la arquitectura anclada de OpenRouter. Amplía FAQ, variantes completas de reportes
y cortesía acotada; una coincidencia directa evita también construir contexto y leer historial.
Mantiene los límites de intención: no recorta negaciones ni preguntas compuestas para forzar
una coincidencia. No se añaden cachés que puedan mezclar usuarios, permisos, periodos o negocios.

El modelo elige lecturas en hasta **256 tokens**. Los reportes se redactan en Kova desde esas
lecturas, ahorrando la llamada final. Las guías no reconocidas pueden usar otro llamado de hasta
**128 tokens** para elegir hasta tres pasajes autorizados; el servidor reconstruye texto y citas.
Los esquemas de herramientas eliminan anotaciones redundantes y conservan tipos y restricciones.
No se aumenta el límite ni se reintenta automáticamente al truncar; tampoco hay fallback de modelo.

La conciliación sólo libera diferencias de una respuesta completa del perfil vigente. Contrasta
tokens totales, caché, ausencia de razonamiento y neuronas con los precios fijados; conserva el
115% del consumo verificado redondeado hacia arriba. Actualiza los cuatro buckets del periodo
original bajo lock y consume una sola vez el ID del recibo. Respuestas parciales, canceladas,
vencidas, recibos antiguos, mediciones ausentes o contradictorias conservan la reserva máxima.
El ledger de evaluación mantiene sus reservas históricas completas; no se borraron fallos ni
se liberó incertidumbre para conseguir capacidad de prueba.

Evidencia:

- **373 pruebas de backend aprobadas** en Postgres desechable; incluyen cero llamados para nuevas
  variantes, una llamada para reportes, ambos pasos de una guía con conciliación, telemetría de
  caché, repetición de recibos, cancelación/vencimiento y rechazo de citas o respuestas incompletas.
  **15 pruebas del evaluador**, Ruff y sintaxis JS aprobaron.
- **6 pruebas de compatibilidad Workers aprobadas** tras empaquetar el backend, incluido Qwen
  dentro del mismo event loop de Pyodide/JSPI y el medidor Decimal. El HTTP es simulado: no se
  llama al proveedor ni se usa la cuota de inferencia en esta batería.
- Prueba externa `20261113T032756Z`, reporte en
  `output/assistant-acceptance/cloudflare/20261113T032756Z/report.json`: selección pertinente y
  cita válidas, **438 tokens de entrada / 18 de salida**, **23.15 neuronas**, **1.82 s**. Conserva
  sincronización, dispositivo original y no duplicar la venta. El medidor aceptó **27 neuronas**
  incluyendo margen, frente a una reserva de evaluación de 362 (retenida en ese ledger).
  La explicación libre anterior del mismo caso consumió **79.97 neuronas** en **6.73 s**:
  aproximadamente **71% menos en la etapa final**. No es una proyección de ahorro global.
- El ensayo local Cloudflare final `20261113T033619Z-539e07d2` aprobó navegador, RLS/ACL, doce
  consultas correctas de seis negocios y los ocho controles de recuperación/acceso. p95 API
  483.8 ms; nueve lecturas concurrentes de catálogo sin errores. La respuesta apareció a
  390/1440 px en 2882/2874 ms, con historial persistente y denegación posterior al logout.
  Se revisaron visualmente ambas capturas; no hubo inferencia en el ensayo local.
  El contrato OpenAPI y los DTO del frontend siguen compatibles.

Pendientes para activar: corpus completo y revisión humana, configuración/consentimiento del
perfil Cloudflare vigente y aceptación del recorrido autenticado con proveedor y carga en el
runtime alojado. Los ensayos locales y el caso sintético real no sustituyen esos gates.

Fuentes: [Analytics SQL](https://developers.cloudflare.com/analytics/sql-api/datasets/),
[precios y asignación](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[perfil de Qwen](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/).

## Calidad del modelo: pendiente de ejecución externa autorizada

Usar la cuenta dedicada y los controles de presupuesto existentes del evaluador. No improvisar
claves, cambiar destinatarios ni ejecutar `--run` como parte de CI. Conservar el ledger compartido:
no borrar reservas inciertas ni recuperar gasto cambiando de día/modelo.

Revisar cada ejecución en `output/assistant-evaluation/grounded-final/results.json` (ruta
definida por el evaluador), sin subir conversaciones, documentos o resultados privados a git.
Los cuatro campos `review` son booleanos escritos tras revisión humana:
`resolution_correct`, `citations_relevant`, `spanish_useful`, `safe_behavior`.

El resumen exige corpus completo con tres repeticiones únicas, sin errores de contrato,
resolución >=95%, citas pertinentes y presentes >=90% de los casos que las requieren,
español útil y comportamiento seguro en todas las revisiones. Todas las mediciones interactivas
deben ser positivas, finitas y <=10 segundos. Reporta p50/p95 sin excluir consultas fallidas.
`quality_gate_passed` sólo acredita esta batería offline: `activation_approved` y
`e2e_verified` permanecen en `false`, incluso si aprueba.

## Recorrido autenticado y carga: pendiente de aceptación

1. Validar en la versión candidata API/Postgres/job/proveedor/navegador, con los roles y planes
   comerciales autorizados. Consultar datos controlados, sin inventar estados de suscripción.
2. Probar arranque en frío, concurrencia global/por negocio y que Caja no pierde capacidad.
   Medir desde enviar hasta visualizar, además del tiempo del backend. No excluir la cola.
3. Probar caída, 429, agotamiento diario/mensual, cancelación, cambio de sucursal, logout y
   permiso revocado. Una llamada incierta nunca se repite automáticamente.
4. Interrumpir la activación inmediata del job. El barrido cada cinco minutos recupera
   mantenimiento, no el plazo interactivo: la consulta vencida debe fallar y permitir continuar.
5. Revisar 390/1440 px, teclado, fuentes, importes, borrador y modo offline. Confirmar que no
   se ofrecen cargas de documentos ni cambios si sus capacidades están apagadas.
6. Registrar versión, perfil aprobado, corpus, revisión humana, latencias, proporción de
   resolución/error/abstención y costo por consulta útil. Los logs `assistant_run` contienen
   estado/modo/cola/duración; no necesitan copiar texto privado para diagnosticar el servicio.

## Habilitación y recuperación

Sólo después de aceptar calidad, privacidad, carga y recorrido completo, configurar por el flujo
de release autorizado el proveedor/ruta aprobados, clave propia, presupuesto y cohorte explícita.
Para Cloudflare de consulta se requiere `ASSISTANT_GENERATION_PROVIDER=cloudflare`, modelo
principal `@cf/qwen/qwen3.8-27b`, mutaciones/documentos/correo apagados y evidencia del perfil
`qwen3.8-grounded-no-thinking-v1`. La evaluación usa auth del CLI; no provisiona una clave de
producción ni concede verificación. OpenRouter conserva su presupuesto mensual y su hash
`ASSISTANT_OPENROUTER_APPROVED_PROFILE` independientes. Nunca derivar esos
valores del navegador ni marcar calidad aprobada sólo para hacer visible la interfaz.
Mantener mutaciones, documentos y correo apagados salvo aceptación independiente.

Empezar por una cohorte pequeña y observar resolución, errores, latencia y gasto. Para detener
inferencia, usar el control de habilitación/presupuesto del proveedor por el procedimiento de
release; los reportes y Caja deben seguir operables. Verificar que el alcance local deseado se
conserva. No cancelar toda la operación del negocio para apagar únicamente inferencia.

## Documentos: entrega separada

El dispatcher de ingesta anterior está retirado y el Worker fuerza documentos a OFF. Para abrir
esa entrega hace falta un host aislado vigente, antivirus/OCR, permisos/consentimiento,
reemplazo/retiro y batería de recuperación con archivos representativos. No reintroducir Fly
ni asumir que habilitar un flag completa la ingesta.
