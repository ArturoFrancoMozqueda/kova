# language: es
Característica: Captación y postventa internas sin cuentas conectadas
  Escenario: Una solicitud pública conserva su privacidad tras la conversión
    Dado un catálogo publicado con productos activos
    Cuando una persona envía nombre, contacto, mensaje y referencia única
    Entonces recibe únicamente un comprobante de recepción
    Y no se crea venta, reserva ni consentimiento
    Cuando el encargado elige explícitamente un cliente y convierte la solicitud
    Entonces se crea una oportunidad vinculada sin ingreso
    Y repetir el envío público sólo devuelve el comprobante original

  Escenario: La política habilitada genera tareas sobre ventas reales sin mensajes
    Dado que el propietario habilitó seguimiento para una sucursal
    Y existe una venta nueva completada con cliente activo
    Cuando el procesador ejecuta dos veces
    Entonces existe una tarea de reseña neutral y una de recompra para la venta
    Y no se repiten tareas ni se envía comunicación
    Y una incidencia no condiciona la solicitud de reseña

  Escenario: Revocar la política preserva historial e incidentes
    Dado que existen tareas automáticas e incidencias pendientes
    Cuando el propietario desactiva la política con su versión actual
    Entonces los pendientes automáticos quedan descartados
    Y los incidentes permanecen pendientes
    Y las ventas y pagos no cambian
