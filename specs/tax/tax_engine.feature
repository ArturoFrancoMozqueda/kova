Feature: Impuestos configurables sin afirmar CFDI
  Scenario: Impuesto exclusivo
    Given un producto con una tasa configurada de 16 por ciento exclusiva
    When el servidor cotiza una base de 100.00
    Then el impuesto es 16.00 y el total 116.00

  Scenario: Producto exento
    Given un producto marcado exento
    When se completa la venta
    Then el snapshot conserva la base y factor exento
    And no inventa tasa ni importe trasladado

  Scenario: Configuración de otro tenant
    Given una tasa perteneciente al tenant A
    When el tenant B intenta asignarla a un producto
    Then recibe 404
    And el producto no cambia

  Scenario: Más de un componente fiscal
    Given un perfil con componentes fiscales ordenados y aprobados
    When el servidor completa la venta
    Then conserva un snapshot separado por componente y dirección
    And el total coincide con la versión configurada del motor

  Scenario: Combinación no soportada
    Given un perfil con composición fiscal que la versión del motor no reconoce
    When el servidor intenta cotizarlo
    Then rechaza la cotización sin aproximar el impuesto
