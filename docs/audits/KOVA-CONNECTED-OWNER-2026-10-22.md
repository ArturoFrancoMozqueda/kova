# Operación conectada y navegación del dueño

Fecha: 22 de octubre de 2026, America/Mexico_City.
Rama: `feature/connected-owner-workflows`. Implementación local; publicación pendiente.

## Resultado de producto

El dueño puede continuar desde un cliente hasta una venta inmediata, pedido de comercio o cita
de servicio, y regresar a los registros correspondientes. Las siete entradas principales son
Panel, Caja, Ventas, Clientes, Operación, Análisis y Configuración. Cada grupo presenta sus
herramientas relacionadas; la búsqueda global conserva todas las secciones autorizadas.
No se infiere el giro, se eliminan capacidades ni se amplían permisos. Rutas, menú de cajero,
navegación offline y barra inferior permanecen compatibles.

La ficha resume compras, pedidos, citas, oportunidades, seguimiento y atención de la sucursal.
Las tareas principales aparecen sin esperar consultas secundarias. Cada fuente muestra hasta
tres registros iniciales, ampliables, y comunica errores y límites sin fabricar totales.

Pedidos admite cliente opcional explícito al crear. La identidad se conserva al editar y pasa a
la venta al cobrar, sin exigir cotización. Los pedidos anónimos siguen disponibles. No se
backfillean contactos históricos ni se cambia la identidad de un pedido existente.

Agenda puede abrir la cita exacta fuera del período visible y precargar el cliente desde su
ficha. Una venta registrada en Caja se vincula explícitamente con la cita y sobrevive la recarga.
La asistencia y el cobro siguen separados, y las devoluciones/anulaciones conservan su verdad
financiera. Recursos de agenda quedan bajo un desplegable para priorizar el trabajo diario.

## Cambios y controles

- Navegación: `frontend/src/layout/AppShell.tsx`, `workspaceNavigation.ts`, descubrimiento y tests.
- Clientes/Caja/Pedidos: vistas, API y pruebas de `customers`, `register` y `customerOrders`.
- Agenda: vista y panel de venta, contratos, API/servicio y pruebas de citas/vínculos.
- Datos: migraciones aditivas 0094 (vínculo append-only cita/venta) y 0095 (cliente nullable en
  pedido); RLS, FK por tenant/sucursal, grants privados, exportación y purga.
- Contratos: OpenAPI, especificaciones de agenda, pedidos y ficha del cliente.
- CI: nuevo recorrido real local incluido en `test:integration`.

Revisión entre agentes detectó y corrigió la diferencia semántica entre cliente omitido y null
explícito en edición al calcular reintentos. También verificó el filtro implícito de sucursal
del historial y lo dejó explícito con regresión de dos sucursales. No se cambia sesión,
facturación, RLS, cálculo monetario, reservas ni idempotencia de la cola de ventas.

## Conservación de la PR 267

La PR [267](https://github.com/ArturoFrancoMozqueda/kova/pull/267) contenía arreglos válidos no
sustituidos por la reorganización: búsqueda desde páginas posteriores, filtro temporal de caché,
errores online, descarte de respuestas/fallback tardíos y claridad de Canales. Se incorporó su
diff completo desde `8ac92ef86dd1758aecf6dbbc01569341c6db1dfc`, incluyendo pruebas y documentación.
Su cierre se coordina con una PR consolidada; no se descarta trabajo ni se borra su rama remota.
Las verificaciones productivas citadas en esa documentación son evidencia histórica de esa ronda.

## Validación y límites

- Frontend completo: **1,373 pruebas en 194 archivos** aprobadas; TypeScript, ESLint, build de
  cliente/SSR y prerender aprobados. Escaneo de 123 JS sin patrones prohibidos; guard de 51 specs.
- Backend focal: **93 pruebas con psycopg y las mismas 93 con pg8000** aprobadas, incluyendo
  idempotencia histórica, scopes, clientes, cotizaciones, stock/concurrencia, agenda, CSRF,
  vínculos, operaciones y ciclo de cuenta. Tras completar la exportación del nuevo customer_id,
  **11 pruebas de exportación/ciclo de cuenta** adicionales pasaron, incluida conservación del
  grafo pedido/cliente y cita/venta. Ruff y verificación del contrato OpenAPI aprobados.
- Migraciones: **cinco escenarios** aprobados entre 0094, 0095 y matriz privada 0065:
  conservación de datos, upgrades, downgrades vacíos y rechazo de pérdida con datos;
  RLS y grants privados de la relación nueva.
- Build final: **42 escenarios de navegador** aprobados: 20 navegación/asistente, 19
  Pedidos/automatizaciones/CRM y tres recorridos reales locales. Los primeros 39 usan APIs
  interceptadas; los tres restantes usan FastAPI/Postgres con rol runtime `kova_app`, sin bypass
  RLS: servicio en 1440/390 px y comercio en 1440 px. Verifican cliente, venta única, asociación
  persistente, recarga e historial; comercio verifica stock 5/1/4 antes y 4/0/4 tras cobrar.
- QA visual revisó capturas de escritorio/móvil y foco; no hubo desbordamiento. QA inicial
  adicional de ficha a 320/1440 px no encontró violaciones graves/críticas de axe. El menú
  conserva cobertura de teclado, rail, búsqueda, permisos y privacidad del asistente.

Las escrituras de integración usan negocios efímeros locales; no se modifican datos productivos.
Tarjeta manual registra un medio de pago, no procesa un cargo externo. No se declara aceptación
autenticada en producción ni QA física de hardware/VoiceOver por estas pruebas.

No se activan WhatsApp, reservas públicas, checkout de proveedor, terminal, timbrado, campañas
ni descuentos de lealtad. Esos recorridos mantienen los requisitos/aceptaciones documentados;
los enlaces y registros internos no se presentan como mensajes entregados o pagos procesados.
