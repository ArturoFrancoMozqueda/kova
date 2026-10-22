# language: es
Característica: Atención privada y trazable de clientes
  Escenario: Registrar y resolver un caso no modifica la venta
    Dado que existe un cliente y una venta suya de la sucursal
    Cuando un encargado registra un caso con nota y responsable activo
    Entonces se conserva el vínculo explícito de cliente y venta
    Y existe un evento inmutable con autor y la nota original
    Cuando el encargado resuelve el caso con la versión vigente
    Entonces el caso queda resuelto y no aparece como vencido
    Y la venta, pagos e inventario permanecen intactos

  Escenario: Reabrir conserva el historial anterior
    Dado que un caso resuelto conserva sus notas y vencimiento manual
    Cuando un encargado reabre el caso con la versión vigente
    Entonces el caso vuelve a estar activo
    Y el indicador de vencimiento se calcula contra la fecha real
    Y los eventos anteriores permanecen inmutables

  Escenario: Un nombre de pedido no basta para identificar al cliente
    Dado que un pedido sólo tiene nombre y teléfono manuales
    Cuando un encargado intenta vincularlo a un caso de un cliente
    Entonces se rechaza el vínculo ambiguo
    Y puede continuar sin pedido o elegir una referencia de cliente verificable

  Escenario: Dos resoluciones simultáneas no sobrescriben la historia
    Dado que dos encargados tienen la misma versión de un caso
    Cuando ambos intentan resolverlo simultáneamente
    Entonces sólo una resolución agrega la siguiente versión y evento
    Y el segundo encargado recibe un conflicto y consulta el estado actual
