# Correcciones de experiencia y continuidad — 17 de noviembre de 2026

## Alcance

Implementación de los 17 hallazgos de la auditoría de navegación. Se conserva el núcleo de Caja,
Pedidos, Ventas, Inventario, Compras, Agenda y Clientes. Se simplifican entradas, configuración y
copy; no se eliminan registros históricos ni se activan proveedores. Sin migraciones.

## Trazabilidad

| Hallazgo | Corrección | Validación principal |
|---|---|---|
| A01: otro pedido tras error de confirmación | Conservar ID/artículos/versión del pedido creado; corregir el mismo registro. Recuperación de respuesta incierta con comando y clave originales. | Regresiones de formulario y E2E real de stock concurrente y respuesta perdida después de commit a 390/1440 px. |
| A02: respuesta vieja bajo ruta nueva | Sesión de detalle ligada a identidad/ruta; generación y cancelación de consultas/acciones previas. | Prueba de respuestas invertidas y cambio de identidad. |
| A03: error junto a vacío de reposición | Vacío y formulario requieren carga exitosa; recuperación explícita. | Fallo de sugerencias/proveedores y retry con datos actuales. |
| A04: tarjeta excede disponibilidad | Validación agregada compartida entre tarjeta, + y modificadores. | Componente y E2E real en ambos tamaños. |
| A05: fecha offline falsa | Timestamp por detalle y por listado; escritura atómica. Legacy conserva datos con fecha desconocida. | IndexedDB, independencia de detalles/listado y lectura offline sin habilitar escrituras. |
| A06: tareas ausentes en Pendientes | Lectura independiente de tareas de reglas, con permisos del servidor, errores por fuente y límites explícitos. Enlace al run exacto. | Unitarias, E2E con APIs simuladas y recorrido real regla → Pendientes → tarea enfocada. |
| A07: conexión externa engañosa | Alcance de tareas internas explícito; retirar estado de conexión que no representaba una capacidad. | Copy/estados en componente y navegador. |
| A08: consentimiento afirma canal desconectado | Confirmar únicamente el permiso registrado. | Prueba de CRM. |
| A09: nombre amplio y CTA técnico | «Reglas de tareas» y «Buscar nuevos pendientes»; búsqueda conserva términos anteriores. | Navegación y recorridos de reglas. |
| A10: reposición pierde producto | Enlace exacto de producto al parámetro existente de Inventario. | Componente y E2E real. |
| A11: versiones internas visibles | Retirar versiones del historial y mantener control de concurrencia en solicitudes. | Componente, navegador y QA visual. |
| A12: dos altas de incidencias | La nueva incidencia abre el caso canónico; un seguimiento existente precarga origen autorizado, cliente y venta. Contexto bloqueado contra mezcla. Histórico intacto. | Tests de origen inaccesible, procedencia y sustitución sintética de cliente/venta; navegador de continuidad. |
| A13: local exige consentimiento externo | Resolver consultas locales sin grant externo; proveedor no disponible comunica disponibilidad. Revalidar consentimiento antes de llamar y entregar respuesta externa. | Regresiones sin preferencias, revocación, proveedor distinto/apagado y ausencia de llamadas remotas sin permiso. |
| A14: CSV técnico sin punto de partida | Plantilla vacía con encabezados del parser y guía en español. | Descargar no crea operaciones; contrato del contenido y preview/commit existentes. |
| A15: Panel y menú discrepan | Los cinco grupos y sus etiquetas se comparten; métricas junto a su ruta real. Contrato API y definiciones de cifras intactos. | Unitarias y navegador a 320/390/768/1440/1920 px; error parcial conserva cifras independientes. |
| A16: falta medición recurrente | Intentos/resultados, tiempo activo/total monotónico y consulta interna de agregados. Sin PII ni indicadores ficticios. | Eventos validados, emparejamiento offline, duplicados, resultados contradictorios, guard de identidad y dos cobros simultáneos. |
| A17: configuración antes del trabajo | Pendientes primero; reglas en configuración plegada con controles accesibles. | Componente, foco de tarea y navegador móvil/escritorio. |

## Seguridad y contratos

Tenant y usuario continúan resueltos por cookies. La medición conserva su expectativa de identidad
fuera del cuerpo y el servidor rechaza eventos de otra sesión; las propiedades no incluyen datos
de negocio. La cola conserva eventos que llegan durante un flush. Los intentos de Caja enviados
se separan del carrito siguiente y se liberan al finalizar.

Se mantienen RLS, permisos, acceso comercial, consentimiento externo e idempotencia. Las consultas
locales del asistente conservan autorización activa y alcance. Las incidencias previas no se migran
ni se cierran. La procedencia del seguimiento se conserva como contexto y nota; no se afirma una
relación FK nueva. La recuperación de formulario está acotada a su sesión abierta; no es otra cola
offline. Las ventas offline mantienen su persistencia y sincronización existentes.

OpenAPI se regeneró sin cambios públicos; el contrato del frontend aprueba. La nueva consulta
de experiencia es interna y exige la autorización operativa existente.

## Validación local

- `npm run lint`, `npm run typecheck`, build completo y contrato API: aprobados.
- Frontend completo: **254 archivos / 1,962 pruebas aprobadas**; comprobaciones finales de los
  módulos ajustados: **98 pruebas aprobadas**.
- Backend focalizado de asistente y telemetría con PostgreSQL: **225 pruebas aprobadas**.
  La regresión adicional de cambio de identidad y su consulta asociada: **2 aprobadas**.
- Integración real sobre el build: **36 escenarios existentes y 4 nuevos aprobados**, cero
  omisiones, reintentos o resultados intermitentes. PostgreSQL runtime con RLS, Python 3.12.16.
- Navegador adicional con APIs simuladas: **41 escenarios cubiertos y aprobados** entre la pasada
  integrada y la repetición focalizada de Panel tras adoptar explícitamente los cinco grupos.
  Los esperados de seis tarjetas y prioridad de agenda se actualizaron por ese cambio de diseño;
  la información sigue disponible mediante el detalle de su área.
- QA visual de Pedidos a 390/1440: un solo pedido confirmado, cantidades e importes sin recortes.
  QA real de reglas/Pendientes en ambos tamaños: tarea visible antes de configuración plegada,
  producto exacto y foco correctos, sin overflow ni errores JS. A 390 × 844, el encabezado de
  pendientes pasó de 2,518 a 348 px desde arriba (86.2% menos distancia inicial).
- Ruff y `git diff --check`: aprobados.

Los logs, JSON y PNG locales están en `workspace/ux-fixes/`, fuera del commit. No se publican
capturas de negocios ni datos sintéticos como datos productivos. La validación local no acredita
Stripe live, envíos externos, timbrado, hardware o pruebas con personas. La publicación y sus
checks se verifican en el PR/release, sin despliegues manuales.

## Medición honesta

La nueva medición describe intentos reportados por el cliente después de respuestas de operación;
no demuestra resultados contables ni acciones físicas. `queued` no cuenta como venta confirmada.
Se distingue tiempo activo de espera y sincronización; no se restan fechas de recepción.
Consultar agregados no devuelve identidades. Sin evidencia, tasas y medianas son `null`.

La satisfacción, comprensión y dificultad percibida siguen requiriendo participantes reales.
No se asigna una puntuación UX ni se retira un módulo suponiendo falta de uso. La política y el
significado de la medición están en `specs/reports/task_experience.md`.
