# Gate operativo para ampliar la beta

Este checklist reúne evidencia; no sustituye asesoría legal profesional ni autoriza acciones en
producción. Debe existir un registro por tenant pagado, almacenado fuera del repositorio si contiene
datos personales o firmas.

Actualización del 17 de noviembre de 2026: la
[preparación comercial](sales-readiness.md) concentra la evidencia nueva y las intervenciones
del dueño. El correo público ya recibe por reenvío y el dueño eligió respuestas desde Gmail.
El ciclo técnico de cuenta se ejecutó en PostgreSQL desechable y en navegador con API/RLS reales;
los checks humanos, legales, de hardware y recuperación regional conservan su alcance pendiente.
Las comprobaciones históricas siguientes no sustituyen este corte ni se fechan de nuevo.

Reconciliación documental: 26 de octubre de 2026. Las comprobaciones históricas conservan su
fecha y alcance; no certifican automáticamente el despliegue ni las plantillas actuales. Esta
revisión no envió correos, no ejecutó restauraciones ni cambió proveedores.

Actualización de evidencia del 29 de octubre: la consulta del proveedor confirma las seis
plantillas de prueba entregadas a Gmail el 27 de octubre y el logo público responde HTTP 200.
Esa consulta por sí sola no acredita Inbox ni el origen del envío. Posteriormente, la solicitud
real de recuperación a través del proxy de la versión `49d96f4bb994` produjo un correo `delivered`
el 30 de octubre a las 02:50 UTC; no se leyó el token ni se cambió la contraseña.

El 30 de octubre a las 14:48 UTC se repitió el recorrido con la presentación premium publicada en
`aa9c856e8f11`: HTTP 200 y `delivered`. La verificación pública confirmó sitio, API y proxy en esa
versión y base accesible. La apariencia en el buzón QA sigue pendiente de aceptación humana.

La restauración ampliada del 30 de octubre (29 CDMX) ya recuperó la revisión 0098 y comprobó
autenticación por cookies, CSRF/identidad, exportación por API de un negocio restaurado y logout
usando la imagen `57fe4cf7004f`, en un namespace sin red externa. La cuenta sintética y todos los
datos desechables se eliminaron. No se cierra la recuperación regional con bindings/tráfico de
producción ni la aceptación de correo en otros clientes. [Alcance exacto](restore-supabase-backup.md).

## OPS-1 y OPS-2 — correo y soporte

Revalidación del 2 de noviembre: producción `79f73a326b14` con web/API/proxy y DB accesibles;
dominio de correo verificado y reset editorial del 30 de octubre confirmado `delivered`. El nuevo
[restore con revisión 0099](../audits/KOVA-R2-RESTORE-2026-11-02.json) también aprobó login,
exportación, logout, runtime RLS, integridad y limpieza. Estos resultados reemplazan el corte
anterior de compatibilidad de esquema, no la aceptación en otros clientes ni la recuperación regional.
El lote posterior de seis muestras QA del diseño editorial también llegó a `delivered` a las
16:14 UTC. El dueño abrió el buzón y se verificó Inbox y presentación en Gmail web de las seis,
con SPF/DKIM/DMARC PASS en la muestra QA de reset. [Método y límites](../email-deliverability.md).

Cierre posterior sobre `4e3a58060f81` (PR #300): [CI protegido](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41482372217)
y [release](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41483548278) aprobados; smoke
público con web/API/proxy en el mismo SHA y DB accesible. El [restore repetido](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41483756223)
usó esa imagen y el backup nuevo del 2 de noviembre, con login/exportación/logout, RLS, integridad
y limpieza aprobados. Los gates sin aceptación física, comercial o de proveedores siguen abiertos.

- [ ] Las seis plantillas actuales llegaron a Inbox en buzones QA autorizados de Gmail, Outlook y
      Hotmail: verificación, bienvenida, recibo de pago, fin de prueba, invitación y contraseña.
- [x] Muestras actuales de las seis en Inbox de Gmail web, con revisión de escritorio el
      2 de noviembre. Autenticación PASS observada en el reset QA; otros clientes siguen abiertos.
- [ ] SPF, DKIM y DMARC pasan; enlaces, español, móvil, modo oscuro, spam y rebotes fueron revisados.
- [ ] La evidencia sólo contiene fecha, proveedor, plantilla y resultado; no direcciones ni tokens.
- [x] Gmail es el canal oficial aceptado para la beta controlada: decisión SELL-06 en
      [sprint-planning.md](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/sprint-planning.md) y fuente vigente
      [`frontend/src/lib/support.ts`](../../frontend/src/lib/support.ts).
- [x] `soporte@kovasuite.com` recibe y reenvía al Gmail de operación. Prueba autorizada entregada
      el 17 de noviembre; regla exacta Active y destino comprobados.
- [x] Respuestas manuales desde `posprojectsupport@gmail.com`, elegidas expresamente por el dueño.
      El alias SMTP externo se retiró; tras recargar, Gmail conserva sólo su identidad original.
- [ ] Responsable, cobertura y conversación de ida/respuesta aceptados con cada piloto.

La dirección pública de dominio usa reenvío, sin buzón de pago. Las respuestas salen desde Gmail;
no requieren Enviar como externo ni Workspace. La prueba de conversación con un piloto sigue
siendo distinta de recibir un correo transaccional. [Decisión y evidencia](../email-deliverability.md).

La [evidencia del 12 de agosto](../email-deliverability.md) acredita cinco plantillas en Gmail,
incluidos SPF/DKIM/DMARC PASS en el mensaje observado. No incluye la invitación presente hoy en
[`backend/app/email/service.py`](../../backend/app/email/service.py), ni acredita Outlook/Hotmail,
clientes móviles o modo oscuro. El origen Fly de aquella evidencia es histórico; Fly está retirado
y no es el destino de nuevas pruebas.

### Qué puede verificarse sin enviar correo

- Inventario, escape de datos, asuntos, caducidades y destinos de enlace de las seis funciones de
  correo; HTML compartido en `backend/app/email/templates.py` y cobertura existente en
  `backend/app/tests/test_email_*`, `test_welcome_email.py`, `test_payment_receipt_email.py` y
  `test_trial_reminders.py`. Leer esa cobertura no equivale a ejecutarla ni a probar Inbox.
- El gate de arranque de producción exige `RESEND_API_KEY` y rechaza el remitente por defecto
  `onboarding@resend.dev`; esto prueba el requisito del código, no la configuración efectiva del
  proveedor. Consultar sólo presencia de variables, nunca sus valores.
- DNS público. El 26 de octubre resolvieron SPF y MX de `send.mail.kovasuite.com`, el selector
  `resend._domainkey.mail.kovasuite.com` y DMARC en raíz y subdominio. No se copiaron claves DKIM.
  Publicar esos registros no demuestra que un mensaje concreto pase autenticación o llegue a Inbox.
- El PNG de correo existe en `frontend/public/email/kova-mark.png`. HEAD y GET desde la red de esta
  revisión recibieron HTTP 403 en su URL pública: su disponibilidad para clientes de correo queda
  sin confirmar; no se infiere una caída global a partir de esa respuesta.

La comprobación posterior del 29 de octubre sí obtuvo HTTP 200, `image/png` y 2,908 bytes desde la
URL pública del logo. Esto resuelve aquella comprobación de accesibilidad HTTP, no el render en
clientes de correo.

La revisión candidata incorpora HTML y texto plano legible para las seis plantillas, con `Reply-To`
al Gmail oficial. Los errores del transporte se registran por categoría sin copiar excepciones,
destinatarios, enlaces o tokens del proveedor. Las pruebas usan un Resend simulado: no acreditan el
despliegue de esa revisión ni recepción de mensajes. No hay clave de idempotencia del proveedor,
identificador de mensaje en el registro de aceptación ni cola durable de entrega. `email.sent`
significa que la llamada no lanzó excepción, no que el destinatario lo recibió. El recordatorio de
prueba guarda una marca por tenant después de esa aceptación. No prometer recuperación automática,
entrega única o monitoreo completo de rebotes a partir de esas marcas.

La plantilla compartida candidata corrige los contrastes de enlaces, texto secundario y pie a al
menos 4.5:1, y la invitación explica su motivo sin afirmar que el destinatario ya tiene cuenta.
Se renderizaron las seis variantes offline a 390 y 800 px, con datos ficticios, sin desbordamiento,
botones de al menos 44 px y logo local. Los originales conservan el enlace público del logo para la
prueba real posterior. Esta revisión no sustituye Inbox, modo oscuro ni render en Outlook/Gmail.

### Protocolo mínimo sin contratar servicios

1. Antes de cualquier envío, el usuario identifica los buzones QA que controla o tiene permiso de
   usar y autoriza explícitamente destinatarios, remitente, seis plantillas, cantidad máxima y
   ventana. Un correo conocido, una dirección de soporte publicada o un permiso de lectura no
   autorizan a enviar. Guardar las direcciones fuera de git; aquí usar alias QA-G, QA-O y QA-H.
2. Preparar y revisar primero los seis HTML sin red de envío, con el código de la revisión a probar.
   Usar asunto y aviso visibles de QA, tokens deliberadamente inválidos y datos no personales.
   No crear cuentas, suscripciones o cobros para dispararlos. El recibo QA no acredita un pago;
   si se omite su enlace opcional de Stripe, anotar esa variante como no probada.
3. Tras la autorización, enviar como máximo una muestra por plantilla y buzón autorizado: seis por
   destinatario, hasta dieciocho para la matriz completa. Empezar con Gmail y detener el lote si
   aparecen rechazos o rebotes. Usar las cuentas y cuota existentes; si no alcanzan, registrar el
   límite y detenerse, sin contratar un plan ni modificar DNS. Una aceptación ambigua no autoriza
   reenvíos automáticos: revisar el resultado antes de duplicar la muestra.
4. El responsable del buzón verifica Inbox o Spam, autenticación del mensaje recibido, remitente,
   enlaces QA, logo, texto, contraste y modo oscuro. Distinguir Outlook/Hotmail web del cliente
   Outlook de escritorio y de Gmail móvil; no marcar un cliente que no se abrió realmente.
5. Para soporte, acordar además una prueba separada de ida y respuesta entre un buzón QA autorizado
   y el Gmail oficial. Requiere autorización de ambos mensajes. Registrar responsable y tiempos
   observados, sin convertirlos en un SLA. No cambiar el canal de dominio durante esta prueba.
6. Conservar sólo fecha UTC, revisión, alias de buzón, cliente, plantilla y resultado. En repositorio
   no guardar tokens, destinatarios, cabeceras completas, cuerpos privados ni enlaces de recibos.
   Mantener abiertos los checks sin evidencia; la muestra no establece una tasa de entregabilidad.

## OPS-3 — restore

- [x] Restauración lógica de respaldos reales en PostgreSQL 17 desechable, sin SQL en producción:
      snapshots 0078 y 0079 del 10 de octubre, con checksum, runtime/RLS, conteos, pagos/lotes y
      limpieza verificados en la [evidencia fechada](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/KOVA-R2-REAL-RESTORE-2026-10-10.md).
- [x] Compatibilidad del snapshot 0099 con la imagen `4e3a58060f81`: igualdad con el head de
      migraciones, arranque ASGI y lectura autenticada aprobados. Este corte no requirió migrar;
      recuperar un snapshot anterior exige validar las migraciones posteriores por separado.
- [x] Repetición actual autorizada del 17 de noviembre CDMX: snapshot 0108, imagen reconstruida
      desde `5d19806840fd`, integridad, RLS, login, exportación, logout y limpieza aprobados en
      el [run 44231962898](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44231962898).
- [ ] Recuperación completa del servicio: nuevo Postgres si corresponde, roles/grants/RLS,
      configuración y binarios de Cloudflare, smoke y cambio de tráfico controlado. La auth propia
      ya se probó sobre el clon restaurado; Supabase Auth/Storage/Vault no son servicios usados
      por Kova y no se añaden como requisitos de este gate.
- [ ] RTO y RPO del servicio medidos, con límites y limpieza del destino completo registrados.

No sigue vigente describir OPS-3 como ausencia de restore real o bloqueo exclusivo por slots/costo.
El [drill lógico en runner](restore-supabase-backup.md#logical-restore-without-creating-a-supabase-project)
usa infraestructura existente y no exige crear un proyecto Supabase. El último ejercicio lógico y
ASGI del 17 de noviembre CDMX duró 20.921 segundos desde la descarga, sin incluir la construcción
de la imagen, con una edad del snapshot de 9 h 28 min 25.989 s.
[Run actual](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44231962898).
Estas mediciones no equivalen a un RTO/RPO regional completo.
Crear o eliminar un proyecto, restaurar o cambiar tráfico requiere su propia autorización; este
checklist no la concede.

## OPS-4 — turnos

- [ ] Responsable y hora de cierre acordados con cada piloto.
- [ ] Revisión diaria sin cierres automáticos; toda caja se cierra con efectivo contado por humano.
- [ ] El turno QA observado se trató conforme a [shift-hygiene.md](shift-hygiene.md).

## OPS-5 — ciclo de cuenta

- [x] Tenant desechable: ZIP/CSV completo, exclusiones y neutralización de fórmulas verificados
      por API con PostgreSQL. La descarga desde UI también aprobó a 390/1440 px.
- [x] Solicitud, ventana reversible ≥30 días y cancelación verificadas por API y navegador.
- [x] Purga local de la solicitud desechable vencida; login/sesión/exportación posteriores negados,
      otro negocio intacto y constancia mínima validada. Sólo se adelantó la fecha de esa solicitud
      sintética; no se purgaron negocios alojados ni se esperaron 30 días reales.
- [ ] Se informó la ventana residual de backups y se documentó cualquier retención legal.

El alcance técnico del 17 de noviembre está en `test_account_lifecycle.py`,
`test_cfdi_account_lifecycle.py` y `account-lifecycle-real.spec.ts`, dentro de las 151 pruebas
backend y 23 de navegador aprobadas del corte. No acredita la aceptación de condiciones por
un cliente ni un periodo real de espera completado. La retención residual se explica en el
acuerdo preparado; debe ser aceptada y revisada profesionalmente.

## OPS-6 — legal y comercial

- [ ] Identidad legal del proveedor y tenant, fecha, precio y etapa beta completos.
- [ ] Acuerdo revisado profesionalmente y firmado antes del acceso pagado.
- [ ] Límites de soporte, horario, severidades, respuesta a incidentes y escalación aceptados.
- [ ] Tratamiento, exportación, eliminación, backups, cambios y limitaciones explicados.
- [ ] Claims comerciales contrastados contra comportamiento vigente; no se promete SLA.

## Registro sin PII

| Gate | Fecha UTC | Entorno/proveedor | Commit | Resultado | Evidencia privada | Bloqueo |
|---|---|---|---|---|---|---|
| OPS-1 | 2026-10-30 | Backend Cloudflare/proxy y Resend | `aa9c856e8f11` | Recuperación con diseño nuevo solicitada por API, HTTP 200 y `delivered` a las 14:48 UTC; seis plantillas del 27 de octubre conservan su alcance histórico | [Alcance de la entrega](../email-deliverability.md) | Aceptación de la nueva presentación, Inbox, Outlook/Hotmail, móvil/oscuro y disparadores actuales de las otras plantillas |
| OPS-2 | 2026-10-26 | Decisión de soporte beta y fuente del producto | SELL-06 / `support.ts` | Gmail aceptado como canal; buzón de dominio diferido | Evidencia de respuesta operativa todavía requerida | Responsable, recepción/respuesta y tiempos; dominio sólo si se decide migrarlo |
| OPS-3 | 2026-10-30 | GitHub runner / R2 / PostgreSQL 17 y ASGI aislados (29 CDMX) | `57fe4cf7004f`; snapshot 0098 | Restore, runtime RLS, integridad, login/CSRF, exportación de 2,217 pedidos existentes y logout aprobados; dos contenedores y dump eliminados | [Run 40996995394](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40996995394) | Recuperación regional, esquemas del proveedor, bindings/tráfico y RTO/RPO completos |
| OPS-3 | 2026-11-18 (17 CDMX) | Única repetición aislada autorizada; R2, PostgreSQL 17 y ASGI | `5d19806840fd`; snapshot 0108 | Restore actual, RLS, integridad, login, exportación, logout y limpieza aprobados; ejercicio 20.921 s sin incluir construcción de imagen | [Run 44231962898](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/44231962898) y alcance en el runbook de restore | Recuperación regional, bindings/tráfico y RTO/RPO completos |
| OPS-4 | 2026-08-14 | No ejecutado | `8e15269` | Bloqueado | No aplica | Tenant, responsable, autorización y conteo humano |
| OPS-5 | 2026-08-14 | GitHub Actions | `8e15269` | Parcial: workflow verde; drill no ejecutado | Run `31687212936` | Tenant desechable, autorización, recorrido y retención |
| OPS-6 | 2026-08-14 | No ejecutado | `8e15269` | Bloqueado | Debe crearse fuera de git | Revisión profesional, identidad, firma y aceptación |

Las filas OPS-4 a OPS-6 de esta tabla conservan el corte histórico del 14 de agosto. Los checks
OPS-5 y el registro de preparación comercial anteriores sí acreditan la nueva ejecución técnica
del 17 de noviembre, sin cerrar aceptación humana o legal. El detalle histórico está en:
[`AUDIT-EXTERNAL-GATES-CLOSEOUT-2026-08-13.md`](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/AUDIT-EXTERNAL-GATES-CLOSEOUT-2026-08-13.md).

El preflight histórico de capacidad está en:
[`AUDIT-STAGING-RESTORE-FEASIBILITY-2026-08-14.md`](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/AUDIT-STAGING-RESTORE-FEASIBILITY-2026-08-14.md).
Su bloqueo por destino no sustituye la evidencia posterior del restore lógico real del 10 de octubre.
