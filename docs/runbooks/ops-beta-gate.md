# Gate operativo para ampliar la beta

Este checklist reúne evidencia; no sustituye asesoría legal profesional ni autoriza acciones en
producción. Debe existir un registro por tenant pagado, almacenado fuera del repositorio si contiene
datos personales o firmas.

## OPS-1 y OPS-2 — correo y soporte

- [ ] Las cinco plantillas llegaron a Inbox en Gmail, Outlook y Hotmail con un buzón de QA.
- [ ] SPF, DKIM y DMARC pasan; enlaces, español, móvil, modo oscuro, spam y rebotes fueron revisados.
- [ ] La evidencia sólo contiene fecha, proveedor, plantilla y resultado; no direcciones ni tokens.
- [ ] `posprojectsupport@gmail.com` recibe y responde durante la beta controlada.
- [ ] No cambiar a `soporte@kovasuite.com` hasta probar recepción **y respuesta**; mantener Gmail en
      paralelo durante la transición y definir rollback.

## OPS-3 — restore

- [ ] Proyecto Supabase fresco y desechable autorizado; nunca producción.
- [ ] Preflight local, restore, roles/RLS, conteos y smoke de sólo lectura aprobados.
- [ ] RTO y RPO medidos; gaps y limpieza del proyecto temporal registrados.

## OPS-4 — turnos

- [ ] Responsable y hora de cierre acordados con cada piloto.
- [ ] Revisión diaria sin cierres automáticos; toda caja se cierra con efectivo contado por humano.
- [ ] El turno QA observado se trató conforme a [shift-hygiene.md](shift-hygiene.md).

## OPS-5 — ciclo de cuenta

- [ ] Tenant desechable: ZIP/CSV completo y neutralización de fórmulas verificados.
- [ ] Solicitud, ventana reversible ≥30 días y cancelación verificadas.
- [ ] Purga autorizada en entorno desechable; acceso posterior negado y constancia mínima validada.
- [ ] Se informó la ventana residual de backups y se documentó cualquier retención legal.

## OPS-6 — legal y comercial

- [ ] Identidad legal del proveedor y tenant, fecha, precio y etapa beta completos.
- [ ] Acuerdo revisado profesionalmente y firmado antes del acceso pagado.
- [ ] Límites de soporte, horario, severidades, respuesta a incidentes y escalación aceptados.
- [ ] Tratamiento, exportación, eliminación, backups, cambios y limitaciones explicados.
- [ ] Claims comerciales contrastados contra comportamiento vigente; no se promete SLA.

## Registro sin PII

| Gate | Fecha UTC | Entorno/proveedor | Commit | Resultado | Evidencia privada | Bloqueo |
|---|---|---|---|---|---|---|
| OPS-1 | | | | | | |
| OPS-2 | | | | | | |
| OPS-3 | | | | | | |
| OPS-4 | | | | | | |
| OPS-5 | | | | | | |
| OPS-6 | | | | | | |
