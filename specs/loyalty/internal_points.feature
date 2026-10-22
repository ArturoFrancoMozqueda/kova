# language: es
Característica: Lealtad interna trazable sin alterar el POS
  Escenario: Sólo las ventas reales desde la habilitación acumulan puntos
    Dado que la lealtad de una sucursal está inicialmente desactivada
    Cuando el propietario confirma importe MXN por tramo y puntos por tramo
    Y se registra una venta real con cliente
    Entonces el procesador agrega una entrada inmutable con redondeo hacia abajo
    Y repetir el procesamiento no duplica puntos
    Y los importes de venta, pago e inventario permanecen intactos

  Escenario: Cambiar la tasa no cambia los puntos de una venta anterior
    Dado que una venta se registró bajo una revisión habilitada
    Cuando el propietario cambia la tasa y después pausa la política
    Y se procesa aquella venta por primera vez
    Entonces se utiliza la tasa vigente cuando se registró la venta
    Y las ventas durante la pausa no acumulan puntos

  Escenario: Un canje requiere confirmación y no aplica descuentos
    Dado que un cliente tiene puntos disponibles
    Cuando el propietario confirma puntos y descripción de beneficio manual con saldo esperado
    Entonces se registra exclusivamente el débito de puntos
    Y no se acredita entrega ni se aplica descuento al POS
    Y dos canjes concurrentes no pueden consumir el mismo saldo

  Escenario: Una devolución posterior a un canje puede dejar saldo negativo
    Dado que el propietario ya registró un canje de puntos
    Cuando se devuelve o anula la venta que originó los puntos
    Entonces se agrega una reversa con la tasa original incluso si la política está desactivada
    Y se muestra el saldo negativo completo
    Y no se permiten nuevos canjes con puntos insuficientes
