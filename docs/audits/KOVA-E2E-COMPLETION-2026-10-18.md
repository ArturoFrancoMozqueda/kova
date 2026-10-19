# Continuación del circuito comercial E2E sin conectar cuentas

Fecha del propietario: 2026-10-18, America/Mexico_City.
Rama: `feature/business-automation-completion`.

El propietario autorizó integrar la primera entrega y avanzar con agentes sin conectar sus cuentas.
Primera entrega integrada mediante [PR #207](https://github.com/ArturoFrancoMozqueda/kova/pull/207),
commit `63be58a7791d69c448e27c84bb8b8dae73777d2b`, después de CI completo aprobado, incluido
Cloudflare/Postgres, migraciones, navegador, contratos y auditoría de dependencias.
La publicación posterior conserva sus controles; no equivale a aceptación de un canal externo.
[Evidencia inicial](KOVA-E2E-IMPLEMENTATION-2026-10-18.md).

## Capacidades implementadas

| Recorrido | Comportamiento |
|---|---|
| Catálogo → solicitud | Formulario público, origen permitido, límites compartidos, productos publicados y referencia idempotente. Respuesta mínima con recibo; sin datos privados, venta, reserva ni consentimiento implícitos. |
| Solicitud → oportunidad | Cola privada por sucursal. El usuario elige el cliente antes de convertir; conserva origen y versión. Sin fusión por nombre/teléfono. |
| Oportunidad → cotización | Vínculo opcional inmutable contra cliente/tenant/sucursal. Recorrido consultable enlaza solicitud, oportunidad, cotización, pedido y venta real. Sin vínculo no se adivina atribución. |
| Pedido → venta → cliente | Checkout desde cotización conserva identidad explícita del cliente. Pedidos sin vínculo siguen sin atribución. Totales, pagos e inventario mantienen sus contratos. |
| Venta → postventa | Política opt-in por sucursal genera tareas deduplicadas de reseña neutral y recompra sobre ventas posteriores a autorización. Excluye anulaciones/devoluciones; incidentes no condicionan reseñas. |
| Incidencias | Cliente, venta opcional validada, responsable, vencimiento y resolución versionada; sin modificar la venta. |
| Bandeja | Conversaciones internas, asignación, pausa humana, cierre y borradores. Mensajes externos requieren cliente explícito y cuenta verificada. |
| Tarea → borrador | Selección explícita de tarea/conversación; dedupe, texto servidor con folio y revalidación de regla/pedido/contacto. No envía. |
| Outbox/recibos | Distingue draft, queued, sending, accepted, sent, delivered, read, failed y uncertain. Dispatcher exige proveedor inyectado y enable explícito. Ingesta interna firmada/deduplicada; ningún webhook o dispatcher público activado. |
| Recuperación | Worker con cohorte opt-in y rol runtime procesa postventa y recupera envíos interrumpidos por sucursal, incluso sin reglas. Nunca reenvía inciertos a ciegas. |

Rutas nuevas: `/inbox`, `/commercial-requests`, `/followups`; formulario en catálogo público y
vínculo/recorrido en cotizaciones. Vistas privadas online para owner/manager conservan CSRF,
identidad/sucursal y solicitudes cancelables. Los canales sin conectar se muestran desconectados.

Archivos principales: `backend/app/crm/engagement*`, `backend/app/messaging/`,
`backend/app/quotes/`, `backend/app/customer_orders/service.py`, `backend/app/orders/service.py`,
`backend/app/automations/worker.py` y vistas equivalentes en `frontend/src/`.
Specs: [captación/postventa](../../specs/crm/commercial_engagement.md),
[bandeja/outbox](../../specs/integrations/messaging-inbox.md),
[cotizaciones](../../specs/quotes/customer_quotes.md).

## Datos y seguridad

Tres migraciones aditivas `0085_messaging_inbox`–`0087_quote_opportunity_link`: siete tablas
privadas y vínculos compuestos por tenant/sucursal. FORCE RLS, grants por columna, sin grants
públicos. El runtime sólo lee bindings; no puede provisionarlos ni marcarlos verificados.
No se guardan credenciales en estas tablas. Inventario RLS, provisioning, exportación y purga
en orden de dependencias incluyen las entidades nuevas. Downgrades rechazan perder historial.
Las matrices de pruebas agregan entidades/columnas autorizadas sin relajar denegaciones.

## Validación

- Migraciones: 19 pruebas aprobadas; upgrade poblado, reversibilidad vacía, protección de
  historial y matriz SQL real de verbos/columnas con dos tenants.
- CRM/captación/postventa más contratos existentes: 37 pruebas focales aprobadas.
- Mensajería: 55 focales aprobadas; proveedor simulado explícito, RLS, replay, recibos fuera
  de orden, revocación y recuperación en sucursal secundaria.
- E2E real ampliado: `business-automation-real.spec.ts`, 1/1 aprobado en 7.1 s, sin mocks.
  Navegador → API con rol `kova_app` sin bypass RLS → Postgres local aislado. Verifica origen,
  cliente, pedido, venta/pagos, postventa, reposición y conciliación. Transferencia registrada
  representa un apunte POS, no certifica liquidación PSP.
- Chromium controlado: bandeja, solicitudes y postventa en 1440/768/390/320 px sin overflow,
  excepciones ni infracciones axe A/AA detectadas.
- Frontend después de integrar main: 1,044 pruebas en 170 archivos; ESLint, TypeScript, build,
  SSR, prerender, 114 chunks e import guard aprobados. Ocho recorridos Chromium controlados
  cubren las vistas previas y nuevas más captación pública; la última copia de estados está en español.
- Backend completo después de integrar main: 1,693 pruebas aprobadas, tres advertencias, 152.36 s.
  Las 55 de mensajería se repitieron después de ajustar exclusivamente nombres de schemas OpenAPI.
  Los cinco casos de migración/grants modificados se repitieron también con fuente final, aprobados.
- Los paths OpenAPI anteriores permanecen estructuralmente idénticos. Sólo QuoteCreate/QuoteResponse
  agregan el vínculo opcional de oportunidad. Los schemas de bandeja usan nombres propios para
  conservar intactas las referencias del asistente y autenticación.

Se corrigieron dos defectos detectados: timestamps de automatizaciones se normalizan a UTC
para replay estable con Postgres en CDMX; recuperación de envíos interrumpidos cubre también
sucursales secundarias sin reglas/política. Ambos tienen cobertura de regresión.

## Cuentas y límites

No se conectó WhatsApp, Meta, correo del dominio, PSP ni PAC. No se enviaron mensajes,
procesaron tarjetas ni emitieron CFDI Live. WhatsApp requiere alta/elegibilidad, vinculación
verificada, custodia de credenciales, webhook HTTPS y aceptación real. Marketing y mensajes
fuera de ventana siguen bloqueados sin plantilla aprobada; outbox no implica campañas habilitadas.

Correo/Instagram, plantillas Meta y cobros requieren elegir/configurar proveedores y completar
sus adaptadores y aceptación, además de credenciales. CFDI conserva onboarding/gates existentes.
La operación física/financiera mantiene las confirmaciones humanas correspondientes.

El horizonte por giro (citas, lealtad, crédito, recetas/KDS, voz, firma, cursos y franquicias)
requiere contratos y aceptación propios. Esta entrega acredita el circuito general descrito,
sin presentar ese horizonte como disponible.

Release: CI completo incluido nuevo caso workerd, revisión de diff, respaldo, migraciones,
provisioning y aceptación del candidato. Mantener reglas/cohorte/canales desactivados hasta
configuración expresa. Sin aceptación real de WhatsApp, hardware, QR impreso ni Safari/iOS.

## Corrección del control de publicación detectada durante el merge

El release previo de otro cambio, [39195580940](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39195580940),
falló al verificar inmediatamente después de publicar y restaurar Cloudflare: primero observó el
SHA anterior y luego el candidato durante la recuperación. Una consulta pública posterior confirmó
API, proxy y frontend coherentes de nuevo en `62aafb648cf70abf36336f89706a44cd4fbb25d9`.
No se hicieron mutaciones manuales para ese diagnóstico.

Los scripts de release/recuperación añaden una espera acotada para propagación, permitiendo sólo
el SHA objetivo y el anterior explícitamente conocido. HTTP fallido, respuesta inválida o identidad
desconocida siguen bloqueando de inmediato. Después se ejecuta la verificación completa de sitio,
versión exacta, API, proxy y base sin relajar ninguna aserción. No se cambian credenciales ni DNS.
La recuperación invierte las dos identidades y espera también el frontend restaurado.
Validación: 69 pruebas de publicación/recuperación aprobadas y una exclusiva de Windows omitida;
lectura real del checker sobre API/proxy recuperados aprobada. La ventana es 120 s y cada lectura
conserva el timeout de 20 s del verificador para arranques fríos; una lectura en curso puede
extender esa ventana como máximo por su timeout. Las simulaciones nuevas prueban convergencia,
agotamiento, versiones ajenas, errores HTTP y orden de recuperación; los mocks previos sólo
incorporan el método de readiness que ahora exige el contrato, conservando sus denegaciones.
