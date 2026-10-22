Feature: Tareas operativas internas por sucursal
  Scenario: Un evento confirmado genera una sola tarea
    Given una regla de pedido listo habilitada por el propietario
    When un pedido pasa a listo y se confirma su transacción
    And el worker procesa el mismo evento dos veces
    Then existe una sola tarea interna para esa regla y evento
    And no se envía ningún mensaje externo

  Scenario: Pausar revoca tareas pendientes
    Given una tarea pendiente de una regla habilitada
    When el propietario pausa la regla con su versión vigente
    Then la tarea queda suprimida
    And completar la versión anterior es rechazado

  Scenario: Un evento revertido no produce efectos
    Given una regla habilitada
    When una transición de pedido y su evento hacen rollback
    Then no existe evento confirmado ni tarea generada

  Scenario: Una sucursal ajena no puede resolver tareas
    Given una tarea de otra sucursal o negocio
    When un usuario consulta o resuelve desde su sucursal
    Then la tarea no es visible y la resolución devuelve no encontrado

  Scenario: Revisar vencimientos manuales sin duplicar por notas
    Given la regla de revisión de atención se habilitó en la sucursal
    And un caso activo tiene un vencimiento posterior a esa autorización
    When vence la fecha y el motor procesa dos veces
    Then existe una sola revisión interna de ese caso y fecha
    And agregar una nota no crea otra revisión
    And no se envía mensaje ni se modifica la atención

  Scenario: Suprimir revisión de atención con fuente obsoleta
    Given existe una revisión interna pendiente por vencimiento
    When se resuelve el caso o se cambia su fecha o se revoca la autorización
    Then no puede completarse la revisión obsoleta
    And el siguiente procesamiento acotado la suprime
