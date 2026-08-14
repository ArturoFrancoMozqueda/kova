# Higiene operativa de turnos

Este runbook evita que un turno abierto acumule varias jornadas y vuelva irreconciliable el corte.
No automatizar el cierre financiero: siempre requiere una persona autorizada y efectivo contado.

## Política de jornada

- Responsable primario: propietario o gerente del tenant piloto; cajero sólo si su operación lo
  permite y tiene `shifts.close`.
- Revisar el turno actual al inicio y al final de cada jornada. Un turno que cruza la hora de cierre
  acordada se escala al responsable antes de registrar la siguiente jornada.
- El recordatorio no cambia datos. Nunca inferir el efectivo real, cerrar por timeout ni usar el
  saldo esperado como conteo real.
- Antes de cerrar: sincronizar ventas pendientes, contar caja físicamente, registrar entradas y
  salidas faltantes, explicar la diferencia y conservar el corte.

## Checklist para el tenant QA

1. Confirmar por canal interno que el tenant es el de QA y no pertenece a un cliente.
2. Registrar ID anonimizado, `opened_at`, edad del turno y responsable; no copiar PII.
3. Obtener autorización explícita para cerrar y el monto de efectivo contado por la persona a cargo.
4. Verificar que la cola offline no tenga ventas pendientes.
5. Cerrar desde la UI normal, descargar o imprimir el corte y comprobar esperado, real y diferencia.
6. Abrir el siguiente turno sólo cuando comience la siguiente jornada.

Si no hay autorización o conteo físico, no cerrar. Escalar el turno como pendiente operativo; esta
documentación no autoriza la mutación.

## Evidencia mínima

| Campo | Valor |
|---|---|
| Fecha/hora CDMX | |
| Tenant QA anonimizado | |
| Edad al detectar / cerrar | |
| Responsable y autorización | |
| Cola offline en cero | Sí / No |
| Efectivo contado por humano | Sí / No (sin publicar monto) |
| Resultado del corte | Cuadrado / Diferencia explicada / Bloqueado |
| Incidente o seguimiento | |
