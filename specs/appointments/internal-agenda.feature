Feature: Agenda interna de recursos reales
  Scenario: Citas contiguas sin sobrecupo
    Given un recurso activo y un cliente activo en la sucursal autenticada
    When el dueño registra una cita de 10:00 a 11:00 UTC
    Then una cita de 10:30 a 11:30 UTC del mismo recurso se rechaza
    And una cita de 11:00 a 12:00 UTC sí se permite

  Scenario: Dos operadores reservan simultáneamente
    Given un intervalo libre de un recurso real
    When dos sesiones intentan reservar el mismo intervalo con claves distintas
    Then sólo una cita se confirma y la otra recibe conflicto
    And no se duplica historia ni recordatorio

  Scenario: Reprogramación y cancelación con versiones
    Given una cita scheduled con recordatorio interno pendiente
    When se reprograma con versión vigente
    Then se guarda historia y se suprime el recordatorio anterior
    And un reintento con la misma clave devuelve la misma respuesta
    And una versión antigua con nueva clave recibe conflicto
    When se cancela la cita
    Then el intervalo vuelve a estar libre y no queda recordatorio pendiente

  Scenario: Aislamiento y zona explícita
    Given un recurso de otra sucursal o de otro negocio
    Then no se puede consultar ni reservar desde esta sucursal
    And una fecha sin offset se rechaza
    And la respuesta expresa el instante en UTC junto con la zona IANA del recurso

  Scenario: Tarea de recordatorio sin cuenta externa
    Given una cita vigente próxima a iniciar
    When el dueño completa su recordatorio interno
    Then sólo se resuelve la tarea privada
    And no se envía mensaje ni se registra ingreso
