# Soporte y alta comercial acompañada

## Alcance

Kova se ofrece como beta controlada con acompañamiento del fundador. La capacidad de cobro y
las pruebas automatizadas no sustituyen la aceptación de la operación del negocio ni una
revisión profesional del acuerdo. Estado y evidencias: [preparación comercial](../../docs/runbooks/sales-readiness.md).

Las altas nuevas contratan Esencial o Gestión según el catálogo público del servidor.
Standard de $299 MXN/mes se conserva exclusivamente para acuerdos anteriores; no se ofrece
como precio de una alta nueva. Los precios, capacidades y recuperación de pago se rigen por
[planes comerciales](../billing/commercial_plans.md) y [acceso comercial](../billing/access_control.md).

## Canal y atención

- Dirección pública: `soporte@kovasuite.com`. Cloudflare Email Routing reenvía a
  `posprojectsupport@gmail.com`; las respuestas manuales salen desde ese Gmail por decisión
  expresa del dueño. No requieren Workspace ni Enviar como mediante SMTP externo.
- La ayuda autenticada muestra el correo público. WhatsApp sólo aparece como canal secundario
  si existe un número verificado en la fuente del frontend; no acredita integración del POS.
- Horario publicado: lunes a viernes de 9:00 a 19:00, hora de Ciudad de México.
  El responsable debe aceptar la cobertura antes de incorporar clientes pagados.
- Los incidentes que impiden operar tienen prioridad. No se promete resolución en cuatro horas,
  atención permanente ni SLA formal. Se confirma recepción, impacto y siguiente actualización;
  sólo se comunica una fecha de corrección cuando exista una estimación sustentada.
- Ayuda puede adjuntar el último `X-Request-ID` seguro de la API. No adjunta tenant, correo
  del usuario, cookies, tokens, cuerpos de respuesta ni datos de pago.
- No pedir contraseñas, tokens, datos completos de tarjeta ni exportaciones completas por correo.

## Alta por negocio

1. Revisar giro, flujo de caja, conectividad y equipos. Explicar las funciones efectivamente
   disponibles y las limitaciones de hardware, CFDI, terminal y WhatsApp.
2. Completar identidad de las partes, plan, importe y alcance del
   [acuerdo](../../docs/beta-agreement-template.md). Obtener revisión profesional y aceptación
   fuera del repositorio; no marcarlo firmado por haber completado la plantilla.
3. El propietario crea su cuenta por el registro normal y verifica su correo. Introduce su
   contraseña directamente; soporte no la recibe ni crea credenciales en su nombre.
4. Cargar únicamente productos y existencias reales autorizados por el propietario. Las
   demostraciones y ensayos usan un negocio de QA separado, nunca cifras ficticias de producción.
5. Con el propietario: primera venta, devolución, cierre con efectivo contado, revisión de
   inventario y exportación. La prueba offline se hace en un equipo preparado, con venta
   autorizada y confirmando una sola sincronización.
6. El propietario elige el plan disponible y paga en Stripe. El retorno del navegador no
   acredita el pago: comprobar activación del servidor y la recepción del recibo correspondiente.
7. Verificar recepción por el correo público y respuesta desde Gmail con una prueba acordada.
   Registrar responsable, horario aceptado y contacto alterno, sin inventar tiempos de atención.
8. Registrar equipo/navegador y resultados en la
   [matriz física](../../docs/runbooks/pos-hardware-acceptance.md). No declarar compatibilidad
   de impresora, lector o cajón a partir de una prueba de navegador.

## Medición con personas

En la primera sesión, pedir al dueño que complete sin guía: cargar un producto, abrir turno,
cobrar y encontrar el resultado del día. Registrar por tarea si terminó, errores, ayuda necesaria
y tiempo observado. Después preguntar dificultad de 1 a 5, qué no entendió y qué le faltó.
La duración automatizada o la opinión del agente no equivalen a satisfacción del cliente.

Proponer seguimiento al séptimo día y una sesión semanal de 30 minutos durante el primer mes;
fechas y participantes se acuerdan con cada negocio. Guardar feedback y constancias en un
registro operativo privado, con acceso limitado. Las notas autorizadas de Kova Ops pueden
referenciarlo; no se presume que existe un formulario o un CRM de soporte nuevo.

Los defectos P0/P1 se priorizan en el backlog con su impacto, reproducción y validación de la
corrección. Las métricas agregadas de tareas conservan la
[semántica de experiencia](../reports/task_experience.md); no se fabrican tasas sin datos.

## Aceptación

- Canal configurado y prueba de recepción documentada; respuesta Gmail elegida explícitamente.
- Plan e importe acordados coinciden con la oferta del servidor o con el acuerdo anterior vigente.
- Propietario, responsable de soporte, cobertura y condiciones aceptados por cada negocio.
- Conteo físico, equipos, recibo y comprensión del dueño acreditados con su propio alcance.
- Acuerdos, feedback y datos personales fuera de git; secretos fuera de chat y registros.
