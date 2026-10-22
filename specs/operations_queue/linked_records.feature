Feature: Abrir un pendiente en su módulo de origen
  Scenario: Abrir una entidad fuera de la primera página
    Given un pendiente propio cuyo ID no aparece en la primera página del módulo
    When sigo el enlace permitido desde la cola y recargo
    Then se consulta el registro por ID con tenant y sucursal vigentes
    And veo sus datos reales sin buscar sólo en la muestra paginada
    And no se modifica el registro por navegar

  Scenario: Enlace inválido o de otro negocio
    When abro un enlace con UUID inválido o con un ID que no pertenece a mi contexto
    Then se muestra un estado de registro no disponible sin datos ajenos
    And una respuesta tardía del contexto anterior no repone el registro

  Scenario: Recordatorio que dejó de estar disponible
    Given un enlace a un recordatorio de una cita reprogramada, cerrada o futura
    When consulto el recordatorio por ID
    Then recibo 404 sin suprimir ni completar el recordatorio por la lectura

  Scenario: Se conservan autorización y acceso comercial
    Given un enlace individual válido
    Then un cajero no puede consultar el registro
    And una suscripción bloqueada conserva el gate de acceso comercial
    And una petición sin sesión recibe 401
