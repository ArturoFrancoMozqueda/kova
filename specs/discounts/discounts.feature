Feature: Descuentos auditables
  Scenario: Manager aplica descuento porcentual de línea
    Given un manager autenticado con una venta online de 100.00
    When aplica 10 por ciento con un motivo
    Then el servidor calcula descuento 10.00 y base 90.00
    And el ticket y la auditoría muestran el descuento

  Scenario: Cajero sin permiso intenta descontar
    Given un cajero sin discounts.apply
    When intenta crear una venta con descuento
    Then recibe 403
    And no se crea orden ni auditoría

  Scenario: Replay conserva una sola venta
    Given una orden con descuento e Idempotency-Key
    When se envía dos veces el mismo cuerpo
    Then ambas respuestas identifican la misma orden
    And existe un solo descuento persistido

  Scenario: Venta offline no inventa autorización
    Given que la caja perdió conexión
    Then Kova permite vender sin descuento
    And explica que los descuentos requieren conexión
