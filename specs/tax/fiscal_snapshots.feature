Feature: Snapshots fiscales inmutables
  Scenario: Cambio de tasa no reescribe una venta
    Given una venta confirmada con snapshots fiscales
    When el owner cambia la configuración del producto
    Then el ticket histórico conserva base, tasa e impuesto originales

  Scenario: Falla transaccional no deja snapshot parcial
    Given una creación de venta con impuesto
    When falla la escritura de un snapshot de línea
    Then no existe orden, pago, movimiento ni snapshot parcial

  Scenario: Recibo operativo no afirma CFDI
    Given una venta con desglose fiscal sin timbrado PAC
    Then el documento se identifica como recibo operativo
    And no muestra UUID fiscal ni estado emitido
