Feature: Cotizaciones con precios de servidor
  Scenario: La aceptación registrada crea un único pedido sin ingreso
    Given una cotización vigente compartida con el cliente
    When gerencia registra su aceptación con la versión actual
    And reintenta la misma solicitud
    Then existe un único pedido nuevo vinculado a la cotización
    And no existen venta, pago ni reserva creados por cotizar

  Scenario: Cambió el precio después de cotizar
    Given una cotización con precio congelado
    When cambia el precio del catálogo antes de aceptar
    Then la conversión devuelve conflicto y conserva la cotización original
    And no se crea pedido con condiciones distintas

  Scenario: La cotización venció mientras estaba abierta la pantalla
    Given una cotización que ya alcanzó su fecha de vigencia
    When gerencia registra su aceptación
    Then la operación se rechaza sin crear pedido

  Scenario: La sucursal ajena no puede acceder
    Given una cotización de otra sucursal o negocio
    When el usuario intenta aceptarla desde su sesión
    Then no se encuentra la cotización y no se crea pedido
