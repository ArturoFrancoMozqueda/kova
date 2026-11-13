# Documentación de Kova

Empieza aquí. Si un documento y el código no coinciden, manda el código; corrige el documento en el
mismo PR.

## Base (leer primero)

| Documento | Para qué |
|---|---|
| [arquitectura.md](arquitectura.md) | Qué corre dónde, datos, multi-tenant, auth, offline, billing y jobs |
| [despliegue.md](despliegue.md) | Cómo llega `main` a producción, rollback, entorno de GitHub, backups |
| [desarrollo-y-ci.md](desarrollo-y-ci.md) | Levantar local, correr pruebas, qué valida CI |
| [current-sprint.md](current-sprint.md) | Trabajo en curso y gates abiertos |

## Decisiones (ADR) — `adr/`

Explican por qué el sistema es así. No se editan para reflejar cambios: si una decisión cambia, se
escribe un ADR nuevo que reemplaza al anterior.

- [Asistente Cloudflare con consumo verificable](adr/ADR-034-asistente-cloudflare-consumo-verificado.md):
  respuestas ancladas, reducción de llamadas/tokens y conciliación de Qwen sin liberar incertidumbre.

## Referencia de producto y negocio

- [KOVA_BRAND_CONTEXT.md](KOVA_BRAND_CONTEXT.md): marca, público, voz, identidad visual y producto
  para crear publicaciones, imágenes y videos.
- [commercial-strategy.md](commercial-strategy.md): propuesta de posicionamiento, venta asistida,
  difusión y medición para conseguir los primeros clientes, con fuentes comerciales vigentes.
- [Diseño comercial de Esencial y Gestión](adr/ADR-019-commercial-plan-design.md): dirección
  aprobada de $399/$699, protección de acuerdos actuales y mediciones pendientes.
- [Base comercial multiplan](adr/ADR-020-commercial-plan-foundation.md): cohortes y capacidades
  del servidor, con activación de nuevas ofertas apagada por defecto.
- [Activación comercial productiva](adr/ADR-021-commercial-production-activation.md): autorización
  de $399/$699 con Portal básico sandbox aceptado interactivamente, acuerdos anteriores conservados
  y política ON cuya publicación se acredita con release y verificación externa.
- [Configuración de arranque nativa](adr/ADR-022-native-controller-boot-policy.md): identidad del
  controlador verificada; la política ON conserva la baseline OFF `d4d81d6a4fe6` y necesita su
  propio release y verificación externa.
- [Aceptación y medición comercial](runbooks/commercial-plan-acceptance.md): Standard, cortesías,
  pruebas de planes, atención y consumo, sin confundir proyecciones con costos comprobados.
- [report-metric-definitions.md](report-metric-definitions.md): cómo se calcula cada métrica de
  ventas.
- [billing-state-copy-matrix.md](billing-state-copy-matrix.md): estados de suscripción y sus textos.
- [account-lifecycle.md](account-lifecycle.md): exportación y eliminación de cuentas.
- [deferred-scope.md](deferred-scope.md): lo que decidimos no construir todavía.

## Para agentes y diseño — `claude/`

Contexto que leen `CLAUDE.md` y `AGENTS.md`: producto, invariantes de arquitectura, checklist de QA
manual, contrato de experiencia de UI, sistema de movimiento y brief visual de la landing.

## Seguridad — `security/`

Modelo de amenazas de cookies/CSRF y diseño de rate limiting.

## Runbooks — `runbooks/`

Procedimientos paso a paso para operar producción: restore de backup, drill de Stripe, uptime,
panel interno de operación, Sentry del navegador, higiene de turnos, cuarentena offline y pilotos.

[Alta de WhatsApp desde Kova](runbooks/whatsapp-embedded-signup.md): preparación única de la
plataforma, autorización por comercio y revisión de efectos externos inciertos. Estado y límites
en el [contrato](../specs/integrations/whatsapp-embedded-signup.md).

[Revisión de la app de WhatsApp](runbooks/whatsapp-meta-app-review.md): configuración preparada,
justificación de permisos y recorrido de video, con bloqueos de Meta y evidencia aún pendiente.

[Aceptación de equipos](runbooks/pos-hardware-acceptance.md): equipo de prueba, impresión térmica,
lector, cajón y pruebas offline en los dispositivos reales de cada negocio.

[Aceptación del asistente](runbooks/assistant-acceptance.md): evaluación reproducible, revisión
humana, chat autenticado, carga y presupuesto antes de habilitar inferencia externa.

## Pruebas

[testing-ci.md](testing-ci.md) tiene la política detallada de CI. Los escenarios por dominio viven
en `specs/` (`.feature`) y se ejecutan desde `backend/app/tests/bdd/`.

## Regla para documentos nuevos

- Las auditorías, planes y reportes con fecha son temporales: cuando se cierran, sus conclusiones
  vigentes pasan a un documento base, ADR o runbook y el archivo se borra. Git conserva el
  historial.
- No dupliques lo que ya dice el código. Enlaza el archivo en su lugar.

- [Validación local de Clientes, lealtad y reservas](testing-clients-booking.md).
