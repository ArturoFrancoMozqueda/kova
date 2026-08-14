Feature: Recepción de compras auditable
  Background:
    Given existe una orden enviada con 10 unidades pendientes

  Scenario: Recepción parcial confirmada
    When un manager confirma una recepción de 4 unidades con una clave idempotente nueva
    Then se crea un solo movimiento de inventario por 4 unidades
    And la orden queda parcialmente recibida con 6 unidades pendientes

  Scenario: Reintento idempotente
    When el mismo manager repite la confirmación con la misma clave y payload
    Then recibe la misma recepción confirmada
    And no se crea otro movimiento de inventario

  Scenario: Confirmaciones concurrentes exceden el saldo
    When dos managers intentan recibir simultáneamente más que el saldo disponible
    Then como máximo una confirmación es aceptada
    And el inventario coincide con las recepciones confirmadas

  Scenario: Fallo transaccional
    Given una línea de la recepción ya no es válida
    When el manager intenta confirmar la recepción
    Then ninguna línea modifica inventario
    And la recepción permanece en borrador

  Scenario: Aislamiento de tenant
    When un usuario de otro tenant consulta la orden
    Then recibe una respuesta de recurso no encontrado

  Scenario: Operación offline
    Given el dispositivo está offline
    When el manager abre una recepción
    Then la confirmación está deshabilitada con una explicación
