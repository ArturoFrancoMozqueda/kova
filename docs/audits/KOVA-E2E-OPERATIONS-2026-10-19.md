# Continuación E2E: agenda y lealtad interna

Fecha: 2026-10-19. El propietario autorizó continuar con agentes, integrar y verificar el
funcionamiento en producción, avanzando sin conectar sus cuentas externas.

## Comportamiento implementado

- Agenda por sucursal y recurso de capacidad uno: cliente explícito, zona IANA mexicana
  inmutable, intervalos UTC, reserva/reprogramación/cancelación y estados atendida/no asistió.
  Los intervalos contiguos son válidos; locks transaccionales evitan reservas simultáneas
  superpuestas. Inicio futuro hasta 366 días, duración máxima 24 horas y máximo 200 recursos.
- Historial de cita append-only y tareas de recordatorio internas. Reprogramar/cancelar
  suprime tareas anteriores; completar una tarea no acredita ningún mensaje enviado.
- Lealtad exclusiva del propietario, desactivada inicialmente y sin tasa monetaria inventada.
  Cada política es una revisión inmutable; una venta usa la política vigente al vender.
  Acumulación por ventas con cliente y reversas por devoluciones/anulaciones son idempotentes.
  Los pases procesan hasta 100 entradas y continúan sin duplicar cuando hay más trabajo.
- Canje de puntos con saldo esperado, beneficio descrito y confirmación humana. El ledger
  puede quedar negativo después de una devolución; se muestra el saldo real y se bloquean
  nuevos canjes sin puntos o con reversas pendientes. No modifica descuentos, pagos, caja,
  inventario ni el total de ninguna venta. El beneficio sigue siendo una operación manual.
- Vistas privadas `/appointments` y `/loyalty`, estados vacíos reales, filtros y paginación.
  Horarios independientes de la zona del dispositivo; horas ambiguas/inexistentes por cambio
  de horario son rechazadas. Agenda para dueño/gerente; lealtad sólo dueño sin fetch del gerente.

## Integración y seguridad

Migraciones aditivas `0088_appointments` y `0089_internal_loyalty`, con downgrade bloqueado
si existe historia. Seis tablas con FORCE RLS, FKs de propiedad y permisos mínimos runtime.
Las políticas/entradas de lealtad y el historial de citas sólo admiten SELECT/INSERT runtime.
Exportación explícita y purga ordenada incluyen todos los datos nuevos.

El worker privado incorpora sucursales con política de lealtad y aplica el mismo billing y
contexto tenant/sucursal, sin conexión privilegiada. Conserva cohorte explícita desactivada
por defecto. La interfaz permite procesar manualmente la lealtad sin esperar a habilitarla.
Los recordatorios de agenda se crean transaccionalmente y no necesitan activar un canal.
Los paths y schemas OpenAPI anteriores se conservaron estructuralmente idénticos.

## Validación

Pruebas enfocadas cubren concurrencia real con dos conexiones runtime, aislamiento de negocio
/sucursal, acceso por rol, billing, idempotencia, UTC con Postgres en CDMX, rollback completo,
redondeo, políticas históricas, devoluciones acumulativas y saldos negativos.
La matriz de migración prueba los verbos/columnas permitidos y denegados contra dos negocios.

Frontend: 1,071 pruebas unitarias aprobadas; typecheck y lint aprobados. QA Chromium a
1440/768/390/320 px incluye accesibilidad axe, overflow y errores JavaScript.
Migraciones: 23 pruebas aprobadas. Runtime Python Durable Objects: siete pruebas aprobadas,
incluyendo agenda, colisión de reserva, lealtad opt-in y aislamiento sin proveedores externos.
La suite backend nativa completa y los contratos del repositorio aprobaron.
El PR y el registro de release contienen el resultado final de CI y aceptación pública.

Antes del cambio se verificó producción en `2c460921cacd`: sitio, API directa, proxy y DB sanos;
Chromium público a 1440/390 px sin errores, rutas privadas al login y API privada 401.
No se usaron credenciales de clientes ni se crearon ventas/datos sintéticos en producción.

## Alcance pendiente y límites

No se conectaron WhatsApp/Meta, correo de dominio, PSP ni PAC; tampoco se enviaron mensajes,
cobraron tarjetas o emitieron CFDI. El propietario usa sólo la app WhatsApp Business;
la aceptación real de Cloud API y los adaptadores externos siguen pendientes.
La automatización programada requiere configurar la cohorte existente expresamente.

No se acredita un flujo autenticado de negocio en producción sin una sesión autorizada;
se valida con backend real local, runtime workerd y aceptación pública del SHA desplegado.
Safari/iOS, entrega de recordatorios y cumplimiento manual de beneficios no fueron validados.
Crédito, recetas/KDS, voz, firma, cursos y franquicias siguen fuera de este corte y necesitan
sus propios contratos y aceptación. La implementación no declara cerrado todo el horizonte E2E.
En clientes con mucho historial, medir el coste del lock de ventas durante canjes antes de escalar.
