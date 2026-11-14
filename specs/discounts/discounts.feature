Feature: Descuentos y tasa de impuesto controlados por el servidor
  Scenario: Manager aplica un descuento en línea
    Given un manager autenticado con una venta online de 30.00
    When cobra con descuento de 1.00 y tasa de 16 por ciento
    Then el servidor registra la venta con impuesto 4.64 y total 33.64

  Scenario: Cajero sin permiso intenta descontar en línea
    Given un cajero sin orders.discount
    When intenta crear una venta online con descuento
    Then recibe 403
    And no se crea venta, pago ni movimiento de inventario

  Scenario: Cajero intenta cambiar la tasa configurada
    Given un negocio con tasa predeterminada de 16 por ciento
    And un cajero sin orders.discount
    When intenta cobrar en línea con tasa 0
    Then recibe 403
    And con la tasa de 16 por ciento la venta se registra

  Scenario: Venta offline con descuento sin permiso se conserva y se audita
    Given una venta en cola de un cajero con descuento y un precio de catálogo anterior
    When la caja sincroniza
    Then la venta se registra tal como se cobró
    And existe una sola auditoría orders.pricing_review con los motivos y precios
