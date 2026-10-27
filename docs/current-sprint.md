# Current Sprint

Last updated: 2026-10-27

## Correcciones de seguridad con Agent Teams — validación local y AMD64 sin despliegue

Se corrige la reconciliación de facturación para aplicar la suscripción actual de Stripe,
con protección contra checkouts históricos, eventos de suscripciones sustituidas y carreras
entre webhooks y reparación interna. Signup devuelve una respuesta pública uniforme sin IDs
fuera de desarrollo local. El propietario decidió conservar la entrada inmediata; permanece
documentado el límite de inferencia compuesta por signup y login.

El acceso comercial se exige en lecturas y escrituras, sesiones abiertas, jobs y sincronización;
quedan disponibles pago, autenticación y derechos sobre datos. La prueba sigue en siete días y
el primer cobro fallido permite como máximo 48 horas, sin ampliación por reintentos o valores
antiguos. La autorización offline, incluida una caja abierta, vence a las 12 horas o antes si
vence facturación. Las ventas pendientes se conservan.

Las bibliotecas señaladas se actualizan en todos los locks. CI cubre cuatro proyectos npm,
dos locks Python y ambas imágenes, sin exclusiones. Nativa y parser pasan el escaneo final
sin HIGH/CRITICAL. La nativa usa Distroless/Python 3.12.16; el parser incorpora ClamAV actualizado,
fuentes Tesseract revisadas y seis backports de libxml2 con regresiones y vigilancia propia
de avisos nuevos. El corte local aprobó 2,188 pruebas backend, 1,471 frontend, 31 recorridos
browser y el flujo móvil con API/PostgreSQL/RLS reales. La aceptación AMD64 real y CI remoto ya aprobaron: 2,248 backend, 1,471 frontend y
333 recorridos de navegador, incluidos los 16 con API/Postgres/RLS reales. La nativa
alcanzó 188.13 MiB y 2692.4 ms máximos bajo los mismos 256 MiB/0.0625 CPU/3000 ms,
sin OOM. Se corrigieron las carreras del setup de roles, la identidad del build semanal,
propagación de fallos, fixture de recuperación de catálogo y cobertura del dashboard real.
El resize RGBA reduce memoria temporal conservando bytes exactos; no se afirma una mejora
de CPU ni se retiran los gates por la variabilidad entre runners. No hubo despliegue ni
cambios en producción. [Cierre AMD64](audits/KOVA-AMD64-VALIDATION-2026-10-27.md).
[Archivos, evidencia y límites](audits/KOVA-SECURITY-REMEDIATION-2026-10-26.md).

## Preparación de publicación — cierre de AbortSignal/Request

Los dos errores de identidad quedan resueltos al reinstalar las dependencias exactas del
lockfile: el entorno local conservaba Vitest 3.2.7 y el repositorio ya fija 4.1.11. No se
cambian autenticación, setup, lockfile ni expectativas de identidad. Tres nuevas pruebas
protegen Request/clones, motivo de cancelación y limpieza de listeners DOM con los globals reales.
Validación completa: 1,428 unitarias frontend, 2,105 backend y 311 recorridos de navegador
aprobados; 16 casos de integración se omiten deliberadamente en el perfil preview y se ejecutan
contra API/PostgreSQL reales por separado. También se corrigen la espera del guardado final de
postventa y una ruta de capturas exclusiva de macOS, conservando resultados y controles originales.

Los cambios se integran con `main`, incluyendo el enlace/QR fijo del menú y el centro de control.
El [PR #277](https://github.com/ArturoFrancoMozqueda/kova/pull/277) concentra la entrega; su gate
`CI required` sobre el último commit es la autoridad para publicar. No se ha fusionado ni
desplegado esta rama. [Evidencia y límites](audits/KOVA-RELEASE-READINESS-2026-10-25.md).
WhatsApp permanece deshabilitado por defecto y requiere aceptación independiente del proveedor.

## Experiencia compartida y ciclo de negocio — validación local

Agent Teams unifica controles, encabezados/acciones, estados vacíos y foco en Agenda,
Atención postventa, Seguimiento y Bandeja. Compras prioriza registros/recepción y conserva
borradores en paneles secundarios; Pedidos comparte filtros con teclado y el término Tarjeta
manual con Caja. La continuación comercial y reposición/compra conservan el registro exacto.
Se corrige la contradicción entre prioridad y severidad de una devolución única del 100%.
El [contrato UI/UX](claude/ui-experience-contract.md) guía los módulos sin cambiar sus contratos.

El build pasó cuatro recorridos con API/PostgreSQL/RLS locales reales, incluido el nuevo ciclo
por UI: menú anónimo → solicitud → cliente → oportunidad → cotización → pedido → cobro → entrega
→ postventa → reposición → recepción parcial/total. Conservó una venta de $90 y existencias
5→3→4→7. Se añade a CI de integración. Pasaron 47 regresiones de navegador con APIs interceptadas,
TypeScript, ESLint, build/SSR/prerender y contratos. El corte inicial tuvo 1,407 unitarias aprobadas
y dos fallos de AbortSignal/Request, resueltos en la preparación de publicación descrita arriba.
[Alcance, archivos, evidencia y límites](audits/KOVA-EXPERIENCE-CONTINUITY-2026-10-25.md).
Sin publicación ni activación/certificación de proveedores externos por esta entrega.

## WhatsApp → cliente → catálogo → pedido — piloto asistido local

Se implementa ingreso HTTPS con firma raw, routing por registro privado de plataforma y
sesiones runtime/RLS por negocio/sucursal. La bandeja permite identificar el contacto exacto,
vincular cliente, consultar historial y preparar pedido; genera borradores del catálogo publicado
y admite respuesta humana con confirmación, autor/responsable vigente, consentimiento y ventana.
Conexión/configuración y entrega se muestran por separado. Hay interruptor global y por conexión,
límite diario conservador y estados inciertos sin reenvío ciego. No se agregan migraciones ni
permisos de escritura de bindings al runtime; el alta asistida verifica la cuenta ante Meta con
un script de operador. [Contrato](../specs/integrations/messaging-inbox.md) y
[guía de alta/aceptación y pendientes](runbooks/whatsapp-assisted-pilot.md).

El propietario sólo tiene WhatsApp Business en el celular. La app de Meta, número de prueba,
credenciales en Secret store, publicación y entrega real siguen pendientes. Este corte no completa
Embedded Signup ni avisos automáticos con plantillas/postventa externa; las tareas internas y
los contratos de venta/pago conservan su significado. Validación local: 117 pruebas backend
focales y 75 con pg8000; 19 frontend focales, siete recorridos Chromium y 21 del controlador
nativo aprobados. El corte inicial tuvo 1,391 unitarias aprobadas y dos fallos de AbortSignal/Request,
resueltos en la preparación de publicación descrita arriba. TypeScript, ESLint,
Ruff, build/SSR/prerender y contratos aprobados. [Evidencia y límites](audits/KOVA-WHATSAPP-PILOT-2026-10-23.md).

## Menú digital público — implementación local

El catálogo se presenta como menú para armar solicitudes de pedido, a distancia o en el negocio:
búsqueda, disponibilidad, cantidades, subtotal estimado y resumen adaptable a móvil/escritorio.
El detalle llega a la bandeja existente de Kova con el contrato público actual, sin migraciones.
Las consultas generales y el enlace secundario a WhatsApp se conservan. No crea automáticamente
órdenes operativas, reservas ni pagos; el equipo revisa la solicitud antes de continuar.
[Contrato y límites](../specs/storefront/public_catalog.md). Publicación y aceptación con un
negocio real pendientes; las pruebas locales no acreditan pedidos productivos ni WhatsApp real.
El ajuste móvil conserva el encabezado compacto y separa exploración de revisión sin duplicar formulario.
El menú usa tarjetas en tres columnas en móvil/tablet con fotografías 4:3 a todo el ancho, nombres,
precios y controles bajo la imagen. «N en pedido» abre el detalle para ajustar cantidades sin
comprimir los botones; escritorio conserva sus controles directos. Un toque abre foto grande y descripción completa en el diálogo
compartido. Sólo se muestran las fotos públicas reales del negocio; las capturas de demostración
usan recursos existentes del proyecto desde una respuesta interceptada del test.
Al volver conserva datos, selección, posición de desplazamiento y foco. Escritorio conserva la
disposición con resumen lateral. La bandeja y los contratos no cambian.
Validación: 32 pruebas focales, TypeScript, ESLint de archivos afectados y build/SSR/prerender
aprobados. Ocho recorridos del catálogo sobre el build final, con APIs interceptadas, cubren
320/390/768/1440 px, pedidos a distancia/presenciales, consultas, teclado, reintento y axe.
Móvil verifica tres tarjetas por fila en 320/390/768 px, carga de fotografías, primer producto
antes de 400 px, revisión separada y conservación de contacto/notas al regresar al menú.
Las pruebas con fotografías verifican carga de píxeles reales, amplitud de imagen y navegación
por teclado del detalle (foco, Tab/Shift+Tab y Escape), conservando la cobertura sin fotografías.
Revisión visual de capturas móvil/escritorio completada; QR físico y WhatsApp real sin verificar.

Ajuste del 2026-10-24: el guardado del menú conserva siempre el enlace y QR vigentes. Se retira
la casilla de reemplazo del formulario para evitar invalidar direcciones al actualizar contenido.
La interfaz aclara que los cambios guardados se ven al abrir o recargar el mismo enlace. La API
rechaza `rotate_link: true` con 422 y elimina la lógica de reemplazo; el campo deprecado sólo
admite `false` para clientes existentes. Las rutas retiradas históricamente siguen inválidas.
Retirar y volver a publicar conserva la dirección y el QR, sin nuevas publicaciones ni alias.
Validación frontend:
cuatro pruebas del formulario, TypeScript y ESLint aprobados. El recorrido de navegador con
API, Postgres y rol runtime sin bypass de RLS confirma que editar, guardar y abrir la misma
URL muestra el título actualizado; también completa la consulta y su conversión existentes.
Validación completa del ajuste: 30 pruebas backend de catálogo/captación, 33 de storefront,
TypeScript, ESLint, Ruff y contrato OpenAPI aprobados. El recorrido real de publicación,
actualización por la misma URL y consulta también aprobó con la nueva restricción de API.
Backend prueba rechazo sin crear alias, retiro/republicación con el mismo PNG de QR y
compatibilidad de enlaces históricos, incluyendo la invalidez de los ya retirados.
Implementado localmente, pendiente de publicación.

Integración con el panel de #275: se incorpora su DTO puro al inventario de Workers y se
ajustan los checks de navegación/login a «Centro de control». El menú cerrado se verifica
directamente por `aria-hidden`, `inert` y enlaces fuera del árbol accesible; los accesos de
Catálogo del panel permanecen permitidos. Cuatro pruebas de snapshot, 13 recorridos de
login/navegación sobre el build final, TypeScript, ESLint, Ruff y build/SSR/prerender aprobados.

## Flujos conectados de comercio y servicios — implementación local

Agent Teams implementó navegación del dueño con siete entradas y herramientas contextuales,
ficha de cliente con registros reales y pasos directos a Caja/Pedidos/Agenda. Pedidos conserva
cliente explícito hasta la venta; Agenda vincula una venta existente con idempotencia/historial,
sin confundir atención y cobro. Se mantienen rutas, roles, gates y operación anónima de mostrador.
Migraciones 0094/0095 aditivas; preservan RLS, propiedad, exportación y purga. Los arreglos útiles
de #267 se conservan íntegros en esta entrega antes de coordinar su cierre por sustitución.
[Alcance, archivos, validación y límites](audits/KOVA-CONNECTED-OWNER-2026-10-22.md).
Validación: 1,373 pruebas frontend, 93 backend por cada driver psycopg/pg8000, cinco escenarios
de migración y 42 de navegador sobre el build final (tres con API/Postgres/RLS locales reales).
Exportación del grafo conectado y ciclo de cuenta: 11 pruebas adicionales aprobadas.
Publicación y aceptación productiva pendientes; no se activan canales ni proveedores externos.

## Estado productivo registrado durante la PR #267

La base productiva es `07b03a9912ba32fd9ad165e3818e32d403626ff6` (#266):
[CI y release 39865204921](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39865204921)
aprobados y `/health` con el SHA exacto. #262/#263 corrigieron la publicación
estricta tras cambios de configuración del dashboard; #265 normalizó la
jurisdicción R2 sin configurar y tuvo
[release 39850544534 aprobado](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39850544534).
#261 también está integrado (`cb90e026`); corrige una aserción sobre ciphertext,
sin modificar el almacenamiento de credenciales.

La comprobación posterior `verify-deployment` confirmó web, proxy, backend y
base de datos con ese SHA. El verificador residente aprobó 25 contratos sobre
el mismo proceso, mediana 291 ms y máximo 551 ms. Fueron lecturas sin mutaciones;
no equivalen a una nueva venta, emisión fiscal, mensaje entregado ni aceptación
autenticada completa de la interfaz.

La lectura autenticada actual de `GET /api/v1/integrations/cfdi/setup` devolvió
`available:true`, `state:not_started`, `issuer:null`, `organization_created:false`,
`test_connected:false`, `live_connected:false` y `production_ready:false`.
Kova detecta la configuración fiscal de plataforma; faltan emisor y conexión
Test/Live. Esto no demuestra que Facturapi acepte la llave. La lectura de
`GET /api/v1/assistant/capabilities` devolvió `enabled:true`,
`local_answers_ready:true`, `inference_ready:false`, `configuration:false`,
`documents:false` y `email:false`. Las respuestas locales están disponibles según
capacidades; generación externa, aplicación de configuración, documentos y correo
no están habilitados. No se probó una respuesta hoy ni se invocó inferencia o
generó gasto por ella.

El catálogo con nombre del negocio ya se publicó en #260 y se verificó en
`https://kovasuite.com/catalogo/cafeteria-sweet-home`. Ese pendiente está cerrado;
no implica checkout ni pago en línea. La ronda con equipos de agentes está lista
para PR, sin publicar y con CI remoto pendiente. Incluye claridad de preparación
de canales, especificación fiscal actualizada y cuatro correcciones de Pedidos.
La generación de consulta descarta respuestas tardías tanto de API como del
fallback al limpiar la consulta; las respuestas anteriores tampoco actualizan la
caché. Pruebas con promesas diferidas cubren esa protección. La primera descripción
de arquitectura en `CLAUDE.md` refleja Cloudflare activo, Vercel de respaldo y Fly
retirado, sin cambiar sus reglas.

Validación de la versión final: 192 archivos y 1,334 pruebas de frontend;
TypeScript, ESLint y build/SSR/prerender aprobados. Pasaron 19 pruebas de navegador
del build final (`customer-orders` y `automations-crm`), con 320/390/768/1440 px y
axe. Revisión independiente de Canales y especificación sin bloqueos. Las pruebas
usan APIs interceptadas; las lecturas autenticadas anteriores no equivalen a una
nueva aceptación completa de UI. No se realizó QA productiva financiera ni hubo
emisión fiscal, envío de mensajes o cobro real.

Prioridades pendientes: distinguir guía y conexión real de canales; completar
el emisor fiscal y aceptar Test antes de cualquier Live, con configuración de
plataforma ya detectada; revisar con el
dueño turno, costos y catálogo; completar recorridos externos de WhatsApp/IA y
aceptación de dispositivos/offline según alcance. El
[estado funcional](audits/KOVA-ESTADO-FUNCIONAL-2026-10-22.md) conserva la auditoría
autenticada anterior como snapshot, separado de estos hechos de publicación.

## Escritorio: resultados y valor visible — publicado en #266

Pase autorizado de Panel, Caja, Catálogo e Inventario: resultados y prioridades
antes de configuración, comparación explícita, atajos compactos, enlaces
contextuales, instantánea operativa con alcance real y checkout integrado con
total y cobro accesibles. No agrega consultas ni cambia contratos, cálculos,
sesiones o permisos. [Alcance, archivos y QA](audits/KOVA-DESKTOP-VALUE-2026-10-22.md).
Suite de frontend: 1,326 pruebas aprobadas y revalidaciones focales finales;
build/SSR/prerender, TypeScript, ESLint y 49 recorridos de navegador del build
final aprobados, incluidos 320–1920 px y regresiones de cobro/offline/recibo.
Los recorridos usan datos de pruebas con APIs interceptadas. Publicación
completada con el SHA y release indicados arriba; aceptación autenticada de este
pase en producción pendiente. El documento de alcance enlazado conserva su
estado de implementación local anterior a la publicación.

## Auditoría funcional y enlaces legibles — snapshot y publicación #260

Revisión de lectura autenticada de las secciones del dueño, contrastada con contratos,
implementación y QA previa: [matriz de estado y prioridades](audits/KOVA-ESTADO-FUNCIONAL-2026-10-22.md).
El núcleo POS está respaldado por aceptación previa; los canales externos no quedan
certificados por CI. No se realizaron nuevas ventas ni conexiones durante esta auditoría.
El propietario eligió enlaces del catálogo con nombre del negocio sin código aleatorio.
La implementación publicada incorpora rutas legibles con colisiones numéricas, compatibilidad de QR anteriores
y revocación por versión; migración aditiva y metadatos de routing con RLS por slug exacto.
#260 se publicó como `e20b62a92413c78398dd8c1c039efe1704842ef6`, con
[CI y release 39823273561 aprobados](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39823273561).
La aceptación posterior verificó la URL real indicada arriba; no se repitió
durante esta actualización documental ni acredita las integraciones externas.

## Kova como copiloto — Phase 0 foundation

The 12-month product strategy starts with validation rather than feature parity. The first shipped
slice measures whether real analysis produces a useful owner action; contract and privacy rules live
in [`specs/reports/analysis_activation.md`](../specs/reports/analysis_activation.md).

- [x] Keep **Análisis** as the authenticated surface without changing `/reports` or report API
      contracts.
- [x] Track tenant-scoped analysis views, evidence opens, action starts, completions and reopens with
      categorical metadata only.
- [x] Add the missing successful `close_shift` activation event.
- [x] Validate analysis payload categories server-side and reject financial or unsupported metadata.
- [x] Expose a protected, identity-free 7/30-day adoption report for weekly pilot review.
- [x] Measure explicit recommendation usefulness, prior-window return, active-business adoption and
      the observable sale → close → analysis journey.
- [ ] Recruit and observe the planned multi-vertical pilot cohort; this is commercial research, not
      a code-complete gate.
- [ ] Close the existing live Stripe, inbox-delivery and backup-restore production gates before broad
      rollout.

## Source Of Truth

Este archivo contiene sólo el plan vigente. Las secciones históricas (julio–21 de octubre) se
retiraron del árbol el 2026-10-22 y se conservan en el historial de git.

- El objetivo de ejecución actual y los gates de publicación viven aquí.
- La hoja de ruta futura vive en `docs/sprint-planning.md`.
- Los runbooks operativos viven en `docs/runbooks/` y los riesgos en `docs/risk-register.md`.
- No duplicar criterios de aceptación detallados aquí; enlazar la spec, runbook o plan dueño.
- Setup, comandos de prueba, arquitectura y puntos de entrada operativos viven en
  [`engineering-operations-index.md`](engineering-operations-index.md).
