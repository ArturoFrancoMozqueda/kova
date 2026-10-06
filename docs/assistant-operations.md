# Asistente de Kova: operación y activación del piloto

Implementación integrada en `main` mediante PR #158 (`204f024`). Fecha: 2026-10-06.
El diseño completo y los escenarios de aceptación permanecen en
[PLAN-ASISTENTE-TENANT](plans/PLAN-ASISTENTE-TENANT.md). Esta guía describe el código entregado,
los requisitos de ejecución y la evidencia pendiente. No autoriza un despliegue.

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
que ya no aparecen como staged antes de declarar la configuración aplicada.

Referencias: [token AI](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
[claves R2](https://developers.cloudflare.com/r2/api/tokens/).

La configuración de un proceso Fly separado para chat/retención está preparada en
`codex/assistant-runtime` ([PR #159](https://github.com/ArturoFrancoMozqueda/kova/pull/159)),
sin desplegar; su primer CI pasó. El operador autorizó mantener una máquina activa
para la cohorte de prueba; los gates del modelo siguen pendientes antes de habilitar chat.
La [calculadora de Fly](https://fly.io/calculator/) mostró
US$8.37 de cómputo mensual para una máquina shared, un CPU, 1024 MiB, 730 horas en `dfw`,
sin volumen ni reserva; la transferencia se presupuesta aparte. Fly crea por defecto
un standby detenido para procesos sin servicio; verificar una sola máquina activa
y el almacenamiento facturable de la reserva al desplegar. CPU/RAM se cobran por
tiempo encendido; apagar el worker requiere un mecanismo de arranque y retrasa sus tareas.
No es un techo de gasto impuesto por el proveedor. No hay host de ingesta desplegado: documentos,
mutaciones y correo siguen apagados. La cohorte del piloto está identificada, pero sus
UUIDs, contactos y credenciales se mantienen fuera de esta documentación pública.

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
   Activar configuración, documentos y resúmenes con flags separados, gradualmente.

Las variables nuevas y sus defaults están en `.env.example`. Ninguna usa prefijo VITE_. El código
predeterminado mantiene modelos Qwen de pesos abiertos alojados en Workers AI:
`@cf/qwen/qwen3.8-27b` para consultas generales, `@cf/qwen/qwen3-30b-a3b-fp8` para ayuda inicial,
y `@cf/qwen/qwen3-embedding-0.6b` para vectores de 1024 dimensiones. No se instala un modelo con
acceso al host, herramientas integradas o credenciales de infraestructura.

## Presupuesto, equidad y carga

Workers AI ofrece 10,000 neuronas diarias por cuenta; no es una cuota por tenant. El código reserva
como máximo 9,000/día: 8,000 chat y el resto ingesta. El reset del contador es 00:00 UTC.

- La primera reserva congela la cohorte y el presupuesto de ese día. Añadir negocios espera al
  siguiente día; bajar un límite surte efecto inmediatamente. No redistribuir cuota a mitad del día.
- El pool se divide por tenant; un usuario consume como máximo 75% de la porción de su tenant.
  Nadie puede agotar la porción asignada a otro negocio. No hay préstamos de cuota en esta versión.
- Máximo 30 turnos diarios y tres/minuto por usuario; cuatro llamadas al modelo y ocho herramientas
  por turno. Contexto acotado a 8,000 bytes reservados como tokens, salida a 1,024; sin fallback pagado.
- Tres trabajos/cargas simultáneos globales, dos por tenant y uno por usuario, con leases de 11 min.
  Indexación en lotes y pausa entre iteraciones para evitar monopolizar un slot.
- Archivos: 20 MiB para conocimiento, 2 MiB para CSV/XLSX; 100 documentos/100 MiB acumulados por
  tenant, incluyendo privados de otros administradores y cargas incompletas. El contador solo guarda
  UUIDs/tamaños. Cinco cargas/hora y 20/día por usuario; 50/día y 200 MiB recibidos/día por tenant.
- El OCR reserva CPU antes de intentar extracción: 1,800 segundos máximos por tenant/día. El parser
  corre sin red, read-only, nonroot, sin capabilities, con RAM/CPU/PIDs/tmp/timeout acotados.

Las reservas son conservadoras y **no se devuelven** al terminar; tampoco se informa que sean consumo
exacto conciliado con Cloudflare. Tarifas, tokens de razonamiento y facturación deben verificarse en
la cuenta dedicada antes de activar. Si cambian, apagar la inferencia y actualizar contratos/pruebas.
No se promete un número de clientes: medir consultas reales, latencia, reservas y cola por cohorte.
Aumentar tenants reduce su porción; un techo de gasto no prueba capacidad ni calidad.

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
