# Asistente de consulta de Kova

## Problema, usuarios y valor

El dueño o administrador con acceso a todas las sucursales necesita consultar ventas,
productos e inventario y encontrar el siguiente paso en Kova sin interpretar métricas erróneas.
El primer alcance es de lectura: reportes del backend y guías públicas. La inferencia externa
requiere aceptación propia; la ingesta de documentos y las mutaciones permanecen apagadas.
Decisión vigente: [ADR-034](../../docs/adr/ADR-034-asistente-cloudflare-consumo-verificado.md),
que conserva la arquitectura anclada de ADR-017.
Las lecturas locales en el contenedor nativo siguen [ADR-035](../../docs/adr/ADR-035-consultas-locales-en-api-nativa.md).

## Requisitos funcionales

- El servidor controla cohorte, permisos y capacidades comerciales. La navegación exige
  `advanced_reports`; las herramientas conservan los permisos comerciales de reportes.
- Las preguntas locales reconocidas se resuelven sin inferencia ni reserva de presupuesto de
  modelo. Conservan autorización, consentimiento, límites de turnos y sucursal activa.
- En el contenedor nativo, las lecturas locales intentan ejecutar su trabajo confirmado en la
  misma petición mediante el procesador existente y sus locks. Si no hay cupo, conservan la cola;
  los reenvíos idempotentes sólo recuperan el trabajo original. La inferencia externa, la ingesta
  y los mantenimientos conservan su worker privado y su pausa operativa.
- Ventas, productos, inventario y sucursales admiten hoy, ayer, semana/mes actual y semana/mes
  anterior completos. Sólo productos destacados admiten todo el histórico.
- Fechas y límites se resuelven con el calendario del negocio; nunca con la fecha del navegador.
- El chat no compara automáticamente periodos ni calcula utilidad a partir de venta neta.
  Las definiciones proceden de [métricas](../../docs/report-metric-definitions.md).
- Las preguntas no reconocidas localmente requieren proveedor listo. Sin él, se explica la
  indisponibilidad; no se inventa una respuesta ni se elimina la pregunta del editor.
- Con OpenRouter y el perfil Qwen/Cloudflare de consulta, el modelo selecciona lecturas y pasajes;
  Kova calcula los reportes y valida
  las citas. Ninguna instrucción en mensajes/documentos concede permisos ni acceso a SQL.
- Las variantes completas reconocidas y cortesía acotada no consumen inferencia. No se eliminan
  instrucciones adicionales ni negaciones para forzar una coincidencia directa.
- El perfil Qwen de consulta reserva 256 tokens para elegir lecturas y 128 para seleccionar hasta
  tres pasajes. Un reporte sin pasajes no requiere una segunda llamada. No hay reintento automático
  por truncamiento ni fallback a prosa libre o a otro modelo.
- Conversaciones y respuestas conservan métricas, fuentes y sucursal al volver a abrirlas.
- Los botones sugeridos son consultas de lectura. Configuración sólo aparece habilitada por el
  servidor. Archivos aparece si se permiten documentos o quedan archivos previos que administrar.
- Sin inferencia conectada no se muestra un presupuesto no configurado como capacidad agotada.
  Las consultas locales y sus fuentes siguen disponibles según la autorización del negocio.
- Seguimiento y memoria existentes son registros del usuario o señales del backend; su
  disponibilidad no depende del envío de correo. No se prometen metas generadas por IA.

## Permisos, datos y API

Se usan `/api/v1/assistant/*`, `assistant_records`, las ACL por propietario y el RLS forzado por
tenant existentes. No hay tablas, migraciones ni endpoints nuevos. Identidad/sucursal provienen
de sesión y scope del servidor; los headers esperados sólo detectan cambios de contexto.
El permiso de procesamiento nombra al proveedor y destinatarios actuales. Cambiarlos exige
una aceptación nueva; revocarlo detiene nuevos envíos. Retirar/eliminar datos conserva su flujo.
No se relajan roles, acceso comercial, cuotas, reservas inciertas o idempotencia.

## Requisitos no funcionales y recuperación

- OpenRouter y Qwen/Cloudflare de consulta tienen diez segundos desde crear la consulta, incluyendo
  cola. Una consulta vencida
  pasa a fallida antes de admitir otra o durante mantenimiento del worker. Nunca se reenvía una
  llamada incierta ni se libera por ello una reserva/lease de una llamada todavía en curso.
- Qwen sólo concilia respuestas completas del perfil vigente, dentro de los límites reservados
  y con medidores de tokens/caché/neuronas coherentes. Conserva margen del 15%, actualiza los
  buckets del periodo original y no acredita dos veces una reserva. Cancelación, vencimiento,
  telemetría incompleta, contradictoria o de un perfil anterior conservan la reserva máxima.
- El polling cierra consultas vencidas; una respuesta tardía no se entrega. Una consulta activa
  dentro del plazo sigue bloqueando otra de la misma persona.
- El cliente puede recuperar errores de carga/polling mediante lecturas, sin volver a enviar la
  pregunta. Carga, error y ausencia de datos se presentan como estados diferentes.
- Sin conexión se explica el requisito y se ofrece volver a Caja. No se encolan consultas offline.
- Medición operativa por ejecución: estado, modo, tiempo en cola y ejecución, sin preguntas,
  respuestas, documentos, credenciales ni errores externos crudos en el log.
- El despertar privado valida cohorte y tenant sin abrir la base de datos. Adelanta una alarma
  de recuperación futura para atender la consulta; la ejecución conserva las verificaciones de
  RLS, ACL, sesión y acceso comercial antes de leer datos. La pausa operativa sigue bloqueándola.
- Se revisan teclado, foco, borradores, cancelación, sesión y aislamiento a 390 y 1440 px.

## Escenarios de aceptación

```gherkin
Feature: Consultar el negocio sin inventar evidencia
  Scenario: Consulta local con ventas registradas
    Given un administrador autorizado con consentimiento vigente y ventas reales
    And el proveedor externo no está conectado
    When pregunta "¿Cuánto vendí hoy?"
    Then Kova responde con las métricas del backend de la sucursal activa
    And no llama al modelo ni consume su presupuesto
    And conserva las métricas y fuentes al recuperar la conversación

  Scenario: Mes anterior al inicio del año
    Given la fecha local del negocio es el primero de enero
    When pregunta "¿Cuánto vendí el mes pasado?"
    Then consulta del primero al último de diciembre del año anterior

  Scenario: Recuperar una consulta vencida
    Given una consulta del perfil anclado en cola o ejecución desde hace más de diez segundos
    When el usuario envía una nueva consulta válida
    Then la anterior queda fallida y la nueva puede entrar en cola
    And no se reenvía la anterior ni se devuelve una respuesta tardía
    And se conservan sus reservas inciertas

  Scenario: Recuperar un error de carga
    Given la lectura inicial de capacidades falló
    Then se muestra un error con reintento y no una carga permanente
    When el usuario reintenta y el servicio responde
    Then puede continuar sin conceder consentimiento automáticamente

  Scenario: Evaluación incompleta
    Given resultados sin revisión humana, repetidos, desactualizados o con fallos críticos
    When se calcula el resumen de calidad
    Then no aprueba la calidad
    And ningún resumen activa producción
```

## Matriz de pruebas y aceptación de producción

| Capa | Evidencia |
|---|---|
| API/Postgres | `test_assistant_readiness.py`: venta real, job, historial, periodos y vencimiento |
| Seguridad y dominio | Suites existentes `test_assistant*`: ACL/RLS, consentimiento, presupuesto, fuentes |
| Runtime | `compatibility.test.mjs`: OpenRouter y selector/medición de Qwen en el event loop real de Workers, transporte simulado |
| UI | Vitest y `e2e/assistant.spec.ts`: recuperación, privacidad, formatos, teclado y tamaños; APIs interceptadas |
| Integración local | `accept_assistant_local.py --browser` y `assistant-real.spec.ts`: login, API, Postgres/RLS, tres workers, carga, historial y logout sin interceptar APIs ni inferencia |
| Modelo | Evaluador versionado y revisión humana; requiere ejecución externa autorizada |
| Producción | [Runbook de aceptación](../../docs/runbooks/assistant-acceptance.md) |

Las pruebas locales no certifican proveedor, carga real ni activación productiva. Antes de ampliar
la cohorte se necesita aceptación del recorrido autenticado completo y presupuesto aprobado.
