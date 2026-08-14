Feature: Conciliación manual segura
  Scenario: Preview sin persistencia
    When un manager previsualiza un archivo válido
    Then ve filas normalizadas y errores accionables
    And no se crean entradas ni coincidencias

  Scenario: Commit idempotente
    When el manager confirma dos veces el mismo archivo con la misma clave y selección
    Then existe un solo batch con una entrada por fila seleccionada

  Scenario: Sugerencia explicable
    Given una entrada y pagos candidatos del mismo tenant
    When el sistema calcula sugerencias
    Then cada candidato muestra monto, ventana y razones de coincidencia
    And ninguno queda confirmado automáticamente

  Scenario: Confirmación concurrente
    When dos usuarios intentan asignar el mismo saldo simultáneamente
    Then no se sobreasigna la entrada ni el pago

  Scenario: Archivo peligroso
    When el usuario carga un archivo con macro, fórmula o contenido distinto a su formato declarado
    Then la importación se rechaza sin ejecutar ni registrar el contenido activo

  Scenario: Privacidad y aislamiento
    When un usuario de otro tenant consulta una entrada
    Then recibe recurso no encontrado
    And ningún log contiene datos bancarios completos

  Scenario: Venta aún offline
    Given una venta local no se ha sincronizado
    When el manager busca candidatos en conciliación
    Then esa venta no aparece hasta completar la sincronización
