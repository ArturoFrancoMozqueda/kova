# language: es
Característica: Pendientes internos desde registros reales
  Escenario: El gerente consulta pendientes sin crear nuevos efectos
    Dado que existen casos activos, oportunidades con próxima acción y seguimientos pendientes
    Y hay un recordatorio disponible de la versión vigente de una cita programada
    Cuando el gerente consulta la cola de su sucursal
    Entonces recibe cuatro secciones con campos reales y destinos conocidos
    Y no recibe notas, contactos, importes ni totales calculados desde muestras
    Y no cambia ningún estado ni se crea un evento o notificación

  Escenario: Los límites no se presentan como un total
    Dado que una sección tiene más de veinte registros elegibles
    Cuando se consulta la cola
    Entonces esa sección muestra veinte registros en orden de fecha e identificador
    Y has_more indica que hay más registros en su vista fuente
    Y los registros sin fecha quedan al final y no se marcan vencidos

  Escenario: Un recordatorio obsoleto deja de aparecer sin alterar su historial
    Dado que un recordatorio pendiente corresponde a una versión anterior de una cita
    Cuando se consulta la cola
    Entonces ese recordatorio no aparece en la sección de agenda
    Y la consulta conserva su estado original en la base de datos

  Escenario: La cola conserva el aislamiento y permisos existentes
    Dado que existen pendientes de dos negocios y varias sucursales
    Cuando un dueño o gerente consulta con su sucursal verificada
    Entonces sólo recibe registros de ese negocio y sucursal
    Y un cajero o una sesión sin acceso comercial no puede consultar la cola
